import type { Actor } from './auth.ts';
import { EMPTY_MENU_STATE, menuStateFromEvents, type MenuEvent, type StartingMenu } from './menuEdits.ts';
import { fileItemId, fileSectionId, menuFile } from './menuFile.ts';

/**
 * A change to a menu that shops already have (server/firstMenu.ts sends a shop's menu once, so a new
 * price in the menu's source never reaches a shop that has it). Items and sections are named by their
 * ids in the source menu; what they become (prices, names, the section) is read from that menu.
 * New items need no update: they have new ids and arrive with the menu.
 */
export interface MenuUpdate {
  /** Fixed for good: the events' ids come from it, so an update is stored once. */
  id: string;
  /** Sections sent again whole (name, sizes, hours, kitchen). One the owner took off stays off. */
  sections?: string[];
  /** Items whose prices are set to the menu's. */
  prices?: string[];
  /** Items whose names are set to the menu's (anything else the owner changed on them stays). */
  names?: string[];
  /** Items taken off. */
  removed?: string[];
  /**
   * Items sent again whole as the menu has them (section, names, prices, extras): how an item moves to
   * another section and keeps its id, so its sales, photo and the owner's own changes stay with it.
   * One the owner took off stays off.
   */
  moved?: string[];
  /** Sections taken off (after their items moved out). */
  removedSections?: string[];
}

/**
 * The events that bring a shop's menu up to date, by `actor`, after `existing` (the shop's menu
 * events so far, oldest first). Their ids are fixed per update, so sending them again stores nothing.
 */
export const menuUpdateEvents = (
  updates: readonly MenuUpdate[], menu: StartingMenu, existing: readonly { type: string }[],
  shopId: string, actor: Actor, at: number,
): MenuEvent[] => {
  const file = menuFile(menu, EMPTY_MENU_STATE);
  const item = (id: string) => {
    const found = file.items.find((x) => x.id === fileItemId(id));
    if (!found) throw new Error(`menu update: ${id} is not on the menu`);
    return found;
  };
  const out: MenuEvent[] = [];
  for (const u of updates) {
    const base = (what: string) => ({ id: `menu-update-${u.id}-${what}`, shopId, at, orderNumber: 0 as const, actor });
    const before = menuStateFromEvents([...existing, ...out]);
    for (const s of u.sections ?? []) {
      const sectionId = fileSectionId(s);
      const found = file.sections.find((x) => x.id === sectionId);
      if (!found) throw new Error(`menu update: ${s} is not a section of the menu`);
      if (before.sections[sectionId]?.removed) continue;
      const { id: _id, ...section } = found;
      out.push({ ...base(sectionId), type: 'menu.section_set', sectionId, section });
    }
    for (const id of u.prices ?? []) {
      const { id: itemId, prices } = item(id);
      out.push({ ...base(`${itemId}-price`), type: 'menu.price_set', itemId, before: {}, after: { prices } });
    }
    // A name change replaces the item's whole override: keep what the owner (or the prices above) set.
    const now = menuStateFromEvents([...existing, ...out]);
    for (const id of u.names ?? []) {
      const { id: itemId, name } = item(id);
      const was = now.overrides[itemId] ?? {};
      out.push({ ...base(`${itemId}-name`), type: 'menu.item_set', itemId, before: was, after: { ...was, name } });
    }
    for (const id of u.moved ?? []) {
      const { id: itemId, ...moved } = item(id);
      if (before.added[itemId]?.removed) continue;
      out.push({ ...base(`${itemId}-moved`), type: 'menu.item_added', itemId, item: moved });
    }
    const moved = menuStateFromEvents([...existing, ...out]);
    for (const s of u.removedSections ?? []) {
      const sectionId = fileSectionId(s);
      if (file.sections.some((x) => x.id === sectionId)) throw new Error(`menu update: ${s} is still a section of the menu`);
      if (!moved.sections[sectionId] || moved.sections[sectionId].removed) continue;
      // An item the owner added there themselves keeps its section.
      if (Object.values(moved.added).some((n) => n.category === sectionId && !n.removed)) continue;
      out.push({ ...base(sectionId), type: 'menu.section_set', sectionId, section: null });
    }
    for (const id of u.removed ?? []) {
      const itemId = fileItemId(id);
      out.push({ ...base(`${itemId}-removed`), type: 'menu.item_added', itemId, item: null });
    }
  }
  return out;
};
