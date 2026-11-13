import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startReplicator } from '../../server/replicator.ts';
import { memoryStore } from '../../server/store.ts';
import { adminRoutes, otherSystems } from './admin.ts';
import { createCloud, sha256Hex } from './cloud.ts';
import { fakeD1 } from './fakeD1.ts';

const KEY = 'k'.repeat(10) + 'Zq3_-x9PpLm2Vb8RtYw4Nc7Hs1Df6Gj0Ae5';
const NOW = Date.UTC(2026, 10, 13, 6, 0);
const req = (path: string, init: RequestInit & { session?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.session) headers.set('cookie', init.session);
  return new Request(`https://cloud.test${path}`, { ...init, headers });
};
const OTHERS = otherSystems(JSON.stringify([
  { name: 'CheesyBeez', place: 'Thalwila', about: 'ERP repo, its own cloud', url: 'https://cheesybeez.example/admin' },
  { name: 'Not a link', url: 'javascript:alert(1)' },
]));

async function setup() {
  const { d1, db } = fakeD1();
  db.prepare("INSERT INTO shops (id, name, created_at) VALUES ('bata-kade', 'Bata Kade', 0)").run();
  db.prepare("INSERT INTO devices (id, tenant_id, kind, token_hash, created_at) VALUES ('dev-bk', 'bata-kade', 'shop_server', ?, 0)").run(await sha256Hex('server-bk'));
  const cloud = createCloud(d1, { now: () => NOW });
  const admin = async (r: Request) => (await adminRoutes(r, new URL(r.url), { db: d1, key: KEY, latest: async () => null, now: () => NOW, app: async () => new Response(''), others: OTHERS }))!;
  const login = await admin(req('/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key: KEY }) }));
  const session = login.headers.get('set-cookie')!.split(';')[0];
  return { db, cloud, admin, session };
}

test("a shop's parts: switched on /admin, logged with what changed, picked up by the shop, which says it has them", async () => {
  const { db, cloud, admin, session } = await setup();
  const page = await (await admin(req('/admin/shops/bata-kade/parts', { session }))).text();
  assert.match(page, /Bata Kade · parts/);
  assert.match(page, /name="twoKitchens" role="switch">/, 'two kitchens off by default');
  assert.match(page, /name="kitchen" role="switch">/, 'the kitchen screen off by default');
  assert.match(page, /name="cashOut" role="switch" checked>/);
  assert.match(page, /Waiting for the shop/);

  // Two kitchens on, busy mode off (an unticked box is simply not sent).
  const form = new URLSearchParams({ twoKitchens: 'on', cashOut: 'on', onlineOrders: 'on', ownerPhone: 'on' });
  const saved = await admin(req('/admin/shops/bata-kade/parts', { method: 'POST', session, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }));
  assert.equal(saved.status, 303);
  const log = db.prepare("SELECT action, shop_id, detail FROM admin_log WHERE action = 'changed-parts'").all();
  assert.deepEqual(log.map((r) => ({ ...r })), [{ action: 'changed-parts', shop_id: 'bata-kade', detail: 'Two kitchens on, Busy mode off' }]);
  assert.match(await (await admin(req('/admin/log', { session }))).text(), /Changed the parts: Two kitchens on, Busy mode off/);

  // The shop server's next copy pass brings them, and tells the cloud it has them.
  const store = memoryStore();
  let kept = {};
  const rep = startReplicator({
    store, tenantId: 'bata-kade', url: 'https://cloud.test', token: 'server-bk', every: 3_600_000, now: () => NOW,
    fetch: (async (url: string, init?: RequestInit) => cloud(new Request(String(url), init))) as typeof fetch,
    about: () => ({ version: '0.1.16', update: null, features: kept }),
    onFeatures: (f) => { kept = f; },
  });
  await rep.syncNow();
  assert.deepEqual(kept, { kitchen: false, twoKitchens: true, cashOut: true, busyMode: false, onlineOrders: true, ownerPhone: true, serving: false });
  await rep.syncNow(); // the next pass says what it now has
  rep.stop();
  assert.match(await (await admin(req('/admin/shops/bata-kade/parts', { session }))).text(), /The shop has these/);
  assert.doesNotMatch(await (await admin(req('/admin', { session }))).text(), /waiting for the shop/);

  // Saving the same again changes nothing and logs nothing.
  await admin(req('/admin/shops/bata-kade/parts', { method: 'POST', session, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'changed-parts'").get()!.n, 1);
});

test('parts are for the signed-in admin only; never with the laptop key, never without signing in', async () => {
  const { admin } = await setup();
  assert.equal((await admin(req('/admin/shops/bata-kade/parts'))).status, 403);
  assert.equal((await admin(req('/admin/shops/bata-kade/parts', { headers: { authorization: `Bearer ${KEY}` } }))).status, 403);
  assert.equal((await admin(req('/admin/shops/no-such-shop/parts', { session: (await setup()).session }))).status, 404);
});

test('other systems are listed apart, a link to their own admin; nothing of theirs is stored here', async () => {
  const { admin, session } = await setup();
  assert.deepEqual(OTHERS.map((o) => o.name), ['CheesyBeez'], 'only https links');
  const page = await (await admin(req('/admin', { session }))).text();
  assert.match(page, /<h2 class="section">Other systems<\/h2>/);
  assert.match(page, /href="https:\/\/cheesybeez.example\/admin"[^>]*>CheesyBeez<\/a>/);
  assert.match(page, /Thalwila · ERP repo, its own cloud/);
  assert.ok(page.indexOf('Bata Kade') < page.indexOf('Other systems'), 'the Lume POS shops come first');
});
