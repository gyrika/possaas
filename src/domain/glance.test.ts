import test from 'node:test';
import assert from 'node:assert/strict';
import { glanceOf } from './glance.ts';
import type { SyncEvent } from './sync.ts';
import type { Tender } from './types.ts';

// SCRUM-173: the shop at a glance, and the words behind each number.

const NOW = new Date(2026, 9, 26, 17, 20).getTime(); // a Monday, 5:20 pm
const at = (daysBack: number, h: number, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() - daysBack); d.setHours(h, m, 0, 0); return d.getTime(); };
const ravi = { id: 'c1', name: 'Ravi', role: 'cashier' as const };
let n = 0;
const paid = (when: number, rupees: number, tender: Tender = 'cash'): SyncEvent =>
  ({ id: `p${++n}`, shopId: 's', at: when, orderNumber: 1000 + n, actor: ravi, type: 'order.paid', total: rupees * 100, tender, tendered: rupees * 100 });
/** The last 4 Mondays: Rs 2,000 at noon and Rs 1,000 at 7 pm each. */
const usualMondays = [7, 14, 21, 28].flatMap((d) => [paid(at(d, 12), 2000), paid(at(d, 19), 1000)]);
const todays = [paid(at(0, 12, 30), 3000), paid(at(0, 13, 10), 1000, 'transfer')];
const glance = (events: SyncEvent[]) => glanceOf(events, NOW);

test('the ring: today against a usual day for this weekday, and how it is worked out', () => {
  const g = glance([...usualMondays, ...todays]);
  assert.equal(g.sales, 400000);
  assert.equal(g.orders, 2);
  assert.equal(g.usualDay, 300000);
  assert.ok(Math.abs(g.share! - 4 / 3) < 1e-9);
  assert.match(g.ringExplain, /By 5:20 pm a usual Monday has made Rs 2,000, and Rs 3,000 by closing\./);
});

test('no history for this weekday: no usual, and the screen says so', () => {
  const g = glance(todays);
  assert.equal(g.usualDay, null);
  assert.equal(g.share, null);
  assert.match(g.ringExplain, /No usual yet/);
  assert.match(g.summary, /Rs 4,000 from 2 orders so far\./);
});

