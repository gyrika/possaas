/**
 * ALL FAKE DATA LIVES HERE. Nothing in this file is real: not the people, not
 * the PINs, not the orders. It exists for development and the /?demo screen,
 * and goes away when real logins (sprint 3) and real data arrive.
 */
import type { Actor } from '../domain/auth.ts';
import type { StartingMenu } from '../domain/menuEdits.ts';
import type { MenuItem, Order, Section } from '../domain/types.ts';

export const FAKE_SHOP_ID = 'shop-demo-cheesybeez';

/** Fake staff and their PINs. PINs are not secrets; they only open the fake auth service. */
export const FAKE_STAFF: { pin: string; actor: Actor }[] = [
  { pin: '2580', actor: { id: 'fake-manager-1', name: 'Ravi', role: 'manager' } },
  { pin: '1111', actor: { id: 'fake-cashier-1', name: 'Nimal', role: 'cashier' } },
  { pin: '9999', actor: { id: 'fake-owner-1', name: 'Owner', role: 'owner' } },
];

/** Demo orders for /?demo: three tables eating, nothing paid yet. */
export const fakeOrders = (now: number): Order[] => {
  const min = 60_000;
  return [
    {
      number: 1041, sentAt: now - 18 * min, lines: [
        { id: 'demo-1041-a', itemId: 'devilled-chicken', qty: 1, size: 'L', adds: ['full-cheese'], outs: ['no-onion'], sent: true },
        { id: 'demo-1041-b', itemId: 'margherita', qty: 2, size: 'M', adds: [], outs: [], sent: true },
        { id: 'demo-1041-c', itemId: 'chicken-burger', qty: 1, adds: ['cheese-slice'], outs: [], sent: true },
      ],
    },
    {
      number: 1042, sentAt: now - 9 * min, lines: [
        { id: 'demo-1042-a', itemId: 'seafood', qty: 1, size: 'L', adds: [], outs: [], sent: true },
        { id: 'demo-1042-b', itemId: 'crispy-chicken-burger', qty: 2, adds: [], outs: ['no-lettuce'], sent: true },
      ],
    },
    {
      number: 1043, sentAt: now - 3 * min, lines: [
        { id: 'demo-1043-a', itemId: 'italian-pasta', qty: 1, size: 'M', adds: [], outs: [], sent: true },
        { id: 'demo-1043-b', itemId: 'bbq-chicken', qty: 1, size: 'M', adds: ['half-cheese'], outs: [], sent: true },
      ],
    },
  ];
};

/** The rice & curry demo's shop (/?demo=rice): it takes payment before the order goes to the kitchen. */
export const FAKE_RICE_SHOP_DETAILS = { name: 'Bata Kade · බත් කඩේ', place: 'Demo', footer: 'Thank you!', payFirst: true };

/**
 * /?demo=rice: a rice & curry shop's menu, Medium and Large. The PRICES ARE PLACEHOLDERS, not any
 * shop's: a real shop types its own on the Menu screen (#menu).
 */
const RICE_SIZES = [{ id: 'M', label: 'Medium' }, { id: 'L', label: 'Large' }];
// Two kitchens (asked for by the developer, 2026-10-29): rice & curry on the left, kottu and fried rice on the right.
const RICE_SECTION: Section = { id: 'rice-curry', name: 'Rice & Curry · බත් සහ කරි', cookMinutes: 3, sizes: RICE_SIZES, adds: [], station: 'left' };
const KOTTU_SECTION: Section = { id: 'kottu', name: 'Kottu & Fried Rice', cookMinutes: 8, sizes: RICE_SIZES, adds: [], station: 'right' };
const riceCurry = (id: string, name: string, si: string, aliases: string[], m: number, l: number): MenuItem => ({
  id, category: 'rice-curry', name: { en: `${name} Rice & Curry`, si }, description: '', aliases,
  variants: [{ ...RICE_SIZES[0], price: m * 100 }, { ...RICE_SIZES[1], price: l * 100 }], adds: [], leaveOut: [],
});
const kottu = (id: string, name: string, aliases: string[], m: number, l: number): MenuItem => ({
  id, category: 'kottu', name: { en: name }, description: '', aliases,
  variants: [{ ...RICE_SIZES[0], price: m * 100 }, { ...RICE_SIZES[1], price: l * 100 }], adds: [], leaveOut: [],
});
export const FAKE_RICE_START: StartingMenu = {
  sections: [RICE_SECTION, KOTTU_SECTION],
  items: [
    // Sinhala names for the demo (asked for by the developer, 2026-10-28); a real shop types its own.
    riceCurry('rc-chicken', 'Chicken', 'චිකන් බත්', ['chicken rice', 'chicken', 'chicken bath'], 450, 600),
    riceCurry('rc-fish', 'Fish', 'මාළු බත්', ['fish rice', 'fish', 'malu bath', 'malu'], 450, 600),
    riceCurry('rc-egg', 'Egg', 'බිත්තර බත්', ['egg rice', 'egg', 'biththara bath', 'biththara'], 350, 450),
    riceCurry('rc-vege', 'Vegetable', 'එළවළු බත්', ['vege rice', 'vegetable', 'vege', 'veg', 'elawalu bath', 'elawalu'], 300, 400),
    kottu('kt-chicken', 'Chicken Kottu', ['chicken kottu', 'kottu'], 700, 950),
    kottu('kt-egg', 'Egg Kottu', ['egg kottu'], 550, 750),
    kottu('fr-chicken', 'Chicken Fried Rice', ['chicken fried rice', 'fried rice'], 700, 950),
    kottu('fr-egg', 'Egg Fried Rice', ['egg fried rice'], 550, 750),
  ],
};

/** The demo's shop (/?demo): its name, town and receipt footer, as Shop setup would give them. */
export const FAKE_SHOP_DETAILS = { name: 'CheesyBeez', place: 'Thalwila', footer: 'Thank you!' };

/**
 * What the ordering page's /api/v1/shop answers in `npm run dev` (vite.config.ts), so the page shows a
 * real-looking open shop instead of "Couldn't check". The hours are an example, NOT the shop's: the live
 * page shows hours only once the owner gives them (the cloud's ORDER_HOURS).
 */
export const FAKE_ORDER_SHOP = {
  name: 'CheesyBeez Thalwila',
  open: true,
  hours: { opens: 11 * 60, closes: 21 * 60 },
  phone: null,
  address: null,
};
