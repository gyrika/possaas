import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * What the setup wizard decides about this shop, kept beside the database:
 * the shop, the receipt printer, whether setup is finished. Small, read at
 * start-up, written whole (via a temporary file, so a power cut never leaves
 * half a file).
 */
export interface ShopSettings {
  shopId?: string;
  shopName?: string;
  place?: string;
  /** The receipt's last line; absent = DEFAULT_FOOTER, '' = none. */
  receiptFooter?: string;
  /** Windows printer name; absent = no printer yet (dry run). */
  printer?: string;
  /** Receipt paper width in mm; absent = 80. */
  paperWidth?: 58 | 80;
  /** Customers pay before the order goes to the kitchen; absent = pay first (Bata Kade, 2026-10-30); false = eat first, pay after. */
  payFirst?: boolean;
  /** The shop's logo beside its name in every screen's corner: a small image as a data: URL; absent = the shop's own (Bata Kade's); '' = none. */
  logo?: string;
  setupDone?: boolean;
  /** The cloud copy, once the wizard connected it with the shop code. */
  cloudUrl?: string;
  cloudToken?: string;
  /** This shop's own secret with the cloud: only this server can connect the shop again. */
  cloudSecret?: string;
  /** The counter is taking online orders. */
  onlineOpen?: boolean;
}

export function settingsFile(file: string) {
  let value: ShopSettings = {};
  try { if (existsSync(file)) value = JSON.parse(readFileSync(file, 'utf8')) as ShopSettings; } catch { value = {}; }
  return {
    get: (): ShopSettings => ({ ...value }),
    set(patch: Partial<ShopSettings>): ShopSettings {
      value = { ...value, ...patch };
      for (const k of Object.keys(value) as (keyof ShopSettings)[]) if (value[k] === undefined) delete value[k];
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return { ...value };
    },
  };
}
export type Settings = ReturnType<typeof settingsFile>;
