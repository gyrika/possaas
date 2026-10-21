import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookTimeMs } from './kitchen.ts';
import { SAMPLE_START, itemById, menuIsEmpty, menuItems, menuSections, popularItems, setMenuState, setStartingMenu, typingExample } from './menu.ts';
import { EMPTY_MENU_STATE, EMPTY_START, checkNewItem, checkSection, menuStateFromEvents, type NewItem, type SectionDef } from './menuEdits.ts';
import { orderTotal } from './order.ts';
import { ShorthandInterpreter } from './parser.ts';

/** A new shop's own menu: it starts empty, and is made of the owner's sections and items (events). */
const owner = { id: 'o', name: 'Rasika', role: 'owner' as const };
let n = 0;
const ev = (body: object) => ({ id: `e${++n}`, shopId: 's', at: n, orderNumber: 0, actor: owner, ...body });
const section = (sectionId: string, def: SectionDef | null) => ev({ type: 'menu.section_set', sectionId, section: def });
const item = (itemId: string, def: NewItem | null) => ev({ type: 'menu.item_added', itemId, item: def });

const KOTTU: SectionDef = {
  name: 'Kottu', cookMinutes: 8,
  sizes: [{ id: 'regular', label: 'Regular' }, { id: 'full', label: 'Full' }],
  adds: [{ id: 'egg', label: 'Egg', price: 10000 }, { id: 'cheese', label: 'Cheese', price: 25000 }],
};
const DRINKS: SectionDef = { name: 'Drinks', cookMinutes: 1, sizes: [], adds: [] };

const withShop = (events: object[], run: () => void) => {
  setStartingMenu(EMPTY_START);
  setMenuState(menuStateFromEvents(events as { type: string }[]), 1000);
  try { run(); } finally { setStartingMenu(SAMPLE_START); setMenuState(EMPTY_MENU_STATE); }
};

test('a new shop starts with nothing to sell', () => withShop([], () => {
  assert.equal(menuIsEmpty(), true);
  assert.deepEqual(menuSections(), []);
  assert.deepEqual(popularItems(), []);
}));

test("a shop's own sections and items: its sizes, extras, leave-outs and numbers; the kitchen's cook time; shorthand", () => {
  const events = [
    section('sec-kottu', KOTTU),
    section('sec-drinks', DRINKS),
    item('new-chicken-kottu', { category: 'sec-kottu', name: { en: 'Chicken Kottu' }, description: '', prices: { regular: 90000, full: 130000 }, number: 3, leaveOut: ['No chilli'] }),
    item('new-cheese-kottu', { category: 'sec-kottu', name: { en: 'Cheese Kottu' }, description: '', prices: { full: 160000 } }),
    item('new-milo', { category: 'sec-drinks', name: { en: 'Milo' }, description: 'Iced', prices: { one: 35000 } }),
  ];
  withShop(events, () => {
    assert.equal(menuIsEmpty(), false);
    assert.deepEqual(menuSections().map((x) => x.name), ['Kottu', 'Drinks']);
    const kottu = itemById('new-chicken-kottu');
    assert.deepEqual(kottu.variants?.map((v) => [v.label, v.price]), [['Regular', 90000], ['Full', 130000]]);
    assert.deepEqual(kottu.adds.map((a) => a.label), ['Egg', 'Cheese']);
    assert.deepEqual(kottu.leaveOut, [{ id: 'no-chilli', label: 'No chilli', price: 0 }]);
    assert.deepEqual(itemById('new-cheese-kottu').variants?.map((v) => v.label), ['Full'], 'not sold as Regular: not offered');
    assert.equal(itemById('new-milo').price, 35000);
    assert.deepEqual(popularItems().map((m) => m.name.en), ['Chicken Kottu', 'Cheese Kottu', 'Milo']);

    const parse = new ShorthandInterpreter(menuItems()).interpret('2 full chicken kottu extra egg no chilli, milo, 3 r');
    assert.deepEqual(parse.unresolved, []);
    assert.deepEqual(parse.lines.map((l) => [l.itemId, l.qty, l.size, l.adds, l.outs]), [
      ['new-chicken-kottu', 2, 'full', ['egg'], ['no-chilli']],
      ['new-milo', 1, undefined, [], []],
      ['new-chicken-kottu', 1, 'regular', [], []], // "3" is its number, "r" is Regular
    ]);
    assert.equal(orderTotal({ number: 1, lines: parse.lines.map((l, i) => ({ ...l, id: `l${i}` })) }), 2 * (130000 + 10000) + 35000 + 90000);

    const line = (itemId: string) => ({ id: itemId, itemId, qty: 1, adds: [], outs: [] });
    assert.equal(cookTimeMs({ lines: [line('new-chicken-kottu'), line('new-milo')] }), 8 * 60_000, 'its slowest section');
  });
});

