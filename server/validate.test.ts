import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePush } from './validate.ts';

const base = {
  id: 'event-1',
  shopId: 'shop-1',
  at: 1,
  orderNumber: 0,
  actor: { id: 'manager-1', name: 'Ravi', role: 'manager' },
};

test('menu edits and sold-out events are accepted only with valid event data', () => {
  const owner = { ...base, actor: { id: 'owner-1', name: 'Nisal', role: 'owner' } };
  const valid = [
    {
      ...owner,
      type: 'menu.item_set',
      itemId: 'margherita',
      before: {},
      after: { prices: { M: 160000 }, name: { en: 'Margherita Special' } },
    },
    {
      ...owner,
      id: 'event-2',
      type: 'menu.sold_out',
      itemId: 'margherita',
      until: 1_800_000_000_000,
    },
  ];
  assert.deepEqual(validatePush({ events: valid }, 'shop-1'), { events: valid });

  const unknownItem = validatePush({
    events: [{ ...owner, type: 'menu.item_set', itemId: 'not-on-menu', before: {}, after: {} }],
  }, 'shop-1');
  assert.ok('reason' in unknownItem);

  const invalidPrice = validatePush({
    events: [{ ...owner, type: 'menu.item_set', itemId: 'margherita', before: {}, after: { prices: { M: 160001 } } }],
  }, 'shop-1');
  assert.ok('reason' in invalidPrice);

  const invalidSoldOut = validatePush({
    events: [{ ...owner, type: 'menu.sold_out', itemId: 'margherita', until: 'tomorrow' }],
  }, 'shop-1');
  assert.ok('reason' in invalidSoldOut);
});

test("a manager's price change carries prices only, in whole rupees", () => {
  const price = (after: object) => ({ ...base, type: 'menu.price_set', itemId: 'margherita', before: {}, after });
  const ok = price({ prices: { M: 160000 }, adds: { 'full-cheese': 70000 } });
  assert.deepEqual(validatePush({ events: [ok] }, 'shop-1'), { events: [ok] });
  assert.ok('reason' in validatePush({ events: [price({ prices: { M: 160000 }, name: { en: 'Free pizza' } })] }, 'shop-1'), 'never a name');
  assert.ok('reason' in validatePush({ events: [price({ hidden: true })] }, 'shop-1'), 'never hiding');
  assert.ok('reason' in validatePush({ events: [price({ prices: { M: 160001 } })] }, 'shop-1'));
});

test("the owner's new items are accepted only with an added-item id and whole-rupee prices", () => {
  const owner = { ...base, actor: { id: 'owner-1', name: 'Nisal', role: 'owner' } };
  const item = { category: 'pasta', name: { en: 'Chicken Alfredo', si: '' }, description: '', prices: { S: 110000, M: 210000, L: 290000 } };
  const valid = [
    { ...owner, type: 'menu.item_added', itemId: 'new-chicken-alfredo', item },
    { ...owner, id: 'event-2', type: 'menu.item_set', itemId: 'new-chicken-alfredo', before: {}, after: { prices: { L: 300000 }, hidden: true } },
    { ...owner, id: 'event-3', type: 'menu.sold_out', itemId: 'new-chicken-alfredo', until: 1_800_000_000_000 },
    { ...owner, id: 'event-4', type: 'menu.item_added', itemId: 'new-chicken-alfredo', item: null },
    // A shop's own section and sizes: the server cannot know them one event at a time, so it checks the shape.
    { ...owner, id: 'event-5', type: 'menu.item_added', itemId: 'new-chicken-kottu',
      item: { category: 'sec-kottu', name: { en: 'Chicken Kottu' }, description: '', prices: { regular: 90000, full: 130000 }, number: 3, leaveOut: ['No egg'] } },
    { ...owner, id: 'event-6', type: 'menu.item_set', itemId: 'new-chicken-kottu', before: {}, after: { prices: { full: 140000 } } },
  ];
  assert.deepEqual(validatePush({ events: valid }, 'shop-1'), { events: valid });

  for (const bad of [
    { itemId: 'margherita', item },
    { itemId: 'new-Chicken', item },
    { itemId: 'new-x', item: { ...item, prices: {} } },
    { itemId: 'new-x', item: { ...item, prices: { S: 110000, M: 210000, L: '290000' } } },
    { itemId: 'new-x', item: { ...item, prices: { 'Not A Size': 110000 } } },
    { itemId: 'new-x', item: { ...item, number: 0 } },
    { itemId: 'new-x', item: { ...item, name: { en: 'X', fr: 'Y' } } },
    { itemId: 'new-x', item: { ...item, extra: true } },
  ]) {
    const r = validatePush({ events: [{ ...owner, type: 'menu.item_added', ...bad }] }, 'shop-1');
    assert.ok('reason' in r, JSON.stringify(bad));
  }
  const notAdded = validatePush({ events: [{ ...owner, type: 'menu.sold_out', itemId: 'not-on-menu', until: null }] }, 'shop-1');
  assert.ok('reason' in notAdded);
});

