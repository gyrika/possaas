import { EMPTY_MENU_STATE, type StartingMenu } from '../src/domain/menuEdits.ts';
import { loadMenu, menuFile, menuLoadEvents } from '../src/domain/menuFile.ts';
import type { SyncedEvent } from '../src/domain/sync.ts';
import type { Device, EventStore } from './store.ts';

/** Who added the shop's first menu: the POS itself, not a person (it shows in the audit as this). */
export const MENU_INSTALLER = { id: 'lume-pos', name: 'Lume POS', role: 'owner' as const };

/**
 * possaas is Bata Kade's POS: its menu ships with the app. Each time the server starts, the shop's
 * counter's first pull sends the menu as ordinary menu events, so it reaches the counter, the
 * kitchen and the cloud like a menu typed in by hand. The events' fixed ids make this a no-op once
 * they are stored: the server keeps one event per id, so the menu is never doubled, an item the
 * owner took off stays off, and the owner's own price changes (newer events) stay.
 */
export function firstMenu({ store, menu, shopId, now = Date.now }: {
  store: EventStore; menu: StartingMenu; shopId: () => string | undefined; now?: () => number;
}): (device: Device) => Promise<SyncedEvent[]> {
  const asked = new Map<string, Promise<SyncedEvent[]>>();
  const add = async (device: Device): Promise<SyncedEvent[]> => {
    const load = loadMenu(menuFile(menu, EMPTY_MENU_STATE), { sections: [], items: [] });
    if (typeof load === 'string') { console.error(`The shop's menu could not be added: ${load}`); return []; }
    const { stored } = await store.push(device, menuLoadEvents(load, device.tenantId, MENU_INSTALLER, now()), now());
    if (stored.length) console.log(`Added the shop's menu: ${load.sections.length} sections, ${load.items.length} items`);
    return stored;
  };
  return (device) => {
    if (device.kind !== 'counter' || device.tenantId !== shopId()) return Promise.resolve([]);
    if (!asked.has(device.tenantId)) {
      asked.set(device.tenantId, add(device).catch((e: unknown) => { asked.delete(device.tenantId); throw e; }));
      return asked.get(device.tenantId)!;
    }
    return Promise.resolve([]);
  };
}
