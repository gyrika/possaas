import type { OrderEvent } from './events.ts';
import { fmt } from './money.ts';
import { twoCols, type ReceiptLine, type ShopHeader } from './receipt.ts';
import type { Cents, Tender } from './types.ts';

/**
 * Closing the day: what the drawer should hold, against what is counted. Serves the manager at
 * closing, who already knows the cash they started with and wants one number: short, over or
 * exact. From the events (the truth), so it agrees with the Owner view and survives a restart.
 */

/** A shop's day runs 5 am to 5 am: a kottu shop still selling after midnight closes yesterday's day. */
export const DAY_STARTS_HOUR = 5;
export const businessDayStart = (now: number): number => {
  const d = new Date(now);
  if (d.getHours() < DAY_STARTS_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(DAY_STARTS_HOUR, 0, 0, 0);
  return d.getTime();
};

export interface DayCount {
  from: number;
  to: number;
  orders: number;
  /** Paid in each way, and how many orders. */
  byTender: Record<Tender, { cents: Cents; orders: number }>;
  total: Cents;
  /** Sent items a manager cancelled, and discounts or free orders given (each still standing). */
  voids: number;
  discounts: number;
}

const TENDERS: Tender[] = ['cash', 'transfer', 'card', 'qr', 'comp'];
export const TENDER_NAMES: Record<Tender, string> = { cash: 'Cash', transfer: 'Bank transfer', card: 'Card', qr: 'QR', comp: 'Free' };

/**
 * The business day `from`..`to`. Payments as they stand (an Undo takes back the latest payment of
 * that order number, as salesFrom does); a manager's change undone does not count.
 */
export function dayCount(events: readonly { type: string }[], from: number, to: number): DayCount {
  const undone = new Set(events.filter((e) => e.type === 'order.change_undone').map((e) => (e as Extract<OrderEvent, { type: 'order.change_undone' }>).undoneEventId));
  const paid: ({ total: Cents; tender: Tender } | null)[] = [];
  const open = new Map<number, number[]>();
  let voids = 0;
  let discounts = 0;
  for (const raw of events) {
    const e = raw as OrderEvent;
    if (!e.type?.startsWith('order.') || e.at < from || e.at >= to) continue;
    if (e.type === 'order.paid') {
      open.set(e.orderNumber, [...(open.get(e.orderNumber) ?? []), paid.length]);
      paid.push({ total: e.total, tender: e.tender });
    } else if (e.type === 'order.payment_undone') {
      const i = open.get(e.orderNumber)?.pop();
      if (i !== undefined) paid[i] = null;
    } else if (!undone.has(e.id)) {
      if (e.type === 'order.item_cancelled') voids += 1;
      if (e.type === 'order.comped' || (e.type === 'order.discount_set' && e.after)) discounts += 1;
    }
  }
  const byTender = Object.fromEntries(TENDERS.map((t) => [t, { cents: 0, orders: 0 }])) as DayCount['byTender'];
  let total = 0;
  for (const p of paid) {
    if (!p) continue;
    byTender[p.tender].cents += p.total;
    byTender[p.tender].orders += 1;
    total += p.total;
  }
  return { from, to, orders: paid.filter(Boolean).length, byTender, total, voids, discounts };
}

/** What the drawer should hold: the cash it started with, plus the cash taken. */
export const expectedCash = (d: DayCount, float: Cents): Cents => float + d.byTender.cash.cents;

/** "Rs 200 short", "Rs 50 over", "Exact". */
export const difference = (counted: Cents, expected: Cents): string =>
  counted === expected ? 'Exact' : `Rs ${fmt(Math.abs(counted - expected))} ${counted < expected ? 'short' : 'over'}`;

const when = (at: number) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The day's close on the receipt printer, to keep with the cash. */
export function cashUpLines(d: DayCount, o: { shop: ShopHeader; float: Cents; counted: Cents | null; by: string; width: number }): ReceiptLine[] {
  const rule = { text: '-'.repeat(o.width) };
  const row = (l: string, r: string) => ({ text: twoCols(l, r, o.width) });
  const expected = expectedCash(d, o.float);
  return [
    { text: o.shop.name.slice(0, Math.floor(o.width / 2)), center: true, bold: true, big: true },
    { text: 'Close of the day', center: true },
    { text: `${when(d.from)} - ${when(d.to)}`, center: true },
    rule,
    ...TENDERS.filter((t) => d.byTender[t].orders).map((t) => row(`${TENDER_NAMES[t]} (${d.byTender[t].orders})`, fmt(d.byTender[t].cents))),
    row(`Total (${d.orders} ${d.orders === 1 ? 'order' : 'orders'})`, fmt(d.total)),
    row('Items cancelled', String(d.voids)),
    row('Discounts / free', String(d.discounts)),
    rule,
    row('Cash at opening', fmt(o.float)),
    row('Cash expected', fmt(expected)),
    ...(o.counted === null ? [] : [row('Cash counted', fmt(o.counted)), { text: twoCols('Difference', difference(o.counted, expected), o.width), bold: true }]),
    rule,
    { text: `Closed by ${o.by}`, center: true },
  ];
}
