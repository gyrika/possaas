import { useEffect, useRef, useState } from 'react';
import { fmt, parseLKR, quickCashAmounts } from '../domain/money.ts';
import type { Cents, Tender } from '../domain/types.ts';

interface Props {
  total: Cents;
  /** One tap completes the sale; there is no second confirmation, only Undo. */
  onPay: (tender: Tender, tendered: Cents) => void;
  onClose: () => void;
}

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/** Under the amount being typed: what the cashier hands back, or what is still missing. */
const typedNote = (typed: string, amount: Cents | null, total: Cents): string => {
  if (!typed) return '';
  if (amount === null) return 'Check the amount';
  if (amount < total) return `Short ${fmt(total - amount)}`;
  return amount === total ? 'Exact' : `Change ${fmt(amount - total)}`;
};

export function PaySheet({ total, onPay, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const [pad, setPad] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const exactChip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!typed && !pad) { onClose(); return; }
        setTyped('');
        setPad(false);
        exactChip.current?.focus();
        return;
      }
      // Digits go straight to the amount: the cashier just starts typing what the customer gave.
      if (/^\d$/.test(e.key) && e.target !== field.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        field.current?.focus();
        setTyped((t) => t + e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, typed, pad]);

  const [exact, ...more] = quickCashAmounts(total);
  const amount = parseLKR(typed);
  const enough = amount !== null && amount >= total;
  const note = typedNote(typed, amount, total);

  const pressPad = (key: string) => {
    setTyped((t) => (key === '⌫' ? t.slice(0, -1) : t + key));
    field.current?.focus(); // so Enter takes the amount, not the last key pressed again
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Payment">
        <div className="sheet__body pay-body">
          <div className="pay-main">
            <div className="sheet__title">
              <h1 className="pay-total num">{fmt(total)}</h1>
            </div>

            <section className="group">
              <h2>Cash</h2>
              <div className="chips">
                <button ref={exactChip} type="button" className="chip chip--solid num" autoFocus onClick={() => onPay('cash', exact)}>
                  Exact · {fmt(exact)}
                </button>
                {more.map((a) => (
                  <button key={a} type="button" className="chip chip--solid num" onClick={() => onPay('cash', a)}>
                    {fmt(a)}
                  </button>
                ))}
                <input
                  ref={field}
                  className="chip chip--solid num pay-other"
                  inputMode="none"
                  autoComplete="off"
                  maxLength={12}
                  placeholder="Other amount"
                  aria-label="Other amount"
                  value={typed}
                  onClick={() => setPad(true)}
                  onChange={(e) => setTyped(e.target.value.replace(/[^\d.,]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (!typed) onPay('cash', exact);
                    else if (enough) onPay('cash', amount);
                  }}
                />
              </div>
            </section>

            <section className="group">
              <h2>Other</h2>
              <div className="chips">
                <button type="button" className="chip chip--solid" onClick={() => onPay('transfer', total)}>Bank transfer</button>
                <button type="button" className="chip chip--solid" onClick={() => onPay('card', total)}>Card</button>
                <button type="button" className="chip chip--solid" onClick={() => onPay('qr', total)}>QR</button>
              </div>
            </section>
          </div>
          <div className="pay-keys">
            {pad && PAD_KEYS.map((k, i) => (k
              ? (
                <button key={i} type="button" className="pay-key num" onClick={() => pressPad(k)} aria-label={k === '⌫' ? 'Delete' : k}>
                  {k}
                </button>
              )
              : <span key={i} />))}
          </div>
        </div>
        <div className="sheet__foot pay-foot">
          <span className={`pay-note num${typed && !enough ? ' pay-note--short' : ''}`} role="status">{note}</span>
          {typed && (
            <button type="button" className="cta" disabled={!enough} onClick={() => { if (enough) onPay('cash', amount); }}>
              {enough ? `Take ${fmt(amount)}` : 'Take'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
