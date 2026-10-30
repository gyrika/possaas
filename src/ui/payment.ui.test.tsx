import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

const panel = () => within(screen.getByRole('complementary', { name: 'Current order' }));
const sheet = () => within(screen.getByRole('dialog', { name: 'Payment' }));

/** An order of 2,500, sent to the kitchen, with the payment sheet open. */
const openPayment = async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getAllByRole('button', { name: 'L 2500' })[0]);
  await user.click(panel().getByRole('button', { name: 'Send to kitchen' }));
  await user.click(panel().getByRole('button', { name: /^1001/ }));
  await user.click(panel().getByRole('button', { name: 'Charge' }));
  return user;
};

test('the suggested amounts are the total rounded up, what a customer really hands over', async () => {
  await openPayment();
  const chips = sheet().getAllByRole('button').map((b) => b.textContent);
  expect(chips).toEqual(['Exact · 2,500', '3,000', '5,000', 'Bank transfer', 'Card', 'QR']);
});

test('Enter with nothing typed is still Exact', async () => {
  const user = await openPayment();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog', { name: 'Payment' })).toBeNull();
  expect(panel().getByText('Paid')).toBeTruthy();
});

test('digits type the amount given without clicking the field; Enter takes it and shows the change', async () => {
  const user = await openPayment();
  await user.keyboard('2800');
  expect(sheet().getByRole<HTMLInputElement>('textbox', { name: 'Other amount' }).value).toBe('2800');
  expect(sheet().getByRole('status').textContent).toBe('Change 300');
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog', { name: 'Payment' })).toBeNull();
  expect(panel().getByText('Change')).toBeTruthy();
  expect(panel().getByText(/Cash 2,800/)).toBeTruthy();
});

test('too little cash says how much is short and cannot be taken', async () => {
  const user = await openPayment();
  await user.keyboard('2000');
  expect(sheet().getByRole('status').textContent).toBe('Short 500');
  expect(sheet().getByRole<HTMLButtonElement>('button', { name: 'Take' }).disabled).toBe(true);
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Payment' })).toBeTruthy();
});

test('Esc clears what was typed, a second Esc closes the sheet', async () => {
  const user = await openPayment();
  await user.keyboard('28');
  await user.keyboard('{Escape}');
  expect(sheet().getByRole<HTMLInputElement>('textbox', { name: 'Other amount' }).value).toBe('');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Payment' })).toBeNull();
});

test('touch: tapping the field opens the number pad, and Take finishes the sale', async () => {
  const user = await openPayment();
  expect(sheet().queryByRole('button', { name: 'Delete' })).toBeNull();
  await user.click(sheet().getByRole('textbox', { name: 'Other amount' }));
  for (const key of ['3', '0', '0', '1', 'Delete', '0']) await user.click(sheet().getByRole('button', { name: key }));
  expect(sheet().getByRole('status').textContent).toBe('Change 500');
  await user.click(sheet().getByRole('button', { name: 'Take 3,000' }));
  expect(panel().getByText(/Cash 3,000/)).toBeTruthy();
});
