import { EMPTY_MENU_STATE, type StartingMenu } from '../src/domain/menuEdits.ts';
import { loadMenu, menuFile, menuLoadEvents } from '../src/domain/menuFile.ts';
import { PULL_LIMIT, type SyncedEvent } from '../src/domain/sync.ts';
import type { Device, EventStore } from './store.ts';

/** Who added the shop's first menu: the POS itself, not a person (it shows in the audit as this). */
export const MENU_INSTALLER = { id: 'lume-pos', name: 'Lume POS', role: 'owner' as const };

/**
 * possaas is one shop's POS (Bata Kade): its menu ships with the app. The first time that shop's
 * counter connects and the shop has never had a menu event, the server adds the menu as ordinary
 * menu events, so it reaches the counter, the kitchen and the cloud like a menu typed in by hand.
 * Asked once per server start; a shop that has ever had a menu (even one emptied since) is left as it is,
 * and the events' fixed ids keep the menu from being added twice.
 */
export function firstMenu({ store, menu, shopId, now = Date.now }: {
  store: EventStore; menu: StartingMenu; shopId: () => string | undefined; now?: () => number;
}): (device: Device) => Promise<SyncedEvent[]> {
  const asked = new Map<string, Promise<SyncedEvent[]>>();
  const add = async (device: Device): Promise<SyncedEvent[]> => {
    for (let after = 0; ;) {
      const page = await store.pull(device.tenantId, after, PULL_LIMIT);
      if (page.some((s) => s.event.type.startsWith('menu.'))) return [];
      if (page.length < PULL_LIMIT) break;
      after = page.at(-1)!.seq;
    }
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
