import { businessDayStart, cashOutsBetween } from './cashOut.ts';
import { salesFrom } from './insights.ts';
import { fmt } from './money.ts';
import { itemById } from './menu.ts';
import { OUT_TOO_LONG_MS } from './online.ts';
import { orderLinesFrom, paidOrders } from './salesLedger.ts';
import type { SyncEvent } from './sync.ts';
import type { Cents, Tender } from './types.ts';

/**
 * Today at a glance (SCRUM-173): the whole shop in one look for the owner, and in words for
 * whatever he taps. Pure, like insights.ts: events in, the picture and its explanations out, so
 * the counter, the owner's phone and the tests all see the same. Every explanation says where
 * its number comes from, so nothing on the screen has to be taken on trust.
 *
 * "Usual" is the same weekday over the last 4 weeks, days the shop was open only; with fewer
 * than 2 such days there is no usual yet, and the screen says so instead of guessing.
 */
export type StationId = 'money';
export type StationTone = 'ok' | 'warn';

export interface Station {
  id: StationId;
  label: string;
  /** The one number on it. */
  value: string;
  tone: StationTone;
  /** Things to look at; 0: none. */
  badge: number;
  explain: string;
  /** Where its records are, on the counter (the owner's phone has no such screens). */
  href: string | null;
}

export interface HourBar {
  hour: number;
  label: string;
  /** Sold in this hour today; null: still to come. */
  today: Cents | null;
  usual: Cents | null;
  explain: string;
}

/** A part of the day (owner, 2026-11-28): morning to 11 am, lunch 11 am to 3 pm, evening after 3 pm. */
export type DayPartId = 'morning' | 'lunch' | 'evening';
export const DAY_PARTS: readonly { id: DayPartId; label: string; from: number; to: number }[] = [
  { id: 'morning', label: 'Morning', from: 0, to: 11 },
  { id: 'lunch', label: 'Lunch', from: 11, to: 15 },
  { id: 'evening', label: 'Evening', from: 15, to: 24 },
];

export interface DayPart {
  id: DayPartId;
  label: string;
  /** "to 11 am", "11 am – 3 pm", "from 3 pm". */
  span: string;
  sales: Cents;
  orders: number;
  /** False until the part has begun. */
  begun: boolean;
  explain: string;
}

/** One dish sold today, all its sizes together, from the bills paid today as they stand. */
export interface ItemSold {
  /** The menu item id. */
  key: string;
  name: string;
  qty: number;
  /** How many in each part of the day. */
  byPart: Record<DayPartId, number>;
}

