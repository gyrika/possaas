import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.tsx';
import { Kitchen } from './Kitchen.tsx';
import { Root } from './Root.tsx';
import { readAll } from './eventLog.ts';
import { setShopDetails } from '../services/shop.ts';
import { SAMPLE_START, setStartingMenu } from '../domain/menu.ts';
import { FAKE_RICE_START } from '../fake/data.ts';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); setShopDetails({ name: 'Shop', place: '', footer: '', payFirst: false }); });

const panel = () => within(screen.getByRole('complementary', { name: 'Current order' }));
const kitchen = () => within(screen.getByRole('main', { name: 'Orders to make' }));

/** Takes one order at the register and sends it: Devilled Chicken L, no onion. */
const sendOne = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Devilled Chicken/ }));
  await user.click(screen.getByRole('button', { name: /Large/ }));
  await user.click(screen.getByRole('button', { name: /No onion/ }));
  await user.click(screen.getByRole('button', { name: /^Add ·/ }));
  await user.click(panel().getByRole('button', { name: 'Send to kitchen' }));
};

test('a sent order appears in the kitchen before payment; Done clears it; Undo brings it back', async () => {
  const user = userEvent.setup();
  render(<><App /><Kitchen /></>);
  expect(kitchen().getByText('No orders waiting')).toBeTruthy();

  await sendOne(user);
  const ticket = within(kitchen().getByRole('article', { name: 'Order 1001' }));
  expect(ticket.getByText('Devilled Chicken')).toBeTruthy();
  expect(ticket.getByText('Large')).toBeTruthy();
  expect(ticket.getByText('No onion')).toBeTruthy();
  expect(ticket.getByText('00:00')).toBeTruthy();

  await user.click(ticket.getByRole('button', { name: 'Done: Order 1001' }));
  expect(kitchen().getByText('No orders waiting')).toBeTruthy();

  // Both screens share this test page, so pick the kitchen's toast, not the register's.
  const toast = screen.getAllByRole('status').find((el) => el.textContent?.includes('1001 done'))!;
  await user.click(within(toast).getByRole('button', { name: 'Undo' }));
  expect(kitchen().getByRole('article', { name: 'Order 1001' })).toBeTruthy();
});

test('undoing the send at the register recalls the ticket', async () => {
  const user = userEvent.setup();
  render(<><App /><Kitchen /></>);
  await sendOne(user);
  expect(kitchen().getByRole('article', { name: 'Order 1001' })).toBeTruthy();
  const toast = screen.getAllByRole('status').find((el) => el.textContent?.includes('Sent 1001'))!;
  await user.click(within(toast).getByRole('button', { name: 'Undo' }));
  expect(kitchen().queryByRole('article', { name: 'Order 1001' })).toBeNull();
  expect(panel().getByText('Devilled Chicken')).toBeTruthy(); // back on the register, unsent
});

test('a later round arrives as its own "added" ticket; paying does not touch the kitchen', async () => {
  const user = userEvent.setup();
  render(<><App /><Kitchen /></>);
  await sendOne(user);
  await user.click(panel().getByRole('button', { name: /^1001/ }));
  await user.click(screen.getAllByRole('button', { name: 'M 1450' })[0]); // + Margherita M
  await user.click(panel().getByRole('button', { name: 'Send to kitchen' }));

  const more = within(kitchen().getByRole('article', { name: 'Order 1001, added items' }));
  expect(more.getByText('Margherita')).toBeTruthy();
  expect(more.queryByText('Devilled Chicken')).toBeNull(); // only the new round
  expect(kitchen().getAllByRole('article').length).toBe(2);

  await user.click(panel().getByRole('button', { name: /^1001/ }));
  await user.click(panel().getByRole('button', { name: 'Charge' }));
  await user.click(screen.getByRole('button', { name: /Exact/ }));
  expect(kitchen().getAllByRole('article').length).toBe(2);
});

test('a kitchen opened later still sees earlier tickets', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<App />);
  await sendOne(user);
  unmount();
  render(<Kitchen />);
  expect(screen.getByRole('article', { name: 'Order 1001' })).toBeTruthy();
});

test('the register shows Cooking until the kitchen taps Done, next to Paid / Unpaid', async () => {
  const user = userEvent.setup();
  render(<><App /><Kitchen /></>);
  await sendOne(user); // 1001
  const row = () => within(panel().getByRole('button', { name: /^1001/ }));
  expect(row().getByText('Cooking')).toBeTruthy();
  expect(row().getByText('Unpaid')).toBeTruthy();

  await user.click(kitchen().getByRole('button', { name: 'Done: Order 1001' }));
  expect(row().getByText('Done')).toBeTruthy();
  expect(row().queryByText('Cooking')).toBeNull();

  // A second round puts it back to Cooking; the opened order shows it too.
  await user.click(panel().getByRole('button', { name: /^1001/ }));
  await user.click(screen.getAllByRole('button', { name: 'M 1450' })[0]);
  await user.click(panel().getByRole('button', { name: 'Send to kitchen' }));
  expect(row().getByText('Cooking')).toBeTruthy();

  // Paid orders keep their kitchen state.
  await user.click(panel().getByRole('button', { name: /^1001/ }));
  expect(panel().getByText('Cooking')).toBeTruthy();
  await user.click(panel().getByRole('button', { name: 'Charge' }));
  await user.click(screen.getByRole('button', { name: /Exact/ }));
  await user.click(panel().getByRole('button', { name: 'Next order' }));
  const paid = within(panel().getByRole('region', { name: 'Paid today' }));
  expect(paid.getByText('Cooking')).toBeTruthy();
  expect(paid.getByText('Paid · Cash')).toBeTruthy();
});

