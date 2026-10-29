import type { Actor } from './auth.ts';
import type { Category, Cents, MenuItem, Option, Section, SizeId } from './types.ts';

/**
 * The owner's own menu, as events on top of a starting menu (a new shop starts empty; the demo
 * starts from the pizza sample in menu.ts, and "Back to how it was" is always one tap).
 * Each change is an event like a sale: who, when, before and after, so it reaches every screen,
 * the cloud and online ordering, is audited, and can be undone.
 *
 * An override is the whole difference for one item; the newest event for an item wins.
 */
export interface ItemOverride {
  name?: { en?: string; si?: string; ta?: string };
  description?: string;
  /** Price per size, or `one` for single-price items. */
  prices?: Partial<Record<SizeId | 'one', Cents>>;
  /** Extras' prices, by option id. */
  adds?: Record<string, Cents>;
  hidden?: boolean;
}

/**
 * An item the owner added. It takes its section's sizes and extras, so only its name, prices
 * and (if any) leave-outs are his to type. A size it has no price for is simply not offered.
 */
export interface NewItem {
  category: Category;
  name: { en: string; si?: string; ta?: string };
  description: string;
  /** A price per size of its section it is sold in, or `one` for a section without sizes. */
  prices: Partial<Record<SizeId | 'one', Cents>>;
  /** The number staff and customers order it by ("5 L"). */
  number?: number;
  /** What a customer may ask to leave out: "No onion". */
  leaveOut?: string[];
}

/** A section the owner made (or changed): its name, cook time, sizes and extras. */
export type SectionDef = Omit<Section, 'id'>;

/** Added items' ids, so they never meet a starting item's id. */
export const NEW_ITEM_ID = /^new-[a-z0-9-]{1,48}$/;
/** The owner's own sections' ids. */
export const NEW_SECTION_ID = /^sec-[a-z0-9-]{1,40}$/;
/** A size's or extra's id inside its section: a slug of its label. */
export const OPTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A price's size: a shop's own (a slug) or the sample's ('S', 'M', 'L'). */
export const SIZE_KEY = /^([SML]|[a-z0-9][a-z0-9-]{0,39})$/;

/** "Chicken Alfredo" → "chicken-alfredo". */
export const slug = (text: string, max = 40): string =>
  text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);

/** What a manager may change on an item: its prices, nothing else. */
export type PriceChange = Pick<ItemOverride, 'prices' | 'adds'>;

interface MenuBase { id: string; shopId: string; at: number; orderNumber: 0; actor: Actor; itemId: string }
interface SectionBase { id: string; shopId: string; at: number; orderNumber: 0; actor: Actor; sectionId: string }
export type MenuEvent =
  /** Owner only: names, description, prices, hidden. `after: {}` = back to the printed menu. */
  | (MenuBase & { type: 'menu.item_set'; before: ItemOverride; after: ItemOverride })
  /** Owners and managers: only the prices (sizes and extras); names and what is on offer stay the owner's. */
  | (MenuBase & { type: 'menu.price_set'; before: PriceChange; after: PriceChange })
  /** Owners and managers: sold out until `until` (the next morning), or back (`null`). */
  | (MenuBase & { type: 'menu.sold_out'; until: number | null })
  /** Owner only: a new item, or `null` to take back an item just added (Undo). */
  | (MenuBase & { type: 'menu.item_added'; item: NewItem | null })
  /** Owner only: a section made or changed (the whole definition), or `null` to take it off the menu. */
  | (SectionBase & { type: 'menu.section_set'; section: SectionDef | null });

export const MENU_EVENT_TYPES = ['menu.item_set', 'menu.price_set', 'menu.sold_out', 'menu.item_added', 'menu.section_set'] as const satisfies readonly MenuEvent['type'][];

/** Where a shop's menu starts before its own events: empty for a new shop, the sample for the demo. */
export interface StartingMenu { sections: Section[]; items: MenuItem[] }
export const EMPTY_START: StartingMenu = { sections: [], items: [] };

