import { test } from 'node:test';
import assert from 'node:assert/strict';
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
