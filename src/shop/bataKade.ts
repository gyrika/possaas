import type { StartingMenu } from '../domain/menuEdits.ts';
import type { MenuUpdate } from '../domain/menuUpdate.ts';
import type { MenuItem, Option, Section } from '../domain/types.ts';

/*
 * possaas is Bata Kade's POS (2026-10-30): this is the shop's real menu. A new Bata Kade shop server
 * adds it once, the first time its counter connects with no menu yet (server/firstMenu.ts); the
 * rice demo (/?demo=rice) shows it too. Change it here only from the owner's own menu, and list every
 * change to an item a shop already has in BATA_KADE_UPDATES below, or running shops keep the old one.
 */

/**
 * Bata Kade's own menu, its prices and Sinhala names copied from the shop's menu (given by the
 * developer 2026-10-30, new price list from the shop 2026-11-13, changes 2026-11-14). Sinhala names
 * the shop did not write (drinks, desserts, rolls...) were added on the developer's request on
 * 2026-11-14 for the owner to check. "Fish / Egg" lines are one item each so the kitchen knows which.
 *
 * Every item is on sale all day (developer, 2026-11-13); only rice & curry's price changes with the
 * time: a breakfast price and a lunch & dinner price, two sections of the same name, each sold at its
 * own hours, so the counter always shows one Rice & Curry. The HOURS ARE PLACEHOLDERS until the owner
 * gives them.
 */
const PORTIONS = [{ id: 'normal', label: 'Normal' }, { id: 'full', label: 'Full' }];
/** Fried rice and kottu: the shop calls the small one Half. Same size id, so old orders stay. */
const HALF_FULL = [{ id: 'normal', label: 'Half' }, { id: 'full', label: 'Full' }];
const BREAKFAST = { from: 5 * 60, to: 11 * 60 };
const LUNCH_AND_DINNER = { from: 11 * 60, to: 5 * 60 };
const extra = (id: string, label: string, rupees: number): Option => ({ id, label, price: rupees * 100 });
/** Bread with gravy: an egg, fish or chicken on top (2026-11-14). */
const BREAD_ADDS = [extra('egg', 'Egg', 50), extra('fish', 'Fish', 100), extra('chicken', 'Chicken', 120)];
/** String hoppers: 10, 15 and 20 stay their own items; every 5 more is 40 (2026-11-14). Both = 15 more. */
const STRING_HOPPER_ADDS = [extra('5-more', '5 more', 40), extra('10-more', '10 more', 80)];
// Two kitchens (asked for by the developer, 2026-10-29): rice and the rest on the left, kottu and fried rice on the right.
const RICE_MORNING_SECTION: Section = { id: 'rice-morning', name: 'Rice & Curry · බත් සහ කරි', cookMinutes: 3, sizes: PORTIONS, adds: [], station: 'left', hours: BREAKFAST };
const RICE_DAY_SECTION: Section = { id: 'rice-day', name: 'Rice & Curry · බත් සහ කරි', cookMinutes: 3, sizes: PORTIONS, adds: [], station: 'left', hours: LUNCH_AND_DINNER };
const FRIED_RICE_SECTION: Section = { id: 'fried-rice', name: 'Fried Rice · ෆ්‍රයිඩ් රයිස්', cookMinutes: 8, sizes: HALF_FULL, adds: [], station: 'right' };
const MEALS_SECTION: Section = { id: 'meals', name: 'Meals · ආහාර', cookMinutes: 3, sizes: [], adds: [], station: 'left' };
const KOTTU_SECTION: Section = { id: 'kottu', name: 'Kottu · කොත්තු', cookMinutes: 8, sizes: HALF_FULL, adds: [], station: 'right' };
// Few sections, so the counter never hunts (developer, 2026-11-14): everything eaten as a meal (bread,
// string hoppers, roti, rolls, wade) is in Meals, everything drunk in Drinks, sweets and the rest in Other.
// Bread and string hoppers carry their extras themselves (NewItem.adds), so Meals needs none.
const OTHER_SECTION: Section = { id: 'other', name: 'Other · වෙනත් ආහාර', cookMinutes: 2, sizes: [], adds: [], station: 'left' };
const DRINKS_SECTION: Section = { id: 'drinks', name: 'Drinks · බීම', cookMinutes: 1, sizes: [], adds: [], station: 'left' };
const names = (en: string, si: string) => (si ? { en, si } : { en });
/** Prices by size, in rupees; a size without a price is not offered. */
const sized = (category: string, id: string, name: string, si: string, aliases: string[], prices: Record<string, number>, sizes = PORTIONS): MenuItem => ({
  id, category, name: names(name, si), description: '', aliases,
  variants: sizes.flatMap((z) => (prices[z.id] ? [{ ...z, price: prices[z.id] * 100 }] : [])), adds: [], leaveOut: [],
});
const halfFull = (category: string, id: string, name: string, si: string, aliases: string[], half: number, full: number): MenuItem =>
  sized(category, id, name, si, aliases, { normal: half, full }, HALF_FULL);
