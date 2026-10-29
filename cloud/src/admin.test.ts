import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SyncEvent } from '../../src/domain/sync.ts';
import { adminRoutes, ago, signedIn, startOfDayColombo } from './admin.ts';
import { createCloud, sha256Hex, updateStatus } from './cloud.ts';
import { fakeD1 } from './fakeD1.ts';

const KEY = 'k'.repeat(10) + 'Zq3_-x9PpLm2Vb8RtYw4Nc7Hs1Df6Gj0Ae5'; // 45 characters, like the generated one
const NOW = Date.UTC(2026, 9, 14, 12, 0); // 17:30 in Sri Lanka

const req = (path: string, init: RequestInit & { session?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.session) headers.set('cookie', init.session);
  return new Request(`https://cloud.test${path}`, { ...init, headers });
};
const login = (key: string) => req('/admin/login', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key }),
});
/** The session from a Set-Cookie header, as a browser sends it back. */
const sessionOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];

async function setup() {
  const { d1, db } = fakeD1();
  for (const [shop, token] of [['shop-a', 'server-a'], ['shop-b', 'server-b']]) {
    db.prepare('INSERT INTO shops (id, name, created_at) VALUES (?, ?, 0)').run(shop, shop === 'shop-a' ? 'Bata Kade Galle' : 'Test shop');
    db.prepare("INSERT INTO devices (id, tenant_id, kind, token_hash, created_at) VALUES (?, ?, 'shop_server', ?, 0)")
      .run(`dev-${token}`, shop, await sha256Hex(token));
  }
  const cloud = createCloud(d1, { now: () => NOW });
  const admin = (r: Request) => adminRoutes(r, new URL(r.url), {
    db: d1, key: KEY, latest: async () => '1.0.5', now: () => NOW,
    // Like Cloudflare's static files: '/index.html' answers with a redirect to '/'.
    app: async (r: Request) => new URL(r.url).pathname === '/'
      ? new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } })
      : new Response(null, { status: 307, headers: { location: '/' } }),
  });
  const session = sessionOf((await admin(login(KEY)))!);
  return { cloud, admin, db, session };
}

const paid = (id: string, at: number): SyncEvent =>
  ({ type: 'order.paid', id, shopId: 'shop-a', at, actor: { id: 'c', name: 'Kasun', role: 'cashier' }, orderNumber: 1, total: 150000, tender: 'cash', tendered: 150000 });

test('each copy pass tells the cloud the version and the last update; the admin list shows every shop', async () => {
  const { cloud, admin, session } = await setup();
  const update = JSON.stringify({ phase: 'done', percent: 100, version: '1.0.4', at: NOW - 5 * 60_000, extra: 'dropped' });
  const r = await cloud(new Request('https://cloud.test/api/v1/replica', {
    method: 'POST',
    headers: { authorization: 'Bearer server-a', 'content-type': 'application/json', 'x-station-version': '1.0.4', 'x-station-update': update },
    body: JSON.stringify({ events: [{ seq: 1, deviceId: 'pc', receivedAt: NOW - 60_000, event: paid('p1', NOW - 60_000) }] }),
  }));
  assert.equal(r.status, 200);

  const page = await (await admin(req('/admin', { session })))!.text();
  assert.match(page, /1 of 2 online · latest release 1\.0\.5 · 1 still to update/);
  assert.match(page, /Bata Kade Galle/);
  assert.match(page, /Version 1\.0\.4 · 1\.0\.5 waiting/);
  assert.match(page, /Updated 1\.0\.4 · 5 min ago/);
  assert.match(page, /Last sale 1 min ago · 1 events today/);
  assert.match(page, /Offline · never/, 'the test shop never checked in');
  assert.ok(page.indexOf('Bata Kade Galle') < page.indexOf('Test shop'), 'online shops first');
});

test('a shop server cannot store anything odd in its status', () => {
  assert.equal(updateStatus('{"phase":"done","percent":100,"version":"1.0.4","at":5}'), '{"phase":"done","percent":100,"version":"1.0.4","at":5}');
  assert.equal(updateStatus('{"phase":"<script>"}'), null);
  assert.equal(updateStatus('not json'), null);
  assert.equal(updateStatus('x'.repeat(600)), null);
  assert.equal(updateStatus('{"phase":"done","version":"<b>"}'), '{"phase":"done","percent":0,"version":"","at":0}');
});

