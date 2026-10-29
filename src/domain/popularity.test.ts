import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderEvent } from './events.ts';
import { MENU, popularItems, setPopularScores } from './menu.ts';
import { DECAY, rankPopular, rollScores, soldCounts } from './popularity.ts';
import type { OrderLine } from './types.ts';

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m).getTime();
const actor = { id: 'c', name: 'Nimal', role: 'cashier' } as const;
let n = 0;
const line = (itemId: string, qty = 1, extra: Partial<OrderLine> = {}): OrderLine => ({ id: `l${++n}`, itemId, qty, adds: [], outs: [], sent: true, ...extra });
const sent = (order: number, time: number, lines: OrderLine[], ticketId = `t${++n}`) =>
  ({ id: `e${++n}`, shopId: 's', at: time, actor, orderNumber: order, type: 'order.sent', ticketId, lines, addOn: false }) as OrderEvent;

test('sold counts: what each order still holds, an undone send and a cancel not counted, halves count half', () => {
  const cancelled = line('seafood');
  const events: OrderEvent[] = [
    sent(1, at(12), [line('margherita', 2), cancelled]),
    { id: 'x1', shopId: 's', at: at(12, 5), actor, orderNumber: 1, type: 'order.item_cancelled', lineId: cancelled.id, index: 1, before: cancelled, reason: 'Changed mind', totalBefore: 0, totalAfter: 0 },
    sent(2, at(13), [line('chicken-burger')], 'undone'),
    { id: 'x2', shopId: 's', at: at(13, 1), actor, orderNumber: 2, type: 'order.send_undone', ticketId: 'undone' },
    sent(3, at(14), [line('margherita', 1, { half: 'seafood' })]),
    sent(4, at(4, 0, 22), [line('italian-pasta')]), // after midnight: still this business day, but outside [from, to)
  ];
  assert.deepEqual(soldCounts(events, at(5), at(4, 0, 22)), { margherita: 2.5, seafood: 0.5 });
});

test('each day rolls in: yesterday counts most, old sales fade', () => {
  const s = rollScores(rollScores({}, { margherita: 10 }), { seafood: 3 });
  assert.deepEqual(s, { margherita: 10 * DECAY, seafood: 3 });
  let faded: Record<string, number> = { margherita: 1 };
  for (let i = 0; i < 30; i++) faded = rollScores(faded, {});
  assert.deepEqual(faded, {}, 'a month of nothing: gone');
});

test('ranking: sold items first, then the shop\'s own order; hidden items never; ties keep the shop\'s order', () => {
  const [a, b, c, d] = MENU;
  const shown = [a, b, c];
  const ranked = rankPopular(shown, { [c.id]: 5, [b.id]: 1, [d.id]: 99 }, [a, b, c, d], 3);
  assert.deepEqual(ranked.map((m) => m.id), [c.id, b.id, a.id]);
  assert.deepEqual(rankPopular(shown, { [b.id]: 2, [c.id]: 2 }, [a, c, b]).map((m) => m.id), [c.id, b.id, a.id]);
  assert.deepEqual(rankPopular(shown, {}, [b, a]).map((m) => m.id), [b.id, a.id], 'no sales yet: the fallback');
});

test("the sample's Popular: its best sellers until sales move a burger to the front", () => {
  assert.equal(popularItems()[0].id, 'margherita');
  setPopularScores({ 'chicken-burger': 3 });
  try {
    assert.deepEqual(popularItems().slice(0, 2).map((m) => m.id), ['chicken-burger', 'margherita']);
    assert.equal(popularItems().length, 9);
  } finally {
    setPopularScores({});
  }
});