export interface MenuState {
  overrides: Record<string, ItemOverride>;
  /** Item id → sold out until (ms). */
  soldOut: Record<string, number>;
  /**
   * The owner's own items, oldest first. A taken-back item keeps its definition (`removed`),
   * so an order that already has it still prices and prints.
   */
  added: Record<string, NewItem & { removed?: true }>;
  /** The owner's sections (and changes to starting ones), oldest first; a taken-off one keeps its definition. */
  sections: Record<string, SectionDef & { removed?: true }>;
}
export const EMPTY_MENU_STATE: MenuState = { overrides: {}, soldOut: {}, added: {}, sections: {} };

/** Folds menu events (oldest first) into the shop's current changes. Other events are ignored. */
export const menuStateFromEvents = (events: readonly { type: string }[]): MenuState => {
  const overrides: Record<string, ItemOverride> = {};
  const soldOut: Record<string, number> = {};
  const added: MenuState['added'] = {};
  const sections: MenuState['sections'] = {};
  for (const e of events) {
    if (e.type === 'menu.item_set') {
      const m = e as Extract<MenuEvent, { type: 'menu.item_set' }>;
      if (Object.keys(m.after).length) overrides[m.itemId] = m.after;
      else delete overrides[m.itemId];
    } else if (e.type === 'menu.price_set') {
      const m = e as Extract<MenuEvent, { type: 'menu.price_set' }>;
      const { prices: _p, adds: _a, ...rest } = overrides[m.itemId] ?? {};
      const next: ItemOverride = { ...rest, ...(m.after.prices ? { prices: m.after.prices } : {}), ...(m.after.adds ? { adds: m.after.adds } : {}) };
      if (Object.keys(next).length) overrides[m.itemId] = next;
      else delete overrides[m.itemId];
    } else if (e.type === 'menu.sold_out') {
      const m = e as Extract<MenuEvent, { type: 'menu.sold_out' }>;
      if (m.until) soldOut[m.itemId] = m.until;
      else delete soldOut[m.itemId];
    } else if (e.type === 'menu.item_added') {
      const m = e as Extract<MenuEvent, { type: 'menu.item_added' }>;
      if (m.item) added[m.itemId] = m.item;
      else if (added[m.itemId]) added[m.itemId] = { ...added[m.itemId], removed: true };
    } else if (e.type === 'menu.section_set') {
      const m = e as Extract<MenuEvent, { type: 'menu.section_set' }>;
      if (m.section) sections[m.sectionId] = m.section;
      else if (sections[m.sectionId]) sections[m.sectionId] = { ...sections[m.sectionId], removed: true };
    }
  }
  return { overrides, soldOut, added, sections };
};

const clean = (s: string | undefined) => s?.trim() || undefined;

/** One printed item with the owner's changes applied. */
export const applyOverride = (item: MenuItem, o: ItemOverride | undefined, soldOutUntil: number | undefined, now: number): MenuItem => {
  const soldOut = soldOutUntil !== undefined && soldOutUntil > now;
  if (!o && !soldOut) return item;
  const price = (id: SizeId | 'one', fallback: Cents) => o?.prices?.[id] ?? fallback;
  return {
    ...item,
    name: {
      en: clean(o?.name?.en) ?? item.name.en,
      ...(clean(o?.name?.si) ?? item.name.si ? { si: clean(o?.name?.si) ?? item.name.si } : {}),
      ...(clean(o?.name?.ta) ?? item.name.ta ? { ta: clean(o?.name?.ta) ?? item.name.ta } : {}),
    },
    description: clean(o?.description) ?? item.description,
    ...(item.variants ? { variants: item.variants.map((v) => ({ ...v, price: price(v.id, v.price) })) } : {}),
    ...(item.price !== undefined ? { price: price('one', item.price) } : {}),
    adds: item.adds.map((a) => ({ ...a, price: o?.adds?.[a.id] ?? a.price })),
    ...(o?.hidden ? { hidden: true } : {}),
    ...(soldOut ? { soldOut: true } : {}),
    ...(o ? { edited: true } : {}),
  };
};

