import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_RICE_START } from '../fake/data.ts';
import { SAMPLE_START } from './menu.ts';
import { EMPTY_MENU_STATE, EMPTY_START, checkNewItem, checkSection, effectiveMenu, menuStateFromEvents } from './menuEdits.ts';
import { menuFile, readMenuFile } from './menuFile.ts';

const owner = { id: 'o', name: 'Owner', role: 'owner' as const };
const base = { shopId: 's', orderNumber: 0 as const, actor: owner };
const none = { sections: [], items: [] };

/** Loads a copied menu on an empty shop, as the Menu screen does, and returns that shop's menu. */
const loadOnEmpty = (text: string) => {
  const load = readMenuFile(text, none);
  assert.notEqual(typeof load, 'string', String(load));
  if (typeof load === 'string') throw new Error(load);
  const events = [
    ...load.sections.map(([sectionId, section], i) => ({ ...base, id: `s${i}`, at: i, type: 'menu.section_set', sectionId, section })),
    ...load.items.map(([itemId, item], i) => ({ ...base, id: `i${i}`, at: 100 + i, type: 'menu.item_added', itemId, item })),
  ];
  return { load, menu: effectiveMenu(EMPTY_START, menuStateFromEvents(events), 0) };
};

test('the rice demo copied and loaded on an empty shop sells the same items at the same prices', () => {
  const text = JSON.stringify(menuFile(FAKE_RICE_START, EMPTY_MENU_STATE));
  const { load, menu } = loadOnEmpty(text);
  assert.equal(load.sections.length, FAKE_RICE_START.sections.length);
  assert.equal(menu.length, FAKE_RICE_START.items.length);
  const price = (m: { variants?: { id: string; price: number }[]; price?: number }) => m.variants?.map((v) => `${v.id}:${v.price}`).join() ?? String(m.price);
  for (const want of FAKE_RICE_START.items) {
    const got = menu.find((m) => m.name.en === want.name.en && m.name.si === want.name.si && price(m) === price(want));
    assert.ok(got, `${want.name.en} is on the loaded menu at its price`);
  }
  // Kitchens and hours stay with their sections.
  const kottu = load.sections.find(([, s]) => s.name.startsWith('Kottu'))!;
  assert.equal(kottu[1].station, 'right');
  const breakfast = load.sections.find(([, s]) => s.name.startsWith('Rice & Curry') && s.hours?.from === 5 * 60)!;
  assert.deepEqual(breakfast[1].hours, { from: 5 * 60, to: 11 * 60 });
  assert.equal(load.sections.find(([, s]) => s.name.startsWith('Fried Rice'))![1].hours, undefined);
  assert.deepEqual(load.sections.map(([, s]) => s.name.split(' · ')[0]), ['Rice & Curry', 'Rice & Curry', 'Fried Rice', 'Kottu', 'Meals', 'Drinks', 'Other']);
  // An item's own extras go with it: bread's egg, fish and chicken; the rest of Meals has none.
  const meal = (en: string) => load.items.find(([, n]) => n.name.en === en)![1];
  assert.equal(meal('Bread').adds!.map((a) => `${a.label} ${a.price}`).join(), 'Egg 5000,Fish 10000,Chicken 12000');
  assert.equal(meal('String Hoppers').adds!.map((a) => a.label).join(), '5 more,10 more');
  assert.equal(meal('Biriyani').adds, undefined);
  assert.equal(menu.find((m) => m.name.en === 'Bread')!.adds.map((a) => a.label).join(), 'Egg,Fish,Chicken');
  assert.equal(menu.find((m) => m.name.en === 'Noodles')!.adds.length, 0);
  // An item's own sizes go with it too: one Water card, a price per bottle; the rest of Drinks has none.
  assert.deepEqual(meal('Water').sizes!.map((z) => z.label), ['500 ml', '1 L', '1.5 L']);
  assert.equal(menu.find((m) => m.name.en === 'Water')!.variants!.map((v) => `${v.label} ${v.price}`).join(), '500 ml 8000,1 L 12000,1.5 L 15000');
  assert.equal(menu.find((m) => m.name.en === 'String Hoppers')!.variants!.map((v) => `${v.label} ${v.price}`).join(), '10 12000,15 16000,20 20000');
  assert.equal(meal('Milo').sizes, undefined);
  assert.ok(load.items.every(([, n]) => checkNewItem(n, load.sections.map(([id, s]) => ({ ...s, id }))) === null));
  assert.ok(load.sections.every(([id, s]) => id.startsWith('sec-') && checkSection(s) === null));
  assert.ok(load.items.every(([id]) => id.startsWith('new-')));
});

test("the owner's changes go with the menu; items taken off and sold-out marks do not", () => {
  const events = [
    { ...base, id: 'a', at: 1, type: 'menu.item_set', itemId: 'kt-egg', before: {}, after: { prices: { normal: 50000, full: 70000 } } },
    { ...base, id: 'b', at: 2, type: 'menu.item_set', itemId: 'ot-milo', before: {}, after: { hidden: true } },
    { ...base, id: 'c', at: 3, type: 'menu.sold_out', itemId: 'ot-coffee', until: Date.now() + 3_600_000 },
    { ...base, id: 'd', at: 4, type: 'menu.section_set', sectionId: 'sec-juice', section: { name: 'Juice', cookMinutes: 2, sizes: [], adds: [] } },
    { ...base, id: 'e', at: 5, type: 'menu.item_added', itemId: 'new-lime', item: { category: 'sec-juice', name: { en: 'Lime Juice' }, description: '', prices: { one: 15000 } } },
  ];
  const state = menuStateFromEvents(events);
  const { menu } = loadOnEmpty(JSON.stringify(menuFile(FAKE_RICE_START, state)));
  assert.deepEqual(menu.find((m) => m.name.en === 'Egg Kottu')!.variants!.map((v) => v.price), [50000, 70000]);
  assert.equal(menu.find((m) => m.name.en === 'Milo'), undefined);
  assert.equal(menu.find((m) => m.name.en === 'Coffee')!.soldOut, undefined);
  assert.equal(menu.find((m) => m.name.en === 'Lime Juice')!.price, 15000);
});

test('ids the shop used before are never reused', () => {
  const load = readMenuFile(JSON.stringify(menuFile(FAKE_RICE_START, EMPTY_MENU_STATE)), { sections: ['sec-kottu'], items: ['new-kt-egg'] });
  if (typeof load === 'string') throw new Error(load);
  assert.ok(load.sections.some(([id]) => id === 'sec-kottu-2'));
  assert.ok(load.items.some(([id]) => id === 'new-kt-egg-2'));
});

test('the sample pizza menu copies too (items keep their numbers and leave-outs)', () => {
  const { menu } = loadOnEmpty(JSON.stringify(menuFile(SAMPLE_START, EMPTY_MENU_STATE)));
  const dc = menu.find((m) => m.name.en === 'Devilled Chicken')!;
  assert.equal(dc.number, 5);
  assert.ok(dc.variants!.length > 0);
});

test('anything else pasted is refused in words, and nothing is loaded', () => {
  assert.match(readMenuFile('hello', none) as string, /not a copied menu/);
  assert.match(readMenuFile('{"lume":"menu","v":1,"sections":[],"items":[]}', none) as string, /no items/);
  const file = menuFile(FAKE_RICE_START, EMPTY_MENU_STATE);
  file.items[0].prices = { normal: 12345 };
  assert.match(readMenuFile(JSON.stringify(file), none) as string, /^Vegetable Rice & Curry: prices are whole rupees/);
});
