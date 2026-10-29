import { DAY_EVENT_TYPES } from '../src/domain/cashUp.ts';
import { MENU } from '../src/domain/menu.ts';
import {
  checkNewItem, checkOverride, checkSection, MENU_EVENT_TYPES, NEW_ITEM_ID, NEW_SECTION_ID, OPTION_ID, SIZE_KEY, type ItemOverride, type NewItem, type SectionDef,
} from '../src/domain/menuEdits.ts';
import type { MenuItem } from '../src/domain/types.ts';
import {
  KITCHEN_EVENT_TYPES, ORDER_EVENT_TYPES, PUSH_BATCH, type SyncEvent,
} from '../src/domain/sync.ts';

const TYPES = new Set<string>([
  ...ORDER_EVENT_TYPES, ...KITCHEN_EVENT_TYPES, ...MENU_EVENT_TYPES, ...DAY_EVENT_TYPES,
]);
const cents = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;
const tally = (v: unknown): boolean => isObj(v) && cents(v.cents) && cents(v.orders);
/** The count a close carries: whole numbers only, every way of paying there. */
const validCount = (v: unknown, from: unknown, to: unknown): boolean =>
  isObj(v) && v.from === from && v.to === to && cents(v.orders) && cents(v.total) && cents(v.voids) && cents(v.discounts) &&
  isObj(v.byTender) && ['cash', 'transfer', 'card', 'qr', 'comp'].every((t) => tally((v.byTender as Record<string, unknown>)[t]));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shortString = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isAddedId = (v: unknown): v is string => typeof v === 'string' && NEW_ITEM_ID.test(v);
const onMenu = (itemId: unknown): boolean => MENU.some((entry) => entry.id === itemId) || isAddedId(itemId);
/**
 * An item the owner added: the server checks one event at a time, so it does not know which
 * section it is in, nor that section's sizes and extras. Any well-formed size or extra passes;
 * the menu ignores what the item lacks.
 */
const anyAdded = (o: Record<string, unknown>): MenuItem => {
  const ids = (v: unknown, ok: RegExp) => (isObj(v) ? Object.keys(v).filter((k) => ok.test(k)) : []);
  return {
    id: 'new-item', category: 'any', name: { en: 'This item' }, description: '', aliases: [],
    variants: ids(o.prices, SIZE_KEY).map((id) => ({ id, label: id, price: 0 })), price: 0,
    adds: ids(o.adds, OPTION_ID).map((id) => ({ id, label: id, price: 0 })), leaveOut: [],
  };
};
const validNewItem = (value: unknown): boolean =>
  value === null || (isObj(value) && isObj(value.name) && isObj(value.prices) &&
    Object.entries(value.name).every(([key, name]) => ['en', 'si', 'ta'].includes(key) && typeof name === 'string') &&
    Object.values(value.prices).every((price) => typeof price === 'number') &&
    Object.keys(value).every((key) => ['category', 'name', 'description', 'prices', 'number', 'leaveOut'].includes(key)) &&
    checkNewItem(value as unknown as NewItem, null) === null);
const validOption = (v: unknown): boolean =>
  isObj(v) && Object.keys(v).every((k) => ['id', 'label', 'hint', 'price'].includes(k));
const validSection = (value: unknown): boolean =>
  value === null || (isObj(value) && Object.keys(value).every((key) => ['name', 'cookMinutes', 'sizes', 'adds', 'station'].includes(key)) &&
    Array.isArray(value.sizes) && value.sizes.every(validOption) && Array.isArray(value.adds) && value.adds.every(validOption) &&
    checkSection(value as unknown as SectionDef) === null);
/** A manager's price change carries prices and extras' prices only. */
const onlyPrices = (value: unknown): boolean => isObj(value) && Object.keys(value).every((k) => k === 'prices' || k === 'adds');

