import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDayStart, cashUpLines, dayCount, difference, expectedCash } from './cashUp.ts';

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m).getTime();
const actor = { id: 'm', name: 'Ravi', role: 'manager' };
let n = 0;
const ev = (type: string, time: number, body: object = {}) => ({ id: `e${++n}`, shopId: 's', type, at: time, actor, orderNumber: 1000 + n, ...body });

test("the business day runs 5 am to 5 am: a kottu shop's 1 am sale is yesterday's day", () => {
  assert.equal(businessDayStart(at(14)), at(5));
  assert.equal(businessDayStart(at(1, 30, 22)), at(5, 0, 21));
  assert.equal(businessDayStart(at(5, 0, 22)), at(5, 0, 22));
});

test("the day's count: payments by how they were paid, an undone payment not counted, cancels and discounts that stand", () => {
  const discount = ev('order.discount_set', at(13), { after: { kind: 'percent', pct: 10 } });
  const mistake = ev('order.discount_set', at(15), { after: { kind: 'percent', pct: 20 } });
  const events = [
    ev('order.paid', at(4), { total: 99900, tender: 'cash' }), // yesterday's day
    ev('order.paid', at(12), { total: 150000, tender: 'cash' }),
    ev('order.paid', at(12, 30), { total: 80000, tender: 'transfer' }),
    { ...ev('order.paid', at(13), { total: 60000, tender: 'cash' }), orderNumber: 7 },
    { ...ev('order.payment_undone', at(13, 1)), orderNumber: 7 }, // paid by mistake: not counted
    ev('order.paid', at(23, 50), { total: 0, tender: 'comp' }),
    ev('order.paid', at(1, 10, 22), { total: 45000, tender: 'cash' }), // after midnight, same day
    ev('order.item_cancelled', at(14)),
    discount,
    ev('order.comped', at(23, 49)),
    mistake,
    { ...ev('order.change_undone', at(15, 1)), undoneEventId: mistake.id }, // that discount was undone
  ];
  const d = dayCount(events, at(5), at(5, 0, 22));
  assert.equal(d.orders, 4);
  assert.deepEqual(d.byTender.cash, { cents: 195000, orders: 2 });
  assert.deepEqual(d.byTender.transfer, { cents: 80000, orders: 1 });
  assert.deepEqual(d.byTender.comp, { cents: 0, orders: 1 });
  assert.equal(d.total, 275000);
  assert.equal(d.voids, 1);
  assert.equal(d.discounts, 2);

  assert.equal(expectedCash(d, 500000), 695000);
  assert.equal(difference(675000, 695000), 'Rs 200 short');
  assert.equal(difference(700000, 695000), 'Rs 50 over');
  assert.equal(difference(695000, 695000), 'Exact');

  const lines = cashUpLines(d, { shop: { name: "Rasika's Kitchen and Bakery", lines: [], footer: '' }, float: 500000, counted: 675000, by: 'Ravi', width: 32 });
  for (const l of lines) assert.ok(l.text.length <= (l.big ? 16 : 32), `fits 58 mm: "${l.text}"`);
  const text = lines.map((l) => l.text).join('\n');
  assert.match(text, /Cash \(2\) +1,950/);
  assert.match(text, /Bank transfer \(1\) +800/);
  assert.match(text, /Difference +Rs 200 short/);
  assert.match(text, /Total \(4 orders\)/);
  assert.match(cashUpLines({ ...d, orders: 1 }, { shop: { name: 'S', lines: [], footer: '' }, float: 0, counted: null, by: 'R', width: 48 }).map((l) => l.text).join('\n'), /Total \(1 order\) /);
});
