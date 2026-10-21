import { useMemo, useState } from 'react';
import { TENDER_NAMES, businessDayStart, cashUpLines, dayCount, difference, expectedCash } from '../domain/cashUp.ts';
import { canManage, type Actor } from '../domain/auth.ts';
import { fmt } from '../domain/money.ts';
import type { Cents } from '../domain/types.ts';
import { currentCashier } from '../services/auth.ts';
import { canPrint, printLines } from '../services/printer.ts';
import { receiptWidth, shopHeader } from '../services/shop.ts';
import { appendEvent, readAll } from './eventLog.ts';
import { OwnerNav } from './OwnerNav.tsx';
import { PinSheet } from './PinSheet.tsx';

/**
 * Close the day (#close). Serves the owner or manager at closing, counting the drawer: they know
 * the cash they started with; the single next thing is to type what they counted and see short,
 * over or exact, then close the day: the close is kept (a `day.closed` event), the owner sees the
 * report in the Owner view and the shop PC saves it as a PDF. Closing again replaces it.
 */
const toCents = (text: string): Cents | null => {
  const t = text.replace(/[,\s]/g, '');
  if (!t) return 0;
  return /^\d{1,7}$/.test(t) ? Number(t) * 100 : null;
};

export function CloseDay({ onBack }: { onBack: () => void }) {
  const [now] = useState(() => Date.now());
  const day = useMemo(() => dayCount(readAll(), businessDayStart(now), now), [now]);
  const [float, setFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [printed, setPrinted] = useState<'' | 'printed' | 'failed'>('');
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [askPin, setAskPin] = useState(false);
  const floatCents = toCents(float);
  const countedCents = counted.trim() ? toCents(counted) : null;
  const expected = expectedCash(day, floatCents ?? 0);
  const paidWays = (['cash', 'transfer', 'card', 'qr', 'comp'] as const).filter((t) => day.byTender[t].orders);

  const canClose = floatCents !== null && countedCents !== null;
  /** A manager or the owner signs the close; anyone else at the screen is asked for one's PIN. */
  const close = (by: Actor = currentCashier()) => {
    if (floatCents === null || countedCents === null) return;
    if (!canManage(by)) { setAskPin(true); return; }
    const at = Date.now();
    appendEvent({ type: 'day.closed', at, actor: by, orderNumber: 0, from: day.from, to: day.to, float: floatCents, counted: countedCents, count: day });
    setClosedAt(at);
  };

  const print = async () => {
    const lines = cashUpLines(day, { shop: shopHeader(), float: floatCents ?? 0, counted: countedCents, by: currentCashier().name, width: receiptWidth() });
    setPrinted((await printLines(lines)) === 'printed' ? 'printed' : 'failed');
  };

  return (
    <div className="owner">
      <OwnerNav current="close" onRegister={onBack} />
      <main className="owner__main closeday" aria-label="Close the day">
        <h1 className="menuv__title">Close the day</h1>
        <p className="menuv__lead">
          Since {new Date(day.from).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.
          Check nothing is still waiting to pay on the Register first.
        </p>
        <dl className="closeday__list">
          {paidWays.map((t) => (
            <div key={t}><dt>{TENDER_NAMES[t]} <span>{day.byTender[t].orders} {day.byTender[t].orders === 1 ? 'order' : 'orders'}</span></dt><dd className="num">{fmt(day.byTender[t].cents)}</dd></div>
          ))}
          <div className="closeday__total"><dt>Total <span>{day.orders} {day.orders === 1 ? 'order' : 'orders'}</span></dt><dd className="num">{fmt(day.total)}</dd></div>
          <div><dt>Items cancelled</dt><dd className="num">{day.voids}</dd></div>
          <div><dt>Discounts and free orders</dt><dd className="num">{day.discounts}</dd></div>
        </dl>

        <section className="closeday__count" aria-label="Count the cash">
          <label className="setup__field"><span>Cash in the drawer at opening</span>
            <input className="num" inputMode="numeric" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" /></label>
          <p className="closeday__expected">Cash expected now <b className="num">Rs {fmt(expected)}</b></p>
          <label className="setup__field"><span>Cash counted now</span>
            <input className="num" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Count it, then type it" autoFocus /></label>
          {(floatCents === null || (counted.trim() && countedCents === null)) && <p className="setup__error" role="alert">Whole rupees, like 12500.</p>}
          {countedCents !== null && floatCents !== null && (
            <p className={`closeday__diff closeday__diff--${countedCents === expected ? 'ok' : 'off'}`} role="status">{difference(countedCents, expected)}</p>
          )}
        </section>

        <p className="setup__row">
          <button type="button" className="cta closeday__print" disabled={!canClose} onClick={() => close()}>{closedAt ? 'Close again' : 'Close the day'}</button>
          {canPrint() && <button type="button" className="insight__action" onClick={() => void print()}>Print it</button>}
        </p>
        {closedAt && (
          <p className="closeday__done" role="status">
            Closed at {new Date(closedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. The owner sees the report in the Owner view, and a PDF is saved on the shop PC.
          </p>
        )}
        {printed && <p className="closeday__done" role="status">{printed === 'printed' ? 'Sent to the printer.' : 'The printer did not take it.'}</p>}
      </main>
      {askPin && <PinSheet purpose="A manager signs off the cash" onClose={() => setAskPin(false)} onUnlock={(manager) => { setAskPin(false); close(manager); }} />}
    </div>
  );
}
