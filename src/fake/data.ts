/**
 * ALL FAKE DATA LIVES HERE. Nothing in this file is real: not the people, not
 * the PINs, not the orders. It exists for development and the /?demo screen,
 * and goes away when real logins (sprint 3) and real data arrive.
 */
import type { Actor } from '../domain/auth.ts';
import type { Order } from '../domain/types.ts';

export const FAKE_SHOP_ID = 'shop-demo-pizza';

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

/** The rice & curry demo's shop (/?demo=rice): it takes payment before the order goes to the kitchen. Its logo (src/fake/bata-kade-logo.webp) is the shop's own. */
export const FAKE_RICE_SHOP_DETAILS = { name: 'Bata Kade · බටකඩේ', place: 'Demo', footer: 'Thank you!', payFirst: true };

/** /?demo=rice shows Bata Kade's real menu (src/shop/bataKade.ts). */
export { BATA_KADE_MENU as FAKE_RICE_START } from '../shop/bataKade.ts';

/** The demo's shop (/?demo): its name, town and receipt footer, as Shop setup would give them. */
export const FAKE_SHOP_DETAILS = { name: 'Sample Pizza', place: 'Demo', footer: 'Thank you!' };

/**
 * What the ordering page's /api/v1/shop answers in `npm run dev` (vite.config.ts), so the page shows a
 * real-looking open shop instead of "Couldn't check". The hours are an example, NOT the shop's: the live
 * page shows hours only once the owner gives them (the cloud's ORDER_HOURS).
 */
export const FAKE_ORDER_SHOP = {
  name: 'Sample Pizza',
  open: true,
  hours: { opens: 11 * 60, closes: 21 * 60 },
  phone: null,
  address: null,
};
