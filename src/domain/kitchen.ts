import { SAMPLE_SECTIONS, itemById, menuSections, sectionOf } from './menu.ts';
import type { SyncEvent } from './sync.ts';
import type { Category, OnlineMark, OrderLine, Station } from './types.ts';
import { leaveOutsOf, lineItemName, secondHalf } from './halves.ts';

/**
 * The kitchen works from the screen only: there is no printed kitchen ticket.
 * So every arrival, change and cancellation must be impossible to miss: the
 * ticket raises an alert (sound + flash) that stays until the kitchen taps it.
 */

/** A line as the kitchen sees it. A manager change keeps the old version so the cook sees both. */
export interface KitchenLine extends OrderLine {
  /** What this line was before the latest manager change. */
  was?: OrderLine;
  cancelled?: boolean;
  /** Portions handed over at a pay-first counter (the serving list); absent = none. */
  served?: number;
}

/**
 * One trip to the kitchen. An order sends its first ticket before payment
 * (customers eat first); anything ordered later goes as an add-on ticket with
 * the same order number. Lines are a copy taken at sending.
 */
export interface KitchenTicket {
  id: string;
  shopId: string;
  number: number;
  lines: KitchenLine[];
  firedAt: number;
  /** A later round for an order the kitchen has already seen. */
  addOn?: boolean;
  /** An online order: the customer comes to collect it by `pickupBy`. */
  online?: OnlineMark;
  /** A shop with two kitchens: the one that makes it. Absent = the only kitchen. */
  station?: Station;
  /** A manager changed or cancelled something on it. */
  changed?: boolean;
  /** Last arrival or change. The ticket flashes until `seenAt` catches up. */
  alertAt: number;
  seenAt?: number;
  doneAt?: number;
}

export type NewTicket = Pick<KitchenTicket, 'id' | 'shopId' | 'number' | 'lines' | 'firedAt' | 'addOn' | 'online' | 'station'>;

export type Urgency = 'ok' | 'warn' | 'bad';

/** The sample menu's cook times (the CheesyBeez owner, 2026-10-12). A shop sets its own per section. */
export const COOK_MINUTES: Record<Category, number> = Object.fromEntries(SAMPLE_SECTIONS.map((x) => [x.id, x.cookMinutes]));
/** An item whose section is unknown (should not happen): a pizza's time. */
const DEFAULT_COOK_MINUTES = 10;
const cookMinutesOf = (itemId: string): number => sectionOf(itemById(itemId).category)?.cookMinutes ?? DEFAULT_COOK_MINUTES;
/** Late = past the cook time; very late = past one and a half times it. */
export const VERY_LATE = 1.5;
/** Done tickets are kept this long so a mistaken "Done" can be undone, then dropped. */
export const KEEP_DONE_MS = 60 * 60_000;

/** A ticket should be ready after its slowest item (a cancelled line no longer counts). */
export const cookTimeMs = (t: Pick<KitchenTicket, 'lines'>): number => {
  const live = t.lines.filter((l) => !l.cancelled);
  return Math.max(0, ...live.map((l) => cookMinutesOf(l.itemId))) * 60_000 || DEFAULT_COOK_MINUTES * 60_000;
};

/** Amber once a ticket passes its cook time, red at one and a half times it. */
export const urgency = (elapsedMs: number, cookMs: number): Urgency =>
  elapsedMs >= cookMs * VERY_LATE ? 'bad' : elapsedMs >= cookMs ? 'warn' : 'ok';

