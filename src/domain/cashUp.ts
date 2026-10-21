import type { Actor } from './auth.ts';
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

/**
 * The day's close, kept: the manager's count and the cash, audited (who, when). The owner sees it
 * in the Owner view and the shop PC files it as a PDF (server/dailyReport.ts). Closing again
 * replaces that day's close, so a miscount is fixed by counting again; nothing is edited.
 */
export interface DayClosedEvent {
  type: 'day.closed';
  id: string;
  shopId: string;
  at: number;
  actor: Actor;
  /** Not an order: 0, like menu changes. */
  orderNumber: 0;
  from: number;
  to: number;
  float: Cents;
  counted: Cents;
  count: DayCount;
}
export const DAY_EVENT_TYPES = ['day.closed'] as const satisfies readonly DayClosedEvent['type'][];

/** The latest close of each business day, newest day first. */
export const closesFrom = (events: readonly { type: string }[]): DayClosedEvent[] => {
  const byDay = new Map<number, DayClosedEvent>();
  for (const e of events) {
    if (e.type !== 'day.closed') continue;
    const c = e as DayClosedEvent;
    const was = byDay.get(c.from);
    if (!was || c.at >= was.at) byDay.set(c.from, c);
  }
  return [...byDay.values()].sort((a, b) => b.from - a.from);
};

export interface ReportRow { label: string; value: string; strong?: boolean }
/** The day in one shape for the receipt slip, the PDF and the Owner view. */
export interface DayReport {
  /** "Tuesday 21 October 2026": the business day, named by the morning it started. */
  day: string;
  period: string;
  sections: { title: string; rows: ReportRow[] }[];
  /** Who closed and when, or that nobody did. */
  closed: string;
}

const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** `by` and `closedAt` null: nobody closed the day (the report the shop PC makes by itself at 5 am). */
export function dayReport(d: DayCount, o: { float: Cents | null; counted: Cents | null; by: string | null; closedAt: number | null }): DayReport {
  const sales: ReportRow[] = TENDERS.filter((t) => d.byTender[t].orders)
    .map((t) => ({ label: `${TENDER_NAMES[t]} (${d.byTender[t].orders})`, value: fmt(d.byTender[t].cents) }));
  sales.push({ label: `Total (${d.orders} ${d.orders === 1 ? 'order' : 'orders'})`, value: fmt(d.total), strong: true });
  const changes: ReportRow[] = [
    { label: 'Items cancelled', value: String(d.voids) },
    { label: 'Discounts / free', value: String(d.discounts) },
  ];
  const cash: ReportRow[] = o.float === null
    ? [{ label: 'Cash taken', value: fmt(d.byTender.cash.cents) }, { label: 'Cash counted', value: 'Not counted' }]
    : [
      { label: 'Cash at opening', value: fmt(o.float) },
      { label: 'Cash expected', value: fmt(expectedCash(d, o.float)) },
      ...(o.counted === null ? [] : [
        { label: 'Cash counted', value: fmt(o.counted) },
        { label: 'Difference', value: difference(o.counted, expectedCash(d, o.float)), strong: true },
      ]),
    ];
  return {
    day: `${new Date(d.from).toLocaleDateString('en-GB', { weekday: 'long' })} ${new Date(d.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    period: `${when(d.from)} - ${when(d.to)}`,
    sections: [{ title: 'Sales', rows: sales }, { title: 'Changes', rows: changes }, { title: 'Cash', rows: cash }],
    closed: o.by && o.closedAt !== null ? `Closed by ${o.by} at ${clock(o.closedAt)}` : 'Nobody closed the day',
  };
}

/** The day's close on the receipt printer, to keep with the cash. */
export function cashUpLines(d: DayCount, o: { shop: ShopHeader; float: Cents; counted: Cents | null; by: string; width: number }): ReceiptLine[] {
  const rule = { text: '-'.repeat(o.width) };
  const report = dayReport(d, { float: o.float, counted: o.counted, by: o.by, closedAt: null });
  return [
    { text: o.shop.name.slice(0, Math.floor(o.width / 2)), center: true, bold: true, big: true },
    { text: 'Close of the day', center: true },
    { text: report.period, center: true },
    ...report.sections.flatMap((s) => [rule, ...s.rows.map((r) => ({ text: twoCols(r.label, r.value, o.width), ...(r.strong ? { bold: true } : {}) }))]),
    rule,
    { text: `Closed by ${o.by}`, center: true },
  ];
}

/** A business day gone by: its close, or, when nobody closed it, the sales alone. */
export interface PastDay {
  from: number;
  close: DayClosedEvent | null;
  /** The close's count, or the whole day's sales. */
  count: DayCount;
  /** "Rs 200 short", "Exact"; null when nobody counted. */
  difference: string | null;
  report: DayReport;
}

const nextDay = (dayStart: number): number => { const d = new Date(dayStart); d.setDate(d.getDate() + 1); return d.getTime(); };

/**
 * Every day with sales or a close, newest first (Owner view → Past days). Today is in it
 * only once closed: until then it is still being sold.
 */
export function pastDays(events: readonly { type: string; at?: number }[], now: number, limit = 90): PastDay[] {
  const closes = new Map(closesFrom(events).map((c) => [c.from, c]));
  const today = businessDayStart(now);
  const byDay = new Map<number, { type: string }[]>();
  for (const e of events) {
    if (!e.type.startsWith('order.') || e.at === undefined) continue;
    const day = businessDayStart(e.at);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const days = new Set([...closes.keys(), ...[...byDay.keys()].filter((d) => d < today)]);
  return [...days].sort((a, b) => b - a).slice(0, limit).flatMap((from): PastDay[] => {
    const close = closes.get(from) ?? null;
    if (close) {
      return [{ from, close, count: close.count, difference: difference(close.counted, expectedCash(close.count, close.float)),
        report: dayReport(close.count, { float: close.float, counted: close.counted, by: close.actor.name, closedAt: close.at }) }];
    }
    const count = dayCount(byDay.get(from) ?? [], from, nextDay(from));
    return count.orders ? [{ from, close, count, difference: null, report: dayReport(count, { float: null, counted: null, by: null, closedAt: null }) }] : [];
  });
}