/**
 * Every section, the owner's changes applied, taken-off ones included (marked `removed`): an old
 * order may have an item from one. Starting sections first, then the owner's, oldest first.
 */
export const allSections = (start: StartingMenu, state: MenuState): (Section & { removed?: true })[] => {
  const own = state.sections ?? {};
  return [
    ...start.sections.map((sec) => (own[sec.id] ? { ...own[sec.id], id: sec.id } : sec)),
    ...Object.entries(own).filter(([id]) => !start.sections.some((sec) => sec.id === id)).map(([id, def]) => ({ ...def, id })),
  ];
};

/** The sizes an item in this section is priced in ('one' for a single price). */
export const newItemSizes = (section: Pick<Section, 'sizes'>): { id: SizeId | 'one'; label: string; hint?: string }[] =>
  section.sizes.length ? section.sizes : [{ id: 'one', label: 'Price' }];

/** "No onion" → an option the customer can ask for. */
const leaveOutOption = (label: string): Option => ({ id: `no-${slug(label.replace(/^no\s+/i, ''), 36) || 'thing'}`, label, price: 0 });

/** An added item as a menu item, before the owner's later changes (null if its section was never made). */
export const newMenuItem = (id: string, n: NewItem & { removed?: true }, sections: readonly (Section & { removed?: true })[]): MenuItem | null => {
  const sec = sections.find((x) => x.id === n.category);
  if (!sec) return null;
  const variants = sec.sizes.filter((z) => (n.prices[z.id] ?? 0) > 0).map((z) => ({ ...z, price: n.prices[z.id]! }));
  // Nothing it can be sold as (its sizes changed since): kept for old orders, not offered.
  const unsellable = sec.sizes.length ? variants.length === 0 : !(n.prices.one && n.prices.one > 0);
  return {
    id, category: n.category, name: n.name, description: n.description, aliases: [],
    ...(n.number ? { number: n.number } : {}),
    ...(sec.sizes.length ? { variants } : { price: n.prices.one ?? 0 }),
    adds: sec.adds, leaveOut: (n.leaveOut ?? []).map(leaveOutOption), added: true,
    ...(n.removed ? { hidden: true, removed: true } : (sec.removed || unsellable) ? { hidden: true } : {}),
  };
};

/** The menu every screen shows: the starting items, then the owner's own, with the shop's changes. */
export const effectiveMenu = (start: StartingMenu, state: MenuState, now: number): MenuItem[] => {
  const sections = allSections(start, state);
  const gone = new Set(sections.filter((x) => x.removed).map((x) => x.id));
  return [
    ...start.items.map((m) => (gone.has(m.category) ? { ...m, hidden: true } : m)),
    ...Object.entries(state.added ?? {}).flatMap(([id, n]) => newMenuItem(id, n, sections) ?? []),
  ].map((item) => applyOverride(item, state.overrides[item.id], state.soldOut[item.id], now));
};

/** Sold out "for today" ends the next morning at 6, so it never needs remembering to undo. */
export const nextMorning = (now: number): number => {
  const d = new Date(now);
  d.setHours(6, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
};

const MAX_PRICE: Cents = 10_000_000; // Rs 100,000
const isPrice = (v: unknown): v is Cents => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_PRICE && (v as number) % 100 === 0;
const isText = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);

const checkName = (name: { en?: string; si?: string; ta?: string }): string | null => {
  if (!isText(name.en, 40) || !isText(name.si, 60) || !isText(name.ta, 60)) return 'a name is too long';
  if (name.en !== undefined && !name.en.trim()) return 'the item needs an English name';
  return null;
};