export interface Glance {
  sales: Cents;
  orders: number;
  parts: DayPart[];
  /** Most sold first. */
  items: ItemSold[];
  /** A usual day for this weekday, all day; null: not enough history yet. */
  usualDay: Cents | null;
  /** Today against that day, 0..; null: no usual yet. */
  share: number | null;
  ringExplain: string;
  stations: Station[];
  hours: HourBar[];
  summary: string;
}

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const weeksBack = (day: number, k: number) => { const d = new Date(day); d.setDate(d.getDate() - 7 * k); return d.getTime(); };
const hourOf = (t: number) => new Date(t).getHours();
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
const clock = (t: number) => { const d = new Date(t); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`; };
const rs = (c: Cents) => `Rs ${fmt(Math.round(c / 100) * 100)}`;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const TENDER: Record<Tender, string> = { cash: 'Cash', transfer: 'Bank transfer', card: 'Card', qr: 'QR', comp: 'Free', uber: 'Uber Eats' };

/**
 * Today's deliveries (SCRUM-193) sent to the kitchen and not paid yet: the rider still has the food
 * or the cash. `due` is their lines at the price they were sent at plus the fee (a later discount
 * would make it less, hence "about").
 */
export const unpaidDeliveries = (events: readonly SyncEvent[], today: number, now: number): { number: number; due: Cents; readyBy: number }[] => {
  const out = new Map<number, { number: number; due: Cents; readyBy: number }>();
  for (const e of events) {
    if (e.at < today || e.at > now) continue;
    if (e.type === 'order.sent' && e.online?.delivery) {
      const lines = e.lines.reduce((n, l) => n + (l.unit ?? 0) * l.qty, 0);
      out.set(e.orderNumber, { number: e.orderNumber, due: lines + e.online.delivery.fee, readyBy: e.online.pickupBy });
    } else if (e.type === 'order.sent' && out.has(e.orderNumber)) {
      out.get(e.orderNumber)!.due += e.lines.reduce((n, l) => n + (l.unit ?? 0) * l.qty, 0);
    } else if (e.type === 'order.paid') out.delete(e.orderNumber);
  }
  return [...out.values()];
};

/** The shop at a glance, now. */
export const glanceOf = (events: readonly SyncEvent[], now: number): Glance => {
  const today = startOfDay(now);
  const weekday = WEEKDAYS[new Date(now).getDay()];
  const sales = salesFrom(events).filter((s) => s.at <= now);
  const todays = sales.filter((s) => s.at >= today);
  const total = todays.reduce((n, s) => n + s.total, 0);

  // ----- usual: the same weekday, the last 4 weeks the shop was open -----
  const past = [1, 2, 3, 4].map((k) => weeksBack(today, k))
    .map((day) => sales.filter((s) => s.at >= day && s.at < day + DAY))
    .filter((day) => day.length > 0);
  const known = past.length >= 2;
  const avg = (f: (day: typeof todays) => number) => (known ? Math.round(past.reduce((n, d) => n + f(d), 0) / past.length) : null);
  const usualDay = avg((d) => d.reduce((n, s) => n + s.total, 0));
  const upTo = (t: number) => hourOf(t) * 60 + new Date(t).getMinutes();
  const usualSoFar = avg((d) => d.filter((s) => upTo(s.at) <= upTo(now)).reduce((n, s) => n + s.total, 0));

  // ----- sales by hour: from the first hour the shop sells in to the last -----
  const seen = [...todays, ...past.flat()].map((s) => hourOf(s.at));
  const first = seen.length ? Math.min(...seen) : 10;
  const last = Math.max(seen.length ? Math.max(...seen) : 21, first + 5);
  const hours: HourBar[] = [];
  for (let h = first; h <= last; h++) {
    const done = today + h * 60 * 60 * 1000 <= now;
    const t = done ? todays.filter((s) => hourOf(s.at) === h).reduce((n, s) => n + s.total, 0) : null;
    const u = avg((d) => d.filter((s) => hourOf(s.at) === h).reduce((n, s) => n + s.total, 0));
    const current = done && hourOf(now) === h;
    const lines = t === null
      ? [`${hourLabel(h)}: still to come.`, ...(u !== null ? [`A usual ${weekday} makes ${rs(u)} in this hour.`] : [])]
      : [`${hourLabel(h)}: ${rs(t)}${current ? ' so far' : ''}.`,
        ...(u !== null ? [`A usual ${weekday}: ${rs(u)}.`, ...(current ? [] : [t >= u ? `${rs(t - u)} more than usual.` : `${rs(u - t)} less than usual.`])] : ['No usual yet: it needs 2 weeks of history.'])];
    hours.push({ hour: h, label: hourLabel(h), today: t, usual: u, explain: lines.join('\n') });
  }

  // ----- morning, lunch, evening -----
  const partOf = (t: number): DayPartId => DAY_PARTS.find((p) => hourOf(t) >= p.from && hourOf(t) < p.to)!.id;
  const parts: DayPart[] = DAY_PARTS.map((p) => {
    const inPart = todays.filter((s) => partOf(s.at) === p.id);
    const sum = inPart.reduce((n, s) => n + s.total, 0);
    const span = p.from === 0 ? `to ${hourLabel(p.to)}` : p.to === 24 ? `from ${hourLabel(p.from)}` : `${hourLabel(p.from)} – ${hourLabel(p.to)}`;
    const begun = hourOf(now) >= p.from;
    const ongoing = begun && hourOf(now) < p.to;
    return {
      id: p.id, label: p.label, span, sales: sum, orders: inPart.length, begun,
      explain: !begun ? `${p.label} (${span}): still to come.`
        : [`${p.label} (${span}): ${rs(sum)} from ${plural(inPart.length, 'bill')}${ongoing ? ' so far' : ''}.`,
          ...(inPart.length ? [`${rs(sum / inPart.length)} a bill on average.`] : [])].join('\n'),
    };
  });

  // ----- each dish sold today, from today's paid bills as they stand -----
  // One row per dish: its sizes (Half, Full) count together (owner, 2026-11-28).
  const sold = new Map<string, ItemSold>();
  const addSold = (itemId: string, qty: number, part: DayPartId) => {
    let row = sold.get(itemId);
    if (!row) {
      let name = itemId;
      try { name = itemById(itemId).name.en; } catch { /* an item no longer on the menu */ }
      row = { key: itemId, name, qty: 0, byPart: { morning: 0, lunch: 0, evening: 0 } };
      sold.set(itemId, row);
    }
    row.qty += qty; row.byPart[part] += qty;
  };
  for (const p of paidOrders(events)) {
    if (p.at < today || p.at > now) continue;
    const part = partOf(p.at);
    for (const l of orderLinesFrom(p.events).lines) {
      if (l.half) { addSold(l.itemId, l.qty / 2, part); addSold(l.half, l.qty / 2, part); }
      else addSold(l.itemId, l.qty, part);
    }
  }
  const items = [...sold.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  // ----- the one station: the money (no Counter station, owner 2026-11-28; voids and discounts stay in To do) -----

  const byTender = new Map<Tender, Cents>();
  for (const s of todays) {
    // A split bill counts each tender for its own part; a difference settled later goes with the main one.
    const parts = s.parts?.length ? s.parts : [{ tender: s.tender, amount: s.total }];
    const rest = s.total - parts.reduce((n, p) => n + p.amount, 0);
    for (const p of parts) byTender.set(p.tender, (byTender.get(p.tender) ?? 0) + p.amount);
    if (rest) byTender.set(s.tender, (byTender.get(s.tender) ?? 0) + rest);
  }
  const unpaid = unpaidDeliveries(events, today, now);
  const owed = unpaid.reduce((n, d) => n + d.due, 0);
  const overdue = unpaid.filter((d) => now - d.readyBy > OUT_TOO_LONG_MS);
  // Cash out (cashOut.ts): what left the drawer this business day, the owner's paper list.
  const day = businessDayStart(now);
  const cashOut = cashOutsBetween(events, day, day + DAY);
  const money: Station = {
    id: 'money', label: 'Money', value: rs(total), tone: overdue.length ? 'warn' : 'ok', badge: overdue.length, href: '#cashout',
    explain: [
      `Money: ${rs(total)} taken today.`,
      ...[...byTender].filter(([, c]) => c > 0).map(([t, c]) => `${TENDER[t]}: ${rs(c)}`),
      ...(cashOut.total ? [`Cash out of the drawer today: ${rs(cashOut.total)} (${cashOut.lines.slice(0, 4).map((l) => l.name).join(', ')}${cashOut.lines.length > 4 ? ' and more' : ''}).`] : []),
      ...(byTender.get('cash') ? [`The drawer should hold the cash plus the opening float${cashOut.total ? ', less the cash out' : ''}.`] : []),
      ...(unpaid.length ? [`About ${rs(owed)} still to come from ${plural(unpaid.length, 'delivery', 'deliveries')}, paid when the rider is back.`] : []),
      ...overdue.map((d) => `Delivery ${d.number} was ready at ${clock(d.readyBy)} and is not paid yet.`),
    ].join('\n'),
  };

  // ----- the ring and the day in a sentence -----
  const share = usualDay ? total / usualDay : null;
  const ringExplain = [
    `Sales today: ${rs(total)} from ${plural(todays.length, 'order')}.`,
    ...(usualDay !== null && usualSoFar !== null
      ? [`By ${clock(now)} a usual ${weekday} has made ${rs(usualSoFar)}, and ${rs(usualDay)} by closing.`, `The ring fills toward that full day: ${Math.round((share ?? 0) * 100)}% now.`]
      : ['No usual yet: the ring needs 2 weeks of history for this weekday.']),
  ].join('\n');
  const greeting = new Date(now).getHours() < 12 ? 'Good morning.' : new Date(now).getHours() < 17 ? 'Good afternoon.' : 'Good evening.';
  const pace = !todays.length ? 'No sales yet today.'
    : usualSoFar ? (() => {
      const pct = Math.round(((total - usualSoFar) / usualSoFar) * 100);
      return Math.abs(pct) < 10 ? `${rs(total)} so far, about usual for a ${weekday}.` : `${rs(total)} so far, ${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'} a usual ${weekday}.`;
    })()
      : `${rs(total)} from ${plural(todays.length, 'order')} so far.`;
  const peak = hours.filter((h) => (h.today ?? 0) > 0).sort((a, b) => (b.today ?? 0) - (a.today ?? 0))[0];
  const top = items[0];
  const summary = [
    `${greeting} ${pace}`,
    ...(peak ? [`Busiest hour: ${peak.label} (${rs(peak.today ?? 0)}).`] : []),
    ...(top ? [`Most sold: ${top.name} (${top.qty}).`] : []),
  ].join('\n');

  return {
    sales: total, orders: todays.length, parts, items, usualDay, share, ringExplain,
    stations: [money],
    hours,
    summary,
  };
};
