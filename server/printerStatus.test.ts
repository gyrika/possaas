import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { networkPrinter } from './printer.ts';
import { printerQueue } from './printerStatus.ts';

test("Windows' view of the printer: its state and queue, a name with a quote in it kept safe, clearing the queue", async () => {
  const asked: string[] = [];
  const q = printerQueue({
    platform: 'win32',
    run: async (_c, args) => {
      asked.push(args.at(-1)!);
      return asked.length === 1 ? '{"status":"PaperOut","jobs":2,"offline":false}\r\n' : '2\r\n';
    },
  });
  assert.deepEqual(await q.state("Rasika's XP-80"), { status: 'PaperOut', jobs: 2, offline: false });
  assert.match(asked[0], /Get-Printer -Name 'Rasika''s XP-80'/);
  assert.equal(await q.clear("Rasika's XP-80"), 2);
  assert.match(asked[1], /Get-PrintJob -PrinterName 'Rasika''s XP-80'.*Remove-PrintJob/);
});

test('a printer Windows no longer knows is as good as off; elsewhere nothing is known', async () => {
  const gone = printerQueue({ platform: 'win32', run: async () => { throw new Error('No printer found'); } });
  assert.deepEqual(await gone.state('XP-80T'), { status: 'NotAvailable', jobs: 0, offline: false });
  assert.deepEqual(await printerQueue({ platform: 'linux' }).state('XP-80T'), { status: '', jobs: 0, offline: false });
});

test('a network printer: the receipt goes to its address as it is; Did it print? asks whether it answers', async () => {
  const got: Buffer[] = [];
  const fake = createServer((socket) => socket.on('data', (d: Buffer) => got.push(d)));
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const port = (fake.address() as { port: number }).port;
  try {
    await networkPrinter(`net:127.0.0.1:${port}`).print(Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([...Buffer.concat(got)], [0x1b, 0x40, 0x41, 0x0a]);
    assert.equal((await printerQueue({ platform: 'win32' }).state(`net:127.0.0.1:${port}`)).status, 'Normal');
  } finally {
    await new Promise((r) => fake.close(r));
  }
  assert.equal((await printerQueue({ platform: 'win32' }).state(`net:127.0.0.1:${port}`)).status, 'Offline', 'nothing answers: off');
  await assert.rejects(networkPrinter(`net:127.0.0.1:${port}`).print(Uint8Array.from([0x41])));
});

test('a USB receipt printer without its driver: free USB ports, and setting one up with Windows\' own driver', async () => {
  const asked: string[] = [];
  const q = printerQueue({ platform: 'win32', run: async (_c, args) => { asked.push(args.at(-1)!); return 'USB001\r\nUSB002\r\nnot a port\r\n'; } });
  assert.deepEqual(await q.freeUsbPorts(), ['USB001', 'USB002']);
  assert.equal(await q.addUsbPrinter('USB001'), 'Receipt printer (USB001)');
  assert.match(asked[1], /Add-Printer -Name 'Receipt printer \(USB001\)' -DriverName 'Generic \/ Text Only' -PortName 'USB001'/);
  await assert.rejects(q.addUsbPrinter("USB001'; Remove-Item C:\\"), /not a USB printer port/);
  assert.deepEqual(await printerQueue({ platform: 'linux' }).freeUsbPorts(), []);
});
