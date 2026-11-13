import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { EMPTY_MENU_STATE, EMPTY_START, effectiveMenu, menuStateFromEvents } from '../src/domain/menuEdits.ts';
import { loadMenu, menuFile, menuLoadEvents, type MenuLoad } from '../src/domain/menuFile.ts';
import type { PullResponse, SyncEvent } from '../src/domain/sync.ts';
import { menuUpdateEvents } from '../src/domain/menuUpdate.ts';
import { BATA_KADE_MENU, BATA_KADE_UPDATES } from '../src/shop/bataKade.ts';
import { createApp } from './app.ts';
import { MENU_INSTALLER, firstMenu } from './firstMenu.ts';
import { memoryStore, type EventStore } from './store.ts';
import { validatePush } from './validate.ts';

const SHOP = 'shop-bata';

/** The cloud takes copied events in batches of 100 (server/replicator.ts) and checks each one. */
const cloudTakes = (events: SyncEvent[]) => {
  for (let i = 0; i < events.length; i += 100) {
    const r = validatePush({ events: events.slice(i, i + 100) }, SHOP);
    assert.ok(!('reason' in r), 'reason' in r ? r.reason : '');
  }
};

/** A shop server with the first-menu step, and its counter's pull. */
async function shop(store: EventStore, counterToken?: string) {
  const counter = counterToken ? { token: counterToken } : await store.addDevice(SHOP, 'Bata Kade', 'counter');
  const server = createApp({ store, now: () => 5000, firstMenu: firstMenu({ store, menu: BATA_KADE_MENU, updates: BATA_KADE_UPDATES, shopId: () => SHOP, now: () => 5000 }) });
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
  assert.equal(menu.find((m) => m.name.en === 'Chicken Kottu')!.variants!.map((v) => v.price).join(), '50000,75000');
  assert.ok(events.every((e) => 'actor' in e && e.actor.name === 'Lume POS'));
  // The cloud checks every copied event the same way: the menu must pass.
  cloudTakes(events);
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

/** Released before 2026-11-14 (v0.1.18): tea, coffee and malt drinks in Other, rolls, roti and wade in a section of their own. */
const MOVED_TO_DRINKS = ['ot-plain-tea', 'ot-milk-tea', 'ot-coffee', 'ot-milk-coffee', 'ot-nestomalt', 'ot-milo'];
const MOVED_TO_MEALS = ['rt-egg-roll', 'rt-veg-roti', 'rt-egg-roti', 'rt-wade'];

test("a shop with the old menu gets each menu update once: new prices, Half / Full, bread and string hoppers with extras, one biriyani, fewer sections; the owner's own changes stay", async () => {
  const store = memoryStore();
  const counter = await store.addDevice(SHOP, 'Bata Kade', 'counter');
  const owner = { id: 'o', name: 'Owner', role: 'owner' as const };
  // What a shop PC got from the menu before 2026-11-13 (same event ids), then the owner's own change.
  const load = loadMenu(menuFile(BATA_KADE_MENU, EMPTY_MENU_STATE), { sections: [], items: [] }) as MenuLoad;
  const old = menuLoadEvents(load, SHOP, MENU_INSTALLER, 1).map((e) => {
    if (e.type === 'menu.section_set' && e.sectionId === 'sec-fried-rice') {
      return { ...e, section: { ...e.section, hours: { from: 1080, to: 300 }, sizes: [{ id: 'normal', label: 'Normal' }, { id: 'full', label: 'Full' }] } };
    }
    if (e.type === 'menu.item_added' && e.itemId === 'new-rc-m-egg') return { ...e, item: { ...e.item, prices: { normal: 25000 } } };
    if (e.type === 'menu.item_added' && e.itemId === 'new-ot-yoghurt') return { ...e, item: { ...e.item, name: { en: 'Yoghurt' } } };
    // Then they were one price each, in their old sections.
    const was = (category: string) => e.type === 'menu.item_added' && e.item ? { ...e, item: { category, name: e.item.name, description: '', prices: { one: e.item.prices.one ?? Object.values(e.item.prices)[0]! } } } : e;
    if (e.type === 'menu.item_added' && MOVED_TO_DRINKS.includes(e.itemId.slice(4))) return was('sec-other');
    if (e.type === 'menu.item_added' && MOVED_TO_MEALS.includes(e.itemId.slice(4))) return was('sec-roti');
    return e;
  });
  const roti = { id: 'menu-load-sec-roti', shopId: SHOP, at: 1, orderNumber: 0, actor: MENU_INSTALLER, type: 'menu.section_set', sectionId: 'sec-roti',
    section: { name: 'String Hoppers, Roti & Rolls', cookMinutes: 2, sizes: [], adds: [], station: 'left' } };
  // Items the menu had then and no longer has.
  const gone = (id: string, category: string, en: string, prices: Record<string, number>) => ({ id: `menu-load-new-${id}`, shopId: SHOP, at: 1,
    orderNumber: 0, actor: MENU_INSTALLER, type: 'menu.item_added', itemId: `new-${id}`, item: { category, name: { en }, description: '', prices } });
  const before = [
    gone('rt-biriyani', 'sec-roti', 'Biriyani', { one: 50000 }),
    gone('ml-bread-egg', 'sec-meals', 'Bread with Gravy & Egg', { one: 20000 }),
    gone('ml-string-hoppers', 'sec-meals', 'String Hoppers (10)', { one: 12000 }),
    gone('fr-biriyani-chicken', 'sec-fried-rice', 'Chicken Biriyani', { normal: 45000, full: 75000 }),
    gone('dr-beer', 'sec-drinks', 'Beer / Malt Drink', { one: 18000 }),
    gone('ot-kahata', 'sec-other', 'Plain Tea with Jaggery', { one: 3000 }),
  ];
  const own = { id: 'o1', shopId: SHOP, at: 2, orderNumber: 0, actor: owner, type: 'menu.price_set', itemId: 'new-kt-egg', before: {}, after: { prices: { normal: 46000, full: 66000 } } };
  const ownTea = { id: 'o3', shopId: SHOP, at: 2, orderNumber: 0, actor: owner, type: 'menu.price_set', itemId: 'new-ot-milo', before: {}, after: { prices: { one: 13000 } } };
  await store.push({ id: counter.device.id, tenantId: SHOP, kind: 'counter' }, [roti, ...old, ...before, own, ownTea] as SyncEvent[], 2);

  const s = await shop(store, counter.token);
  const events = (await s.pull()).events.map((e) => e.event);
  // The cloud checks every copied event the same way (in batches of 100): the updates must pass.
  cloudTakes(events);
  const state = menuStateFromEvents(events);
  const menu = effectiveMenu(EMPTY_START, state, 0).filter((m) => !m.hidden && !m.removed);
  const item = (en: string, section = '') => menu.find((m) => m.name.en === en && m.category.includes(section))!;
  assert.equal(item('Egg Rice & Curry', 'morning').variants!.map((v) => v.price).join(), '23000');
  assert.equal(item('Egg Rice & Curry', 'day').variants!.map((v) => v.price).join(), '28000');
  assert.equal(item('Noodles').price, 16000);
  assert.equal(state.sections['sec-fried-rice'].hours, undefined);
  assert.equal(state.sections['sec-kottu'].sizes[0].label, 'Half');
  assert.equal(item('Chicken Kottu').variants!.map((v) => `${v.label} ${v.price}`).join(), 'Half 50000,Full 75000');
  // One biriyani; the old ones, the separate bread items and beer are gone.
  assert.equal(menu.filter((m) => /biriyani/i.test(m.name.en)).map((m) => `${m.category} ${m.price}`).join(), 'sec-meals 33000');
  for (const en of ['Bread with Gravy & Egg', 'Chicken Biriyani', 'Beer / Malt Drink']) assert.equal(menu.find((m) => m.name.en === en), undefined, en);
  // Bread and string hoppers in Meals, one card each with their kinds and extras; the rest of Meals has none.
  assert.equal(item('Bread').category, 'sec-meals');
  assert.equal(item('Bread').adds.map((a) => `${a.label} ${a.price}`).join(), 'Egg 5000,Fish 10000,Chicken 12000');
  assert.equal(menu.filter((m) => m.name.en.startsWith('String Hoppers')).map((m) => `${m.category} ${m.variants!.map((v) => v.price).join(' ')}`).join(),
    'sec-meals 12000 16000 20000');
  assert.equal(item('String Hoppers').adds.map((a) => `${a.label} ${a.price}`).join(), '5 more 4000,10 more 8000');
  assert.equal(item('Noodles').adds.length, 0);
  // Fewer sections: tea and malt drinks moved to Drinks, rolls, roti and wade to Meals, keeping their ids;
  // their old section is off the menu; the owner's own price for Milo stays.
  for (const id of MOVED_TO_DRINKS) assert.equal(menu.find((m) => m.id === `new-${id}`)!.category, 'sec-drinks', id);
  for (const id of MOVED_TO_MEALS) assert.equal(menu.find((m) => m.id === `new-${id}`)!.category, 'sec-meals', id);
  assert.equal(item('Milo').price, 13000);
  // Tea and coffee stay a card each; tea with jaggery is gone. Others are one card with a price per kind.
  assert.deepEqual(['Plain Tea', 'Milk Tea', 'Coffee', 'Milk Coffee'].map((en) => item(en, 'drinks').price), [5000, 12000, 7000, 13000]);
  assert.equal(menu.find((m) => m.id === 'new-ot-kahata'), undefined);
  assert.equal(item('Egg Roti').variants!.map((v) => `${v.label} ${v.price}`).join(), 'Plain 10000,Gravy 12000');
  assert.equal(item('Roll').variants!.map((v) => v.label).join(), 'Egg,Fish');
  assert.equal(item('Water').variants!.map((v) => `${v.label} ${v.price}`).join(), '500 ml 8000,1 L 12000,1.5 L 15000');
  assert.equal(state.sections['sec-roti'].removed, true);
  assert.equal(menu.filter((m) => m.category === 'sec-other').map((m) => m.name.en).join(), 'Popsicle,Buns,Muffin,Yoghurt,Jelly,Watalappan,Campa / N.K.G.');
  assert.equal(item('Drink').variants!.map((v) => `${v.label} ${v.price}`).join(), 'Buddy 10000,Medium 18000');
  // Sinhala names, and the owner's own price stays.
  assert.equal(item('Yoghurt').name.si, 'යෝගට්');
  assert.equal(item('Egg Kottu').variants!.map((v) => v.price).join(), '46000,66000');
  await s.stop();

  // Sent once: a restart stores nothing more, and a later owner price stays.
  await store.push({ id: counter.device.id, tenantId: SHOP, kind: 'counter' },
    [{ id: 'o2', shopId: SHOP, at: 9000, orderNumber: 0, actor: owner, type: 'menu.price_set', itemId: 'new-ml-noodles', before: {}, after: { prices: { one: 17000 } } }] as SyncEvent[], 9000);
  const again = await shop(store, counter.token);
  const after = (await again.pull()).events;
  assert.equal(after.length, events.length + 1);
  assert.equal(effectiveMenu(EMPTY_START, menuStateFromEvents(after.map((e) => e.event)), 0).find((m) => m.name.en === 'Noodles')!.price, 17000);
  await again.stop();
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

test("an old section the owner added an item to themselves stays: only the menu's own items move out", () => {
  const at = 1;
  const base = { shopId: SHOP, at, orderNumber: 0 as const, actor: MENU_INSTALLER };
  const existing = [
    { ...base, id: 'r', type: 'menu.section_set', sectionId: 'sec-roti', section: { name: 'Roti & Rolls', cookMinutes: 2, sizes: [], adds: [], station: 'left' } },
    { ...base, id: 'w', type: 'menu.item_added', itemId: 'new-rt-wade', item: { category: 'sec-roti', name: { en: 'Parippu Wade' }, description: '', prices: { one: 3000 } } },
    { ...base, id: 'h', type: 'menu.item_added', itemId: 'new-hoppers', item: { category: 'sec-roti', name: { en: 'Hoppers' }, description: '', prices: { one: 5000 } } },
  ];
  const out = menuUpdateEvents(BATA_KADE_UPDATES, BATA_KADE_MENU, existing, SHOP, MENU_INSTALLER, 2);
  const state = menuStateFromEvents([...existing, ...out]);
  assert.equal(state.added['new-rt-wade'].category, 'sec-meals');
  assert.equal(state.added['new-hoppers'].category, 'sec-roti');
  assert.equal(state.sections['sec-roti'].removed, undefined);
});