test("the owner's own sections: made, changed and taken off; the shape is checked", () => {
  const owner = { ...base, orderNumber: 0, actor: { id: 'owner-1', name: 'Nisal', role: 'owner' } };
  const section = { name: 'Kottu', cookMinutes: 8, sizes: [{ id: 'regular', label: 'Regular' }, { id: 'full', label: 'Full' }], adds: [{ id: 'egg', label: 'Egg', price: 10000 }] };
  const valid = [
    { ...owner, type: 'menu.section_set', sectionId: 'sec-kottu', section },
    { ...owner, id: 'event-2', type: 'menu.section_set', sectionId: 'sec-kottu', section: null },
    { ...owner, id: 'event-3', type: 'menu.section_set', sectionId: 'sec-kottu', section: { ...section, station: 'right' } },
  ];
  assert.deepEqual(validatePush({ events: valid }, 'shop-1'), { events: valid });
  for (const bad of [
    { sectionId: 'pizza', section },
    { sectionId: 'sec-kottu', section: { ...section, name: '' } },
    { sectionId: 'sec-kottu', section: { ...section, cookMinutes: 0 } },
    { sectionId: 'sec-kottu', section: { ...section, sizes: [{ id: 'one', label: 'One' }] } },
    { sectionId: 'sec-kottu', section: { ...section, adds: [{ id: 'egg', label: 'Egg', price: 10050 }] } },
    { sectionId: 'sec-kottu', section: { ...section, extra: true } },
    { sectionId: 'sec-kottu', section: { ...section, station: 'middle' } },
  ]) {
    assert.ok('reason' in validatePush({ events: [{ ...owner, type: 'menu.section_set', ...bad }] }, 'shop-1'), JSON.stringify(bad));
  }
});

test("a close of the day is accepted only whole: the cash in cents and the day's count", () => {
  const tally = { cents: 0, orders: 0 };
  const count = { from: 100, to: 200, orders: 1, total: 150000, voids: 0, discounts: 0, byTender: { cash: { cents: 150000, orders: 1 }, transfer: tally, card: tally, qr: tally, comp: tally } };
  const close = { ...base, type: 'day.closed', from: 100, to: 200, float: 500000, counted: 630000, count };
  assert.ok('events' in validatePush({ events: [close] }, 'shop-1'));
  for (const bad of [
    { ...close, counted: 12.5 },
    { ...close, float: -1 },
    { ...close, orderNumber: 7 },
    { ...close, to: 50 },
    { ...close, count: { ...count, from: 99 } },
    { ...close, count: { ...count, byTender: { cash: tally } } },
    { ...close, actor: undefined },
  ]) assert.ok('reason' in validatePush({ events: [bad] }, 'shop-1'), JSON.stringify(bad));
});

test('a served portion says which ticket and line', () => {
  const served = { id: 'event-1', shopId: 'shop-1', at: 1, orderNumber: 1001, type: 'kitchen.served', ticketId: 't1', lineId: 'l1' };
  assert.ok('events' in validatePush({ events: [served, { ...served, id: 'event-2', type: 'kitchen.unserved' }] }, 'shop-1'));
  assert.ok('reason' in validatePush({ events: [{ ...served, lineId: undefined }] }, 'shop-1'));
  assert.ok('reason' in validatePush({ events: [{ ...served, ticketId: '' }] }, 'shop-1'));
});
