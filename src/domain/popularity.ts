import type { OrderEvent } from './events.ts';
import type { MenuItem } from './types.ts';
import { orderLinesFrom } from './salesLedger.ts';

/**
 * "Popular" from what the shop really sells (step 3d). Each business day's sales are rolled
 * into one score per item, yesterday counting most: `score = previous × DECAY + sold that day`,
 * about a week of memory. Today's sales add on top live, so a new shop's first orders already
 * move their items up. Items nobody has bought yet keep the shop's own order after them.
 */
export type Scores = Record<string, number>;

export const DECAY = 0.8;
export const POPULAR_COUNT = 9;

/**
 * Portions sold per item in [from, to): what each order still holds after undone sends,
 * cancels and manager changes. A half-and-half pizza counts half for each half.
 */
export const soldCounts = (events: readonly OrderEvent[], from: number, to: number): Scores => {
  const byOrder = new Map<number, OrderEvent[]>();
  for (const e of events) {
    if (e.at < from || e.at >= to) continue;
    byOrder.set(e.orderNumber, [...(byOrder.get(e.orderNumber) ?? []), e]);
  }
  const counts: Scores = {};
  const add = (id: string, n: number) => { counts[id] = (counts[id] ?? 0) + n; };
  for (const order of byOrder.values()) {
    for (const l of orderLinesFrom(order).lines) {
      if (l.half) { add(l.itemId, l.qty / 2); add(l.half, l.qty / 2); } else add(l.itemId, l.qty);
    }
  }
  return counts;
};

/** One business day rolled in: the old scores fade, that day's sales add. */
export const rollScores = (prev: Scores, day: Scores): Scores => {
  const next: Scores = {};
  for (const [id, s] of Object.entries(prev)) if (s * DECAY >= 0.01) next[id] = s * DECAY;
  for (const [id, n] of Object.entries(day)) next[id] = (next[id] ?? 0) + n;
  return next;
};

export const addScores = (a: Scores, b: Scores): Scores => {
  const sum: Scores = { ...a };
  for (const [id, n] of Object.entries(b)) sum[id] = (sum[id] ?? 0) + n;
  return sum;
};

/**
 * The Popular tab: sold items by score, then `fallback` (the shop's own order) for the rest.
 * Only items on offer (not hidden); ties keep the fallback's order so buttons don't swap at random.
 */
export const rankPopular = (shown: readonly MenuItem[], scores: Scores, fallback: readonly MenuItem[], n = POPULAR_COUNT): MenuItem[] => {
  const place = new Map(fallback.map((m, i) => [m.id, i]));
  const at = (m: MenuItem) => place.get(m.id) ?? fallback.length;
  const sold = shown.filter((m) => (scores[m.id] ?? 0) > 0)
    .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0) || at(a) - at(b));
  const taken = new Set(sold.map((m) => m.id));
  const rest = fallback.filter((m) => !taken.has(m.id) && shown.some((s) => s.id === m.id));
  return [...sold, ...rest].slice(0, n);
};
