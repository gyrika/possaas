import { OPTION_ID, allSections, checkNewItem, checkSection, effectiveMenu, slug, type MenuState, type NewItem, type SectionDef, type StartingMenu } from './menuEdits.ts';
import type { Actor } from './auth.ts';
import type { Section } from './types.ts';

/**
 * A whole menu as text, to move it from one Lume POS to another: the owner builds it in the demo
 * (or on another shop), copies it, and pastes it on the new shop's empty Menu screen. Loading it
 * makes the same `menu.section_set` / `menu.item_added` events as adding each by hand, so the
 * server checks them, they carry the owner, and they reach the cloud like any other change.
 *
 * What it keeps: sections (name, cook time, sizes, extras, kitchen, hours) and each item's names,
 * description, number, prices and leave-outs. Not kept: typing aliases, "sold out today", items
 * or sections taken off.
 */
export interface MenuFile {
  lume: 'menu';
  v: 1;
  sections: (SectionDef & { id: string })[];
  items: (NewItem & { id: string })[];
}

const SECTION_NAME_MAX = 30;

/** A shop's section names are at most 30 letters: keep the English part of "Kottu · කොත්තු" if the whole is longer. */
const fitName = (name: string): string => {
  if (name.length <= SECTION_NAME_MAX) return name;
  const en = name.split(' · ')[0].trim();
  return (en.length <= SECTION_NAME_MAX ? en : en.slice(0, SECTION_NAME_MAX)).trim();
};

/** A shop's own size ids are lowercase slugs ('normal'); the sample's are 'S', 'M', 'L'. */
const sizeId = (z: { id: string; label: string }): string => (OPTION_ID.test(z.id) ? z.id : slug(z.id) || slug(z.label) || 'size');

/** The menu every screen shows now, as a file. Times of day do not matter: off-hours sections are kept. */
export const menuFile = (start: StartingMenu, state: MenuState): MenuFile => {
  const sections = allSections(start, state).filter((x) => !x.removed);
  const ids = new Map(sections.map((x) => [x.id, x.id.startsWith('sec-') ? x.id : `sec-${slug(x.id) || 'section'}`]));
  const items = effectiveMenu(start, state, 0).filter((m) => !m.hidden && !m.removed && ids.has(m.category));
  return {
    lume: 'menu', v: 1,
    sections: sections.map(({ id, removed: _r, ...def }: Section & { removed?: true }) => ({
      id: ids.get(id)!, ...def, name: fitName(def.name), sizes: def.sizes.map((z) => ({ ...z, id: sizeId(z) })),
    })),
    items: items.map((m) => {
      const sizes = sections.find((x) => x.id === m.category)!.sizes.map((z) => z.id);
      const prices = m.variants
        ? Object.fromEntries(m.variants.filter((v) => sizes.includes(v.id)).map((v) => [sizeId(v), v.price]))
        : { one: m.price ?? 0 };
      return {
        id: m.id.startsWith('new-') ? m.id : `new-${slug(m.id, 48) || 'item'}`,
        category: ids.get(m.category)!, name: m.name, description: m.description, prices,
        ...(m.number !== undefined ? { number: m.number } : {}),
        ...(m.leaveOut.length ? { leaveOut: m.leaveOut.map((o) => o.label) } : {}),
      };
    }),
  };
};

/** What loading a menu adds, in order: its sections first, then their items, each with an id the shop never used. */
type Taken = { sections: Iterable<string>; items: Iterable<string> };

export interface MenuLoad { sections: [string, SectionDef][]; items: [string, NewItem][] }

const fresh = (wanted: string, taken: Set<string>): string => {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
  taken.add(id);
  return id;
};

/**
 * Reads pasted text as a menu and checks every section and item as if typed by hand. `taken`: ids
 * this shop has ever used (taken-off ones too), so nothing loaded meets an old one.
 * Returns what to add, or what is wrong, in words for the owner.
 */
export const readMenuFile = (text: string, taken: Taken): MenuLoad | string => {
  let file: MenuFile;
  try { file = JSON.parse(text.trim()) as MenuFile; } catch { return 'That is not a copied menu. Copy it again with "Copy menu" and paste all of it.'; }
  if (file?.lume !== 'menu' || file.v !== 1 || !Array.isArray(file.sections) || !Array.isArray(file.items)) {
    return 'That is not a copied menu. Copy it again with "Copy menu" and paste all of it.';
  }
  return loadMenu(file, taken);
};

/** A menu file's sections and items, checked, with ids this shop never used (see readMenuFile). */
export const loadMenu = (file: MenuFile, taken: Taken): MenuLoad | string => {
  if (!file.items.length) return 'That menu has no items.';
  const sectionIds = new Set(taken.sections);
  const itemIds = new Set(taken.items);
  const sectionMap = new Map<string, string>();
  const sections: MenuLoad['sections'] = [];
  for (const { id, ...def } of file.sections) {
    const bad = checkSection(def);
    if (bad) return `${def.name || 'A section'}: ${bad}.`;
    const newId = fresh(/^sec-[a-z0-9-]{1,36}$/.test(id) ? id : `sec-${slug(def.name, 36) || 'section'}`, sectionIds);
    sectionMap.set(id, newId);
    sections.push([newId, def]);
  }
  const loaded: Section[] = sections.map(([id, def]) => ({ ...def, id }));
  const items: MenuLoad['items'] = [];
  for (const { id, ...raw } of file.items) {
    const item: NewItem = { ...raw, category: sectionMap.get(raw.category) ?? '' };
    const bad = checkNewItem(item, loaded);
    if (bad) return `${raw.name?.en || 'An item'}: ${bad}.`;
    items.push([fresh(/^new-[a-z0-9-]{1,44}$/.test(id) ? id : `new-${slug(item.name.en, 44) || 'item'}`, itemIds), item]);
  }
  return { sections, items };
};

/**
 * A loaded menu as the events that add it: sections first, then items. Ids come from the menu's
 * own ids, so the same menu sent twice is stored once (the server keeps one event per id).
 */
export const menuLoadEvents = (load: MenuLoad, shopId: string, actor: Actor, at: number) => [
  ...load.sections.map(([sectionId, section]) =>
    ({ id: `menu-load-${sectionId}`, shopId, at, orderNumber: 0 as const, actor, type: 'menu.section_set' as const, sectionId, section })),
  ...load.items.map(([itemId, item]) =>
    ({ id: `menu-load-${itemId}`, shopId, at, orderNumber: 0 as const, actor, type: 'menu.item_added' as const, itemId, item })),
];
