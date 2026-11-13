/**
 * Parts of the POS a shop has switched on. Each shop gets the parts it is ready for; the rest stay
 * out of sight (no keys, no screens) until they are switched on.
 *
 * Where they come from: the developer flips them on the cloud's admin page (/admin, a shop's Parts);
 * the shop server picks them up on its next copy to the cloud (every 30 s) and keeps them in its
 * settings (`features`), so they hold without internet; the screens get them with the shop's details.
 * A part the cloud has never set is at its default below: what the shop had before parts existed.
 */
export interface ShopFeatures {
  /**
   * The kitchen's screen: the Kitchen key and view on the counter, kitchen tablets' QR codes in Shop
   * setup, Cooking / Done beside each order. Off, orders still make kitchen tickets (kept for when it is on).
   */
  kitchen: boolean;
  /** Sections set to the Right kitchen get their own ticket there, a key per kitchen, orders fly to their side. */
  twoKitchens: boolean;
  /** The owner's paper list: F3, the Cash out tab, its card in the Owner view, its lines in Close the day. */
  cashOut: boolean;
  /** Busy time (F6): one tap takes the cash, no bill. */
  busyMode: boolean;
  /** Online orders at the counter (the cloud's pickup page; the counter accepts them). */
  onlineOrders: boolean;
  /** The owner's phone: its QR code in Shop setup (phones already paired keep working until withdrawn). */
  ownerPhone: boolean;
  /** A pay-first counter's Serving list (paid portions handed over one tap each) instead of kitchen tickets. */
  serving: boolean;
}

export type Part = keyof ShopFeatures;

/**
 * What each shop has until the dashboard says otherwise. Two kitchens waits (Bata Kade, 2026-11-13);
 * so does the Serving list, the kitchen's next module once the owner is at home with the POS (2026-11-13).
 * Bata Kade has no kitchen screen yet (developer, 2026-11-14): the Kitchen is off until switched on.
 */
export const DEFAULT_FEATURES: ShopFeatures = {
  kitchen: false, twoKitchens: false, cashOut: true, busyMode: true, onlineOrders: true, ownerPhone: true, serving: false,
};

/** The dashboard's list, in this order: the name and one line on what it does. */
export const PARTS: { key: Part; name: string; what: string }[] = [
  { key: 'kitchen', name: 'Kitchen screen', what: 'The Kitchen key and view on the counter, kitchen tablets, Cooking / Done on each order.' },
  { key: 'cashOut', name: 'Cash out', what: "The owner's paper list (F3): fish, bank, gas. Close the day counts it." },
  { key: 'twoKitchens', name: 'Two kitchens', what: 'Left and Right kitchen tickets, a key per kitchen, orders fly to their side.' },
  { key: 'busyMode', name: 'Busy mode', what: 'F6 at rush time: one tap takes the cash, no bill.' },
  { key: 'onlineOrders', name: 'Online orders', what: 'Pickup orders from the online page; the counter accepts them.' },
  { key: 'ownerPhone', name: "Owner's phone", what: 'A QR code in Shop setup puts the Owner view on the phone.' },
  { key: 'serving', name: 'Serving list', what: 'Pay-first kitchen hands paid portions over, one tap each, instead of cooking tickets.' },
];

let current: ShopFeatures = { ...DEFAULT_FEATURES };

export const features = (): ShopFeatures => current;

/** What the shop's server says; anything it does not mention stays at its default. */
export const setFeatures = (next: Partial<ShopFeatures> | undefined): void => {
  current = { ...DEFAULT_FEATURES, ...(next ?? {}) };
};

/** Only the known parts, as true or false (a settings file or an answer may hold anything). */
export const cleanFeatures = (raw: unknown): Partial<ShopFeatures> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  return Object.fromEntries(PARTS.map((p) => p.key).filter((k) => typeof r[k] === 'boolean').map((k) => [k, r[k]])) as Partial<ShopFeatures>;
};

/** The same switches, in the same order, for comparing what the cloud set with what the shop has. */
export const sameFeatures = (a: Partial<ShopFeatures>, b: Partial<ShopFeatures>): boolean => {
  const all = (f: Partial<ShopFeatures>) => ({ ...DEFAULT_FEATURES, ...cleanFeatures(f) });
  const x = all(a);
  const y = all(b);
  return PARTS.every((p) => x[p.key] === y[p.key]);
};
