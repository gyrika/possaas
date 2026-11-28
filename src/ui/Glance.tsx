import { useState, type CSSProperties } from 'react';
import type { DayPartId, Glance } from '../domain/glance.ts';
import { fmt } from '../domain/money.ts';

/**
 * Today (owner, 2026-11-28): how much, when, and what sold, on one screen with no scrolling.
 * The total first; one day bar split into Morning, Lunch and Evening by what each sold; then
 * every dish sold today, its sizes counted together, most sold first. Tapping a part of the day
 * (on the bar or its label) shows that part's total and dishes; tapping it again shows the whole
 * day. No To do, Counter, Money, hourly chart or black screen: the owner asked for a minimal page.
 */
const rs = (c: number) => `Rs ${fmt(Math.round(c / 100) * 100)}`;
const count = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const bills = (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'}`;
/** Rows shown before "+ N more": two columns of 12 fit the counter PC without scrolling. */
const SHOWN = 24;

export function GlanceView({ glance: g }: { glance: Glance }) {
  const [pick, setPick] = useState<DayPartId | null>(null);
  const [all, setAll] = useState(false);
  const part = g.parts.find((p) => p.id === pick) ?? null;
  const toggle = (id: DayPartId) => { setPick((was) => (was === id ? null : id)); setAll(false); };

  const rows = g.items
    .map((i) => ({ key: i.key, name: i.name, qty: part ? i.byPart[part.id] : i.qty }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  const top = rows[0]?.qty ?? 1;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const sold = g.parts.reduce((n, p) => n + p.sales, 0);

  return (
    <div className="today">
      <section className="today__hero" aria-label="Sales today">
        <div className="today__total">
          <span className="today__big num">{rs(part ? part.sales : g.sales)}</span>
          <span className="today__bills num">{part ? `${bills(part.orders)} · ${part.label.toLowerCase()}` : bills(g.orders)}</span>
        </div>

        <div className="today__bar" aria-hidden="true">
          {sold > 0 && g.parts.filter((p) => p.sales > 0).map((p) => (
            <button key={p.id} type="button" tabIndex={-1} className={`today__seg today__seg--${p.id}${pick && pick !== p.id ? ' today__dim' : ''}`}
              style={{ flexGrow: p.sales } as CSSProperties} onClick={() => toggle(p.id)}>
              {Math.round((p.sales / sold) * 100)}%
            </button>
          ))}
        </div>

        <div className="today__parts">
          {g.parts.map((p) => (
            <button key={p.id} type="button" className={`today__part${pick && pick !== p.id ? ' today__dim' : ''}`}
              aria-pressed={pick === p.id} disabled={!p.begun} onClick={() => toggle(p.id)}
              aria-label={`${p.label}, ${p.span}: ${p.begun ? `${rs(p.sales)}, ${bills(p.orders)}` : 'later'}`}>
              <span className="today__part-label"><i className={`today__key today__seg--${p.id}`} aria-hidden="true" />{p.label} <span className="today__part-span">{p.span}</span></span>
              <span className="today__part-rs num">{p.begun ? rs(p.sales) : 'Later'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="today__sold" aria-label="Sold today">
        <div className="today__head">
          <span className="today__title">{part ? `Sold in the ${part.label.toLowerCase()}` : 'Sold today'}</span>
          {rows.length > 0 && <span className="today__hint">{part ? 'Tap it again for the whole day' : 'Tap a part of the day to see its dishes'}</span>}
        </div>
        {rows.length === 0 ? <p className="today__calm">Nothing sold {part ? `in the ${part.label.toLowerCase()}` : 'yet today'}.</p> : (
          <ul className="today__list">
            {shown.map((r) => (
              <li key={r.key} className="today__row" aria-label={`${r.name}: ${count(r.qty)}`}>
                <span className="today__qty num">{count(r.qty)}</span>
                <span className="today__dish">
                  <span className="today__name">{r.name}</span>
                  <span className="today__track" aria-hidden="true"><span style={{ width: `${(r.qty / top) * 100}%` }} /></span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > SHOWN && (
          <button type="button" className="today__more" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `+ ${rows.length - SHOWN} more`}
          </button>
        )}
      </section>
    </div>
  );
}

/** The shape of what is coming while the history loads: never a spinner. */
export function GlanceSkeleton() {
  return (
    <div className="today" aria-busy="true" aria-label="Loading">
      <div className="today__hero skeleton" style={{ height: 180 }} />
      <div className="today__sold skeleton" style={{ height: 260 }} />
    </div>
  );
}
