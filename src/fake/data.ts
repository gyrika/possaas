/**
 * ALL FAKE DATA LIVES HERE. Nothing in this file is real: not the people, not
 * the PINs, not the orders. It exists for development and the /?demo screen,
 * and goes away when real logins (sprint 3) and real data arrive.
 */
import type { Actor } from '../domain/auth.ts';
import type { StartingMenu } from '../domain/menuEdits.ts';
import type { MenuItem, Order, Section } from '../domain/types.ts';

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

/**
 * /?demo=rice: Bata Kade's own menu, its prices and Sinhala names copied from the shop's menu (given by
 * the developer, 2026-10-30). Items the menu has no price for (mung beans / chickpeas, lunch chicken rice,
 * mix and special fried rice, vegetable and mix kottu, the fried rice under string hoppers, fish rolls)
 * are left out until the owner gives one; "Fish / Egg" lines are one item each so the kitchen knows which.
 */
const PORTIONS = [{ id: 'normal', label: 'Normal' }, { id: 'full', label: 'Full' }];
// Two kitchens (asked for by the developer, 2026-10-29): rice and the rest on the left, kottu and fried rice on the right.
const MEALS_SECTION: Section = { id: 'meals', name: 'Rice & Meals · බත් ආහාර', cookMinutes: 3, sizes: [], adds: [], station: 'left' };
const LUNCH_SECTION: Section = { id: 'lunch', name: 'Lunch & Dinner · දිවා / රාත්‍රී ආහාර', cookMinutes: 3, sizes: [], adds: [], station: 'left' };
const FRIED_RICE_SECTION: Section = { id: 'fried-rice', name: 'Special Fried Rice · ෆ්‍රයිඩ් රයිස්', cookMinutes: 8, sizes: PORTIONS, adds: [], station: 'right' };
const KOTTU_SECTION: Section = { id: 'kottu', name: 'Kottu · කොත්තු', cookMinutes: 8, sizes: PORTIONS, adds: [], station: 'right' };
const OTHER_SECTION: Section = { id: 'other', name: 'Other · වෙනත් ආහාර', cookMinutes: 2, sizes: [], adds: [], station: 'left' };
const ROTI_SECTION: Section = { id: 'roti', name: 'String Hoppers, Roti & Rolls · ඉඳිආප්ප / රොටි / රෝල්ස්', cookMinutes: 2, sizes: [], adds: [], station: 'left' };
const portions = (category: string, id: string, name: string, si: string, aliases: string[], normal: number, full: number): MenuItem => ({
  id, category, name: { en: name, si }, description: '', aliases,
  variants: [{ ...PORTIONS[0], price: normal * 100 }, { ...PORTIONS[1], price: full * 100 }], adds: [], leaveOut: [],
});
const one = (category: string, id: string, name: string, si: string, aliases: string[], price: number): MenuItem => ({
  id, category, name: { en: name, si }, description: '', aliases, price: price * 100, adds: [], leaveOut: [],
});
export const FAKE_RICE_START: StartingMenu = {
  sections: [MEALS_SECTION, LUNCH_SECTION, FRIED_RICE_SECTION, KOTTU_SECTION, OTHER_SECTION, ROTI_SECTION],
  items: [
    one('meals', 'ml-rice-vege', 'Vegetable Rice', 'බත් එළවළු', ['vegetable rice', 'vege rice', 'veg rice', 'elawalu bath'], 200),
    one('meals', 'ml-rice-fish', 'Fish Rice', 'බත් මාළු', ['fish rice', 'malu bath'], 250),
    one('meals', 'ml-rice-egg', 'Egg Rice', 'බත් බිත්තර', ['egg rice', 'biththara bath'], 250),
    one('meals', 'ml-rice-chicken', 'Chicken Rice', 'බත් චිකන්', ['chicken rice', 'chicken bath'], 300),
    one('meals', 'ml-bread-dhal', 'Bread ½ with Dhal', 'පාන් 1/2 පරිප්පු සමඟ', ['bread dhal', 'bread parippu', 'bread', 'paan'], 150),
    one('meals', 'ml-bread-potato', 'Bread ½ with Potato Curry', 'පාන් 1/2 අල හොදි සමඟ', ['bread potato', 'bread ala'], 150),
    one('meals', 'ml-bread-egg', 'Bread ½ with Egg', 'පාන් 1/2 බිත්තර සමඟ', ['bread egg', 'bread biththara'], 200),
    one('meals', 'ml-milk-rice', 'Milk Rice (1 piece)', 'කිරිබත් කෑලි 01', ['milk rice', 'kiribath', 'kiribat'], 100),
    one('meals', 'ml-pol-roti', 'Coconut Roti (1)', 'පොල් රොටි 01', ['coconut roti', 'pol roti'], 60),
    one('meals', 'ml-noodles', 'Noodles', 'නූඩ්ල්ස්', ['noodles', 'noodle'], 180),
    one('meals', 'ml-string-hoppers', 'String Hoppers (10)', 'ඉඳි ආප්ප 10', ['string hoppers', 'string hopper', 'idiyappam', 'indiappa'], 130),
    one('lunch', 'ln-rice-vege', 'Lunch Vegetable Rice', 'බත් එළවළු', ['lunch vegetable rice', 'lunch veg rice', 'lunch vege'], 220),
    one('lunch', 'ln-rice-fish', 'Lunch Fish Rice', 'බත් මාළු', ['lunch fish rice', 'lunch fish'], 300),
    one('lunch', 'ln-rice-egg', 'Lunch Egg Rice', 'බත් බිත්තර', ['lunch egg rice', 'lunch egg'], 300),
    portions('fried-rice', 'fr-egg', 'Egg Fried Rice', 'බිත්තර ෆ්‍රයිඩ් රයිස්', ['egg fried rice', 'egg fried'], 400, 650),
    portions('fried-rice', 'fr-chicken', 'Chicken Fried Rice', 'චිකන් ෆ්‍රයිඩ් රයිස්', ['chicken fried rice', 'chicken fried', 'fried rice'], 450, 750),
    portions('kottu', 'kt-egg', 'Egg Kottu', 'බිත්තර කොත්තු', ['egg kottu'], 450, 650),
    portions('kottu', 'kt-chicken', 'Chicken Kottu', 'චිකන් කොත්තු', ['chicken kottu', 'kottu'], 500, 800),
    one('other', 'ot-plain-tea', 'Plain Tea', 'ප්ලේන් ටී', ['plain tea', 'plaintea', 'tea'], 50),
    one('other', 'ot-milk-tea', 'Milk Tea', 'කිරි තේ', ['milk tea', 'kiri the'], 120),
    one('other', 'ot-coffee', 'Coffee', 'කෝපි', ['coffee', 'kopi'], 70),
    one('other', 'ot-milk-coffee', 'Milk Coffee', 'කිරි කෝපි', ['milk coffee', 'kiri kopi'], 130),
    one('other', 'ot-popsicle', 'Popsicle', 'පොප්සිකල්', ['popsicle'], 120),
    one('other', 'ot-nestomalt', 'Nestomalt', 'පොස්ට්මෝල්ට්', ['nestomalt', 'postmalt', 'nesto'], 120),
    one('other', 'ot-milo', 'Milo', 'මයිලෝ', ['milo'], 120),
    one('other', 'ot-kahata', 'Plain Tea with Jaggery', 'කහට හකුරු සමඟ', ['kahata', 'jaggery tea'], 30),
    one('other', 'ot-buns', 'Buns', 'ඊම් බනිස්', ['buns', 'bun', 'banis'], 100),
    one('other', 'ot-muffin', 'Muffin', 'මෆින්', ['muffin'], 150),
    one('roti', 'rt-biriyani', 'Biriyani', 'බිරියානි', ['biriyani', 'biryani'], 500),
    one('roti', 'rt-egg-roll', 'Egg Roll', 'බිත්තර රෝල්ස්', ['egg roll', 'egg rolls'], 130),
    one('roti', 'rt-veg-roti', 'Vegetable Roti', 'එළවළු රොටි', ['vegetable roti', 'vege roti', 'veg roti'], 100),
    one('roti', 'rt-egg-roti', 'Egg Roti', 'බිත්තර රොටි', ['egg roti'], 140),
    one('roti', 'rt-wade', 'Parippu Wade', 'පරිප්පු වඩේ', ['parippu wade', 'wade', 'vadai'], 30),
  ],
};

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
