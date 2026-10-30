import type { StartingMenu } from '../domain/menuEdits.ts';
import type { MenuItem, Section } from '../domain/types.ts';

/*
 * possaas is Bata Kade's POS (2026-10-30): this is the shop's real menu. A new Bata Kade shop server
 * adds it once, the first time its counter connects with no menu yet (server/firstMenu.ts); the
 * rice demo (/?demo=rice) shows it too. Change it here only from the owner's own menu.
 */

/**
 * Bata Kade's own menu, its prices and Sinhala names copied from the shop's menu (given by
 * the developer, 2026-10-30). Items the menu has no price for (mung beans / chickpeas, lunch chicken rice,
 * fish and vegetable fried rice, vegetable and mix kottu, mix and special fried rice, fish rolls) are left
 * out until the owner gives one; so is a Full price nobody has given yet. "Fish / Egg" lines are one item
 * each so the kitchen knows which.
 *
 * Rice & curry has a morning price and a lunch & dinner price: two sections of the same name, each sold
 * at its own hours, so the counter shows one Rice & Curry whose prices change with the time. Fried rice
 * is sold only at night. The HOURS ARE PLACEHOLDERS until the owner gives them.
 */
const PORTIONS = [{ id: 'normal', label: 'Normal' }, { id: 'full', label: 'Full' }];
const MORNING = { from: 5 * 60, to: 11 * 60 };
const LUNCH_AND_DINNER = { from: 11 * 60, to: 5 * 60 };
const NIGHT = { from: 18 * 60, to: 5 * 60 };
// Two kitchens (asked for by the developer, 2026-10-29): rice and the rest on the left, kottu and fried rice on the right.
const RICE_MORNING_SECTION: Section = { id: 'rice-morning', name: 'Rice & Curry · බත් සහ කරි', cookMinutes: 3, sizes: PORTIONS, adds: [], station: 'left', hours: MORNING };
const RICE_DAY_SECTION: Section = { id: 'rice-day', name: 'Rice & Curry · බත් සහ කරි', cookMinutes: 3, sizes: PORTIONS, adds: [], station: 'left', hours: LUNCH_AND_DINNER };
const FRIED_RICE_SECTION: Section = { id: 'fried-rice', name: 'Fried Rice · ෆ්‍රයිඩ් රයිස්', cookMinutes: 8, sizes: PORTIONS, adds: [], station: 'right', hours: NIGHT };
const MEALS_SECTION: Section = { id: 'meals', name: 'Meals · ආහාර', cookMinutes: 3, sizes: [], adds: [], station: 'left' };
const KOTTU_SECTION: Section = { id: 'kottu', name: 'Kottu · කොත්තු', cookMinutes: 8, sizes: PORTIONS, adds: [], station: 'right' };
const OTHER_SECTION: Section = { id: 'other', name: 'Other · වෙනත් ආහාර', cookMinutes: 2, sizes: [], adds: [], station: 'left' };
const ROTI_SECTION: Section = { id: 'roti', name: 'String Hoppers, Roti & Rolls · ඉඳිආප්ප / රොටි / රෝල්ස්', cookMinutes: 2, sizes: [], adds: [], station: 'left' };
/** Prices by size, in rupees; a size without a price is not offered. */
const sized = (category: string, id: string, name: string, si: string, aliases: string[], prices: Record<string, number>): MenuItem => ({
  id, category, name: { en: name, si }, description: '', aliases,
  variants: PORTIONS.flatMap((z) => (prices[z.id] ? [{ ...z, price: prices[z.id] * 100 }] : [])), adds: [], leaveOut: [],
});
const portions = (category: string, id: string, name: string, si: string, aliases: string[], normal: number, full: number): MenuItem =>
  sized(category, id, name, si, aliases, { normal, full });
const one = (category: string, id: string, name: string, si: string, aliases: string[], price: number): MenuItem => ({
  id, category, name: { en: name, si }, description: '', aliases, price: price * 100, adds: [], leaveOut: [],
});
export const BATA_KADE_MENU: StartingMenu = {
  sections: [RICE_MORNING_SECTION, RICE_DAY_SECTION, FRIED_RICE_SECTION, KOTTU_SECTION, MEALS_SECTION, OTHER_SECTION, ROTI_SECTION],
  items: [
    // The same names and aliases morning and day: only one of the two is sold at a time.
    sized('rice-morning', 'rc-m-vege', 'Vegetable Rice & Curry', 'බත් එළවළු', ['vegetable rice', 'vege rice', 'veg rice', 'elawalu bath'], { normal: 200 }),
    sized('rice-morning', 'rc-m-fish', 'Fish Rice & Curry', 'බත් මාළු', ['fish rice', 'malu bath'], { normal: 250 }),
    sized('rice-morning', 'rc-m-egg', 'Egg Rice & Curry', 'බත් බිත්තර', ['egg rice', 'biththara bath'], { normal: 250 }),
    sized('rice-morning', 'rc-m-chicken', 'Chicken Rice & Curry', 'බත් චිකන්', ['chicken rice', 'chicken bath'], { normal: 300 }),
    sized('rice-day', 'rc-d-vege', 'Vegetable Rice & Curry', 'බත් එළවළු', ['vegetable rice', 'vege rice', 'veg rice', 'elawalu bath'], { normal: 220 }),
    sized('rice-day', 'rc-d-fish', 'Fish Rice & Curry', 'බත් මාළු', ['fish rice', 'malu bath'], { normal: 300 }),
    sized('rice-day', 'rc-d-egg', 'Egg Rice & Curry', 'බත් බිත්තර', ['egg rice', 'biththara bath'], { normal: 300 }),
    portions('fried-rice', 'fr-chicken', 'Chicken Fried Rice', 'චිකන් ෆ්‍රයිඩ් රයිස්', ['chicken fried rice', 'chicken fried', 'fried rice'], 450, 750),
    portions('fried-rice', 'fr-egg', 'Egg Fried Rice', 'බිත්තර ෆ්‍රයිඩ් රයිස්', ['egg fried rice', 'egg fried'], 400, 650),
    portions('kottu', 'kt-egg', 'Egg Kottu', 'බිත්තර කොත්තු', ['egg kottu'], 450, 650),
    portions('kottu', 'kt-chicken', 'Chicken Kottu', 'චිකන් කොත්තු', ['chicken kottu', 'kottu'], 500, 800),
    one('meals', 'ml-bread-dhal', 'Bread ½ with Dhal', 'පාන් 1/2 පරිප්පු සමඟ', ['bread dhal', 'bread parippu', 'bread', 'paan'], 150),
    one('meals', 'ml-bread-potato', 'Bread ½ with Potato Curry', 'පාන් 1/2 අල හොදි සමඟ', ['bread potato', 'bread ala'], 150),
    one('meals', 'ml-bread-egg', 'Bread ½ with Egg', 'පාන් 1/2 බිත්තර සමඟ', ['bread egg', 'bread biththara'], 200),
    one('meals', 'ml-milk-rice', 'Milk Rice (1 piece)', 'කිරිබත් කෑලි 01', ['milk rice', 'kiribath', 'kiribat'], 100),
    one('meals', 'ml-pol-roti', 'Coconut Roti (1)', 'පොල් රොටි 01', ['coconut roti', 'pol roti'], 60),
    one('meals', 'ml-noodles', 'Noodles', 'නූඩ්ල්ස්', ['noodles', 'noodle'], 180),
    one('meals', 'ml-string-hoppers', 'String Hoppers (10)', 'ඉඳි ආප්ප 10', ['string hoppers', 'string hopper', 'idiyappam', 'indiappa'], 130),
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
