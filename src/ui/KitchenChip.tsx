import { cookTimeMs, elapsedLabel, forStation, nothingToServe, queue, servingRows, urgency, type KitchenTicket } from '../domain/kitchen.ts';
import type { Station } from '../domain/types.ts';
import { usePayFirst } from '../services/shop.ts';
import { useNow } from './Kitchen.tsx';

/**
 * While the kitchen has no screen of its own, the Register shows one quiet key per kitchen:
 * how many orders are cooking there and how long the oldest has waited. The dot takes
 * the kitchen's urgency colour, so the cashier knows when to look; the key opens that kitchen.
 * A pay-first counter with one kitchen calls it Serving and counts the portions still to hand over.
 * Its own clock, so the Register itself does not re-render every second.
 */
export function KitchenChip({ tickets: all, station, onOpen }: { tickets: KitchenTicket[]; station?: Station; onOpen: () => void }) {
  const now = useNow(1000);
  const serving = usePayFirst();
  const tickets = forStation(all, station ?? null);
  // A paid order whose items were all cancelled has nothing left to hand over.
  const open = queue(tickets).filter((t) => !serving || !nothingToServe(t));
  const oldest = open[0];
  const waited = oldest ? now - oldest.firedAt : 0;
  const title = station ? `${station === 'left' ? 'Left' : 'Right'} kitchen` : serving ? 'Serving' : 'Kitchen';
  const count = serving ? servingRows(tickets).reduce((n, r) => n + r.count, 0) : open.length;
  const label = oldest
    ? `${title}: ${count} ${serving ? 'to hand over' : 'cooking'}, oldest waiting ${elapsedLabel(waited)}`
    : `${title}: ${serving ? 'nothing to hand over' : 'nothing cooking'}`;
  return (
    <button type="button" className="corner__key kchip" onClick={onOpen} aria-label={label}>
      {oldest && <span className={`kchip__dot kchip__dot--${urgency(waited, cookTimeMs(oldest))}`} aria-hidden />}
      <span aria-hidden>
        {title}
        {oldest && <span className="num"> · {count} · {elapsedLabel(waited)}</span>}
      </span>
    </button>
  );
}
