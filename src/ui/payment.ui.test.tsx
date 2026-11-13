import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.tsx';
import { FOLD_MS } from './PayPanel.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const panel = () => within(screen.getByRole('complementary', { name: 'Current order' }));
/** Charge is not a popup: the order panel itself becomes the payment. */
const pay = () => within(panel().getByRole('region', { name: 'Payment' }));
const paying = () => panel().queryByRole('region', { name: 'Payment' });
const note = () => pay().getByRole('status').textContent;

/** An order of 2,500, sent to the kitchen, with Charge open. */
const openPayment = async (user = userEvent.setup()) => {
  render(<App />);
  await user.click(screen.getAllByRole('button', { name: 'L 2500' })[0]);
  await user.click(panel().getByRole('button', { name: 'Send to kitchen' }));
  await user.click(panel().getByRole('button', { name: /^1001/ }));
  await user.click(panel().getByRole('button', { name: 'Charge' }));
  return user;
};

test('Charge turns the order panel into the payment: no sheet, the order still in view', async () => {
  await openPayment();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(pay().getByRole('list', { name: 'Order' })).getByText(/Devilled Chicken/)).toBeTruthy();
  expect(note()).toBe('Total 2,500');
  expect(pay().getByRole('button', { name: 'Exact cash 2,500' })).toBeTruthy();
});

test('the suggested amounts are the total rounded up, what a customer really hands over', async () => {
  await openPayment();
  const given = within(pay().getByRole('group', { name: 'Cash given' })).getAllByRole('button').map((b) => b.textContent);
  expect(given).toEqual(['3,000', '5,000']);
  for (const name of ['Bank transfer', 'Card', 'QR']) expect(pay().getByRole('button', { name })).toBeTruthy();
});

test('Enter with nothing typed is exact cash', async () => {
  const user = await openPayment();
  await user.keyboard('{Enter}');
  expect(paying()).toBeNull();
  expect(panel().getByText('Paid')).toBeTruthy();
});

test('digits type the amount given, without the keypad; Enter takes it and shows the change', async () => {
  const user = await openPayment();
  await user.keyboard('2800');
  expect(pay().getByRole<HTMLInputElement>('textbox', { name: 'Other amount' }).value).toBe('2800');
  expect(pay().queryByRole('button', { name: 'Delete' })).toBeNull(); // the keyboard needs no keypad
  expect(note()).toBe('Change 300');
  await user.keyboard('{Enter}');
  expect(paying()).toBeNull();
  expect(panel().getByText('Change')).toBeTruthy();
  expect(panel().getByText(/Cash 2,800/)).toBeTruthy();
});

test('too little cash says how much is short and cannot be taken', async () => {
  const user = await openPayment();
  await user.keyboard('2000');
  expect(note()).toBe('Short 500');
  expect(pay().getByRole<HTMLButtonElement>('button', { name: 'Take' }).disabled).toBe(true);
  await user.keyboard('{Enter}');
  expect(paying()).toBeTruthy();
});

test('Esc clears what was typed, a second Esc goes back to the order', async () => {
  const user = await openPayment();
  await user.keyboard('28');
  await user.keyboard('{Escape}');
  expect(pay().getByRole<HTMLInputElement>('textbox', { name: 'Other amount' }).value).toBe('');
  await user.keyboard('{Escape}');
  expect(paying()).toBeNull();
  expect(panel().getByRole('button', { name: 'Charge' })).toBeTruthy();
});

test('B, C and Q pay by bank transfer, card and QR in one key', async () => {
  const user = await openPayment();
  await user.keyboard('b');
  expect(paying()).toBeNull();
  expect(panel().getByText(/Bank transfer · Total 2,500/)).toBeTruthy();
});

test('touch: the keypad opens from the field, folds away by itself once the amount is enough', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = await openPayment(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
  expect(pay().queryByRole('button', { name: 'Delete' })).toBeNull();
  await user.click(pay().getByRole('textbox', { name: 'Other amount' }));
  expect(pay().queryByRole('list', { name: 'Order' })).toBeNull(); // the keypad takes the lines' room
  for (const key of ['3', '0', '00', 'Delete', '0']) await user.click(pay().getByRole('button', { name: key }));
  expect(note()).toBe('Change 500');
  act(() => { vi.advanceTimersByTime(FOLD_MS + 50); });
  expect(pay().queryByRole('button', { name: 'Delete' })).toBeNull();
  expect(pay().getByRole('list', { name: 'Order' })).toBeTruthy();
  expect(pay().getByRole<HTMLInputElement>('textbox', { name: 'Other amount' }).value).toBe('3000');
  await user.click(pay().getByRole('button', { name: 'Take 3,000' }));
  expect(panel().getByText(/Cash 3,000/)).toBeTruthy();
});

test('touch: while the amount is still short the keypad stays open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = await openPayment(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
  await user.click(pay().getByRole('button', { name: 'Keypad' }));
  await user.click(pay().getByRole('button', { name: '2' }));
  act(() => { vi.advanceTimersByTime(FOLD_MS * 3); });
  expect(pay().getByRole('button', { name: 'Delete' })).toBeTruthy();
  await user.click(pay().getByRole('button', { name: 'Hide' }));
  expect(pay().queryByRole('button', { name: 'Delete' })).toBeNull();
});

test('the menu stays live while paying: a tap adds the item and the order comes back', async () => {
  const user = await openPayment();
  await user.click(screen.getAllByRole('button', { name: 'M 1450' })[0]);
  expect(paying()).toBeNull();
  expect(panel().getByRole('button', { name: 'Send to kitchen' })).toBeTruthy();
});
