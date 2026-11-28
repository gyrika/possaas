import type { OrderEvent } from './events.ts';
import { itemById } from './menu.ts';
import type { Cents, OrderLine, Tender } from './types.ts';
import { lineItemName } from './halves.ts';
import { changeGiven } from './split.ts';
import type { SyncEvent } from './sync.ts';

/**
 * The sales ledger: each payment as one tidy row, with the items it paid for, for the
 * cloud's `sales` and `sale_items` tables. The event log stays the truth; these rows are
 * folded from it, so they can always be rebuilt and never disagree with it.
 *
 * Money stays integer cents. The paid total is the one the counter charged; `discount`
 * is whatever brought the items' prices down to it (line adjustments, % off, Free).
 */

/** Sri Lanka is UTC+05:30 all year (no daylight saving). */
const LK_OFFSET_MS = 330 * 60_000;
const lk = (at: number) => new Date(at + LK_OFFSET_MS).toISOString();
export const lkDate = (at: number): string => lk(at).slice(0, 10);
export const lkTime = (at: number): string => lk(at).slice(11, 16);

export interface SaleItemRow {
  lineNo: number;
  itemId: string;
  itemName: string;
  size: string | null;
  qty: number;
  unitPrice: Cents;
  lineTotal: Cents;
  extras: string | null;
  leftOut: string | null;
}

export interface SaleRow {
  id: string;
  orderNumber: number;
  saleDate: string;
  saleTime: string;
  paidAt: number;
  itemsCount: number;
  subtotal: Cents;
  discount: Cents;
  total: Cents;
  tender: Tender;
  tendered: Cents;
  changeGiven: Cents;
  cashier: string;
  online: boolean;
  items: SaleItemRow[];
}

/**
 * The lines an order holds after its events, in order: sends add them, an undone send
 * takes its ticket back, manager changes and cancels apply, and their Undo reverses them.
 * Payments, discounts and kitchen events leave the lines alone.
 */
export const orderLinesFrom = (events: readonly OrderEvent[]): { lines: OrderLine[]; online: boolean; deliveryFee: Cents } => {
  let lines: OrderLine[] = [];
  let online = false;
  let deliveryFee = 0;
  const tickets = new Map<string, string[]>();
  const undo = new Map<string, () => void>(); // a manager change's id → how to put it back
  const replace = (id: string, line: OrderLine) => { lines = lines.map((l) => (l.id === id ? line : l)); };
  const remove = (id: string) => { lines = lines.filter((l) => l.id !== id); };
  const putBack = (index: number, line: OrderLine) => {
    if (!lines.some((l) => l.id === line.id)) lines = [...lines.slice(0, index), line, ...lines.slice(index)];
  };
  for (const e of events) {
    switch (e.type) {
      case 'order.sent':
        lines = [...lines, ...e.lines];
        tickets.set(e.ticketId, e.lines.map((l) => l.id));
        if (e.online) online = true;
        if (e.online?.delivery) deliveryFee = e.online.delivery.fee;
        break;
      case 'order.send_undone':
        for (const id of tickets.get(e.ticketId) ?? []) remove(id);
        break;
      case 'order.item_changed':
        replace(e.lineId, e.after);
        undo.set(e.id, () => replace(e.lineId, e.before));
        break;
      case 'order.item_cancelled':
      case 'order.line_removed':
        remove(e.lineId);
        undo.set(e.id, () => putBack(e.index, e.before));
        break;
      case 'order.change_undone':
        undo.get(e.undoneEventId)?.();
        break;
      default: break;
    }
  }
  return { lines, online, deliveryFee };
};

/**
 * Every payment that still stands, with the order's events as they were when paid (plus changes
 * made after it was paid, SCRUM-242). An undone payment gives its events back to the open order.
 * Order numbers are not unique (each screen counts from 1001), so each payment keeps its own events.
 */