test('the admin reads any shop, and only once signed in', async () => {
  const { cloud, admin, session } = await setup();
  await cloud(new Request('https://cloud.test/api/v1/replica', {
    method: 'POST', headers: { authorization: 'Bearer server-a', 'content-type': 'application/json' },
    body: JSON.stringify({ events: [{ seq: 1, deviceId: 'pc', receivedAt: 1, event: paid('p1', 1) }] }),
  }));

  const events = await (await admin(req('/admin/api/shops/shop-a/events?after=0', { session })))!.json();
  assert.deepEqual(events.events.map((e: { event: SyncEvent }) => e.event.id), ['p1']);
  const shopPage = (await admin(req('/admin/shop/shop-a', { session })))!;
  assert.equal(shopPage.status, 200, 'the app itself, never a redirect off the shop\'s address');
  assert.match(await shopPage.text(), /id="root"/);
  assert.equal((await admin(req('/admin/shop/no-such-shop', { session })))!.status, 404);

  for (const path of ['/admin/api/shops/shop-a/events', '/admin/shop/shop-a']) {
    assert.equal((await admin(req(path)))!.status, 403, `${path} without signing in`);
  }
  const box = await (await admin(req('/admin')))!.text();
  assert.match(box, /Admin password/, 'not signed in: the sign-in box');
  assert.doesNotMatch(box, /Bata Kade Galle/, '...and nothing about any shop');
});

test('signing in: the right password gives a 30-day session cookie no script can read; nothing else does', async () => {
  const { admin } = await setup();
  const ok = (await admin(login(`  ${KEY}\n`)))!; // pasted with spaces around
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/admin');
  const set = ok.headers.get('set-cookie')!;
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/admin', `Max-Age=${30 * 86_400}`]) assert.ok(set.includes(flag), flag);
  assert.ok(!set.includes(KEY), 'the password itself is never in the cookie');

  const wrong = (await admin(login(KEY.slice(0, -1) + 'x')))!;
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.match(await wrong.text(), /That password is not right/);

  const session = sessionOf(ok);
  assert.equal(await signedIn(req('/admin', { session }), KEY, NOW), true);
  const [until, sig] = session.split('=')[1].split('.');
  assert.equal(await signedIn(req('/admin', { session: `cb_admin=${Number(until) + 1}.${sig}` }), KEY, NOW), false, 'a longer session, forged');
  assert.equal(await signedIn(req('/admin', { session }), KEY, Number(until) + 1), false, 'after 30 days');
  assert.equal(await signedIn(req('/admin', { session }), 'another-key-'.repeat(4), NOW), false, 'a new password signs everyone out');

  const out = (await admin(req('/admin/logout', { method: 'POST', session })))!;
  assert.match(out.headers.get('set-cookie')!, /^cb_admin=; .*Max-Age=0/);
});

test('the laptop\'s server reads the shop list and events with the password as a key; a wrong key gets nothing', async () => {
  const { admin } = await setup();
  const key = (k: string) => ({ headers: { authorization: `Bearer ${k}` } });
  const list = await (await admin(req('/admin/api/shops', key(KEY))))!.json();
  assert.deepEqual(list.shops.map((r: { name: string }) => r.name).sort(), ['Bata Kade Galle', 'Test shop']);
  assert.equal(list.latest, '1.0.5');
  assert.equal((await admin(req('/admin/api/shops/shop-a/events', key(KEY))))!.status, 200);
  assert.equal((await admin(req('/admin/api/shops', key('wrong'))))!.status, 403);
  assert.equal((await admin(req('/admin', key(KEY))))!.status, 200);
  assert.match(await (await admin(req('/admin', key(KEY))))!.text(), /Admin password/, 'the key opens the data, not the signed-in pages');
});

test('without a password, or with a short one, /admin does not exist', async () => {
  for (const key of [null, 'short-password']) {
    const r = await adminRoutes(req('/admin'), new URL('https://cloud.test/admin'), {
      db: fakeD1().d1, key, latest: async () => null, app: async () => new Response(''),
    });
    assert.equal(r!.status, 404);
  }
});

test('times read the way the shop lives them', () => {
  assert.equal(new Date(startOfDayColombo(NOW)).toISOString(), '2026-10-13T18:30:00.000Z', 'midnight in Sri Lanka');
  assert.equal(ago(null, NOW), 'never');
  assert.equal(ago(NOW - 20_000, NOW), 'just now');
  assert.equal(ago(NOW - 3 * 3_600_000, NOW), '3 h ago');
  assert.equal(ago(NOW - 3 * 86_400_000, NOW), '3 days ago');
});