test('sales by hour: the hours the shop sells in; today against usual; later hours still to come', () => {
  const { hours } = glance([...usualMondays, ...todays]);
  assert.deepEqual(hours.map((h) => h.hour), [12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual([hours[0].today, hours[0].usual], [300000, 200000]);
  assert.match(hours[0].explain, /^12 pm: Rs 3,000\.\nA usual Monday: Rs 2,000\.\nRs 1,000 more than usual\.$/);
  assert.equal(hours[7].today, null);
  assert.match(hours[7].explain, /^7 pm: still to come\.\nA usual Monday makes Rs 1,000 in this hour\.$/);
});

test('the day in a sentence: the pace, the busiest hour, the most sold dish; no To do (owner, 2026-11-28)', () => {
  const g = glance([...usualMondays, ...todays]);
  assert.equal(g.summary, 'Good evening. Rs 4,000 so far, 100% above a usual Monday.\nBusiest hour: 12 pm (Rs 3,000).');
  const sold = glance([...todays, ...order(7, at(0, 9), at(0, 9, 5), [{ itemId: 'italian-pasta', size: 'S', qty: 3, unit: 999 }])]);
  assert.match(sold.summary, /\nMost sold: Italian Pasta \(3\)\.$/);
});

test('Money splits what was taken by how it was paid', () => {
  const money = glance([...usualMondays, ...todays]).stations.find((s) => s.id === 'money')!;
  assert.equal(money.value, 'Rs 4,000');
  assert.match(money.explain, /Cash: Rs 3,000\nBank transfer: Rs 1,000/);
});

test('the one station is the money: no counter (owner, 2026-11-28), kitchen, deliveries or shelves', () => {
  assert.deepEqual(glance(todays).stations.map((s) => s.id), ['money']);
});

test('Money: cash still to come from deliveries, and a delivery long past its time', () => {
  const line = { id: 'l1', itemId: 'devilled-chicken', qty: 1, size: 'L' as const, adds: [], outs: [], sent: true, unit: 200000 };
  const sent = (number: number, readyBy: number): SyncEvent => ({ id: `s${number}`, shopId: 's', at: readyBy - 45 * 60_000, orderNumber: number, actor: ravi,
    type: 'order.sent', ticketId: `t${number}`, lines: [line], addOn: false, online: { pickupBy: readyBy, delivery: { fee: 25000 } } });
  const paidBack: SyncEvent = { id: 'pb', shopId: 's', at: at(0, 17), orderNumber: 2001, actor: ravi, type: 'order.paid', total: 225000, tender: 'cash', tendered: 225000 };
  const money = glance([sent(2001, at(0, 16, 30)), paidBack, sent(2002, at(0, 17, 10)), sent(2003, at(0, 16, 0))]).stations.find((s) => s.id === 'money')!;
  assert.match(money.explain, /About Rs 4,500 still to come from 2 deliveries, paid when the rider is back\./);
  assert.match(money.explain, /Delivery 2003 was ready at 4:00 pm and is not paid yet\./);
  assert.deepEqual([money.tone, money.badge], ['warn', 1]);
});

test('Money says what left the drawer: the cash out of this business day, and it links to the list', () => {
  const actor = { id: 'o', name: 'Owner', role: 'owner' as const };
  const out = (id: string, name: string, rupees: number, when = at(0, 9)): SyncEvent =>
    ({ id, shopId: 's', at: when, orderNumber: 0, actor, type: 'cash.out', name, amount: rupees * 100 });
  const money = glance([...todays, out('a', 'Fish', 4500), out('b', 'Gas', 3000), out('y', 'Bank', 20000, at(1, 9))]).stations.find((s) => s.id === 'money')!;
  assert.equal(money.href, '#cashout');
  assert.match(money.explain, /Cash out of the drawer today: Rs 7,500 \(Fish, Gas\)\./);
  assert.match(money.explain, /less the cash out\./);
});

// Owner, 2026-11-28: morning, lunch and evening apart, and how many of each dish sold today.

const order = (num: number, sentAt: number, paidAt: number, lines: { itemId: string; size?: 'S' | 'M' | 'L'; qty: number; unit: number }[]): SyncEvent[] => [
  { id: `s${num}`, shopId: 's', at: sentAt, orderNumber: num, actor: ravi, type: 'order.sent', ticketId: `t${num}`, addOn: false,
    lines: lines.map((l, i) => ({ id: `l${num}-${i}`, itemId: l.itemId, qty: l.qty, adds: [], outs: [], unit: l.unit * 100, ...(l.size ? { size: l.size } : {}) })) } as SyncEvent,
  { id: `p${num}`, shopId: 's', at: paidAt, orderNumber: num, actor: ravi, type: 'order.paid', total: lines.reduce((t, l) => t + l.unit * l.qty, 0) * 100, tender: 'cash', tendered: 0 } as SyncEvent,
];

test('morning, lunch and evening: each part its own sales; a part not begun is still to come', () => {
  const NOON = new Date(2026, 9, 26, 12, 30).getTime();
  const events = [paid(at(0, 8), 500), paid(at(0, 10, 59), 300), paid(at(0, 11), 2000), paid(at(0, 12, 10), 1000)];
  const parts = glanceOf(events, NOON).parts;
  assert.deepEqual(parts.map((p) => [p.id, p.span, p.sales, p.orders, p.begun]), [
    ['morning', 'to 11 am', 80000, 2, true],
    ['lunch', '11 am – 3 pm', 300000, 2, true],
    ['evening', 'from 3 pm', 0, 0, false],
  ]);
  assert.match(parts[1].explain, /^Lunch \(11 am – 3 pm\): Rs 3,000 from 2 bills so far\./);
  assert.equal(parts[2].explain, 'Evening (from 3 pm): still to come.');
});

test('sold today: one row per dish, its sizes together, from the bills paid today, most sold first, by part of the day', () => {
  const events = [
    ...order(1, at(0, 9), at(0, 9, 5), [{ itemId: 'italian-pasta', size: 'S', qty: 2, unit: 999 }]),
    ...order(2, at(0, 12), at(0, 12, 5), [{ itemId: 'italian-pasta', size: 'S', qty: 1, unit: 999 }, { itemId: 'italian-pasta', size: 'L', qty: 1, unit: 2650 }, { itemId: 'margherita', size: 'M', qty: 1, unit: 1500 }]),
    ...order(3, at(0, 16), at(0, 16, 5), [{ itemId: 'italian-pasta', size: 'S', qty: 1, unit: 999 }]),
    ...order(4, at(1, 12), at(1, 12, 5), [{ itemId: 'italian-pasta', size: 'L', qty: 9, unit: 2650 }]), // yesterday
    ...order(5, at(0, 17), at(0, 17, 1), [{ itemId: 'italian-pasta', size: 'M', qty: 1, unit: 1899 }]).slice(0, 1), // sent, not paid
  ];
  const { items } = glance(events);
  assert.deepEqual(items.map((i) => [i.key, i.qty, i.byPart]), [
    ['italian-pasta', 5, { morning: 2, lunch: 2, evening: 1 }],
    ['margherita', 1, { morning: 0, lunch: 1, evening: 0 }],
  ]);
  assert.equal(items[0].name, 'Italian Pasta');
});

test('sold today: a line taken off after it was paid no longer counts; an undone payment does not count', () => {
  const events = [
    ...order(1, at(0, 9), at(0, 9, 5), [{ itemId: 'italian-pasta', size: 'S', qty: 1, unit: 999 }, { itemId: 'italian-pasta', size: 'L', qty: 1, unit: 2650 }]),
    { id: 'c1', shopId: 's', at: at(0, 9, 10), orderNumber: 1, actor: ravi, type: 'order.item_cancelled', lineId: 'l1-1', index: 1, afterPay: true,
      before: { id: 'l1-1', itemId: 'italian-pasta', size: 'L', qty: 1, adds: [], outs: [], unit: 265000 }, reason: 'Before it was made' } as unknown as SyncEvent,
    ...order(2, at(0, 10), at(0, 10, 5), [{ itemId: 'italian-pasta', size: 'M', qty: 1, unit: 1899 }]),
    { id: 'u2', shopId: 's', at: at(0, 10, 6), orderNumber: 2, actor: ravi, type: 'order.payment_undone' } as unknown as SyncEvent,
  ];
  assert.deepEqual(glance(events).items.map((i) => [i.key, i.qty]), [['italian-pasta', 1]]);
});
