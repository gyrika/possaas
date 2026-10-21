import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printerAdvice } from './printerHelp.ts';
import { PAPER_CHARS, drawerOnly, escpos, receipt, receiptText, CMD } from './receipt.ts';
import type { PaidOrder } from './types.ts';

test("what to do when the test receipt did not come out: from Windows' state, the most likely cause first", () => {
  assert.match(printerAdvice({ status: 'Offline', jobs: 0, offline: false }).title, /off or not connected/);
  assert.match(printerAdvice({ status: 'Normal', jobs: 0, offline: true }).title, /off or not connected/, '"Use printer offline"');
  assert.match(printerAdvice({ status: 'PaperOut', jobs: 0, offline: false }).title, /out of paper/);
  assert.match(printerAdvice({ status: 'DoorOpen', jobs: 0, offline: false }).title, /lid is open/);
  assert.match(printerAdvice({ status: 'Paused', jobs: 0, offline: false }).steps.join(' '), /Resume/);
  assert.match(printerAdvice({ status: 'Error', jobs: 0, offline: false }).title, /problem/);
  const stuck = printerAdvice({ status: 'Normal', jobs: 3, offline: false });
  assert.equal(stuck.clearJobs, true);
  assert.match(stuck.steps[0], /^3 receipts are waiting in Windows\. Clear them first/);
  assert.match(printerAdvice({ status: 'Offline', jobs: 1, offline: false }).steps[0], /^1 receipt is waiting/);
  const ready = printerAdvice({ status: 'Normal', jobs: 0, offline: false });
  assert.equal(ready.clearJobs, false);
  assert.match(ready.title, /ready, but nothing came out/);
  assert.match(ready.steps.at(-1)!, /printer chosen above/);
  assert.match(printerAdvice({ status: '', jobs: 0, offline: false }).title, /ready/, 'unknown: the plain checks');
});

test('58 mm paper: the receipt fits in 32 characters a line, the shop name in 16 double-width', () => {
  const paid: PaidOrder = {
    number: 1043, total: 1234500, tender: 'cash', tendered: 1500000, change: 265500, paidAt: Date.UTC(2026, 9, 12, 14, 12),
    lines: [{ id: 'a', itemId: 'devilled-chicken', qty: 2, size: 'L', adds: ['full-cheese'], outs: [], unit: 310000 }],
  };
  const shop = { name: "Rasika's Kitchen and Bakery", lines: ['12 Temple Road, Kandy'], footer: 'Thank you! Please come again soon.' };
  const lines = receipt(paid, { shop, cashier: 'Nimal Perera', width: PAPER_CHARS[58] });
  for (const l of lines) assert.ok(l.text.length <= (l.big ? 16 : 32), `too wide for 58 mm: "${l.text}"`);
  assert.match(receiptText(lines, 32), /T O T A L/);
});

test('the cash drawer test opens the drawer and prints nothing', () => {
  assert.deepEqual([...drawerOnly()], [...CMD.init, ...CMD.kick]);
  assert.ok(!drawerOnly().some((b, i, a) => b === 0x1d && a[i + 1] === 0x56), 'no paper cut');
  assert.equal(escpos([], { openDrawer: true }).length > drawerOnly().length, true);
});
