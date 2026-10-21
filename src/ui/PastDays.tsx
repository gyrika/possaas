import { useEffect, useMemo, useState } from 'react';
import { pastDays, type PastDay } from '../domain/cashUp.ts';
import { fmt } from '../domain/money.ts';
import type { SyncEvent } from '../domain/sync.ts';

/**
 * Owner view → Past days. Serves the owner looking back: they know roughly which day they
 * mean; the single next thing is that day's full report. One list, newest first: each day's
 * takings and whether the cash was right; a tap opens the day, Back returns to the list.
 */
const dayName = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const status = (d: PastDay): string =>
  d.close ? `${d.difference === 'Exact' ? 'Cash exact' : `Cash ${d.difference}`} · closed by ${d.close.actor.name}` : 'Not closed';

export function PastDays({ events, now, onClose }: { events: readonly SyncEvent[]; now: number; onClose: () => void }) {
  const days = useMemo(() => pastDays(events, now), [events, now]);
  const [open, setOpen] = useState<PastDay | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (open) setOpen(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet owner-sheet" role="dialog" aria-modal="true" aria-label={open ? open.report.day : 'Past days'}>
        <div className="sheet__body">
          <div className="sheet__title">
            <h1>{open ? open.report.day : 'Past days'}</h1>
            {open
              ? <button type="button" className="linkbtn" onClick={() => setOpen(null)} autoFocus>Back</button>
              : <button type="button" className="linkbtn" onClick={onClose} autoFocus>Close</button>}
          </div>
          {open ? (
            <>
              {open.report.sections.map((s) => (
                <section key={s.title} aria-label={s.title}>
                  <h2 className="pastdays__head">{s.title}</h2>
                  <ul className="owner-list">
                    {s.rows.map((r) => (
                      <li key={r.label} className={r.strong ? 'pastdays__strong' : undefined}>
                        <span className="owner-list__main">{r.label}</span>
                        <span className="owner-list__amount num">{r.value}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p className="owner-list__sub">{open.report.closed}.</p>
            </>
          ) : days.length === 0 ? (
            <p className="owner__calm">No days yet. Each day appears here once it has sales.</p>
          ) : (
            <ul className="owner-list">
              {days.map((d) => (
                <li key={d.from}>
                  <button type="button" className="pastdays__day" onClick={() => setOpen(d)}>
                    <span className="owner-list__main">
                      <span>{dayName(d.from)}</span>
                      <span className={`owner-list__sub${d.difference && d.difference !== 'Exact' ? ' pastdays__off' : ''}`}>{status(d)}</span>
                    </span>
                    <span className="owner-list__amount num">{fmt(d.count.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