const validOverride = (itemId: unknown, value: unknown): boolean => {
  if (!isObj(value)) return false;
  const item = MENU.find((entry) => entry.id === itemId) ?? (isAddedId(itemId) ? anyAdded(value) : undefined);
  if (!item) return false;
  if (value.name !== undefined && (!isObj(value.name) ||
      Object.entries(value.name).some(([key, name]) =>
        !['en', 'si', 'ta'].includes(key) || (name !== undefined && typeof name !== 'string')))) return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.hidden !== undefined && typeof value.hidden !== 'boolean') return false;
  if (value.prices !== undefined && (!isObj(value.prices) ||
      Object.values(value.prices).some((price) => typeof price !== 'number'))) return false;
  if (value.adds !== undefined && (!isObj(value.adds) ||
      Object.values(value.adds).some((price) => typeof price !== 'number'))) return false;
  return checkOverride(item, value as ItemOverride) === null;
};

/**
 * The server checks the shape only (contract rule 3): it never changes an
 * event's body. The shop must be the device's own shop.
 * Returns a reason when the batch must be rejected, or the events.
 */
export const validatePush = (body: unknown, tenantId: string): { events: SyncEvent[] } | { reason: string; wrongShop?: boolean } => {
  if (!isObj(body) || !Array.isArray(body.events)) return { reason: 'body must be { deviceId, events: [] }' };
  if (body.events.length > PUSH_BATCH) return { reason: `at most ${PUSH_BATCH} events per push` };
  for (const [i, e] of body.events.entries()) {
    if (!isObj(e)) return { reason: `event ${i} is not an object` };
    if (!shortString(e.id)) return { reason: `event ${i} has no id` };
    if (!shortString(e.type, 40) || !TYPES.has(e.type)) return { reason: `event ${e.id} has an unknown type` };
    if (!Number.isSafeInteger(e.orderNumber) || (e.orderNumber as number) < 0) return { reason: `event ${e.id} has no orderNumber` };
    if (!Number.isSafeInteger(e.at)) return { reason: `event ${e.id} has no time` };
    if (e.shopId !== tenantId) return { reason: `event ${e.id} belongs to another shop`, wrongShop: true };
    if (e.type.startsWith('order.') || e.type.startsWith('menu.') || e.type.startsWith('day.')) {
      const a = e.actor;
      if (!isObj(a) || !shortString(a.id) || !shortString(a.name, 80) || !shortString(a.role, 16)) {
        return { reason: `event ${e.id} does not say who did it` };
      }
    }
    if ((e.type === 'kitchen.served' || e.type === 'kitchen.unserved') && (!shortString(e.ticketId) || !shortString(e.lineId))) {
      return { reason: `event ${e.id} does not say which portion` };
    }
    if (e.type.startsWith('menu.') && e.orderNumber !== 0) return { reason: `event ${e.id} has an invalid menu order number` };
    if (e.type === 'day.closed' &&
        (e.orderNumber !== 0 || !Number.isSafeInteger(e.from) || !Number.isSafeInteger(e.to) || (e.from as number) >= (e.to as number) ||
          !cents(e.float) || !cents(e.counted) || !validCount(e.count, e.from, e.to))) {
      return { reason: `event ${e.id} has an invalid close of the day` };
    }
    if (e.type === 'menu.item_set' &&
        (!shortString(e.itemId) || !validOverride(e.itemId, e.before) || !validOverride(e.itemId, e.after))) {
      return { reason: `event ${e.id} has an invalid menu change` };
    }
    if (e.type === 'menu.price_set' &&
        (!shortString(e.itemId) || !onlyPrices(e.before) || !onlyPrices(e.after) ||
          !validOverride(e.itemId, e.before) || !validOverride(e.itemId, e.after))) {
      return { reason: `event ${e.id} has an invalid price change` };
    }
    if (e.type === 'menu.sold_out' &&
        (!shortString(e.itemId) || !onMenu(e.itemId) ||
          (e.until !== null && !Number.isSafeInteger(e.until)))) {
      return { reason: `event ${e.id} has an invalid sold-out change` };
    }
    if (e.type === 'menu.item_added' && (!isAddedId(e.itemId) || !validNewItem(e.item))) {
      return { reason: `event ${e.id} has an invalid new menu item` };
    }
    if (e.type === 'menu.section_set' && (typeof e.sectionId !== 'string' || !NEW_SECTION_ID.test(e.sectionId) || !validSection(e.section))) {
      return { reason: `event ${e.id} has an invalid menu section` };
    }
  }
  return { events: body.events as SyncEvent[] };
};
