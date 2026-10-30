import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_START, menuItems, setMenuState, setStartingMenu } from '../domain/menu.ts';
import { EMPTY_MENU_STATE, EMPTY_START } from '../domain/menuEdits.ts';
import { FAKE_RICE_START, FAKE_STAFF } from '../fake/data.ts';
import { App } from './App.tsx';
import { appendEvent, readAll } from './eventLog.ts';
import { Root } from './Root.tsx';

beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/'); setMenuState(EMPTY_MENU_STATE); });
afterEach(() => { cleanup(); setMenuState(EMPTY_MENU_STATE); });

const panel = () => within(screen.getByRole('complementary', { name: 'Current order' }));

test("the owner changes a price and a name: the counter shows it at once; an order already sent keeps its price", async () => {
  const user = userEvent.setup();
  render(<Root />);
  // An order sent at the printed price (Margherita M 1450).
  await user.click(screen.getAllByRole('button', { name: 'M 1450' })[0]);
  await user.click(panel().getByRole('button', { name: 'Send to kitchen' }));

  history.replaceState(null, '', '/#menu');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await user.click(await screen.findByRole('button', { name: 'Change Margherita' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Change Margherita' }));
  await user.clear(sheet.getByLabelText('Medium price'));
  await user.type(sheet.getByLabelText('Medium price'), '1600');
  expect(sheet.getByText('Printed 1,450')).toBeTruthy();
  await user.type(sheet.getByLabelText('Sinhala'), 'මාගරීටා');
  await user.click(sheet.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('status').textContent).toContain('Saved Margherita');
  expect(screen.getByText('M 1,600 · L 1,990')).toBeTruthy();

  const e = readAll().find((x) => x.type === 'menu.item_set')!;
  expect(e).toMatchObject({ itemId: 'margherita', before: {}, after: { prices: { M: 160000 }, name: { si: 'මාගරීටා' } } });

  await user.keyboard('{Escape}');
  expect(screen.getAllByRole('button', { name: 'M 1600' }).length).toBeGreaterThan(0);
  expect(within(panel().getByRole('region', { name: 'Waiting to pay' })).getByRole('button', { name: /^1001/ }).textContent).toContain('1,450');
});

/** Ctrl+M, then the manager's PIN: the Register is in manager mode. */
const unlock = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.keyboard('{Control>}m{/Control}');
  await user.keyboard(FAKE_STAFF.find((x) => x.actor.role === 'manager')!.pin);
};
const managerActor = () => FAKE_STAFF.find((x) => x.actor.role === 'manager')!.actor;

test('manager mode on the Register: a tap on an item changes its price there, as the manager; nothing is added to the order; Undo', async () => {
  const user = userEvent.setup();
  render(<App />);
  await unlock(user);
  await user.click(screen.getAllByRole('button', { name: 'L 1990' })[0]);
  expect(panel().queryByText('Margherita')).toBeNull();
  const sheet = within(screen.getByRole('dialog', { name: 'Change Margherita' }));
  await user.clear(sheet.getByLabelText('Large price'));
  await user.type(sheet.getByLabelText('Large price'), '2100');
  await user.click(sheet.getByRole('button', { name: 'Save' }));
  expect(screen.getAllByRole('button', { name: 'L 2100' }).length).toBeGreaterThan(0);
  expect(readAll().filter((e) => e.type.startsWith('menu.'))).toMatchObject([
    { type: 'menu.item_set', itemId: 'margherita', actor: managerActor(), before: {}, after: { prices: { L: 210000 } } },
  ]);
  // Still managing: the sheet's Esc closed only the sheet. Ctrl+Z takes the price back.
  expect(screen.getByText(`Managing · ${managerActor().name}`)).toBeTruthy();
  await user.keyboard('{Control>}z{/Control}');
  expect(screen.queryAllByRole('button', { name: 'L 2100' })).toEqual([]);
});

test("manager mode: a new size for a section, each item's price for it in the same sheet; blank = not sold in it", async () => {
  setStartingMenu(EMPTY_START);
  const actor = managerActor();
  const base = { orderNumber: 0, actor, at: Date.now() } as const;
  appendEvent({ ...base, type: 'menu.section_set', sectionId: 'sec-kottu', section: { name: 'Kottu', cookMinutes: 8, sizes: [{ id: 'regular', label: 'Regular' }, { id: 'full', label: 'Full' }], adds: [] } });
  appendEvent({ ...base, type: 'menu.item_added', itemId: 'new-chicken-kottu', item: { category: 'sec-kottu', name: { en: 'Chicken Kottu' }, description: '', prices: { regular: 90000, full: 130000 } } });
  appendEvent({ ...base, type: 'menu.item_added', itemId: 'new-egg-kottu', item: { category: 'sec-kottu', name: { en: 'Egg Kottu' }, description: '', prices: { regular: 70000 } } });
  try {
    const user = userEvent.setup();
    render(<App />);
    await unlock(user);
    await user.click(screen.getByRole('button', { name: 'Kottu' }));
    await user.click(screen.getByRole('button', { name: 'Sizes & extras' }));
    const sec = within(screen.getByRole('dialog', { name: 'Change Kottu' }));
    await user.click(sec.getByRole('button', { name: '+ Add a size' }));
    await user.type(sec.getByLabelText('Size 3'), 'Large');
    await user.type(sec.getByLabelText('Chicken Kottu Large price'), '1600');
    await user.click(sec.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Added Large to Kottu')).toBeTruthy();
    expect(menuItems().find((m) => m.id === 'new-chicken-kottu')!.variants!.map((v) => [v.id, v.price])).toEqual([['regular', 90000], ['full', 130000], ['large', 160000]]);
    expect(menuItems().find((m) => m.id === 'new-egg-kottu')!.variants!.map((v) => v.id)).toEqual(['regular']);

    // Egg Kottu gets a Large price later, from its own sheet.
    await user.click(screen.getByRole('button', { name: 'Change Egg Kottu' }));
    const item = within(screen.getByRole('dialog', { name: 'Change Egg Kottu' }));
    await user.type(item.getByLabelText('Large price'), '1200');
    await user.click(item.getByRole('button', { name: 'Save' }));
    expect(menuItems().find((m) => m.id === 'new-egg-kottu')!.variants!.map((v) => [v.id, v.price])).toEqual([['regular', 70000], ['large', 120000]]);

    // Undo takes back the last change only.
    await user.click(within(screen.getByText('Saved Egg Kottu').closest('.toast') as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(menuItems().find((m) => m.id === 'new-egg-kottu')!.variants!.map((v) => v.id)).toEqual(['regular']);
  } finally {
    setStartingMenu(SAMPLE_START);
  }
});

test('sold out for today: greyed on the counter, cannot be added; Undo brings it back', async () => {
  const user = userEvent.setup();
  history.replaceState(null, '', '/#menu');
  render(<Root />);
  const row = within((await screen.findByRole('button', { name: 'Change BBQ Chicken' })).closest('li')!);
  await user.click(row.getByRole('button', { name: 'Available' }));
  expect(row.getByRole('button', { name: 'Sold out today' })).toBeTruthy();
  await user.keyboard('{Escape}');
  const card = screen.getByText('BBQ Chicken').closest('.card')!;
  expect(within(card as HTMLElement).getByText('Sold out')).toBeTruthy();
  expect((within(card as HTMLElement).getByRole('button', { name: 'L 2500' }) as HTMLButtonElement).disabled).toBe(true);
});

test('hidden items leave the counter; back to the printed menu in one tap', async () => {
  const user = userEvent.setup();
  history.replaceState(null, '', '/#menu');
  render(<Root />);
  await user.click(await screen.findByRole('button', { name: 'Change Seafood' }));
  await user.click(screen.getByRole('checkbox', { name: /Hide from the menu/ }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Hidden')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Change Seafood' }));
  await user.click(screen.getByRole('button', { name: 'Back to the printed menu' }));
  expect(screen.queryByText('Hidden')).toBeNull();
  expect(screen.queryByText('Changed')).toBeNull();
});

test('the owner adds a pasta: names stay unique, a blank size is not sold, and the counter offers it at once', async () => {
  const user = userEvent.setup();
  history.replaceState(null, '', '/#menu');
  render(<Root />);
  await user.click(await screen.findByRole('button', { name: 'Pasta' }));
  await user.click(screen.getByRole('button', { name: '+ Add to Pasta' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Add to Pasta' }));
  await user.type(sheet.getByLabelText('Name'), 'Italian Pasta');
  await user.type(sheet.getByLabelText('Single price'), '1100');
  await user.click(sheet.getByRole('button', { name: /^Add/ }));
  expect(sheet.getByRole('alert').textContent).toContain('Italian Pasta is already on the menu');

  await user.clear(sheet.getByLabelText('Name'));
  await user.type(sheet.getByLabelText('Name'), 'Chicken Alfredo');
  await user.clear(sheet.getByLabelText('Single price'));
  await user.click(sheet.getByRole('button', { name: /^Add/ }));
  expect(sheet.getByRole('alert').textContent).toContain('Type a price for at least one size');
  await user.type(sheet.getByLabelText('Single price'), '1100');
  await user.type(sheet.getByLabelText('Medium price'), '2100{Enter}'); // Large left blank: not sold in Large

  expect(sheet.getByRole('status').textContent).toContain('Added Chicken Alfredo');
  expect((sheet.getByLabelText('Name') as HTMLInputElement).value).toBe(''); // ready for the next one
  expect(readAll().find((x) => x.type === 'menu.item_added')).toMatchObject({
    itemId: 'new-chicken-alfredo',
    item: { category: 'pasta', name: { en: 'Chicken Alfredo' }, description: '', prices: { S: 110000, M: 210000 } },
  });
  await user.click(sheet.getByRole('button', { name: 'Done' }));
  expect(screen.getByText('S 1,100 · M 2,100')).toBeTruthy();

  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Pasta' }));
  const card = within(screen.getByText('Chicken Alfredo').closest('.card') as HTMLElement);
  expect(card.getByRole('button', { name: 'S 1100' })).toBeTruthy();
  expect(card.getByRole('button', { name: 'M 2100' })).toBeTruthy();
});

test('Undo right after adding takes the new item off the menu', async () => {
  const user = userEvent.setup();
  history.replaceState(null, '', '/#menu');
  render(<Root />);
  await user.click(await screen.findByRole('button', { name: '+ Add to Pizza' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Add to Pizza' }));
  await user.type(sheet.getByLabelText('Name'), 'Hot Butter Cuttlefish');
  await user.type(sheet.getByLabelText('Medium price'), '2300');
  await user.type(sheet.getByLabelText('Large price'), '3300{Enter}');
  expect(screen.getByRole('button', { name: 'Change Hot Butter Cuttlefish' })).toBeTruthy();
  await user.click(sheet.getByRole('button', { name: 'Undo' }));
  expect(screen.queryByRole('button', { name: 'Change Hot Butter Cuttlefish' })).toBeNull();
});

test("a new shop: the owner meets 'Add your menu', makes a Kottu section and its items one after another, and sells them", async () => {
  setStartingMenu(EMPTY_START);
  try {
    const user = userEvent.setup();
    render(<Root />);
    expect(await screen.findByRole('heading', { name: 'Add your menu' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '+ Add a section' }));
    const sec = within(screen.getByRole('dialog', { name: 'Add a section' }));
    await user.type(sec.getByLabelText('Section name'), 'Kottu');
    await user.clear(sec.getByLabelText('Ready in (minutes)'));
    await user.type(sec.getByLabelText('Ready in (minutes)'), '8');
    await user.click(sec.getByRole('button', { name: '+ Add a size' }));
    await user.type(sec.getByLabelText('Size 1'), 'Regular');
    await user.click(sec.getByRole('button', { name: '+ Add a size' }));
    await user.type(sec.getByLabelText('Size 2'), 'Full');
    await user.click(sec.getByRole('button', { name: '+ Add an extra' }));
    await user.type(sec.getByLabelText('Extra 1'), 'Egg');
    await user.type(sec.getByLabelText('Extra 1 price'), '100');
    await user.click(sec.getByRole('button', { name: 'Add the section' }));
    expect(readAll().find((x) => x.type === 'menu.section_set')).toMatchObject({
      sectionId: 'sec-kottu',
      section: { name: 'Kottu', cookMinutes: 8, sizes: [{ id: 'regular', label: 'Regular' }, { id: 'full', label: 'Full' }], adds: [{ id: 'egg', label: 'Egg', price: 10000 }] },
    });

    // Straight on to its items: type, Enter, the next.
    const add = within(screen.getByRole('dialog', { name: 'Add to Kottu' }));
    await user.type(add.getByLabelText('Name'), 'Chicken Kottu');
    await user.type(add.getByLabelText('Regular price'), '900');
    await user.type(add.getByLabelText('Full price'), '1300{Enter}');
    await user.type(add.getByLabelText('Name'), 'Cheese Kottu');
    await user.type(add.getByLabelText('Full price'), '1600{Enter}');
    expect(add.getByRole('status').textContent).toContain('Added Cheese Kottu');
    await user.click(add.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Ready in 8 min · Regular, Full · extras: Egg')).toBeTruthy();
    expect(screen.getByText('Regular 900 · Full 1,300')).toBeTruthy();

    // Still the owner's menu screen (the menu is no longer empty) until they leave it.
    expect(screen.getByRole('heading', { name: 'Menu' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Kottu' }));
    const card = within(screen.getByText('Chicken Kottu').closest('.card') as HTMLElement);
    await user.click(card.getByRole('button', { name: 'Full 1300' }));
    expect(panel().getByText('Chicken Kottu')).toBeTruthy();
    expect(panel().getByText('Full')).toBeTruthy();
  } finally {
    setStartingMenu(SAMPLE_START);
  }
});

test("a new shop's owner can do the menu later: the counter says it is empty and offers to add it", async () => {
  setStartingMenu(EMPTY_START);
  try {
    const user = userEvent.setup();
    render(<Root />);
    await user.click(await screen.findByRole('button', { name: 'Do it later' }));
    expect(screen.getByRole('heading', { name: 'Your menu is empty' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add your menu' }));
    expect(await screen.findByRole('heading', { name: 'Add your menu' })).toBeTruthy();
  } finally {
    setStartingMenu(SAMPLE_START);
  }
});

test('manager mode: a rice & curry sold in Normal only gets a Full price from its own sheet, and sells in Full', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const user = userEvent.setup();
    vi.setSystemTime(new Date(2026, 9, 30, 9, 0));
    setStartingMenu(FAKE_RICE_START);
    render(<App />);
    await unlock(user);
    await user.click(screen.getAllByRole('button', { name: 'Rice & Curry' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Normal 250' })[0]);
    const sheet = within(screen.getByRole('dialog', { name: 'Change Fish Rice & Curry' }));
    await user.type(sheet.getByLabelText('Full price'), '350');
    await user.click(sheet.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Full 350' })).toBeTruthy();
    expect(readAll().filter((e) => e.type.startsWith('menu.'))).toMatchObject([
      { type: 'menu.item_set', itemId: 'rc-m-fish', actor: managerActor(), after: { prices: { full: 35000 } } },
    ]);
  } finally {
    vi.useRealTimers();
    setStartingMenu(SAMPLE_START);
  }
});

test('a section with hours shows only then: morning rice prices, then lunch & dinner prices, fried rice at night', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const user = userEvent.setup();
    vi.setSystemTime(new Date(2026, 9, 30, 9, 0));
    setStartingMenu(FAKE_RICE_START);
    render(<Root />);
    await user.click(screen.getByRole('button', { name: 'Rice & Curry' }));
    expect(screen.getAllByRole('button', { name: 'Normal 200' })).toHaveLength(1); // morning vegetable
    expect(screen.queryByRole('button', { name: 'Normal 220' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fried Rice' })).toBeNull();
    cleanup();

    vi.setSystemTime(new Date(2026, 9, 30, 19, 0));
    setStartingMenu(FAKE_RICE_START);
    render(<Root />);
    expect(screen.getAllByRole('button', { name: 'Rice & Curry' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Rice & Curry' }));
    expect(screen.getByRole('button', { name: 'Normal 220' })).toBeTruthy(); // lunch & dinner vegetable
    expect(screen.queryByRole('button', { name: 'Normal 200' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Fried Rice' }));
    expect(screen.getByRole('button', { name: 'Full 750' })).toBeTruthy();
  } finally {
    vi.useRealTimers();
    setStartingMenu(SAMPLE_START);
  }
});