test('shops with something wrong come first, each problem in one line', async () => {
  const { cloud, admin, db, session } = await setup();
  // The test shop checks in now with a failed update; Bata Kade Galle has never checked in.
  const failed = JSON.stringify({ phase: 'failed', percent: 0, version: '1.0.5', at: NOW - 2 * 3_600_000 });
  await cloud(new Request('https://cloud.test/api/v1/replica', {
    method: 'POST',
    headers: { authorization: 'Bearer server-b', 'content-type': 'application/json', 'x-station-version': '1.0.5', 'x-station-update': failed },
    body: JSON.stringify({ events: [] }),
  }));
  // Three short closes in a row at the test shop (the ledger is empty: the counts alone say what was taken).
  for (const back of [1, 2, 3]) {
    const from = startOfDayColombo(NOW) - back * 86_400_000 + 5 * 3_600_000;
    const body = { type: 'day.closed', id: `close-${back}`, shopId: 'shop-b', at: from + 12 * 3_600_000, orderNumber: 0, from, to: from + 12 * 3_600_000,
      float: 500000, counted: 490000, count: { byTender: { cash: { cents: 0, orders: 0 } } } };
    db.prepare("INSERT INTO events (tenant_id, id, source_seq, source_device, type, order_number, at, received_at, copied_at, body) VALUES ('shop-b', ?, ?, 'pc', 'day.closed', 0, ?, ?, ?, ?)")
      .run(body.id, back, body.at, body.at, body.at, JSON.stringify(body));
  }

  const { shops } = await (await admin(req('/admin/api/shops', { session })))!.json();
  assert.deepEqual(shops.map((s: { name: string; problems: { level: string; text: string }[] }) => [s.name, s.problems.map((p) => `${p.level}: ${p.text}`)]), [
    ['Test shop', ['bad: Update to 1.0.5 failed 2 h ago', 'warn: Cash short at the last 3 closes: Rs 300 in all']],
    ['Bata Kade Galle', ['warn: Has not checked in yet']],
  ]);
  const page = await (await admin(req('/admin', { session })))!.text();
  assert.match(page, /2 need attention · 1 of 2 online/);
  assert.match(page, /class="shop is-bad"/);
  assert.match(page, /<li class="warn">Cash short at the last 3 closes: Rs 300 in all<\/li>/);
});

test('the audit log keeps every sign-in, wrong password and shop opened, once per reading', async () => {
  const { admin, session } = await setup(); // setup signed in once
  await admin(login('wrong'));
  await admin(req('/admin/shop/shop-a', { session }));
  await admin(req('/admin/api/shops/shop-a/events?after=0', { headers: { authorization: `Bearer ${KEY}`, 'cf-connecting-ip': '203.0.113.9' } }));
  await admin(req('/admin/api/shops/shop-a/events?after=40', { session })); // the next page of the same reading
  await admin(req('/admin/logout', { method: 'POST', session }));

  const page = await (await admin(req('/admin/log', { session })))!.text();
  const order = ['Signed out', "Read the shop's data", 'Opened the shop', 'Wrong password', 'Signed in'];
  const at = order.map((w) => page.search(new RegExp(w)));
  assert.ok(at.every((i) => i > 0), `all five are there: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'newest first');
  assert.match(page, /Laptop · 203\.0\.113\.9/);
  assert.equal((page.match(/Read the shop/g) ?? []).length, 1, 'the next page is not logged again');
  assert.equal((await admin(req('/admin/log', { headers: { authorization: `Bearer ${KEY}` } })))!.status, 403, 'the key does not open the log');
});

test('removing a shop: only by typing its id, everything of it goes, every other shop stays', async () => {
  const { cloud, admin, db, session } = await setup();
  for (const [token, id] of [['server-a', 'a1'], ['server-b', 'b1']]) {
    await cloud(new Request('https://cloud.test/api/v1/replica', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ seq: 1, deviceId: 'pc', receivedAt: NOW, event: { ...paid(id, NOW), shopId: token === 'server-a' ? 'shop-a' : 'shop-b' } }] }),
    }));
  }
  const form = (confirm: string) => req('/admin/shops/shop-b/remove', {
    method: 'POST', session, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ confirm }),
  });

  const ask = await (await admin(req('/admin/shops/shop-b/remove', { session })))!.text();
  assert.match(ask, /Remove Test shop/);
  assert.match(ask, /1 events, 1 sales and 1 linked devices/);

  const wrong = (await admin(form('shop-a')))!;
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /Nothing was removed/);
  assert.equal((await admin(req('/admin/shops/shop-b/remove', { method: 'POST', headers: { authorization: `Bearer ${KEY}` } })))!.status, 403, 'never with the laptop key');
  assert.equal((await admin(req('/admin/shops/shop-b/remove', { method: 'POST' })))!.status, 403, 'never without signing in');

  const done = (await admin(form(' shop-b ')))!;
  assert.equal(done.status, 303);
  const left = (table: string) => db.prepare(`SELECT tenant_id FROM ${table} ORDER BY tenant_id`).all().map((r) => (r as { tenant_id: string }).tenant_id);
  for (const t of ['events', 'sales', 'devices']) assert.deepEqual(left(t), ['shop-a'], t);
  assert.deepEqual(db.prepare('SELECT id FROM shops').all().map((r) => (r as { id: string }).id), ['shop-a']);
  assert.throws(() => db.prepare("DELETE FROM events WHERE tenant_id = 'shop-a'").run(), /events are never deleted/, 'other shops\' events still never go');
  // The removed shop's PC can no longer copy in.
  const push = await cloud(new Request('https://cloud.test/api/v1/replica', {
    method: 'POST', headers: { authorization: 'Bearer server-b', 'content-type': 'application/json' }, body: JSON.stringify({ events: [] }),
  }));
  assert.equal(push.status, 401);
  assert.match(await (await admin(req('/admin/log', { session })))!.text(), /Removed the shop<\/td><td>Test shop/);
  assert.equal((await admin(req('/admin/shops/shop-b/remove', { session })))!.status, 404, 'gone');
});
