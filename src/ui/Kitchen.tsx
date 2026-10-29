import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  cancelledToServe, cookTimeMs, elapsedLabel, forStation, needsAttention, queue, servingRows, ticketLines, toServe, urgency, type KitchenTicket, type LineView,
} from '../domain/kitchen.ts';
import { kitchenStation } from '../services/pairing.ts';
import { usePayFirst } from '../services/shop.ts';
import type { Station } from '../domain/types.ts';
import { chime, useSoundBlocked } from './chime.ts';
import { recordKitchen, recordServed, useKitchenTickets } from './kitchenStore.ts';
import { SyncSign } from './SyncSign.tsx';

/**
 * Kitchen display. Serves the cook: knows the menu, hands busy, standing back
 * from the screen. The only question it answers is "what do I make next?":
 * one column, oldest first, colour = how long it has waited, one tap Done.
 * It is the kitchen's ONLY channel (no printed tickets), so arrivals, changes
 * and cancellations chime and flash until someone taps the ticket.
 */

export const useNow = (everyMs: number): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
};

/** The kitchen is always true black, whatever the device theme. */
const useDarkTheme = () => {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => { if (before) root.dataset.theme = before; else delete root.dataset.theme; };
  }, []);
};

/** A kitchen screen that sleeps mid-rush is useless: keep it awake where supported. */
const useWakeLock = () => {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const request = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      navigator.wakeLock.request('screen').then((l) => { if (live) lock = l; else void l.release(); }, () => {});
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', request);
      void lock?.release();
    };
  }, []);
};

/** One item. `struck` = the version that no longer applies, in red. */
function LineBody({ v, struck = false, showQty = false }: { v: LineView; struck?: boolean; showQty?: boolean }) {
  const qty = (showQty || v.qty > 1) && <b className="num">{v.qty} × </b>;
  if (struck) {
    return (
      <s className="ticket__struck">
        <span className="ticket__name">{qty}{v.name}</span>
        {v.detail && <span className="ticket__detail">{v.detail}</span>}
      </s>
    );
  }
  return (
    <>
      <span className="ticket__name">{qty}{v.name}</span>
      {v.detail && <span className="ticket__detail">{v.detail}</span>}
      {v.outs.length > 0 && <span className="ticket__outs">{v.outs.join(' · ')}</span>}
      {v.note && <span className="ticket__note">“{v.note}”</span>}
    </>
  );
}

interface ScreenProps {
  /** Shown when the Kitchen shares the counter PC with the Register. */
  onBack?: () => void;
  /** The counter showing one kitchen of a shop with two; otherwise this screen's own (its pairing). */
  station?: Station;
  /** A kitchen login on the counter switches user here (F4). */
  onSwitch?: () => void;
}

/** Every arrival, change or cancellation chimes once; it keeps flashing until tapped. */
const useArrivalChime = (open: KitchenTicket[]) => {
  const lastAlert = useRef(0);
  const latestAlert = Math.max(0, ...open.filter(needsAttention).map((t) => t.alertAt));
  useEffect(() => {
    if (latestAlert > lastAlert.current) chime();
    lastAlert.current = Math.max(lastAlert.current, latestAlert);
  }, [latestAlert]);
};

/** An Undo that offers itself for six seconds, also on Ctrl+Z. */
const useUndo = <T,>(onUndo: (last: T) => void) => {
  const [last, setLast] = useState<T | null>(null);
  const undo = useCallback(() => {
    if (last === null) return;
    onUndo(last);
    setLast(null);
  }, [last, onUndo]);
  useEffect(() => {
    if (last === null) return;
    const t = setTimeout(() => setLast(null), 6000);
    return () => clearTimeout(t);
  }, [last]);
  return { last, setLast, undo };
};

function Screen({ title, now, onBack, onSwitch, children }: Omit<ScreenProps, 'station'> & { title: string; now: number; children: ReactNode }) {
  const soundBlocked = useSoundBlocked();
  useDarkTheme();
  useWakeLock();
  return (
    <div className="kitchen">
      <header className="kitchen__head">
        <h1>{title}</h1>
        <span className="kitchen__right">
          <SyncSign />
          <time className="kitchen__clock num">
            {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </time>
          {onBack && (
            <button type="button" className="corner__key" onClick={onBack}>Register <kbd>Esc</kbd></button>
          )}
          {onSwitch && (
            <button type="button" className="corner__key" onClick={onSwitch}>Switch user <kbd>F4</kbd></button>
          )}
        </span>
      </header>

      {soundBlocked && (
        // Browsers block sound until the page is tapped once; the tap itself turns it on.
        <button type="button" className="kitchen__sound">Sound is off · tap to turn on</button>
      )}
      {children}
    </div>
  );
}

/** Space acts on the top row, Ctrl+Z undoes, Esc goes back. A focused button keeps Space for itself. */
const useKitchenKeys = (onSpace: () => void, undo: () => void, onBack?: () => void) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && onBack) { e.preventDefault(); onBack(); return; }
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); onSpace(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
};

