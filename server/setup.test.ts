import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { dryRunPrinter } from './printer.ts';
import { settingsFile } from './settings.ts';
import { isLocal, setupApi, shopIdFor } from './setup.ts';
import { memoryStore } from './store.ts';

async function start(cloudFetch?: typeof fetch, preConnected = Boolean(cloudFetch)) {
  let connected = 0;
  const dir = mkdtempSync(join(tmpdir(), 'cb-setup-'));
  const store = memoryStore();
  const settings = settingsFile(join(dir, 'settings.json'));
  const setup = setupApi({
    store, settings, usePrinter: () => {}, printsDir: join(dir, 'prints'), port: 8080,
    cloud: () => (preConnected ? { url: 'https://cloud.test', token: 'server-token' } : (settings.get().cloudToken
      ? { url: settings.get().cloudUrl!, token: settings.get().cloudToken! } : null)),
    cloudUrl: 'https://cloud.test', fetch: cloudFetch, onCloudConnected: () => { connected += 1; },
  });
  const server = createApp({ store, printer: dryRunPrinter(join(dir, 'prints')), setup, shop: setup.publicShop });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/setup`;
  const post = async (step: string, body: unknown = {}) => {
    const r = await fetch(base + step, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const state = async () => (await fetch(base)).json();
  const shop = async () => { const r = await fetch(base.replace('/setup', '/shop-details')); return { status: r.status, body: await r.json() }; };
  const stop = async () => { await new Promise<void>((r) => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); };
  return { post, state, shop, stop, store, settings, connected: () => connected };
}

test('a new shop: name it (this PC becomes the counter), add staff, finish only with an owner', async () => {
  const s = await start();
  // The printer list is whatever this PC has (and Windows may be slow to tell): not compared.
  const { printers: _printers, usbPorts: _usb, ...fresh } = await s.state();
  assert.deepEqual(fresh, { done: false, shop: null, printer: null, cloud: false });

  const named = await s.post('/shop', { name: 'Bata Kade', place: 'Galle' });
  assert.match(named.body.shopId, /^bata-kade-galle-[0-9a-f]{4}$/, 'a short random ending keeps shops apart in the cloud');
  assert.ok((await s.store.deviceByToken(named.body.counterToken))?.kind === 'counter', 'this PC is paired as the counter');
  assert.equal((await s.post('/shop', { name: 'Bata Kade', place: 'Galle' })).body.counterToken, undefined, 'only once');

  await s.post('/staff', { name: 'Nimal', role: 'cashier', pin: '1111' });
  assert.equal((await s.post('/finish')).status, 409, 'no owner yet');
  assert.equal((await s.post('/staff', { name: 'Kamal', role: 'cashier', pin: '1111' })).status, 409, 'PIN taken');
  assert.equal((await s.post('/staff', { name: 'X', role: 'boss', pin: '1234' })).status, 400);
  const added = await s.post('/staff', { name: 'Nisal Vimukthi', role: 'owner', pin: '1234' });
  assert.deepEqual(added.body.staff.map((m: { name: string }) => m.name).sort(), ['Nimal', 'Nisal Vimukthi']);
  assert.equal((await s.post('/finish')).status, 200);
  assert.equal((await s.state()).done, true);
  assert.equal((await s.state()).staff, undefined, 'after setup the staff list needs the PIN');
  await s.stop();
});

test("after setup every change needs the owner's PIN; a manager's will not do", async () => {
  const s = await start();
  await s.post('/shop', { name: 'Bata Kade', place: 'Galle' });
  await s.post('/staff', { name: 'Nisal Vimukthi', role: 'owner', pin: '1234' });
  await s.post('/staff', { name: 'Ravi', role: 'manager', pin: '2580' });
  await s.post('/finish');

  assert.equal((await s.post('/staff', { name: 'Kamal', role: 'cashier', pin: '3333' })).status, 401);
  assert.equal((await s.post('/staff', { name: 'Kamal', role: 'cashier', pin: '3333', ownerPin: '2580' })).status, 401);
  const ok = await s.post('/staff', { name: 'Kamal', role: 'cashier', pin: '3333', ownerPin: '1234' });
  assert.equal(ok.status, 200);
  const owner = ok.body.staff.find((m: { name: string }) => m.name === 'Nisal Vimukthi');
  assert.equal((await s.post('/staff/remove', { id: owner.id, ownerPin: '1234' })).status, 409, 'the last owner stays');
  assert.equal((await s.post('/shop', { name: 'Other' })).status, 409, 'the shop is not renamed by the wizard again');
  await s.stop();
});

test('QR links: a kitchen tablet on the Wi-Fi, an owner phone via the cloud', async () => {
  const cloudCalls: string[] = [];
  const cloud = (async (url: string | URL | Request, init?: RequestInit) => {
    cloudCalls.push(`${init?.method} ${String(url)} ${(init?.headers as Record<string, string>).authorization}`);
    return Response.json({ id: 'cloud-x', token: 'phone-token' });
  }) as typeof fetch;
  const s = await start(cloud);
  await s.post('/shop', { name: 'Bata Kade', place: 'Galle' });

  const kitchen = await s.post('/pair', { kind: 'kitchen' });
  if (kitchen.status === 200) {
    assert.match(kitchen.body.link, /^http:\/\/[\d.]+:8080\/\?pair=[\w-]+&shop=bata-kade-galle-[0-9a-f]{4}&as=kitchen#kitchen$/);
  } else {
    assert.equal(kitchen.body.error, 'not_ready'); // a machine with no network at all
  }
  // A shop with two kitchens: each screen's link says which kitchen it is.
  const right = await s.post('/pair', { kind: 'kitchen', station: 'right' });
  if (right.status === 200) assert.match(right.body.link, /&as=kitchen&station=right#kitchen$/);
  assert.equal((await s.post('/pair', { kind: 'kitchen', station: 'middle' })).status, 400);
  const phone = await s.post('/pair', { kind: 'owner' });
  assert.equal(phone.body.link, 'https://cloud.test/?owner=phone-token#owner');
  assert.deepEqual(cloudCalls, ['POST https://cloud.test/api/v1/devices Bearer server-token']);
  await s.stop();

  const noCloud = await start();
  await noCloud.post('/shop', { name: 'Bata Kade' });
  assert.equal((await noCloud.post('/pair', { kind: 'owner' })).status, 409);
  await noCloud.stop();
});

test('only the shop PC itself may set up', () => {
  const req = (remoteAddress: string) => ({ socket: { remoteAddress } }) as unknown as IncomingMessage;
  assert.equal(isLocal(req('127.0.0.1')), true);
  assert.equal(isLocal(req('::1')), true);
  assert.equal(isLocal(req('192.168.1.20')), false, 'a tablet on the Wi-Fi');
  assert.equal(shopIdFor('Bata Kade', 'Galle'), 'bata-kade-galle');
  assert.equal(shopIdFor('Café  Ño!', ''), 'cafe-no');
});

test('the cloud step: the shop code connects this shop, and copying starts without a restart', async () => {
  const sent: Record<string, unknown>[] = [];
  const cloud = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ url: String(url), ...body });
    return body.code === 'CB-7K3M-Q9XZ' ? Response.json({ token: 'new-server-token' }) : Response.json({}, { status: 403 });
  }) as typeof fetch;
  const s = await start(cloud, false);
  const { body: { shopId } } = await s.post('/shop', { name: 'Bata Kade', place: 'Galle' });
  assert.equal((await s.state()).cloud, false);

  const wrong = await s.post('/cloud', { code: 'NOPE' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.message, 'that shop code is not right');
  assert.equal((await s.post('/cloud', { code: 'CB-7K3M-Q9XZ' })).status, 200);
  const secret = s.settings.get().cloudSecret!;
  assert.ok(secret.length >= 40, "the shop's own secret, kept in its settings");
  assert.deepEqual(sent.at(-1), { url: 'https://cloud.test/api/v1/enrol', code: 'CB-7K3M-Q9XZ', shopId, name: 'Bata Kade Galle', secret });
  assert.equal(sent[0].secret, secret, 'the same secret every time: a lost answer can be tried again');
  assert.equal(s.settings.get().cloudToken, 'new-server-token');
  assert.equal(s.connected(), 1, 'copying started straight away');
  assert.equal((await s.state()).cloud, true);
  await s.stop();
});

test("updates: the owner's PIN after setup; development has nothing to install", async () => {
  const s = await start();
  await s.post('/shop', { name: 'Bata Kade', place: 'Galle' });
  await s.post('/staff', { name: 'Nisal Vimukthi', role: 'owner', pin: '1234' });
  await s.post('/finish');
  assert.equal((await s.post('/update/check', {})).status, 401);
  assert.equal((await s.post('/update/install', { ownerPin: '1234' })).status, 409, 'no updates set up here');
  await s.stop();
});

test("the shop's own name, town and receipt footer: for every screen, changed later only with the owner's PIN", async () => {
  const s = await start();
  assert.equal((await s.shop()).status, 404, 'nothing until the wizard names the shop');
  await s.post('/shop', { name: "Rasika's Kitchen", place: 'Kandy' });
  assert.deepEqual((await s.shop()).body, { name: "Rasika's Kitchen", place: 'Kandy', footer: 'Thank you!', paper: 80, payFirst: false });
  await s.post('/staff', { name: 'Rasika', role: 'owner', pin: '1234' });
  await s.post('/finish');
  const id = (await s.state()).shop.id;

  assert.equal((await s.post('/details', { name: 'X', place: '', footer: '' })).status, 401);
  assert.equal((await s.post('/details', { name: ' ', ownerPin: '1234' })).status, 400, 'never without a name');
  const saved = await s.post('/details', { name: "Rasika's Kitchen & Bakery", place: '12 Temple Road, Kandy', footer: '  Come again!  ', ownerPin: '1234' });
  assert.equal(saved.status, 200);
  assert.deepEqual((await s.shop()).body, { name: "Rasika's Kitchen & Bakery", place: '12 Temple Road, Kandy', footer: 'Come again!', paper: 80, payFirst: false });
  assert.equal((await s.state()).shop.id, id, 'the id (and the cloud copy) never changes with the name');
  await s.post('/details', { name: "Rasika's Kitchen", place: 'Kandy', footer: '', ownerPin: '1234' });
  assert.equal((await s.shop()).body.footer, '', 'an empty footer stays empty');
  await s.stop();
});

test("the shop's logo: beside its name on every screen, only a small picture, taken away with null", async () => {
  const s = await start();
  await s.post('/shop', { name: 'Bata Kade', place: 'Galle' });
  await s.post('/staff', { name: 'Owner', role: 'owner', pin: '1234' });
  await s.post('/finish');
  const logo = 'data:image/webp;base64,UklGRg==';
  assert.equal((await s.post('/logo', { logo })).status, 401);
  assert.equal((await s.post('/logo', { logo: 'https://example.com/a.png', ownerPin: '1234' })).status, 400, 'a picture, never a link');
  assert.equal((await s.post('/logo', { logo: `data:image/png;base64,${'A'.repeat(200_000)}`, ownerPin: '1234' })).status, 400, 'too big');
  assert.equal((await s.post('/logo', { logo, ownerPin: '1234' })).status, 200);
  assert.equal((await s.shop()).body.logo, logo);
  assert.equal((await s.post('/logo', { logo: null, ownerPin: '1234' })).status, 200);
  assert.equal((await s.shop()).body.logo, undefined);
  await s.stop();
});

test('Shop setup → Shop: customers pay first, for every screen; changed later only with the owner\'s PIN', async () => {
  const s = await start();
  await s.post('/shop', { name: 'Rice Bowl', place: 'Galle' });
  assert.equal((await s.post('/pay-when', { payFirst: 'yes' })).status, 400);
  assert.equal((await s.post('/pay-when', { payFirst: true })).status, 200, 'during setup the PC itself is enough');
  assert.equal((await s.shop()).body.payFirst, true);
  await s.post('/staff', { name: 'Owner', role: 'owner', pin: '1234' });
  await s.post('/finish');
  assert.equal((await s.post('/pay-when', { payFirst: false })).status, 401);
  assert.equal((await s.post('/pay-when', { payFirst: false, ownerPin: '1234' })).status, 200);
  assert.equal((await s.shop()).body.payFirst, false);
  await s.stop();
});

test("Shop setup → Help: the support file on the desktop, with the owner's PIN after setup", async () => {
  let made = 0;
  const dir = mkdtempSync(join(tmpdir(), 'cb-setup-support-'));
  const store = memoryStore();
  const settings = settingsFile(join(dir, 'settings.json'));
  const setup = setupApi({
    store, settings, usePrinter: () => {}, printsDir: join(dir, 'prints'), port: 8080, cloud: () => null, cloudUrl: 'https://cloud.test',
    support: async () => { made += 1; return { name: 'Lume POS support 2026-10-21 1432.zip', path: 'C:\\Users\\Public\\Desktop\\Lume POS support 2026-10-21 1432.zip' }; },
  });
  await setup.nameShop({ name: 'Shop', place: '' });
  assert.deepEqual(await setup.saveSupport({}), { name: 'Lume POS support 2026-10-21 1432.zip', path: 'C:\\Users\\Public\\Desktop\\Lume POS support 2026-10-21 1432.zip' });
  await setup.addStaff({ name: 'Owner', role: 'owner', pin: '1234' });
  await setup.finish();
  await assert.rejects(setup.saveSupport({}), /owner's PIN/);
  assert.equal((await setup.saveSupport({ ownerPin: '1234' })).name, 'Lume POS support 2026-10-21 1432.zip');
  assert.equal(made, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("Shop setup → Printer: 58 mm paper for every screen's receipts; Windows' view of the printer and clearing its queue", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-setup-printer-'));
  const settings = settingsFile(join(dir, 'settings.json'));
  const cleared: string[] = [];
  const usb = { added: '' };
  const setup = setupApi({
    store: memoryStore(), settings, usePrinter: () => {}, printsDir: join(dir, 'prints'), port: 8080, cloud: () => null, cloudUrl: 'https://cloud.test',
    queue: {
      state: async (name) => ({ status: name === 'XP-58' ? 'PaperOut' : 'Normal', jobs: 2, offline: false }),
      clear: async (name) => { cleared.push(name); return 2; },
      freeUsbPorts: async () => (usb.added ? [] : ['USB001']),
      addUsbPrinter: async (port) => { usb.added = port; return `Receipt printer (${port})`; },
    },
  });
  await setup.nameShop({ name: 'Shop', place: '' });
  await assert.rejects(setup.printerState({}), /choose a printer first/);
  settings.set({ printer: 'XP-58' });
  assert.deepEqual(await setup.printerState({}), { state: { status: 'PaperOut', jobs: 2, offline: false } });
  assert.deepEqual(await setup.clearPrinter({}), { cleared: 2 });
  assert.deepEqual(cleared, ['XP-58']);
  await assert.rejects(setup.setPaper({ width: 76 }), /58 or 80/);
  assert.deepEqual(await setup.setPaper({ width: 58 }), { paper: 58 });
  assert.equal(setup.publicShop()?.paper, 58);
  // A network printer by its address, no driver; a USB one without its driver, on Windows' own.
  assert.deepEqual(await setup.setPrinter({ name: 'net:192.168.1.50' }), { printer: 'net:192.168.1.50' });
  await assert.rejects(setup.setPrinter({ name: 'net:bad address!' }), /no printer called/);
  assert.deepEqual((await setup.state()).usbPorts, ['USB001']);
  await assert.rejects(setup.addUsbPrinter({ port: 'USB002' }), /no receipt printer waiting/);
  assert.deepEqual(await setup.addUsbPrinter({ port: 'USB001' }), { printer: 'Receipt printer (USB001)' });
  assert.equal(settings.get().printer, 'Receipt printer (USB001)');
  assert.deepEqual((await setup.state()).usbPorts, []);
  await setup.addStaff({ name: 'Owner', role: 'owner', pin: '1234' });
  await setup.finish();
  await assert.rejects(setup.setPaper({ width: 80 }), /owner's PIN/);
  await assert.rejects(setup.clearPrinter({}), /owner's PIN/);
  rmSync(dir, { recursive: true, force: true });
});