const isLabel = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * Is this a new item the shop can take? Whole-rupee prices for sizes of its section (at least
 * one). `sections` null: the server, which checks one event at a time and only the shape.
 */
export const checkNewItem = (n: NewItem, sections: readonly (Section & { removed?: true })[] | null): string | null => {
  const sec = sections?.find((x) => x.id === n.category && !x.removed);
  if (sections ? !sec : typeof n.category !== 'string' || !n.category) return 'that is not a menu section';
  if (typeof n.name?.en !== 'string') return 'the item needs an English name';
  const bad = checkName(n.name);
  if (bad) return bad;
  if (typeof n.description !== 'string' || !isText(n.description, 160)) return 'the description is too long';
  if (n.number !== undefined && (!Number.isSafeInteger(n.number) || n.number < 1 || n.number > 999)) return 'item numbers are 1 to 999';
  if (n.leaveOut !== undefined && (!Array.isArray(n.leaveOut) || n.leaveOut.length > 12 || !n.leaveOut.every((l) => isLabel(l, 30)))) return 'leave-outs are short words, at most 12';
  const prices = Object.entries(n.prices ?? {});
  const sizes = sec ? newItemSizes(sec).map((z) => z.id) : null;
  if (prices.some(([k]) => (sizes ? !sizes.includes(k) : k !== 'one' && !SIZE_KEY.test(k)))) return 'a price is for a size this section does not have';
  if (!prices.length || prices.some(([, v]) => !isPrice(v) || v === 0)) return 'prices are whole rupees, more than 0';
  return null;
};

/** Is this a section the shop can take? A name, a cook time, sizes and extras with sensible labels. */
export const checkSection = (d: SectionDef): string | null => {
  if (!isLabel(d.name, 30)) return 'the section needs a name (at most 30 letters)';
  if (!Number.isSafeInteger(d.cookMinutes) || d.cookMinutes < 1 || d.cookMinutes > 180) return 'the cook time is 1 to 180 minutes';
  if (!Array.isArray(d.sizes) || d.sizes.length > 6) return 'a section has at most 6 sizes';
  if (!Array.isArray(d.adds) || d.adds.length > 20) return 'a section has at most 20 extras';
  if (d.station !== undefined && d.station !== 'left' && d.station !== 'right') return 'the kitchen is left or right';
  const ids = new Set<string>();
  for (const z of d.sizes) {
    if (!OPTION_ID.test(z?.id ?? '') || z.id === 'one' || !isLabel(z.label, 20) || !isText(z.hint, 20)) return 'a size needs a short name';
    if (ids.has(z.id)) return `there are two sizes called ${z.label}`;
    ids.add(z.id);
  }
  ids.clear();
  for (const a of d.adds) {
    if (!OPTION_ID.test(a?.id ?? '') || !isLabel(a.label, 30)) return 'an extra needs a short name';
    if (!isPrice(a.price)) return 'extras cost whole rupees';
    if (ids.has(a.id)) return `there are two extras called ${a.label}`;
    ids.add(a.id);
  }
  return null;
};

/** Is this a change the shop can take? (Prices in whole rupees, names of a sensible length.) */
export const checkOverride = (item: MenuItem, o: ItemOverride): string | null => {
  const badName = o.name ? checkName(o.name) : null;
  if (badName) return badName;
  if (!isText(o.description, 160)) return 'the description is too long';
  for (const [k, v] of Object.entries(o.prices ?? {})) {
    const known = k === 'one' ? item.price !== undefined : item.variants?.some((x) => x.id === k);
    if (!known) return `${item.name.en} has no ${k} size`;
    if (!isPrice(v) || v === 0) return 'prices are whole rupees, more than 0';
  }
  for (const [k, v] of Object.entries(o.adds ?? {})) {
    if (!item.adds.some((a) => a.id === k)) return 'that extra is not on this item';
    if (!isPrice(v)) return 'prices are whole rupees';
  }
  return null;
};
