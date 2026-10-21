import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FAKE_STAFF } from '../fake/data.ts';
import { appendEvent, readAll } from './eventLog.ts';
import { Root } from './Root.tsx';

beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/#close'); });
afterEach(() => cleanup());

const actor = { id: 'm', name: 'Ravi', role: 'manager' as const };

test("close the day: the day's sales by how they were paid; type the cash counted and see short, over or exact", async () => {
  appendEvent({ type: 'order.paid', at: Date.now() - 60_000, orderNumber: 1001, actor, total: 150000, tender: 'cash', tendered: 200000 });
  appendEvent({ type: 'order.paid', at: Date.now() - 30_000, orderNumber: 1002, actor, total: 80000, tender: 'transfer', tendered: 80000 });
  const user = userEvent.setup();
  render(<Root />);
  expect(await screen.findByRole('heading', { name: 'Close the day' })).toBeTruthy();
  expect(screen.getByText('Bank transfer').closest('div')!.textContent).toContain('800');
  expect(screen.getByText('Total').closest('div')!.textContent).toContain('2,300');

  await user.type(screen.getByLabelText('Cash in the drawer at opening'), '5000');
  expect(screen.getByText('Cash expected now').textContent).toContain('Rs 6,500');
  await user.type(screen.getByLabelText('Cash counted now'), '6,300');
  expect(screen.getByRole('status').textContent).toBe('Rs 200 short');
  await user.clear(screen.getByLabelText('Cash counted now'));
  await user.type(screen.getByLabelText('Cash counted now'), '6500');
  expect(screen.getByRole('status').textContent).toBe('Exact');
});

test('closing the day keeps the close, and the Owner view shows it with the full report behind one tap', async () => {
  appendEvent({ type: 'order.paid', at: Date.now() - 60_000, orderNumber: 1001, actor, total: 150000, tender: 'cash', tendered: 200000 });
  const user = userEvent.setup();
  render(<Root />);
  const close = await screen.findByRole('button', { name: 'Close the day' });
  expect((close as HTMLButtonElement).disabled).toBe(true); // nothing counted yet
  await user.type(screen.getByLabelText('Cash in the drawer at opening'), '5000');
  await user.type(screen.getByLabelText('Cash counted now'), '6300');
  await user.click(close);
  // The cashier at the screen does not sign off the cash: a manager's PIN does.
  expect(readAll().filter((e) => e.type === 'day.closed')).toHaveLength(0);
  await screen.findByRole('dialog', { name: 'Manager PIN' });
  await user.keyboard(FAKE_STAFF.find((s) => s.actor.role === 'manager')!.pin);
  expect(await screen.findByText(/The owner sees the report in the Owner view/)).toBeTruthy();
  const kept = readAll().filter((e) => e.type === 'day.closed');
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({ orderNumber: 0, float: 500000, counted: 630000, count: { total: 150000 }, actor: { role: 'manager' } });

  cleanup();
  history.replaceState(null, '', '/#owner');
  render(<Root />);
  const card = await screen.findByRole('article', { name: /closed: cash Rs 200 short/ });
  await user.click(within(card).getByRole('button', { name: 'See the report' }));
  const report = screen.getByRole('dialog');
  expect(within(report).getByText('Difference').closest('li')!.textContent).toContain('Rs 200 short');
  expect(within(report).getByText('Cash at opening').closest('li')!.textContent).toContain('5,000');
  await user.keyboard('{Escape}');

  // Past days: today, closed, is in the list; a tap opens its report, Back returns to the list.
  await user.click(screen.getByRole('button', { name: 'Past days' }));
  const list = screen.getByRole('dialog', { name: 'Past days' });
  const today = within(list).getByRole('button', { name: /Cash Rs 200 short · closed by Ravi/ });
  expect(today.textContent).toContain('1,500');
  await user.click(today);
  const day = screen.getByRole('dialog');
  expect(within(day).getByRole('region', { name: 'Cash' }).textContent).toContain('Rs 200 short');
  await user.click(within(day).getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('dialog', { name: 'Past days' })).toBeTruthy();
});