/**
 * A shop with two kitchens has a screen in each: it shows that kitchen's orders only, and
 * says which kitchen it is. A screen set to neither shows both.
 */
const STATION_NAME: Record<Station, string> = { left: 'Left kitchen', right: 'Right kitchen' };
const useStationTickets = (shown?: Station): { tickets: KitchenTicket[]; station: Station | null } => {
  const station = shown ?? kitchenStation();
  return { tickets: forStation(useKitchenTickets(), station), station };
};

/** On a screen that shows both kitchens, which one a ticket went to. Neutral: colour is urgency only. */
function StationTag({ t, station }: { t: { station?: Station }; station: Station | null }) {
  if (station || !t.station) return null;
  return <span className="ticket__tag ticket__tag--station">{t.station === 'left' ? '← Left' : 'Right →'}</span>;
}

/** A restaurant cooks to tickets; a pay-first counter hands paid portions over from a serving list. */
export function Kitchen(props: ScreenProps = {}) {
  return usePayFirst() ? <Serving {...props} /> : <Tickets {...props} />;
}

function Tickets({ onBack, onSwitch, station: shown }: ScreenProps) {
  const { tickets, station } = useStationTickets(shown);
  const now = useNow(1000);
  const open = queue(tickets);
  useArrivalChime(open);
  const { last: done, setLast: setDone, undo } = useUndo<{ id: string; number: number }>(
    useCallback((d) => recordKitchen('kitchen.unbumped', d), []),
  );

  const markDone = (id: string, number: number) => {
    recordKitchen('kitchen.bumped', { id, number });
    setDone({ id, number });
    if (navigator.vibrate) navigator.vibrate(8);
  };

  // Space = the oldest ticket is done.
  useKitchenKeys(() => { if (open[0]) markDone(open[0].id, open[0].number); }, undo, onBack);

  return (
    <Screen title={station ? STATION_NAME[station] : 'Kitchen'} now={now} onBack={onBack} onSwitch={onSwitch}>
      <main className="kitchen__list" aria-label="Orders to make">
        {open.length === 0 && <p className="kitchen__empty">No orders waiting</p>}
        {open.map((t) => {
          const elapsed = now - t.firedAt;
          const name = `Order ${t.number}${t.addOn ? ', added items' : ''}${t.changed ? ', changed' : ''}`;
          const alerting = needsAttention(t);
          return (
            <article
              key={t.id}
              className={`ticket ticket--${urgency(elapsed, cookTimeMs(t))}${alerting ? ' ticket--alert' : ''}`}
              aria-label={name}
            >
              {alerting && (
                // The whole card is the tap target: hands are busy, aim is rough.
                <button
                  type="button"
                  className="ticket__ack"
                  aria-label={`Seen: ${name}`}
                  onClick={() => recordKitchen('kitchen.seen', t)}
                />
              )}
              <div className="ticket__meta">
                <span className="ticket__no num">{t.number}</span>
                {t.changed && <span className="ticket__tag ticket__tag--changed">Changed</span>}
                {t.addOn && <span className="ticket__tag">Added</span>}
                <StationTag t={t} station={station} />
                {/* Neutral, like Added: on the kitchen screen colour means urgency only. */}
                {t.online && !t.addOn && (
                  <span className="ticket__tag">
                    Online · pickup {new Date(t.online.pickupBy).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                <span className="ticket__time num" aria-label={`Waiting ${elapsedLabel(elapsed)}`}>
                  {elapsedLabel(elapsed)}
                </span>
              </div>
              <ul className="ticket__items">
                {ticketLines(t).map((l) => (
                  <li key={l.key}>
                    {l.status === 'cancelled' && (
                      <>
                        <LineBody v={l} struck showQty />
                        <span className="ticket__cancelled">Cancelled</span>
                      </>
                    )}
                    {l.status === 'changed' && l.was && (
                      <>
                        <span className="sr-only">Changed from</span>
                        <LineBody v={l.was} struck showQty />
                        <span className="sr-only">to</span>
                        <span className="ticket__now"><LineBody v={l} showQty /></span>
                      </>
                    )}
                    {l.status === 'ok' && <LineBody v={l} />}
                  </li>
                ))}
              </ul>
              <button type="button" className="ticket__done" aria-label={`Done: ${name}`} onClick={() => markDone(t.id, t.number)}>
                Done
              </button>
            </article>
          );
        })}
      </main>

      {done !== null && (
        <div className="toast" role="status" key={done.id}>
          <span className="num">{done.number} done</span>
          <button type="button" onClick={undo}>Undo</button>
        </div>
      )}
    </Screen>
  );
}

/**
 * Serving list. Serves the person handing food over at a pay-first counter:
 * the student says what they paid for; the list says how many of each meal
 * are paid and not yet given, longest wait first. One tap hands over one
 * portion; when a meal is not on the list, nobody has paid for it.
 */
function Serving({ onBack, onSwitch, station: shown }: ScreenProps) {
  const { tickets, station } = useStationTickets(shown);
  const now = useNow(1000);
  const open = queue(tickets);
  const rows = servingRows(tickets);
  const cancelled = cancelledToServe(tickets);
  useArrivalChime(open);
  type Given = { ticket: { id: string; number: number }; lineId: string; name: string; closed: boolean; at: number };
  const { last: given, setLast: setGiven, undo } = useUndo<Given>(useCallback((g) => {
    recordServed('kitchen.unserved', g.ticket, g.lineId);
    if (g.closed) recordKitchen('kitchen.unbumped', g.ticket);
  }, []));

  const serveOne = (row: (typeof rows)[number]) => {
    const t = open.find((x) => x.id === row.next.ticketId);
    if (!t) return;
    const ticket = { id: t.id, number: t.number };
    recordServed('kitchen.served', ticket, row.next.lineId);
    // The last portion closes the ticket: say so as the kitchen's Done, which the owner's
    // prep times and online pickups already listen for.
    const closed = t.lines.reduce((n, l) => n + toServe(l), 0) === 1;
    if (closed) recordKitchen('kitchen.bumped', ticket);
    setGiven({ ticket, lineId: row.next.lineId, name: row.name, closed, at: Date.now() });
    if (navigator.vibrate) navigator.vibrate(8);
  };

  useKitchenKeys(() => { if (rows[0]) serveOne(rows[0]); }, undo, onBack);

  return (
    <Screen title={station ? `Serving · ${STATION_NAME[station]}` : 'Serving'} now={now} onBack={onBack} onSwitch={onSwitch}>
      <main className="kitchen__list" aria-label="Paid, to hand over">
        {rows.length === 0 && cancelled.length === 0 && <p className="kitchen__empty">Nothing paid and waiting</p>}
        {cancelled.map((t) => (
          <article key={t.id} className="ticket serve ticket--bad ticket--alert" aria-label={`Order ${t.number}, cancelled`}>
            <div className="ticket__meta">
              <span className="ticket__no num">{t.number}</span>
              <span className="ticket__tag ticket__tag--changed">Cancelled</span>
            </div>
            <ul className="ticket__items">
              {ticketLines(t).map((l) => <li key={l.key}><LineBody v={l} struck showQty /></li>)}
            </ul>
            {/* Nothing is left to hand over, so seeing it closes it (Done also counts as seen). */}
            <button type="button" className="ticket__done" aria-label={`Seen: Order ${t.number}, cancelled`} onClick={() => recordKitchen('kitchen.bumped', t)}>
              Seen
            </button>
          </article>
        ))}
        {rows.map((r) => {
          const waiting = open.filter((t) => r.ticketIds.includes(t.id));
          const alerting = waiting.filter(needsAttention);
          const elapsed = now - r.oldestAt;
          const name = [r.name, r.detail].filter(Boolean).join(', ');
          return (
            <article
              key={r.key}
              className={`ticket serve ticket--${urgency(elapsed, r.cookMs)}${alerting.length ? ' ticket--alert' : ''}`}
              aria-label={`${name}: ${r.count} paid`}
            >
              {alerting.length > 0 && (
                <button
                  type="button"
                  className="ticket__ack"
                  aria-label={`Seen: ${name}`}
                  onClick={() => alerting.forEach((t) => recordKitchen('kitchen.seen', t))}
                />
              )}
              <div className="ticket__meta">
                <span className="ticket__no num" aria-hidden>× {r.count}</span>
                <StationTag t={waiting[0] ?? {}} station={station} />
                <span className="ticket__time num" aria-label={`Longest wait ${elapsedLabel(elapsed)}`}>
                  {elapsedLabel(elapsed)}
                </span>
              </div>
              <div className="ticket__items serve__item"><LineBody v={{ ...r, qty: 1 }} /></div>
              <button type="button" className="ticket__done" aria-label={`Served one: ${name}`} onClick={() => serveOne(r)}>
                Served
              </button>
            </article>
          );
        })}
      </main>

      {given !== null && (
        <div className="toast" role="status" key={given.at}>
          <span>Served · {given.name}</span>
          <button type="button" onClick={undo}>Undo</button>
        </div>
      )}
    </Screen>
  );
}
