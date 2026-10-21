import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dayCount } from '../src/domain/cashUp.ts';
import type { SyncEvent } from '../src/domain/sync.ts';
import { dailyReports, defaultReportsDir, reportName } from './dailyReport.ts';
import { pdf } from './pdf.ts';
import { memoryStore } from './store.ts';

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m).getTime();
const actor = { id: 'm', name: 'Ravi', role: 'manager' as const };
/** The page draws this text (as the PDF writes it: brackets escaped). */
const shows = (file: string, text: string) => assert.ok(file.includes(`(${text.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj`), text);
const paid = (id: string, when: number, total: number): SyncEvent =>
  ({ id, shopId: 'shop-a', type: 'order.paid', at: when, actor, orderNumber: 1001, total, tender: 'cash', tendered: total });

test('the PDF is well formed: every object where the index says, text in the built-in fonts', () => {
  const file = pdf([{ texts: [{ x: 56, y: 80, text: 'Rasika (Galle) \\ café ශ්‍රී', size: 12 }] }], 'Test').toString('latin1');
  assert.ok(file.startsWith('%PDF-1.4\n') && file.endsWith('%%EOF\n'));
  const xref = Number(/startxref\n(\d+)/.exec(file)![1]);
  assert.ok(file.slice(xref).startsWith('xref'));
  const offsets = [...file.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(file.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.match(file, /\(Rasika \\\(Galle\\\) \\\\ caf\xe9 \?+\) Tj/); // escaped; Sinhala cannot be drawn: "?"
  assert.match(file, /\/BaseFont \/Helvetica-Bold/);
});

test('daily reports: a PDF the moment the day is closed; after 5 am one from the sales if nobody closed; none for a day with no sales', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-reports-'));
  try {
    const store = memoryStore();
    const { device } = await store.addDevice('shop-a', 'Shop A', 'counter');
    let now = at(22, 45);
    const reports = dailyReports({ store, dir, tenantId: () => 'shop-a', shop: () => ({ name: "Rasika's Kitchen", place: 'Galle' }), now: () => now });

    const sale = paid('p1', at(12), 150000);
    const count = dayCount([sale], at(5), at(22, 40));
    reports.onEvents([sale, { id: 'c1', shopId: 'shop-a', type: 'day.closed', at: at(22, 41), actor, orderNumber: 0, from: at(5), to: at(22, 40), float: 500000, counted: 630000, count }]);
    const closed = readFileSync(join(dir, '2026-10-21 daily report.pdf'), 'latin1');
    shows(closed, 'Difference');
    shows(closed, 'Rs 200 short');
    shows(closed, 'Closed by Ravi at 22:41');

    // The next morning: the closed day already has its PDF, so it is left alone.
    now = at(6, 0, 22);
    assert.equal(await reports.catchUp(), null);

    // Thursday: sales, nobody closed. Friday after 5 am the shop PC writes it from the sales.
    await store.push(device, [paid('p2', at(11, 0, 22), 80000), paid('p3', at(2, 0, 23), 20000), paid('p4', at(6, 0, 23), 99900)], at(6, 0, 23));
    now = at(5, 30, 23);
    const path = await reports.catchUp();
    assert.equal(path, join(dir, reportName(at(5, 0, 22))));
    const auto = readFileSync(path!, 'latin1');
    shows(auto, 'Total (2 orders)'); // 11 am and the 2 am sale; not Friday's
    shows(auto, 'Not counted');
    assert.match(auto, /Nobody closed the day/);

    // Saturday: the shop was shut. No empty report.
    now = at(5, 30, 25);
    assert.equal(await reports.catchUp(), null);
    assert.equal(readdirSync(dir).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("on Windows the reports go where the counter finds them: Public Documents", () => {
  assert.match(defaultReportsDir('C:\\ProgramData\\CheesyBeez', 'win32'), /Documents[\\/]Lume POS daily reports$/);
  assert.equal(existsSync(defaultReportsDir('/nowhere', 'linux')), false);
});
