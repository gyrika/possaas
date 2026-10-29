import { useSyncExternalStore } from 'react';
import { DEFAULT_FOOTER, PRODUCT_NAME } from '../domain/brand.ts';
import { PAPER_CHARS, type PaperWidth, type ShopHeader } from '../domain/receipt.ts';
import { FAKE_RICE_SHOP_DETAILS, FAKE_SHOP_DETAILS } from '../fake/data.ts';
import bataKadeLogo from '../fake/bata-kade-logo.webp';
import { isDemo, isRiceDemo, storageKey } from '../ui/storage.ts';

/**
 * The shop's own name, town and receipt footer (Shop setup → Printer), from the shop server's
 * GET /api/v1/shop-details. Kept on the device too, so the corner and the receipt still say the
 * shop's name while the server restarts. Before a shop is named (development, a fresh install)
 * the product's name stands in; the demo shows its fake shop.
 */
export interface ShopDetails {
  name: string; place: string; footer: string; paper?: PaperWidth;
  /** Customers pay before the order goes to the kitchen (a rice & curry counter); absent = eat first, pay after. */
  payFirst?: boolean;
  /** The shop's logo beside its name (Shop setup → Printer): an image URL; absent or '' = none. */
  logo?: string;
}

const KEY = () => storageKey('shop.v1');
const listeners = new Set<() => void>();

const cached = (): ShopDetails | null => {
  if (isRiceDemo()) return { ...FAKE_RICE_SHOP_DETAILS, logo: bataKadeLogo };
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

/** Characters a receipt line: the shop's paper (80 mm unless set to 58 mm). */
export const receiptWidth = (): number => PAPER_CHARS[current?.paper ?? 80];

/** Pay first, then the kitchen: the register's one action is Charge. */
export const payFirst = (): boolean => Boolean(current?.payFirst);

/** The logo beside the name in the corner; '' when the shop has none. */
export const shopLogo = (): string => current?.logo ?? '';

/** What the screens show; anything not given (the paper, when to pay, the logo) stays as it was. */
export function setShopDetails(next: ShopDetails): void {
  current = { ...next, paper: next.paper ?? current?.paper, payFirst: next.payFirst ?? current?.payFirst, logo: next.logo ?? current?.logo };
  try { localStorage.setItem(KEY(), JSON.stringify(current)); } catch { /* blocked: this session still has it */ }
  listeners.forEach((l) => l());
}

/** Asks the shop server; quietly keeps what it had when there is no server (development, the demo). */
export async function loadShopDetails(): Promise<void> {
  if (isDemo()) return;
  try {
    const r = await fetch('/api/v1/shop-details', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const s = (await r.json()) as Partial<ShopDetails>;
    if (typeof s.name === 'string' && s.name) {
      setShopDetails({
        name: s.name, place: s.place ?? '', footer: s.footer ?? DEFAULT_FOOTER, paper: s.paper === 58 ? 58 : 80, payFirst: s.payFirst === true,
        logo: typeof s.logo === 'string' ? s.logo : '',
      });
    }
  } catch { /* the server is away: the cached copy stands */ }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useShopName = (): string => useSyncExternalStore(subscribe, shopName);
export const useShopLogo = (): string => useSyncExternalStore(subscribe, shopLogo);
export const usePayFirst = (): boolean => useSyncExternalStore(subscribe, payFirst);