/** "04:07". Minutes keep counting past 59 rather than hiding a very late ticket. */
export const elapsedLabel = (elapsedMs: number): string => {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** The kitchen that makes an item: its section's. Absent = the only kitchen. */
export const stationOf = (itemId: string): Station | undefined => sectionOf(itemById(itemId).category)?.station;

/**
 * A shop with two kitchens sends each kitchen its own ticket, so each one's Done is its own.
 * Lines whose section names no kitchen go to the left one (the shop's first). A shop with one
 * kitchen gets one group with no station, exactly as before.
 */
export const splitByStation = <L extends Pick<OrderLine, 'itemId'>>(lines: readonly L[]): { station?: Station; lines: L[] }[] => {
  const of = lines.map((l) => stationOf(l.itemId));
  if (!of.some(Boolean)) return lines.length ? [{ lines: [...lines] }] : [];
  return (['left', 'right'] as const)
    .map((station) => ({ station, lines: lines.filter((_, i) => (of[i] ?? 'left') === station) }))
    .filter((g) => g.lines.length > 0);
};

/** The shop has a right kitchen as well as the left one: a section of its menu is made there. */
export const twoKitchens = (): boolean => menuSections().some((x) => x.station === 'right');

/** A kitchen screen set to one kitchen shows that kitchen's tickets; unset, it shows them all. */
export const forStation = (tickets: KitchenTicket[], station: Station | null): KitchenTicket[] =>
  station ? tickets.filter((t) => (t.station ?? 'left') === station) : tickets;

/** Adds a ticket, alerting the kitchen. Re-firing the same id replaces it (idempotent). */
export const fire = (tickets: KitchenTicket[], ticket: NewTicket): KitchenTicket[] => [
  ...tickets.filter((t) => t.id !== ticket.id),
  { ...ticket, lines: ticket.lines.map((l) => ({ ...l })), alertAt: ticket.firedAt },
];

/** Removes a ticket entirely, e.g. the cashier undid the send straight away. */
export const recall = (tickets: KitchenTicket[], id: string): KitchenTicket[] =>
  tickets.filter((t) => t.id !== id);

/**
 * A manager changed (`after`) or cancelled (`after` = null) a sent line.
 * The ticket holding it is reopened even if already done, marked Changed, and
 * alerts again: the screen is the kitchen's only channel.
 */
export const amendLine = (
  tickets: KitchenTicket[], lineId: string, after: OrderLine | null, at: number,
): KitchenTicket[] =>
  tickets.map((t) => {
    if (!t.lines.some((l) => l.id === lineId)) return t;
    const { doneAt: _done, ...open } = t;
    return {
      ...open,
      changed: true,
      alertAt: at,
      lines: t.lines.map((l): KitchenLine => {
        if (l.id !== lineId) return l;
        const { was: _was, cancelled: _cancelled, ...current } = l;
        return after ? { ...after, id: lineId, was: current } : { ...current, cancelled: true };
      }),
    };
  });

/** The kitchen's current view of a line (to restore it exactly on a manager Undo). */
export const kitchenLine = (tickets: KitchenTicket[], lineId: string): KitchenLine | undefined =>
  tickets.flatMap((t) => t.lines).find((l) => l.id === lineId);

/**
 * Manager Undo: put a line back exactly as the kitchen had it. The ticket
 * reopens and alerts again, because the cook last saw it changed or cancelled.
 */
export const restoreLine = (tickets: KitchenTicket[], line: KitchenLine, at: number): KitchenTicket[] =>
  tickets.map((t) => {
    if (!t.lines.some((l) => l.id === line.id)) return t;
    const { doneAt: _done, ...open } = t;
    return { ...open, changed: true, alertAt: at, lines: t.lines.map((l) => (l.id === line.id ? { ...line } : l)) };
  });

/** The kitchen tapped the ticket: stop flashing. */
export const ack = (tickets: KitchenTicket[], id: string, at: number): KitchenTicket[] =>
  tickets.map((t) => (t.id === id ? { ...t, seenAt: Math.max(at, t.alertAt) } : t));

export const needsAttention = (t: KitchenTicket): boolean => t.seenAt === undefined || t.seenAt < t.alertAt;

/** Done also counts as seen. */
export const bump = (tickets: KitchenTicket[], id: string, at: number): KitchenTicket[] =>
  tickets.map((t) => (t.id === id && t.doneAt === undefined ? { ...t, doneAt: at, seenAt: Math.max(at, t.alertAt) } : t));

export const unbump = (tickets: KitchenTicket[], id: string): KitchenTicket[] =>
  tickets.map((t) => {
    if (t.id !== id) return t;
    const { doneAt: _done, ...open } = t;
    return open;
  });

/** Portions of a line still to hand over; a cancelled line has none. */
export const toServe = (l: KitchenLine): number => (l.cancelled ? 0 : Math.max(0, l.qty - (l.served ?? 0)));

/**
 * A pay-first counter hands food over one portion at a time. The ticket is
 * done once nothing is left to serve (Done also counts as seen); taking a
 * portion back reopens it.
 */
export const serve = (tickets: KitchenTicket[], id: string, lineId: string, at: number): KitchenTicket[] =>
  tickets.map((t) => {
    if (t.id !== id || !t.lines.some((l) => l.id === lineId && toServe(l) > 0)) return t;
    const lines = t.lines.map((l) => (l.id === lineId ? { ...l, served: (l.served ?? 0) + 1 } : l));
    const next = { ...t, lines };
    return lines.some((l) => toServe(l) > 0) || t.doneAt !== undefined ? next : { ...next, doneAt: at, seenAt: Math.max(at, t.alertAt) };
  });

export const unserve = (tickets: KitchenTicket[], id: string, lineId: string): KitchenTicket[] =>
  tickets.map((t) => {
    if (t.id !== id || !t.lines.some((l) => l.id === lineId && (l.served ?? 0) > 0)) return t;
    const { doneAt: _done, ...open } = t;
    return { ...open, lines: t.lines.map((l) => (l.id === lineId ? { ...l, served: (l.served ?? 0) - 1 } : l)) };
  });

/** What to make next: open tickets, oldest first. */
export const queue = (tickets: KitchenTicket[]): KitchenTicket[] =>
  tickets
    .filter((t) => t.doneAt === undefined)
    .sort((a, b) => a.firedAt - b.firedAt || a.number - b.number);

/**
 * Kitchen state of a sent order, for the register: cooking while any of its
 * tickets is still on the kitchen screen, done once all are bumped. (Done
 * tickets are pruned after an hour, so "no open ticket" also means done.)
 */
export type CookState = 'cooking' | 'done';
export const cookState = (tickets: KitchenTicket[], number: number): CookState =>
  tickets.some((t) => t.number === number && t.doneAt === undefined) ? 'cooking' : 'done';

export const prune = (tickets: KitchenTicket[], now: number): KitchenTicket[] =>
  tickets.filter((t) => t.doneAt === undefined || now - t.doneAt < KEEP_DONE_MS);

export interface LineView {
  qty: number;
  name: string;
  /** Size and paid extras: "Large · Full cheese". */
  detail: string;
  /** Leave-outs are what cooks miss, so the screen shows them apart, in colour. */
  outs: string[];
  note?: string;
}

export interface TicketLine extends LineView {
  key: string;
  status: 'ok' | 'changed' | 'cancelled';
  /** For a changed line: the old version, shown struck through beside the new one. */
  was?: LineView;
}

const view = (l: OrderLine): LineView => {
  const item = itemById(l.itemId);
  const outs = leaveOutsOf(item, secondHalf(l));
  return {
    qty: l.qty,
    name: lineItemName(l),
    detail: [
      item.variants?.find((v) => v.id === l.size)?.label,
      ...l.adds.map((id) => item.adds.find((o) => o.id === id)?.label),
    ].filter(Boolean).join(' · '),
    outs: l.outs.map((id) => outs.find((o) => o.id === id)?.label ?? id),
    note: l.note,
  };
};

export const ticketLines = (t: KitchenTicket): TicketLine[] =>
  t.lines.map((l) => ({
    key: l.id,
    ...view(l),
    status: l.cancelled ? 'cancelled' : l.was ? 'changed' : 'ok',
    ...(l.was && !l.cancelled ? { was: view(l.was) } : {}),
  }));

/**
 * The serving list of a pay-first counter: everything paid for and not yet
 * handed over, grouped by what goes on the plate ("Large chicken rice x 8"),
 * longest wait first. Serving staff never give more of a meal than was paid.
 */
export interface ServingRow extends Omit<LineView, 'qty'> {
  key: string;
  /** Portions still to hand over. */
  count: number;
  oldestAt: number;
  /** The slowest cook time among them, for the urgency colour. */
  cookMs: number;
  /** The portion one tap serves: the oldest one. */
  next: { ticketId: string; lineId: string; number: number };
  /** Every ticket waiting on this row (an arrival or change flashes the row). */
  ticketIds: string[];
}

export const servingRows = (tickets: KitchenTicket[]): ServingRow[] => {
  const rows = new Map<string, ServingRow>();
  for (const t of queue(tickets)) {
    for (const l of t.lines) {
      const left = toServe(l);
      if (left === 0) continue;
      const { qty: _qty, ...v } = view(l);
      const key = [v.name, v.detail, v.outs.join(','), v.note ?? ''].join('|');
      const row = rows.get(key);
      const cookMs = cookTimeMs({ lines: [l] });
      if (row) {
        row.count += left;
        row.cookMs = Math.max(row.cookMs, cookMs);
        if (!row.ticketIds.includes(t.id)) row.ticketIds.push(t.id);
      } else {
        rows.set(key, { ...v, key, count: left, oldestAt: t.firedAt, cookMs, next: { ticketId: t.id, lineId: l.id, number: t.number }, ticketIds: [t.id] });
      }
    }
  }
  return [...rows.values()];
};

/** An open ticket with nothing left to hand over. */
export const nothingToServe = (t: KitchenTicket): boolean => t.lines.every((l) => toServe(l) === 0);

/**
 * A manager cancelled everything left on a paid order: it is no longer on the
 * serving list, but the counter must see that once (a plate may be ready) and
 * tap it away.
 */
export const cancelledToServe = (tickets: KitchenTicket[]): KitchenTicket[] => queue(tickets).filter(nothingToServe);

/** Events older than this cannot hold a ticket worth showing; skipping them keeps the fold cheap. */
export const TICKET_HORIZON_MS = 24 * 60 * 60_000;

/**
 * The kitchen screen, built from events alone (docs/sync-contract.md): every
 * device folds the same events in the same order and gets the same tickets,
 * so nothing ever has to be merged. A manager Undo restores the line exactly
 * as the kitchen had it before the change it undoes.
 */
export const ticketsFromEvents = (events: readonly SyncEvent[], now: number): KitchenTicket[] => {
  let t: KitchenTicket[] = [];
  const before = new Map<string, KitchenLine>(); // change event id → the kitchen's line before it
  for (const e of events) {
    if (now - e.at > TICKET_HORIZON_MS) continue;
    switch (e.type) {
      case 'order.sent':
        t = fire(t, { id: e.ticketId, shopId: e.shopId, number: e.orderNumber, lines: e.lines, firedAt: e.at, addOn: e.addOn, ...(e.online ? { online: e.online } : {}), ...(e.station ? { station: e.station } : {}) });
        break;
      case 'order.send_undone': t = recall(t, e.ticketId); break;
      case 'order.item_changed':
      case 'order.item_cancelled': {
        const was = kitchenLine(t, e.lineId);
        if (!was) break; // not sent: the kitchen never saw it
        before.set(e.id, was);
        t = amendLine(t, e.lineId, e.type === 'order.item_changed' ? e.after : null, e.at);
        break;
      }
      case 'order.change_undone': {
        const was = before.get(e.undoneEventId);
        if (was) t = restoreLine(t, was, e.at);
        break;
      }
      case 'kitchen.seen': t = ack(t, e.ticketId, e.at); break;
      case 'kitchen.bumped': t = bump(t, e.ticketId, e.at); break;
      case 'kitchen.unbumped': t = unbump(t, e.ticketId); break;
      case 'kitchen.served': t = serve(t, e.ticketId, e.lineId, e.at); break;
      case 'kitchen.unserved': t = unserve(t, e.ticketId, e.lineId); break;
      default: break; // payments and price changes do not concern the kitchen
    }
  }
  return prune(t, now);
};