/**
 * One card, a price button per kind (Water: 500 ml, 1 L, 1.5 L; Tea: Plain, Milk, Jaggery): the item's own
 * sizes (NewItem.sizes), as [id, label, rupees], so its section needs none.
 */
const kinds = (category: string, id: string, name: string, si: string, aliases: string[], options: [string, string, number][], adds: Option[] = []): MenuItem => ({
  id, category, name: names(name, si), description: '', aliases,
  variants: options.map(([size, label, rupees]) => ({ id: size, label, price: rupees * 100 })), adds, leaveOut: [],
});
const one = (category: string, id: string, name: string, si: string, aliases: string[], price: number, adds: Option[] = []): MenuItem => ({
  id, category, name: names(name, si), description: '', aliases, price: price * 100, adds, leaveOut: [],
});
export const BATA_KADE_MENU: StartingMenu = {
  sections: [RICE_MORNING_SECTION, RICE_DAY_SECTION, FRIED_RICE_SECTION, KOTTU_SECTION, MEALS_SECTION, DRINKS_SECTION, OTHER_SECTION],
  items: [
    // The same names and aliases at breakfast and later: only one of the two is sold at a time.
    sized('rice-morning', 'rc-m-vege', 'Vegetable Rice & Curry', 'බත් එළවළු', ['vegetable rice', 'vege rice', 'veg rice', 'elawalu bath'], { normal: 200 }),
    sized('rice-morning', 'rc-m-fish', 'Fish Rice & Curry', 'බත් මාළු', ['fish rice', 'malu bath'], { normal: 250 }),
    sized('rice-morning', 'rc-m-egg', 'Egg Rice & Curry', 'බත් බිත්තර', ['egg rice', 'biththara bath'], { normal: 230 }),
    sized('rice-morning', 'rc-m-chicken', 'Chicken Rice & Curry', 'බත් චිකන්', ['chicken rice', 'chicken bath'], { normal: 300 }),
    // The shop gave Special Rice a lunch price only; it sells at that price all day.
    sized('rice-morning', 'rc-m-special', 'Special Rice', 'ස්පෙෂල් රයිස්', ['special rice', 'special'], { normal: 330 }),
    sized('rice-day', 'rc-d-vege', 'Vegetable Rice & Curry', 'බත් එළවළු', ['vegetable rice', 'vege rice', 'veg rice', 'elawalu bath'], { normal: 220 }),
    sized('rice-day', 'rc-d-fish', 'Fish Rice & Curry', 'බත් මාළු', ['fish rice', 'malu bath'], { normal: 300 }),
    sized('rice-day', 'rc-d-egg', 'Egg Rice & Curry', 'බත් බිත්තර', ['egg rice', 'biththara bath'], { normal: 280 }),
    sized('rice-day', 'rc-d-chicken', 'Chicken Rice & Curry', 'බත් චිකන්', ['chicken rice', 'chicken bath'], { normal: 350 }),
    sized('rice-day', 'rc-d-special', 'Special Rice', 'ස්පෙෂල් රයිස්', ['special rice', 'special'], { normal: 330 }),
    halfFull('fried-rice', 'fr-chicken', 'Chicken Fried Rice', 'චිකන් ෆ්‍රයිඩ් රයිස්', ['chicken fried rice', 'chicken fried', 'fried rice'], 450, 750),
    halfFull('fried-rice', 'fr-egg', 'Egg Fried Rice', 'බිත්තර ෆ්‍රයිඩ් රයිස්', ['egg fried rice', 'egg fried'], 400, 650),
    halfFull('fried-rice', 'fr-mixed', 'Mixed Fried Rice', 'මික්ස් ෆ්‍රයිඩ් රයිස්', ['mixed fried rice', 'mix fried rice', 'mixed fried'], 600, 1200),
    halfFull('kottu', 'kt-egg', 'Egg Kottu', 'බිත්තර කොත්තු', ['egg kottu'], 450, 650),
    halfFull('kottu', 'kt-chicken', 'Chicken Kottu', 'චිකන් කොත්තු', ['chicken kottu', 'kottu'], 500, 750),
    // One biriyani, one price (2026-11-14): no kinds, no Half / Full.
    one('meals', 'ml-biriyani', 'Biriyani', 'බිරියානි', ['biriyani', 'biryani', 'buriyani'], 330),
    one('meals', 'ml-milk-rice', 'Milk Rice (1 piece)', 'කිරිබත් කෑලි 01', ['milk rice', 'kiribath', 'kiribat'], 100),
    one('meals', 'ml-pol-roti', 'Coconut Roti (1)', 'පොල් රොටි 01', ['coconut roti', 'pol roti'], 60),
    one('meals', 'ml-green-gram', 'Green Gram', 'මුං ඇට', ['green gram', 'mung', 'mun ata'], 150),
    one('meals', 'ml-chickpeas', 'Chickpeas', 'කඩල', ['chickpeas', 'kadala'], 150),
    one('meals', 'ml-noodles', 'Noodles', 'නූඩ්ල්ස්', ['noodles', 'noodle'], 160),
    kinds('meals', 'br-bread', 'Bread', 'පාන්', ['bread', 'paan', 'bread gravy', 'bread dhal', 'bread parippu', 'bread potato', 'bread ala'],
      [['dhal', 'Dhal', 150], ['potato', 'Potato', 150]], BREAD_ADDS),
    kinds('meals', 'sh-string-hoppers', 'String Hoppers', 'ඉඳි ආප්ප', ['string hoppers', 'string hopper', 'idiyappam', 'indiappa'],
      [['10', '10', 120], ['15', '15', 160], ['20', '20', 200]], STRING_HOPPER_ADDS),
    kinds('meals', 'rt-egg-roll', 'Roll', 'රෝල්ස්', ['roll', 'rolls', 'egg roll', 'egg rolls', 'fish roll', 'fish rolls'], [['egg', 'Egg', 100], ['fish', 'Fish', 100]]),
    one('meals', 'rt-veg-roti', 'Vegetable Roti', 'එළවළු රොටි', ['vegetable roti', 'vege roti', 'veg roti'], 80),
    kinds('meals', 'rt-egg-roti', 'Egg Roti', 'බිත්තර රොටි', ['egg roti', 'egg roti gravy'], [['plain', 'Plain', 100], ['gravy', 'Gravy', 120]]),
    one('meals', 'rt-paratha', 'Paratha with Gravy', 'පරාට හොදි', ['paratha', 'parata'], 60),
    one('meals', 'rt-wade', 'Parippu Wade', 'පරිප්පු වඩේ', ['parippu wade', 'dhal wade', 'wade', 'vadai'], 30),
    kinds('meals', 'rt-ulundu-wade', 'Ulundu Wade', 'උළුඳු වඩේ', ['ulundu wade', 'ulundu', 'ulundu wade gravy', 'ulundu gravy'], [['plain', 'Plain', 60], ['gravy', 'Gravy', 70]]),
    // Tea and coffee stay a card each, plain and milk (developer, 2026-11-14); no tea with jaggery.
    one('drinks', 'ot-plain-tea', 'Plain Tea', 'ප්ලේන් ටී', ['plain tea', 'plaintea', 'tea'], 50),
    one('drinks', 'ot-milk-tea', 'Milk Tea', 'කිරි තේ', ['milk tea', 'kiri the'], 120),
    one('drinks', 'ot-coffee', 'Coffee', 'කෝපි', ['coffee', 'kopi'], 70),
    one('drinks', 'ot-milk-coffee', 'Milk Coffee', 'කිරි කෝපි', ['milk coffee', 'kiri kopi'], 130),
    one('drinks', 'ot-nestomalt', 'Nestomalt', 'පොස්ට්මෝල්ට්', ['nestomalt', 'postmalt', 'nesto'], 120),
    one('drinks', 'ot-milo', 'Milo', 'මයිලෝ', ['milo'], 120),
    // The Drink is sold by bottle size; which drink is said at the counter (2026-11-14).
    kinds('drinks', 'dr-drink', 'Drink', 'බීම', ['drink', 'buddy', 'small drink', 'medium', 'medium drink'], [['buddy', 'Buddy', 100], ['medium', 'Medium', 180]]),
    kinds('drinks', 'dr-water', 'Water', 'වතුර', ['water', 'big water'], [['500ml', '500 ml', 80], ['1l', '1 L', 120], ['1-5l', '1.5 L', 150]]),
    one('drinks', 'dr-sun-crush', 'Sun Crush', 'සන් ක්‍රෂ්', ['sun crush', 'suncrush'], 150),
    one('drinks', 'dr-faluda', 'Faluda / Rose Drink', 'ෆලූඩා / රෝස් බීම', ['faluda', 'rose drink'], 100),
    kinds('drinks', 'dr-pepsi', 'Pepsi', 'පෙප්සි', ['pepsi', 'big pepsi'], [['400ml', '400 ml', 200], ['1l', '1 L', 300], ['1-5l', '1.5 L', 420]]),
    kinds('drinks', 'dr-coke', 'Coca-Cola', 'කොකා කෝලා', ['coke', 'coca cola', 'big coke'], [['400ml', '400 ml', 200], ['1l', '1 L', 300], ['1-5l', '1.5 L', 420]]),
    one('drinks', 'dr-sprite-400', 'Sprite (400 ml)', 'ස්ප්‍රයිට් 400 ml', ['sprite'], 200),
    one('drinks', 'dr-mirinda-400', 'Mirinda (400 ml)', 'මිරින්ඩා 400 ml', ['mirinda'], 200),
    one('drinks', 'dr-7up-400', '7UP (400 ml)', 'සෙවන් අප් 400 ml', ['7up', 'seven up'], 200),
    one('drinks', 'dr-egb-1000', 'EGB (1 L)', 'ඊ.ජී.බී. ලීටර් 1', ['egb', 'ginger beer 1l'], 300),
    one('drinks', 'dr-soda-1500', 'Cream Soda / Ginger Beer (1.5 L)', 'ක්‍රීම් සෝඩා / ජින්ජර් බියර් ලීටර් 1.5', ['cream soda', 'ginger beer'], 420),
    one('other', 'ot-popsicle', 'Popsicle', 'පොප්සිකල්', ['popsicle'], 120),
    one('other', 'ot-buns', 'Buns', 'ඊම් බනිස්', ['buns', 'bun', 'banis'], 100),
    one('other', 'ot-muffin', 'Muffin', 'මෆින්', ['muffin'], 150),
    one('other', 'ot-yoghurt', 'Yoghurt', 'යෝගට්', ['yoghurt', 'yogurt', 'curd'], 80),
    one('other', 'ot-jelly', 'Jelly', 'ජෙලි', ['jelly'], 80),
    one('other', 'ot-watalappan', 'Watalappan', 'වටලප්පන්', ['watalappan', 'watalappam'], 120),
    // As the shop wrote it; what it is is still to be asked (150 was crossed out for 250).
    one('other', 'ot-campa', 'Campa / N.K.G.', 'කැම්පා / එන්.කේ.ජී.', ['campa', 'nkg'], 250),
  ],
};

