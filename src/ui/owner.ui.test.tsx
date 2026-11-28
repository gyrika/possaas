import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Root } from './Root.tsx';

const FRIDAY_EVENING = new Date(2026, 9, 9, 20, 30);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: FRIDAY_EVENING, toFake: ['Date'] }); // only the clock: the demo history is built from "now"
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

test('the demo Today: the total, morning/lunch/evening, the dishes sold; a part of the day filters them (owner, 2026-11-28)', async () => {
  history.replaceState(null, '', '/?demo#owner');
  const user = userEvent.setup();
  render(<Root />);
  const hero = within(await screen.findByRole('region', { name: 'Sales today' }));
  const sold = () => within(screen.getByRole('region', { name: 'Sold today' }));
  // Minimal: no To do, stations, hourly chart or black screen.
  for (const gone of ['Needs your attention', 'Shop screen', 'Sales by hour']) expect(screen.queryByRole('region', { name: gone })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Money|Counter): / })).toBeNull();
  // Morning, lunch and evening (the demo is at 8:30 pm, so all three have begun).
  const parts = hero.getAllByRole('button', { name: /^(Morning|Lunch|Evening), / });
  expect(parts.map((b) => b.getAttribute('aria-label')?.split(',')[0])).toEqual(['Morning', 'Lunch', 'Evening']);
  const dayRows = sold().getAllByRole('listitem').length;
  expect(dayRows).toBeGreaterThan(0);
  expect(sold().getByText('Sold today')).toBeTruthy();
  // A part of the day: its total and its dishes; again: the whole day.
  await user.click(parts[0]);
  expect(parts[0].getAttribute('aria-pressed')).toBe('true');
  expect(sold().getByText('Sold in the morning')).toBeTruthy();
  expect(hero.getByText(/ bills? · morning$/)).toBeTruthy();
  await user.click(parts[0]);
  expect(sold().getByText('Sold today')).toBeTruthy();
  expect(sold().getAllByRole('listitem').length).toBe(dayRows);
}, 15_000); // the whole demo history, worked out twice

test('no history yet: a calm screen, not an empty error; nothing waits', async () => {
  history.replaceState(null, '', '/#owner');
  render(<Root />);
  expect(await screen.findByText('Nothing sold yet today.')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Sales today' })).getByText('Rs 0', { selector: '.today__big' })).toBeTruthy();
});
