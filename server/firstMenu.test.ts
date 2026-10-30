import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { EMPTY_START, effectiveMenu, menuStateFromEvents } from '../src/domain/menuEdits.ts';
import type { PullResponse, SyncEvent } from '../src/domain/sync.ts';
import { BATA_KADE_MENU } from '../src/shop/bataKade.ts';
import { createApp } from './app.ts';
import { firstMenu } from './firstMenu.ts';
import { memoryStore, type EventStore } from './store.ts';
import { validatePush } from './validate.ts';

const SHOP = 'shop-bata';

/** A shop server with the first-menu step, and its counter's pull. */
async function shop(store: EventStore, counterToken?: string) {
  const counter = counterToken ? { token: counterToken } : await store.addDevice(SHOP, 'Bata Kade', 'counter');
  const server = createApp({ store, now: () => 5000, firstMenu: firstMenu({ store, menu: BATA_KADE_MENU, shopId: () => SHOP, now: () => 5000 }) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pull = async (token = counter.token) =>
    (await (await fetch(`${base}/api/v1/events?after=0`, { headers: { authorization: `Bearer ${token}` } })).json()) as PullResponse;
  const stop = () => new Promise<void>((r) => server.close(() => r()));
  return { pull, stop, token: counter.token };
}

test("a shop with no menu gets Bata Kade's menu on its counter's first pull: every item, at its price, by Lume POS", async () => {
  const store = memoryStore();
  const s = await shop(store);
  const events = (await s.pull()).events.map((e) => e.event);
  const menu = effectiveMenu(EMPTY_START, menuStateFromEvents(events), 0);
  assert.equal(menu.length, BATA_KADE_MENU.items.length);
  assert.equal(menu.find((m) => m.name.en === 'Chicken Kottu')!.variants!.map((v) => v.price).join(), '50000,80000');
  assert.ok(events.every((e) => 'actor' in e && e.actor.name === 'Lume POS'));
  // The cloud checks every copied event the same way: the menu must pass.
  assert.ok(!('reason' in validatePush({ events }, SHOP)));
  await s.stop();
});

test('the menu is added once: a restarted server, or a second pull, adds nothing', async () => {
  const store = memoryStore();
  const first = await shop(store);
  const n = (await first.pull()).events.length;
  assert.equal((await first.pull()).events.length, n);
  await first.stop();
  const again = await shop(store, first.token);
  assert.equal((await again.pull()).events.length, n);
  await again.stop();
});

test("a shop that had other menu changes still gets the menu; the owner's own changes stay; a kitchen screen adds nothing", async () => {
  const store = memoryStore();
  const counter = await store.addDevice(SHOP, 'Bata Kade', 'counter');
  const owner = { id: 'o', name: 'Owner', role: 'owner' as const };
  const s = await shop(store, counter.token);
  await s.pull();
  // The owner takes Milo off and changes the Egg Kottu price; then the server restarts.
  const at = 6000;
  const own = [
    { id: 'o1', shopId: SHOP, at, orderNumber: 0, actor: owner, type: 'menu.item_added', itemId: 'new-ot-milo', item: null },
    { id: 'o2', shopId: SHOP, at, orderNumber: 0, actor: owner, type: 'menu.price_set', itemId: 'new-kt-egg', before: {}, after: { prices: { normal: 50000, full: 70000 } } },
  ] as SyncEvent[];
  await store.push({ id: counter.device.id, tenantId: SHOP, kind: 'counter' }, own, at);
  await s.stop();
  const again = await shop(store, counter.token);
  const menu = effectiveMenu(EMPTY_START, menuStateFromEvents((await again.pull()).events.map((e) => e.event)), 0).filter((m) => !m.hidden);
  assert.equal(menu.find((m) => m.name.en === 'Milo'), undefined);
  assert.equal(menu.find((m) => m.name.en === 'Egg Kottu')!.variants!.map((v) => v.price).join(), '50000,70000');
  assert.equal(menu.length, BATA_KADE_MENU.items.length - 1);
  await again.stop();

  const fresh = memoryStore();
  const kitchen = await fresh.addDevice(SHOP, 'Bata Kade', 'kitchen');
  const k = await shop(fresh, kitchen.token);
  assert.equal((await k.pull()).events.length, 0);
  await k.stop();
});

test('a test PC that had its own menu sections gets the menu too', async () => {
  const store = memoryStore();
  const counter = await store.addDevice(SHOP, 'Bata Kade', 'counter');
  const old = { id: 'm1', shopId: SHOP, at: 1, orderNumber: 0, actor: { id: 'o', name: 'Owner', role: 'owner' },
    type: 'menu.section_set', sectionId: 'sec-tea', section: null } as SyncEvent;
  await store.push({ id: counter.device.id, tenantId: SHOP, kind: 'counter' }, [old], 1);
  const s = await shop(store, counter.token);
  const menu = effectiveMenu(EMPTY_START, menuStateFromEvents((await s.pull()).events.map((e) => e.event)), 0);
  assert.equal(menu.length, BATA_KADE_MENU.items.length);
  await s.stop();
});