test('a pay-first counter: paid meals wait on the serving list, grouped; one tap hands one over', async () => {
  setShopDetails({ name: 'Rice Bowl', place: '', footer: '', payFirst: true });
  const user = userEvent.setup();
  render(<><App /><Kitchen /></>);
  const serving = () => within(screen.getByRole('main', { name: 'Paid, to hand over' }));
  expect(serving().getByText('Nothing paid and waiting')).toBeTruthy();

  const charge = async () => {
    await user.click(screen.getAllByRole('button', { name: 'L 2500' })[0]); // Devilled Chicken L
    await user.click(panel().getByRole('button', { name: 'Charge' }));
    await user.click(screen.getByRole('button', { name: /Exact/ }));
    await user.click(panel().getByRole('button', { name: 'Next order' }));
  };
  await charge();
  await charge();
  const row = () => serving().getByRole('article', { name: /^Devilled Chicken, Large: / });
  expect(row().getAttribute('aria-label')).toBe('Devilled Chicken, Large: 2 paid');

  await user.click(within(row()).getByRole('button', { name: 'Served one: Devilled Chicken, Large' }));
  expect(row().getAttribute('aria-label')).toBe('Devilled Chicken, Large: 1 paid');
  // The oldest is handed over first, and its ticket is done for the register and the owner.
  expect(readAll().filter((e) => e.type === 'kitchen.bumped').map((e) => e.orderNumber)).toEqual([1001]);

  const toast = screen.getAllByRole('status').find((el) => el.textContent?.includes('Served · Devilled Chicken'))!;
  await user.click(within(toast).getByRole('button', { name: 'Undo' }));
  expect(row().getAttribute('aria-label')).toBe('Devilled Chicken, Large: 2 paid');
  expect(readAll().map((e) => e.type).slice(-2)).toEqual(['kitchen.unserved', 'kitchen.unbumped']);

  await user.click(within(row()).getByRole('button', { name: /^Served one/ }));
  await user.click(within(row()).getByRole('button', { name: /^Served one/ }));
  expect(serving().getByText('Nothing paid and waiting')).toBeTruthy();
});

test('two kitchens: rice goes left, kottu goes right; each flies its way and shows on its own screen', async () => {
  setStartingMenu(FAKE_RICE_START);
  setShopDetails({ name: 'Bata Kade', place: '', footer: '', payFirst: true });
  try {
    const user = userEvent.setup();
    render(<Root />);
    await user.click(screen.getAllByRole('button', { name: 'L 600' })[0]); // Chicken Rice & Curry, Large
    await user.click(screen.getByRole('button', { name: 'Kottu & Fried Rice' }));
    await user.click(screen.getAllByRole('button', { name: 'L 950' })[0]); // Chicken Kottu, Large
    await user.click(panel().getByRole('button', { name: 'Charge' }));
    await user.click(screen.getByRole('button', { name: /Exact/ }));

    const sent = readAll().flatMap((e) => (e.type === 'order.sent' ? [[e.station, e.lines.map((l) => l.itemId)]] : []));
    expect(sent).toEqual([['left', ['rc-chicken']], ['right', ['kt-chicken']]]);
    expect(document.querySelector('.flight--left')?.textContent).toContain('1 × Chicken Rice & Curry');
    expect(document.querySelector('.flight--right')?.textContent).toContain('1 × Chicken Kottu');
    // The Register has a key per kitchen, each counting its own.
    expect(screen.getByRole('button', { name: /^Left kitchen: 1 to hand over/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Right kitchen: 1 to hand over/ }));
    expect(screen.getByRole('heading', { name: 'Serving · Right kitchen' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: /Rice & Curry/ })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Left kitchen/ }));
    expect(screen.getByRole('article', { name: 'Chicken Rice & Curry, Large: 1 paid' })).toBeTruthy();
    await user.keyboard('{Escape}');
    cleanup();

    // A kitchen phone or tablet paired as the right kitchen.

    localStorage.setItem('cb.kitchen.station', 'right');
    render(<Kitchen />);
    expect(screen.getByRole('heading', { name: 'Serving · Right kitchen' })).toBeTruthy();
    const serving = within(screen.getByRole('main', { name: 'Paid, to hand over' }));
    expect(serving.getByRole('article', { name: 'Chicken Kottu, Large: 1 paid' })).toBeTruthy();
    expect(serving.queryByRole('article', { name: /Rice & Curry/ })).toBeNull();
  } finally { setStartingMenu(SAMPLE_START); }
});
