import { useSyncExternalStore } from 'react';
import { DEFAULT_FOOTER, PRODUCT_NAME } from '../domain/brand.ts';
import type { ShopHeader } from '../domain/receipt.ts';
import { FAKE_SHOP_DETAILS } from '../fake/data.ts';
import { isDemo, storageKey } from '../ui/storage.ts';

/**
 * The shop's own name, town and receipt footer (Shop setup → Printer), from the shop server's
 * GET /api/v1/shop-details. Kept on the device too, so the corner and the receipt still say the
 * shop's name while the server restarts. Before a shop is named (development, a fresh install)
 * the product's name stands in; the demo shows its fake shop.
 */
export interface ShopDetails { name: string; place: string; footer: string }

const KEY = () => storageKey('shop.v1');
const listeners = new Set<() => void>();

const cached = (): ShopDetails | null => {
  if (isDemo()) return FAKE_SHOP_DETAILS;
  try {
    const s = JSON.parse(localStorage.getItem(KEY()) ?? 'null') as ShopDetails | null;
    return s && typeof s.name === 'string' ? s : null;
  } catch {
    return null;
  }
};

let current: ShopDetails | null = cached();

export const shopDetails = (): ShopDetails | null => current;

/** The name in the corner of every screen. */
export const shopName = (): string => current?.name || PRODUCT_NAME;

export const shopHeader = (): ShopHeader => ({
  name: shopName(),
  lines: current?.place ? [current.place] : [],
  footer: current ? current.footer : DEFAULT_FOOTER,
});

export function setShopDetails(next: ShopDetails): void {
  current = next;
  try { localStorage.setItem(KEY(), JSON.stringify(next)); } catch { /* blocked: this session still has it */ }
  listeners.forEach((l) => l());
}

/** Asks the shop server; quietly keeps what it had when there is no server (development, the demo). */
export async function loadShopDetails(): Promise<void> {
  if (isDemo()) return;
  try {
    const r = await fetch('/api/v1/shop-details', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const s = (await r.json()) as Partial<ShopDetails>;
    if (typeof s.name === 'string' && s.name) setShopDetails({ name: s.name, place: s.place ?? '', footer: s.footer ?? DEFAULT_FOOTER });
  } catch { /* the server is away: the cached copy stands */ }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useShopName = (): string => useSyncExternalStore(subscribe, shopName);