test('taking a section off hides its items (old orders keep them); a size taken away hides what was only sold in it', () => {
  const events = [
    section('sec-kottu', KOTTU),
    item('new-cheese-kottu', { category: 'sec-kottu', name: { en: 'Cheese Kottu' }, description: '', prices: { full: 160000 } }),
    item('new-chicken-kottu', { category: 'sec-kottu', name: { en: 'Chicken Kottu' }, description: '', prices: { regular: 90000, full: 130000 } }),
    section('sec-kottu', { ...KOTTU, sizes: [{ id: 'regular', label: 'Regular' }] }),
  ];
  withShop(events, () => {
    assert.equal(itemById('new-cheese-kottu').hidden, true);
    assert.deepEqual(itemById('new-chicken-kottu').variants?.map((v) => v.label), ['Regular']);
  });
  withShop([...events, section('sec-kottu', null)], () => {
    assert.equal(menuIsEmpty(), true);
    assert.deepEqual(menuSections(), []);
    assert.equal(itemById('new-chicken-kottu').hidden, true, 'still there for orders that have it');
  });
});

test('what a section and an item must be', () => {
  assert.equal(checkSection(KOTTU), null);
  assert.match(checkSection({ ...KOTTU, name: ' ' })!, /name/);
  assert.match(checkSection({ ...KOTTU, cookMinutes: 0 })!, /cook time/);
  assert.match(checkSection({ ...KOTTU, sizes: [{ id: 'full', label: 'Full' }, { id: 'full', label: 'Full' }] })!, /two sizes/);
  assert.match(checkSection({ ...KOTTU, adds: [{ id: 'egg', label: 'Egg', price: 10050 }] })!, /whole rupees/);
  const sections = [{ ...KOTTU, id: 'sec-kottu' }];
  const kottu: NewItem = { category: 'sec-kottu', name: { en: 'Egg Kottu' }, description: '', prices: { full: 120000 } };
  assert.equal(checkNewItem(kottu, sections), null);
  assert.match(checkNewItem({ ...kottu, prices: { one: 120000 } }, sections)!, /size/);
  assert.match(checkNewItem({ ...kottu, prices: {} }, sections)!, /prices/);
  assert.match(checkNewItem({ ...kottu, category: 'sec-rice' }, sections)!, /section/);
  assert.match(checkNewItem({ ...kottu, number: 1000 }, sections)!, /numbers/);
});

test('an item this menu does not know shows as "Unknown item" instead of taking the screen down', () => withShop([], () => {
  assert.equal(itemById('devilled-chicken').name.en, 'Devilled Chicken', 'an old order from the sample menu still reads');
  assert.equal(itemById('new-gone').name.en, 'Unknown item');
  assert.equal(itemById('new-gone').hidden, true);
}));

test("the typing example is the shop's own food, never another shop's", () => {
  withShop([
    section('sec-kottu', KOTTU),
    item('new-chicken-kottu', { category: 'sec-kottu', name: { en: 'Chicken Kottu' }, description: '', prices: { regular: 90000, full: 130000 } }),
    item('new-cheese-kottu', { category: 'sec-kottu', name: { en: 'Cheese Kottu' }, description: '', prices: { full: 160000 } }),
  ], () => {
    assert.equal(typingExample(), '2 full chicken kottu, cheese kottu');
  });
});
