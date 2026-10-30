import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDayColombo, clockColombo, salesWindows, severity, shopProblems, type ShopFacts } from './shopHealth.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Wednesday 21 October 2026, 2:00 pm in Sri Lanka. */
const NOW = Date.UTC(2026, 9, 21, 8, 30);
const TODAY = businessDayColombo(NOW); // 5 am that morning

/** A steady shop: `perDay` sales between 11 am and 1 pm, every day for five weeks. */
const steady = (perDay: number, skipToday = false): number[] =>
  Array.from({ length: 36 }, (_, back) => back).flatMap((back) => back === 0 && skipToday ? [] :
    Array.from({ length: perDay }, (_, i) => TODAY - back * DAY + 6 * HOUR + i * (2 * HOUR / perDay)))
    .filter((t) => t < NOW);

const facts = (f: Partial<ShopFacts> = {}): ShopFacts => ({
  lastSeenAt: NOW - 20_000, version: '0.1.2', update: null, latest: '0.1.2', sales: steady(10), closes: [], now: NOW, ...f,
});
const texts = (f: Partial<ShopFacts>) => shopProblems(facts(f)).map((p) => `${p.level}: ${p.text}`);

test('times are Sri Lanka time, and the business day starts at 5 am', () => {
  assert.equal(clockColombo(NOW), '2:00 pm');
  assert.equal(new Date(TODAY).toISOString(), '2026-10-20T23:30:00.000Z');
  assert.equal(businessDayColombo(TODAY + DAY - 1), TODAY, '4:59 am the next morning is still today');
  assert.equal(salesWindows(NOW)[0][0], TODAY - 7 * DAY);
});

test('a healthy shop has nothing to say', () => {
  assert.deepEqual(texts({}), []);
  assert.equal(severity([]), 2);
});

test('offline: at once during its usual selling hours, otherwise only after a day', () => {
  assert.deepEqual(texts({ lastSeenAt: NOW - 3 * HOUR }), ['bad: Offline for 3 h, in its usual selling hours']);
  // Off from 7:30 to 10:30 am: the shop never sells before 11.
  assert.deepEqual(texts({ lastSeenAt: TODAY + 6.5 * HOUR - 4 * HOUR, now: TODAY + 5.5 * HOUR }), [], 'early morning: not its hours');
  assert.deepEqual(texts({ lastSeenAt: NOW - 30 * HOUR, sales: [] }), ['warn: Offline for 30 h']);
  assert.deepEqual(texts({ lastSeenAt: null, sales: [] }), ['warn: Has not checked in yet']);
});

test('quiet: no sales, or far fewer than the same weekday usually has by now', () => {
  assert.deepEqual(texts({ sales: steady(10, true) }), ['bad: No sales yet today; usually 10 by 2:00 pm']);
  const three = steady(10, true).concat([TODAY + 6 * HOUR, TODAY + 6.2 * HOUR, TODAY + 6.4 * HOUR]);
  assert.deepEqual(texts({ sales: three }), ['warn: Quiet: 3 sales by 2:00 pm, usually 10']);
  assert.deepEqual(texts({ sales: steady(10, true), now: TODAY + 5 * HOUR }), [], '10 am: the shop does not sell before 11');
  assert.deepEqual(texts({ sales: [TODAY - 7 * DAY + 6 * HOUR] }), [], 'one past week is not enough history');
  assert.deepEqual(texts({ sales: steady(10, true), lastSeenAt: NOW - 30 * MIN }), [], 'offline for 30 min: its sales may be on the PC');
});

test('cash: three short closes in a row, and days left unclosed by a shop that closes', () => {
  const close = (back: number, difference: number, at = TODAY - back * DAY + 17 * HOUR) => ({ from: TODAY - back * DAY, at, difference });
  assert.deepEqual(texts({ closes: [close(1, -20000), close(2, -5000), close(3, -10000), close(4, 0), close(5, 0), close(6, 0), close(7, 0)] }),
    ['warn: Cash short at the last 3 closes: Rs 350 in all']);
  assert.deepEqual(texts({ closes: [close(1, -20000), close(1, 0, TODAY - DAY + 18 * HOUR), close(2, -5000), close(3, -10000), close(4, 0), close(5, 0), close(6, 0), close(7, 0)] }),
    [], 'closed again, and exact the second time');
  assert.deepEqual(texts({ closes: [close(1, 0), close(2, 0), close(5, 0), close(6, 0)] }), ['warn: Day not closed on 3 of the last 7 trading days']);
  assert.deepEqual(texts({ closes: [] }), [], 'a shop that never closes its days is not told off for it');
});

test('updates: failed or gone back is bad; behind the newest release is a warning', () => {
  assert.deepEqual(texts({ update: { phase: 'failed', version: '0.1.3', at: NOW - 2 * HOUR } }), ['bad: Update to 0.1.3 failed 2 h ago']);
  assert.deepEqual(texts({ update: { phase: 'back', version: '0.1.3', at: NOW - 40 * MIN } }), ['bad: Update to 0.1.3 went back 40 min ago']);
  assert.deepEqual(texts({ version: '0.1.1' }), ['warn: Runs 0.1.1; 0.1.2 is out']);
  assert.deepEqual(texts({ version: '0.1.1', latest: null }), [], 'the newest release unknown: say nothing');
});

test('the worst comes first', () => {
  const p = shopProblems(facts({ version: '0.1.1', lastSeenAt: NOW - 3 * HOUR }));
  assert.deepEqual(p.map((x) => x.level), ['bad', 'warn']);
  assert.equal(severity(p), 0);
  assert.equal(severity(p.slice(1)), 1);
});

test('the PC clock: an hour or more off is bad, minutes a warning, close enough nothing', () => {
  assert.deepEqual(texts({ clockOffMs: -2 * HOUR }), ['bad: PC clock 2 h behind']);
  assert.deepEqual(texts({ clockOffMs: 12 * MIN }), ['warn: PC clock 12 min ahead']);
  assert.deepEqual(texts({ clockOffMs: 2 * MIN }), []);
});
