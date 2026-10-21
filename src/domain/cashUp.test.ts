import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDayStart, cashUpLines, closesFrom, dayCount, dayReport, difference, expectedCash, pastDays } from './cashUp.ts';

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

test("the day's report: the close's count and cash in one shape; closing again replaces that day's close", () => {
  const d = dayCount([ev('order.paid', at(12), { total: 150000, tender: 'cash' })], at(5), at(22));
  const closed = dayReport(d, { float: 500000, counted: 630000, by: 'Ravi', closedAt: at(22, 41) });
  assert.equal(closed.day, 'Wednesday 21 October 2026');
  assert.deepEqual(closed.sections.map((s) => s.title), ['Sales', 'Changes', 'Cash']);
  assert.deepEqual(closed.sections[2].rows.at(-1), { label: 'Difference', value: 'Rs 200 short', strong: true });
  assert.equal(closed.closed, 'Closed by Ravi at 22:41');
  const nobody = dayReport(d, { float: null, counted: null, by: null, closedAt: null });
  assert.deepEqual(nobody.sections[2].rows.map((r) => r.value), ['1,500', 'Not counted']);
  assert.match(nobody.closed, /Nobody closed the day/);

  const close = (id: string, when: number, counted: number, from = at(5)) =>
    ({ id, shopId: 's', type: 'day.closed', at: when, actor, orderNumber: 0, from, to: when, float: 0, counted, count: d });
  const days = closesFrom([close('a', at(22), 100), close('b', at(22, 30), 200), close('c', at(23, 0, 20), 300, at(5, 0, 20))]);
  assert.deepEqual(days.map((c) => c.id), ['b', 'c']);
});

test('past days: closed days with their difference, unclosed days from their sales, today only once closed', () => {
  const sale = (h: number, day: number) => ev('order.paid', at(h, 0, day), { total: 100000, tender: 'cash' });
  const count = dayCount([sale(12, 19)], at(5, 0, 19), at(22, 0, 19));
  const events = [
    sale(12, 19), { id: 'c19', shopId: 's', type: 'day.closed', at: at(22, 0, 19), actor, orderNumber: 0, from: at(5, 0, 19), to: at(22, 0, 19), float: 0, counted: 80000, count },
    sale(12, 20), sale(2, 21), // the 20th: nobody closed; its 2 am sale belongs to it
    sale(12, 21), // today, still selling
  ];
  const days = pastDays(events, at(15, 0, 21));
  assert.deepEqual(days.map((d) => d.from), [at(5, 0, 20), at(5, 0, 19)]);
  assert.equal(days[0].close, null);
  assert.equal(days[0].count.orders, 2);
  assert.equal(days[0].difference, null);
  assert.equal(days[1].difference, 'Rs 200 short');
  assert.equal(days[1].report.closed, 'Closed by Ravi at 22:00');
});