/**
 * Changes to what a running shop already has (new items reach it by themselves: they have new ids).
 * Each update is sent once, by Lume POS, after the menu (src/domain/menuUpdate.ts); its prices, names
 * and sections come from BATA_KADE_MENU above. Never edit an update once released: add a new one.
 */
export const BATA_KADE_UPDATES: MenuUpdate[] = [
  {
    // The shop's new price list (2026-11-13): new prices, Half / Full, fried rice all day, biriyani by kind.
    id: '2026-11-13',
    sections: ['fried-rice', 'kottu'],
    prices: ['rc-m-egg', 'rc-d-egg', 'ml-noodles', 'rt-egg-roti', 'rt-veg-roti', 'rt-egg-roll'],
    names: [],
    removed: ['rt-biriyani'],
  },
  {
    // 2026-11-14: fewer sections: Meals (with bread and string hoppers, now new items with their extras,
    // so the old ones go, and roti & rolls), Drinks (tea, coffee and malt drinks move there), Other; one
    // card per item with a price button per kind (Roll: Egg / Fish; Egg Roti: Plain / Gravy); no tea with
    // jaggery; one Biriyani at 330, Chicken Kottu Full 750, no beer, Sinhala names for every item.
    id: '2026-11-14',
    prices: ['kt-chicken'],
    names: ['ot-yoghurt', 'ot-jelly', 'ot-watalappan', 'ot-campa'],
    removed: [
      'ml-bread-dhal', 'ml-bread-potato', 'ml-bread-egg', 'ml-bread-fish', 'ml-bread-chicken',
      'ml-string-hoppers', 'ml-string-hoppers-15', 'ml-string-hoppers-20',
      'fr-biriyani-chicken', 'fr-biriyani-egg', 'fr-biriyani-mixed', 'dr-beer',
      'ot-kahata',
    ],
    moved: [
      'ot-plain-tea', 'ot-milk-tea', 'ot-coffee', 'ot-milk-coffee', 'ot-nestomalt', 'ot-milo',
      'rt-egg-roll', 'rt-veg-roti', 'rt-egg-roti', 'rt-wade',
    ],
    removedSections: ['roti'],
  },
];