export const paidOrders = (events: readonly SyncEvent[]): { at: number; events: OrderEvent[] }[] => {
  const open = new Map<number, OrderEvent[]>();
  const paid = new Map<number, { at: number; events: OrderEvent[] }[]>();
  for (const e of events) {
    if (!e.type.startsWith('order.')) continue;
    const event = e as OrderEvent;
    if (event.type === 'order.paid') {
      paid.set(event.orderNumber, [...(paid.get(event.orderNumber) ?? []), { at: event.at, events: open.get(event.orderNumber) ?? [] }]);
      open.delete(event.orderNumber);
    } else if (event.type === 'order.payment_undone') {
      const taken = paid.get(event.orderNumber)?.pop();
      if (taken) open.set(event.orderNumber, [...taken.events, ...(open.get(event.orderNumber) ?? [])]);
    } else if ((event.type === 'order.item_changed' || event.type === 'order.item_cancelled') && event.afterPay) {
      // Changed after it was paid (SCRUM-242): it changes what that payment sold.
      const last = paid.get(event.orderNumber)?.at(-1);
      if (last) last.events = [...last.events, event]; else open.set(event.orderNumber, [...(open.get(event.orderNumber) ?? []), event]);
    } else if (event.type === 'order.change_undone' && paid.get(event.orderNumber)?.at(-1)?.events.some((x) => 'id' in x && x.id === event.undoneEventId)) {
      paid.get(event.orderNumber)!.at(-1)!.events.push(event);
    } else {
      open.set(event.orderNumber, [...(open.get(event.orderNumber) ?? []), event]);
    }
  }
  return [...paid.values()].flat();
};

const nameOf = (itemId: string): { name: string; size: (id?: string) => string | null; option: (id: string) => string } => {
  try {
    const item = itemById(itemId);
    const options = [...item.adds, ...item.leaveOut];
    return {
      name: item.name.en,
      size: (id) => (id ? item.variants?.find((v) => v.id === id)?.label ?? id : null),
      option: (id) => options.find((o) => o.id === id)?.label ?? id,
    };
  } catch {
    return { name: itemId, size: (id) => id ?? null, option: (id) => id }; // an item the printed menu does not have
  }
};

const safeName = (l: OrderLine): string => {
  try { return lineItemName(l); } catch { return `1/2 ${l.itemId} + 1/2 ${l.half}`; }
};

/** One payment, with what the order held when it was paid. */
export const saleFrom = (
  paid: Extract<OrderEvent, { type: 'order.paid' }>,
  orderEvents: readonly OrderEvent[],
): SaleRow => {
  const { lines, online, deliveryFee } = orderLinesFrom(orderEvents);
  const items = lines.map((l, i): SaleItemRow => {
    const n = nameOf(l.itemId);
    const unitPrice = l.unit ?? 0;
    return {
      lineNo: i + 1,
      itemId: l.itemId,
      itemName: l.half ? safeName(l) : n.name,
      size: n.size(l.size),
      qty: l.qty,
      unitPrice,
      lineTotal: unitPrice * l.qty,
      extras: l.adds.length ? l.adds.map(n.option).join(', ') : null,
      leftOut: l.outs.length ? l.outs.map(n.option).join(', ') : null,
    };
  });
  const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
  return {
    id: paid.id,
    orderNumber: paid.orderNumber,
    saleDate: lkDate(paid.at),
    saleTime: lkTime(paid.at),
    paidAt: paid.at,
    itemsCount: items.reduce((s, it) => s + it.qty, 0),
    subtotal,
    // A delivery's fee is in the total but on no line; a Free order (comp) waives it.
    discount: Math.max(0, subtotal + (paid.tender === 'comp' ? 0 : deliveryFee) - paid.total),
    total: paid.total,
    tender: paid.tender,
    tendered: paid.tendered,
    changeGiven: changeGiven(paid),
    cashier: paid.actor.name,
    online,
    items,
  };
};
