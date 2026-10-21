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

test('the demo owner feed: today in one line, then cards with one tap each', async () => {
  history.replaceState(null, '', '/?demo#owner');
  const user = userEvent.setup();
  render(<Root />);
  const feed = within(await screen.findByRole('region', { name: 'Needs your attention' }));
  const cards = await feed.findAllByRole('article');
  expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
    expect.stringMatching(/^Sales \d+% below a usual Friday$/),
    expect.stringMatching(/voids today, \d+ by Ravi$/),
    expect.stringMatching(/^Kitchen slow/),
    "BBQ Pork hasn't sold in 2 weeks",
    expect.stringMatching(/best seller$/),
  ]);
  expect(within(screen.getByRole('region', { name: 'Today' })).getByText(/^Rs [\d,]+$/)).toBeTruthy();

  const voids = cards[1].getAttribute('aria-label')!;
  await user.click(within(feed.getByRole('article', { name: voids })).getByRole('button', { name: 'See them' }));
  const sheet = within(screen.getByRole('dialog', { name: voids }));
  expect(sheet.getAllByText(/^Ravi · /).length).toBeGreaterThan(0);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('no history yet: a calm screen, not an empty error', async () => {
  history.replaceState(null, '', '/#owner');
  render(<Root />);
  expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
  expect(screen.getByText('Rs 0')).toBeTruthy();
});
