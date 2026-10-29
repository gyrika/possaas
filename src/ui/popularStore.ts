import { businessDayStart } from '../domain/cashUp.ts';
import { setPopularScores } from '../domain/menu.ts';
import { addScores, rollScores, soldCounts, type Scores } from '../domain/popularity.ts';
import { readEvents } from './eventLog.ts';
import { storageKey } from './storage.ts';

/**
 * Keeps "Popular" ranked by this shop's sales. The event log keeps only two days, so each
 * finished business day is rolled into a small saved score once (keyed by its date, so doing
 * it twice changes nothing); today's sales add on top. The Register calls `refreshPopular`
 * only while no order is open, so buttons never move under the cashier's finger.
 */
const KEY = () => storageKey('popular.v0');
const DAY_MS = 24 * 60 * 60_000;
/** Older than this, a score has faded to nothing anyway (0.8^60). */
const MAX_DAYS = 60;

interface Saved { day: number; scores: Scores }

const read = (): Saved | null => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY()) ?? 'null') as Saved | null;
    return s && typeof s.day === 'number' && s.scores && typeof s.scores === 'object' ? s : null;
  } catch {
    return null;
  }
};
const write = (s: Saved): void => {
  try { localStorage.setItem(KEY(), JSON.stringify(s)); } catch { /* storage full/blocked: Popular just re-learns */ }
};

export const refreshPopular = (now = Date.now()): void => {
  const events = readEvents();
  const today = businessDayStart(now);
  // First run: start from the oldest day the log still has, so recent sales count at once.
  let { day, scores } = read() ?? { day: businessDayStart(today - 2 * DAY_MS), scores: {} };
  for (let i = 0; day < today && i < MAX_DAYS; i++) {
    const next = businessDayStart(day + DAY_MS + 60 * 60_000);
    scores = rollScores(scores, soldCounts(events, day, next));
    day = next;
  }
  if (day < today) day = today; // the PC was off for months: everything has faded
  write({ day, scores });
  setPopularScores(addScores(scores, soldCounts(events, today, Infinity)));
};
