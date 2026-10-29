import { useEffect, useState, type CSSProperties } from 'react';
import { onFlights, type Flight } from './flight.ts';

/** How long a card may stay if its animation never ends (no animations, a hidden tab). */
const LONGEST_MS = 900;

/**
 * The flying copies of a sent order. Each starts where the bill is and is gone off its
 * kitchen's edge of the screen in under half a second. Decoration only: the toast says it.
 */
export function KitchenFlight() {
  const [cards, setCards] = useState<(Flight & { style: CSSProperties })[]>([]);
  useEffect(() => onFlights((flights) => {
    const bill = document.querySelector('[aria-label="Current order"]')?.getBoundingClientRect();
    const width = Math.min(340, (bill?.width ?? 360) - 32);
    const left = bill ? bill.left + (bill.width - width) / 2 : (window.innerWidth - width) / 2;
    const top = bill ? bill.top + 96 : window.innerHeight / 3;
    const ids = flights.map((f) => f.id);
    setCards((c) => [...c, ...flights.map((f) => ({ ...f, style: { left, top, width } }))]);
    setTimeout(() => setCards((c) => c.filter((x) => !ids.includes(x.id))), LONGEST_MS);
  }), []);
  const gone = (id: string) => setCards((c) => c.filter((x) => x.id !== id));
  return (
    <>
      {cards.map((f) => (
        <div key={f.id} className={`flight flight--${f.station}`} style={f.style} aria-hidden onAnimationEnd={() => gone(f.id)}>
          <span className="flight__no num">{f.number}</span>
          <ul>{f.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ))}
    </>
  );
}
