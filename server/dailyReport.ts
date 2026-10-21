import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_NAME } from '../src/domain/brand.ts';
import { businessDayStart, closesFrom, dayCount, dayReport, type DayClosedEvent, type DayReport } from '../src/domain/cashUp.ts';
import type { SyncEvent } from '../src/domain/sync.ts';
import { A4, pdf, type PdfPage, type PdfText } from './pdf.ts';
import type { EventStore } from './store.ts';

/**
 * The daily report as a PDF on the shop PC, one file per business day, for the owner to keep,
 * print or send on. Written the moment the day is closed (Close the day), again if it is closed
 * again; and if nobody closed it, by the shop PC itself after 5 am, from the sales alone.
 * Windows: the Public Documents folder, where everyone at the counter can find it.
 */
export const defaultReportsDir = (dataDir: string, platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32'
    ? join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Documents', `${PRODUCT_NAME} daily reports`)
    : join(dataDir, 'daily-reports');

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-10-21 daily report.pdf": sorts by date in any folder view. */
export const reportName = (dayStart: number): string => {
  const d = new Date(dayStart);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} daily report.pdf`;
};

const LEFT = 56;
const RIGHT = A4.width - 56;

/** One A4 page: the shop, the day, then Sales, Changes and Cash as label ... amount rows. */
export function reportPdf(report: DayReport, shop: { name: string; place: string }, madeAt: number): Buffer {
  const texts: PdfText[] = [];
  const lines: PdfPage['lines'] = [];
  let y = 80;
  texts.push({ x: LEFT, y, text: shop.name, size: 22, bold: true });
  if (shop.place) texts.push({ x: LEFT, y: (y += 20), text: shop.place, size: 11, grey: true });
  texts.push({ x: LEFT, y: (y += 40), text: 'Daily report', size: 16, bold: true });
  texts.push({ x: RIGHT, y, text: report.day, size: 12, right: true });
  texts.push({ x: LEFT, y: (y += 18), text: report.period, size: 10, grey: true });
  for (const s of report.sections) {
    texts.push({ x: LEFT, y: (y += 38), text: s.title, size: 12, bold: true });
    lines.push({ x1: LEFT, x2: RIGHT, y: (y += 8) });
    for (const r of s.rows) {
      y += 22;
      texts.push({ x: LEFT, y, text: r.label, size: 11, bold: r.strong });
      texts.push({ x: RIGHT, y, text: r.value, size: 11, bold: r.strong, right: true });
    }
  }
  texts.push({ x: LEFT, y: (y += 44), text: report.closed.startsWith('Nobody') ? `${report.closed}: saved by the shop PC after 5 am` : report.closed, size: 11 });
  const made = new Date(madeAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  texts.push({ x: LEFT, y: A4.height - 40, text: `Amounts in rupees · ${PRODUCT_NAME} · saved ${made}`, size: 9, grey: true });
  return pdf([{ texts, lines }], `${shop.name} daily report, ${report.day}`);
}

export const closeReport = (c: DayClosedEvent): DayReport =>
  dayReport(c.count, { float: c.float, counted: c.counted, by: c.actor.name, closedAt: c.at });

export interface DailyReportsOptions {
  store: EventStore;
  dir: string;
  /** This PC's shop (empty until the wizard names it). */
  tenantId: () => string | undefined;
  shop: () => { name: string; place: string } | null;
  now?: () => number;
}

const HOUR_MS = 60 * 60_000;

export function dailyReports({ store, dir, tenantId, shop, now = Date.now }: DailyReportsOptions) {
  const save = (dayStart: number, report: DayReport): string | null => {
    const s = shop();
    if (!s) return null;
    try {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, reportName(dayStart));
      writeFileSync(path, reportPdf(report, s, now()));
      return path;
    } catch (e) {
      // A locked file (open in a PDF reader) or a full disk must never stop the sale that came in with it.
      console.warn(`Daily report not saved: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  /** Everything this shop recorded from `from` on (the store is ordered by arrival, not by time). */
  const eventsSince = async (tenant: string, from: number): Promise<SyncEvent[]> => {
    const out: SyncEvent[] = [];
    let after = 0;
    for (;;) {
      const batch = await store.pull(tenant, after, 1000);
      for (const s of batch) if (s.event.at >= from) out.push(s.event);
      if (batch.length < 1000) return out;
      after = batch[batch.length - 1].seq;
    }
  };

  /** Yesterday's business day, if its PDF is not there yet: from its close, or from the sales alone. */
  const catchUp = async (): Promise<string | null> => {
    const tenant = tenantId();
    if (!tenant || !shop()) return null;
    const to = businessDayStart(now());
    const from = businessDayStart(to - 1);
    if (existsSync(join(dir, reportName(from)))) return null;
    const events = (await eventsSince(tenant, from)).filter((e) => e.at < to || e.type === 'day.closed');
    const closed = closesFrom(events).find((c) => c.from === from);
    if (closed) return save(from, closeReport(closed));
    const count = dayCount(events, from, to);
    // A day with no sales (the shop was shut, or the PC was off) gets no empty report.
    if (!count.orders) return null;
    return save(from, dayReport(count, { float: null, counted: null, by: null, closedAt: null }));
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = () => { catchUp().catch((e) => console.warn(`Daily report check failed: ${e instanceof Error ? e.message : String(e)}`)); };
  return {
    dir,
    /** New events stored: a close of the day becomes its PDF at once. */
    onEvents(events: readonly SyncEvent[]): void {
      for (const c of closesFrom(events)) save(c.from, closeReport(c));
    },
    catchUp,
    /** Checks now (the PC may have been off at 5 am), then every hour. */
    start(): void {
      tick();
      timer = setInterval(tick, HOUR_MS);
      timer.unref?.();
    },
    stop(): void { if (timer) clearInterval(timer); timer = null; },
  };
}
