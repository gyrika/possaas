import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appendEvent } from './eventLog.ts';
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
