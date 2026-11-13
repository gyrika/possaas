import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setShopDetails } from '../services/shop.ts';
import { Root } from './Root.tsx';

beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/'); });
afterEach(() => {
  cleanup();
  setShopDetails({ name: 'Test shop', place: '', footer: '', features: {} });
});

test('parts switched off on /admin leave the screens: no keys, no tab, F3 and F6 do nothing', async () => {
  setShopDetails({ name: 'Bata Kade', place: '', footer: '', features: { cashOut: false, busyMode: false, onlineOrders: false } });
  const user = userEvent.setup();
  render(<Root />);
  expect(await screen.findByRole('button', { name: /Charge|Send/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Cash out/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Busy/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Online/ })).toBeNull();
  await user.keyboard('{F3}');
  expect(screen.queryByRole('heading', { name: 'Cash out' })).toBeNull();
  cleanup();

  history.replaceState(null, '', '/#close');
  render(<Root />);
  expect(await screen.findByRole('heading', { name: 'Close the day' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Cash out' })).toBeNull();
});

test('switched back on, they are there again', async () => {
  setShopDetails({ name: 'Bata Kade', place: '', footer: '', features: { kitchen: true } });
  render(<Root />);
  expect(await screen.findByRole('button', { name: /Cash out/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Busy/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Kitchen/ })).toBeTruthy();
});

test('no kitchen screen (Bata Kade for now, the default): no Kitchen key, #kitchen is the Register, no Cooking on a paid order', async () => {
  setShopDetails({ name: 'Bata Kade', place: '', footer: '', payFirst: true, features: {} });
  const user = userEvent.setup();
  render(<Root />);
  expect(await screen.findByRole('button', { name: /Cash out/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^(Left |Right )?[Kk]itchen/ })).toBeNull();
  // A paid order still goes to the kitchen's tickets (for when it is on), but nothing says Cooking.
  await user.click(screen.getAllByRole('button', { name: 'L 2500' })[0]); // Devilled Chicken L
  await user.click(screen.getByRole('button', { name: 'Charge' }));
  await user.click(screen.getByRole('button', { name: /Exact/ }));
  await user.click(screen.getByRole('button', { name: 'Next order' }));
  expect(within(screen.getByRole('region', { name: 'Paid today' })).getAllByText(/Paid/).length).toBeGreaterThan(0);
  expect(screen.queryByText('Cooking')).toBeNull();
  cleanup();

  history.replaceState(null, '', '/#kitchen');
  render(<Root />);
  expect(await screen.findByRole('button', { name: 'Charge' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Kitchen' })).toBeNull();
});
