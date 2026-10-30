import { DAY_STARTS_HOUR } from './cashUp.ts';
import { fmt } from './money.ts';
import { clockOffText } from './sync.ts';
import { isNewer } from './version.ts';
import type { Cents } from './types.ts';

/**
 * The developer's /admin: what is wrong at each shop, from what the cloud already has (the shop
 * PC's check-ins, its update report, its sales and its closes). Pure, like insights.ts: facts in,
 * plain sentences out. Each rule speaks only when it matters, and compares a shop with its own
 * usual, so a shop that never opens on Sundays is not "quiet" on a Sunday.
 *
 * Times are Sri Lanka time (UTC+5:30, no summer time), not the computer's: this runs in the cloud.
 */

export type HealthLevel = 'bad' | 'warn';
export interface ShopProblem { level: HealthLevel; text: string }

export interface ShopFacts {
  /** The shop server's last check-in (every copy pass, about every 30 s while online). */
  lastSeenAt: number | null;
  version: string | null;
  update: { phase: string; version: string; at: number } | null;
  /** The newest release, or null if unknown. */
  latest: string | null;
  /** When each payment that still stands was made: the last 8 days, and the same weekday 2, 3 and 4 weeks back. */
  sales: readonly number[];
  /** The last two weeks' closes of the day: the business day's start and counted minus expected cash. */
  closes: readonly { from: number; at: number; difference: Cents }[];
  /** The shop PC's clock minus the cloud's (ms), as it last told us. */
  clockOffMs?: number | null;
  now: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const COLOMBO = 5.5 * HOUR;

/** The business day (5 am to 5 am, Sri Lanka time) that `t` falls in. */
export const businessDayColombo = (t: number): number =>
  Math.floor((t + COLOMBO - DAY_STARTS_HOUR * HOUR) / DAY) * DAY - COLOMBO + DAY_STARTS_HOUR * HOUR;

/** The windows of time `sales` must cover, for the cloud's query. */
export const salesWindows = (now: number): [number, number][] => {
  const today = businessDayColombo(now);
  return [[today - 7 * DAY, now], ...[2, 3, 4].map((k): [number, number] => [today - 7 * k * DAY, today - 7 * k * DAY + DAY])];
};

/** "2:00 pm", Sri Lanka time. */
export const clockColombo = (t: number): string => {
  const d = new Date(t + COLOMBO);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** "40 min", "3 h", "2 days". */
const span = (ms: number): string => {
  const min = Math.round(ms / MIN);
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} days`;
};

const between = (sales: readonly number[], from: number, to: number) => sales.filter((t) => t >= from && t < to).length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/** Usually sells between these times of day: on at least 2 of the same weekday in the last 4 weeks. */
const usuallySells = (sales: readonly number[], from: number, to: number) =>
  [1, 2, 3, 4].filter((k) => between(sales, from - 7 * k * DAY, to - 7 * k * DAY) > 0).length >= 2;

/** Offline: worth saying after 2 h when the shop usually sells in that time, and after a day anyway. */
const offline = (f: ShopFacts): ShopProblem | null => {
  if (f.lastSeenAt === null) return { level: 'warn', text: 'Has not checked in yet' };
  const gone = f.now - f.lastSeenAt;
  if (gone >= 2 * HOUR && usuallySells(f.sales, f.lastSeenAt, f.now)) {
    return { level: 'bad', text: `Offline for ${span(gone)}, in its usual selling hours` };
  }
  if (gone >= DAY) return { level: 'warn', text: `Offline for ${span(gone)}` };
  return null;
};

/** Quiet: today's sales so far against the same weekday's, by the same time, over the last 4 weeks. */
const quiet = (f: ShopFacts): ShopProblem | null => {
  // Sales still on a PC that is offline have not reached the cloud: that is the offline rule's job.
  if (f.lastSeenAt === null || f.now - f.lastSeenAt > 10 * MIN) return null;
  const today = businessDayColombo(f.now);
  const soFar = f.now - today;
  const weeks = [1, 2, 3, 4].map((k) => between(f.sales, today - 7 * k * DAY, today - 7 * k * DAY + soFar));
  if (weeks.filter((n) => n > 0).length < 3) return null; // not enough history for this weekday
  const usual = median(weeks);
  const now = between(f.sales, today, f.now);
  const by = clockColombo(f.now);
  if (now === 0 && usual >= 3) return { level: 'bad', text: `No sales yet today; usually ${usual} by ${by}` };
  if (usual >= 5 && now < usual * 0.4) return { level: 'warn', text: `Quiet: ${now} ${now === 1 ? 'sale' : 'sales'} by ${by}, usually ${usual}` };
  return null;
};

/** Cash: the last three closes all short, or a shop that closes its days now and then skipping several. */
const cash = (f: ShopFacts): ShopProblem[] => {
  const latestPerDay = new Map<number, { from: number; at: number; difference: Cents }>();
  for (const c of f.closes) if ((latestPerDay.get(c.from)?.at ?? -1) < c.at) latestPerDay.set(c.from, c);
  const closes = [...latestPerDay.values()].sort((a, b) => b.from - a.from);
  const out: ShopProblem[] = [];
  const last3 = closes.slice(0, 3);
  if (last3.length === 3 && last3.every((c) => c.difference < 0)) {
    const short = -last3.reduce((s, c) => s + c.difference, 0);
    out.push({ level: 'warn', text: `Cash short at the last 3 closes: Rs ${fmt(short)} in all` });
  }
  if (closes.length) {
    const today = businessDayColombo(f.now);
    const traded = Array.from({ length: 7 }, (_, i) => today - (i + 1) * DAY).filter((d) => between(f.sales, d, d + DAY) > 0);
    const open = traded.filter((d) => !latestPerDay.has(d)).length;
    if (open >= 3) out.push({ level: 'warn', text: `Day not closed on ${open} of the last ${traded.length} trading days` });
  }
  return out;
};

/** The update: one that failed or went back is a problem; a shop behind the newest release is worth knowing. */
const update = (f: ShopFacts): ShopProblem | null => {
  const u = f.update;
  const to = u?.version ? ` to ${u.version}` : '';
  if (u?.phase === 'failed') return { level: 'bad', text: `Update${to} failed ${span(f.now - u.at)} ago` };
  if (u?.phase === 'back') return { level: 'bad', text: `Update${to} went back ${span(f.now - u.at)} ago` };
  if (f.latest && f.version && isNewer(f.latest, f.version)) return { level: 'warn', text: `Runs ${f.version}; ${f.latest} is out` };
  return null;
};

/** The PC's clock: an hour or more moves menu hours and the business day, so it is bad; a few minutes is a warning. */
const clock = (f: ShopFacts): ShopProblem | null => {
  const off = clockOffText(f.clockOffMs);
  return off ? { level: Math.abs(f.clockOffMs!) >= HOUR ? 'bad' : 'warn', text: `PC clock ${off}` } : null;
};

/** Everything wrong at one shop, worst first. */
export function shopProblems(f: ShopFacts): ShopProblem[] {
  const all = [offline(f), quiet(f), ...cash(f), update(f), clock(f)].filter((p): p is ShopProblem => p !== null);
  return [...all.filter((p) => p.level === 'bad'), ...all.filter((p) => p.level === 'warn')];
}

/** How a shop's problems rank it in the list: 0 = something bad, 1 = only warnings, 2 = fine. */
export const severity = (problems: readonly ShopProblem[]): number =>
  problems.some((p) => p.level === 'bad') ? 0 : problems.length ? 1 : 2;
