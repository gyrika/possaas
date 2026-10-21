import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MENU, menuIsEmpty, menuItems, menuSections, menuState, sectionOf, sizeTag, startingItem } from '../domain/menu.ts';
import {
  NEW_SECTION_ID, checkNewItem, checkOverride, checkSection, newItemSizes, nextMorning, slug,
  type ItemOverride, type NewItem, type SectionDef,
} from '../domain/menuEdits.ts';
import { fmt } from '../domain/money.ts';
import type { Category, Cents, MenuItem, Section, SizeId } from '../domain/types.ts';
import { currentCashier } from '../services/auth.ts';
import { appendEvent } from './eventLog.ts';
import { useMenu } from './menuStore.ts';
import { OwnerNav } from './OwnerNav.tsx';

/**
 * The owner's menu (#menu). Serves the owner: they know what they sell and want it on the counter
 * now, or one change made, a price, a name, something off for today, without calling anyone. The
 * single next thing: a new shop adds a section, then its items, one after another; later, find the
 * item, change it, save. Managers see the same list with "Sold out today" only.
 * Every change is an event (who, when, before/after) with an Undo, and reaches the counter,
 * the kitchen and online ordering at once.
 */
/** The item as it started (the sample menu), or as the owner added it. */
const startOf = (id: string) => startingItem(id) ?? MENU.find((m) => m.id === id)!;
const prices = (m: MenuItem) => (m.variants ? m.variants.map((v) => `${sizeTag(v)} ${fmt(v.price)}`).join(' · ') : fmt(m.price ?? 0));

/** "1,650" or "1650" → cents, whole rupees only. */
const toCents = (text: string): Cents | null => {
  const t = text.replace(/[,\s]/g, '');
  return /^\d{1,6}$/.test(t) ? Number(t) * 100 : null;
};

const record = (itemId: string, after: ItemOverride) => {
  const before = menuState().overrides[itemId] ?? {};
  appendEvent({ type: 'menu.item_set', at: Date.now(), orderNumber: 0, actor: currentCashier(), itemId, before, after });
  return before;
};
const setSoldOut = (itemId: string, out: boolean) =>
  appendEvent({ type: 'menu.sold_out', at: Date.now(), orderNumber: 0, actor: currentCashier(), itemId, until: out ? nextMorning(Date.now()) : null });
const addItem = (itemId: string, item: NewItem | null) =>
  appendEvent({ type: 'menu.item_added', at: Date.now(), orderNumber: 0, actor: currentCashier(), itemId, item });
/** Makes, changes or (null) takes off a section; returns what it was, for Undo. */
const setSection = (sectionId: string, section: SectionDef | null): SectionDef | null => {
  const was = menuState().sections?.[sectionId];
  appendEvent({ type: 'menu.section_set', at: Date.now(), orderNumber: 0, actor: currentCashier(), sectionId, section });
  if (!was || was.removed) return null;
  const { removed: _r, ...def } = was;
  return def;
};

/** A fresh id from a name: never one that was used before, even by something taken off. */
const freshId = (prefix: string, name: string, taken: Set<string>, fallback: string): string => {
  const base = `${prefix}${slug(name) || fallback}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
};
/** "Chicken Alfredo" → "new-chicken-alfredo", or "new-chicken-alfredo-2" if that was ever used. */
const newId = (en: string): string => freshId('new-', en, new Set(menuItems().map((m) => m.id)), 'item');
const newSectionId = (name: string): string =>
  freshId('sec-', name, new Set([...menuSections().map((x) => x.id), ...Object.keys(menuState().sections ?? {})]), 'section');

/** Typing "pasta" or a name already on the menu must keep finding one item, so names stay unique. */
const nameTaken = (en: string): MenuItem | undefined => {
  const t = en.trim().toLowerCase();
  return menuItems().find((m) => !m.removed && (m.name.en.toLowerCase() === t || m.aliases.includes(t)));
};

/** Escape closes a sheet. */
const useEscape = (onClose: () => void) => useEffect(() => {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [onClose]);

const sentence = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}.`;

/** A row the owner types into: an existing size/extra keeps its id, so items keep their prices. */
interface Row { id?: string; label: string; price: string }

/**
 * A section: its name, how long the kitchen takes, its sizes (none = one price) and the extras its
 * items share. Changing a size's name keeps every item's price for it.
 */
function SectionSheet({ section, onSaved, onClose }: {
  section: Section | null; onSaved: (message: string, undo: () => void, id: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(section?.name ?? '');
  const [cook, setCook] = useState(String(section?.cookMinutes ?? 10));
  const [sizes, setSizes] = useState<Row[]>(section?.sizes.map((z) => ({ id: z.id, label: z.label, price: '' })) ?? []);
  const [adds, setAdds] = useState<Row[]>(section?.adds.map((a) => ({ id: a.id, label: a.label, price: String(a.price / 100) })) ?? []);
  const [error, setError] = useState('');
  useEscape(onClose);

  /** New rows get ids from their names, never one already in the section. */
  const ids = (rows: Row[]): string[] => {
    const taken = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
    return rows.map((r) => {
      if (r.id) return r.id;
      const id = freshId('', r.label, taken, 'size');
      taken.add(id);
      return id === 'one' ? 'one-size' : id;
    });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const minutes = Number(cook);
    const keptSizes = sizes.filter((r) => r.label.trim());
    const keptAdds = adds.filter((r) => r.label.trim());
    const addPrices = keptAdds.map((r) => toCents(r.price || '0'));
    if (addPrices.some((c) => c === null)) { setError('Extras cost whole rupees, like 100.'); return; }
    const sizeIds = ids(keptSizes);
    const addIds = ids(keptAdds);
    const def: SectionDef = {
      name: name.trim(),
      cookMinutes: Number.isInteger(minutes) ? minutes : 0,
      sizes: keptSizes.map((r, i) => ({ id: sizeIds[i], label: r.label.trim() })),
      adds: keptAdds.map((r, i) => ({ id: addIds[i], label: r.label.trim(), price: addPrices[i]! })),
    };
    const bad = checkSection(def);
    if (bad) { setError(sentence(bad)); return; }
    const id = section?.id ?? newSectionId(def.name);
    const was = setSection(id, def);
    onSaved(section ? `Saved ${def.name}` : `Added ${def.name}`, () => setSection(id, was), id);
  };

  const takeOff = () => {
    if (!section) return;
    const was = setSection(section.id, null);
    onSaved(`${section.name} is off the menu`, () => setSection(section.id, was), section.id);
  };

  /** Enter in the last row starts the next one (Enter elsewhere does not save the section half-typed). */
  const nextRow = (list: Row[], set: (r: Row[]) => void, i: number) => (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (i === list.length - 1 && list[i].label.trim()) set([...list, { label: '', price: '' }]);
  };
  const rows = (list: Row[], set: (r: Row[]) => void, what: 'size' | 'extra') => (
    <div className="menued__rows">
      {list.map((r, i) => (
        <div key={i} className="menued__rowin">
          <input value={r.label} placeholder={what === 'size' ? 'e.g. Full' : 'e.g. Egg'} maxLength={what === 'size' ? 20 : 30}
            aria-label={`${what === 'size' ? 'Size' : 'Extra'} ${i + 1}`} autoFocus={!r.label && i === list.length - 1}
            onKeyDown={nextRow(list, set, i)} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          {what === 'extra' && (
            <input className="num" inputMode="numeric" value={r.price} placeholder="Rs" aria-label={`Extra ${i + 1} price`}
              onKeyDown={nextRow(list, set, i)} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          )}
          <button type="button" className="linkbtn" aria-label={`Remove ${r.label || `${what} ${i + 1}`}`}
            onClick={() => set(list.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="chip" onClick={() => set([...list, { label: '', price: '' }])}>+ Add {what === 'size' ? 'a size' : 'an extra'}</button>
    </div>
  );

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="sheet menued" role="dialog" aria-modal="true" aria-label={section ? `Change ${section.name}` : 'Add a section'} onSubmit={save}>
        <div className="sheet__body">
          <div className="sheet__title">
            <h1>{section ? section.name : 'Add a section'}</h1>
            {section && <button type="button" className="linkbtn" onClick={takeOff}>Take off the menu</button>}
          </div>
          <section className="group">
            <div className="menued__grid">
              <label>Section name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="e.g. Kottu" required autoFocus={!section} /></label>
              <label>Ready in (minutes)<input className="num" inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value.replace(/\D/g, ''))} /></label>
            </div>
            <p className="menued__note">The kitchen sees an order turn amber after this long, and red at one and a half times it.</p>
          </section>
          <section className="group">
            <h2>Sizes</h2>
            <p className="menued__note">Like Regular and Full. No sizes: each item has one price.</p>
            {rows(sizes, setSizes, 'size')}
          </section>
          <section className="group">
            <h2>Extras</h2>
            <p className="menued__note">What a customer can add to any item here, like Egg or Cheese.</p>
            {rows(adds, setAdds, 'extra')}
          </section>
          {error && <p className="reason-msg" role="alert">{error}</p>}
        </div>
        <div className="sheet__foot menued__foot">
          <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
          <button type="submit" className="cta">{section ? 'Save' : 'Add the section'}</button>
        </div>
      </form>
    </>
  );
}

/**
 * New items in one section, one after another: name, a price per size (blank = not sold in that
 * size), Enter, and the sheet is ready for the next. Its section's extras come with it; the
 * number, leave-outs and Sinhala/Tamil names are under More.
 */
function AddItems({ section, onClose }: { section: Section; onClose: () => void }) {
  const sizes = newItemSizes(section);
  const [en, setEn] = useState('');
  const [price, setPrice] = useState<Record<string, string>>({});
  const [number, setNumber] = useState('');
  const [outs, setOuts] = useState('');
  const [si, setSi] = useState('');
  const [ta, setTa] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEscape(onClose);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const same = nameTaken(en);
    if (same) { setError(`${same.name.en} is already on the menu. Give this one another name.`); return; }
    const prices: NewItem['prices'] = {};
    for (const z of sizes) {
      const typed = (price[z.id] ?? '').trim();
      if (!typed) continue;
      const c = toCents(typed);
      if (c === null || c === 0) { setError(`Type the ${z.id === 'one' ? 'price' : `${z.label} price`} in whole rupees, like 900.`); return; }
      prices[z.id] = c;
    }
    if (!Object.keys(prices).length) { setError(sizes.length > 1 ? 'Type a price for at least one size.' : 'Type its price, like 900.'); return; }
    const leaveOut = outs.split(',').map((o) => o.trim()).filter(Boolean).map((o) => (/^(no|less|without)\b/i.test(o) ? o : `No ${o}`));
    const item: NewItem = {
      category: section.id,
      name: { en: en.trim(), ...(si.trim() ? { si: si.trim() } : {}), ...(ta.trim() ? { ta: ta.trim() } : {}) },
      description: desc.trim(),
      prices,
      ...(number.trim() ? { number: Number(number) } : {}),
      ...(leaveOut.length ? { leaveOut } : {}),
    };
    const bad = checkNewItem(item, menuSections());
    if (bad) { setError(sentence(bad)); return; }
    const id = newId(item.name.en);
    addItem(id, item);
    setAdded({ id, name: item.name.en });
    setEn(''); setPrice({}); setNumber(''); setOuts(''); setSi(''); setTa(''); setDesc('');
    nameRef.current?.focus();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="sheet menued" role="dialog" aria-modal="true" aria-label={`Add to ${section.name}`} onSubmit={save}>
        <div className="sheet__body">
          <div className="sheet__title"><h1>Add to {section.name}</h1></div>
          <section className="group">
            <div className="menued__grid">
              <label className="menued__wide">Name<input ref={nameRef} value={en} onChange={(e) => setEn(e.target.value)} maxLength={40} required autoFocus placeholder="e.g. Chicken Kottu" /></label>
              {sizes.map((z) => (
                <label key={z.id}>
                  {z.id === 'one' ? 'Price' : z.label}
                  <input className="num" inputMode="numeric" value={price[z.id] ?? ''} onChange={(e) => setPrice({ ...price, [z.id]: e.target.value })}
                    aria-label={z.id === 'one' ? 'Price' : `${z.label} price`} placeholder="Rs" />
                </label>
              ))}
            </div>
            {sizes.length > 1 && <p className="menued__note">Leave a size blank if this item is not sold in it.</p>}
          </section>
          <details className="group menued__more">
            <summary>More: number, leave-outs, Sinhala and Tamil names</summary>
            <div className="menued__grid">
              <label>Number<input className="num" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="e.g. 5" /></label>
              <label className="menued__wide">Can be left out<input value={outs} onChange={(e) => setOuts(e.target.value)} placeholder="e.g. onion, chilli" /></label>
              <label>Sinhala<input value={si} onChange={(e) => setSi(e.target.value)} maxLength={60} lang="si" /></label>
              <label>Tamil<input value={ta} onChange={(e) => setTa(e.target.value)} maxLength={60} lang="ta" /></label>
              <label className="menued__wide">Description<input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={160} /></label>
            </div>
          </details>
          {error && <p className="reason-msg" role="alert">{error}</p>}
          {added && !error && (
            <p className="menued__added" role="status">
              Added {added.name}.
              <button type="button" className="linkbtn" onClick={() => { addItem(added.id, null); setAdded(null); }}>Undo</button>
            </p>
          )}
        </div>
        <div className="sheet__foot menued__foot">
          <button type="button" className="linkbtn" onClick={onClose}>Done</button>
          <button type="submit" className="cta">Add <kbd>Enter</kbd></button>
        </div>
      </form>
    </>
  );
}

function Editor({ item, onSaved, onClose }: { item: MenuItem; onSaved: (message: string, undo: () => void) => void; onClose: () => void }) {
  const base = startOf(item.id);
  const startName = base.added ? 'how you added it' : 'the printed menu';
  const [en, setEn] = useState(item.name.en);
  const [si, setSi] = useState(item.name.si ?? '');
  const [ta, setTa] = useState(item.name.ta ?? '');
  const [desc, setDesc] = useState(item.description);
  const sizes = item.variants?.map((v) => v.id) ?? ['one' as const];
  const [price, setPrice] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.variants ? item.variants.map((v) => [v.id, String(v.price / 100)]) : [['one', String((item.price ?? 0) / 100)]]));
  const [adds, setAdds] = useState<Record<string, string>>(() => Object.fromEntries(item.adds.map((a) => [a.id, String(a.price / 100)])));
  const [hidden, setHidden] = useState(Boolean(item.hidden));
  const [error, setError] = useState('');

  useEscape(onClose);

  const basePrice = (id: string) => (id === 'one' ? base.price ?? 0 : base.variants!.find((v) => v.id === id)!.price);

  /** Only what differs from the printed menu is kept, so "same as printed" is simply nothing. */
  const build = (): ItemOverride | string => {
    const o: ItemOverride = {};
    const name: ItemOverride['name'] = {};
    if (en.trim() !== base.name.en) name.en = en.trim();
    if (si.trim()) name.si = si.trim();
    if (ta.trim()) name.ta = ta.trim();
    if (Object.keys(name).length) o.name = name;
    if (desc.trim() !== base.description) o.description = desc.trim();
    const p: NonNullable<ItemOverride['prices']> = {};
    for (const id of sizes) {
      const c = toCents(price[id] ?? '');
      if (c === null) return 'Prices are whole rupees, like 1650.';
      if (c !== basePrice(id)) p[id as SizeId | 'one'] = c;
    }
    if (Object.keys(p).length) o.prices = p;
    const a: Record<string, Cents> = {};
    for (const opt of base.adds) {
      const c = toCents(adds[opt.id] ?? '');
      if (c === null) return 'Prices are whole rupees, like 300.';
      if (c !== opt.price) a[opt.id] = c;
    }
    if (Object.keys(a).length) o.adds = a;
    if (hidden) o.hidden = true;
    return checkOverride(base, o) ?? o;
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const o = build();
    if (typeof o === 'string') { setError(o); return; }
    const before = record(item.id, o);
    onSaved(`Saved ${en.trim() || base.name.en}`, () => record(item.id, before));
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="sheet menued" role="dialog" aria-modal="true" aria-label={`Change ${item.name.en}`} onSubmit={save}>
        <div className="sheet__body">
          <div className="sheet__title">
            <h1>{item.name.en}</h1>
            {item.edited && (
              <button type="button" className="linkbtn" onClick={() => {
                const before = record(item.id, {});
                onSaved(`${base.name.en}: back to ${startName}`, () => record(item.id, before));
              }}>Back to {startName}</button>
            )}
          </div>

          <section className="group">
            <h2>Name</h2>
            <div className="menued__grid">
              <label>English<input value={en} onChange={(e) => setEn(e.target.value)} maxLength={40} required /></label>
              <label>Sinhala<input value={si} onChange={(e) => setSi(e.target.value)} maxLength={60} lang="si" /></label>
              <label>Tamil<input value={ta} onChange={(e) => setTa(e.target.value)} maxLength={60} lang="ta" /></label>
              <label className="menued__wide">Description<input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={160} /></label>
            </div>
          </section>

          <section className="group">
            <h2>Price</h2>
            <div className="menued__grid">
              {sizes.map((id) => {
                const v = item.variants?.find((x) => x.id === id);
                const was = basePrice(id);
                return (
                  <label key={id}>
                    {v ? `${v.label}${v.hint ? ` ${v.hint}` : ''}` : 'Price'}
                    <input className="num" inputMode="numeric" value={price[id]} onChange={(e) => setPrice({ ...price, [id]: e.target.value })} aria-label={v ? `${v.label} price` : 'Price'} />
                    {toCents(price[id]) !== was && <span className="menued__was num">{base.added ? 'Was' : 'Printed'} {fmt(was)}</span>}
                  </label>
                );
              })}
            </div>
          </section>

          {base.adds.length > 0 && (
            <section className="group">
              <h2>Extras</h2>
              <div className="menued__grid">
                {base.adds.map((opt) => (
                  <label key={opt.id}>
                    {opt.label}
                    <input className="num" inputMode="numeric" value={adds[opt.id]} onChange={(e) => setAdds({ ...adds, [opt.id]: e.target.value })} aria-label={`${opt.label} price`} />
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="group">
            <label className="menued__check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              Hide from the menu <span>(the counter and online ordering stop offering it; old orders keep it)</span>
            </label>
          </section>
          {error && <p className="reason-msg" role="alert">{error}</p>}
        </div>
        <div className="sheet__foot menued__foot">
          <button type="button" className="linkbtn" onClick={onClose}>Cancel</button>
          <button type="submit" className="cta">Save</button>
        </div>
      </form>
    </>
  );
}

export function MenuView({ owner, onBack }: { owner: boolean; onBack: () => void }) {
  useMenu();
  const sections = menuSections();
  const [picked, setPicked] = useState<Category | null>(null);
  const section = sections.find((x) => x.id === picked) ?? sections[0] ?? null;
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [sectionSheet, setSectionSheet] = useState<'new' | Section | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string; undo: () => void } | null>(null);
  const items = section ? menuItems().filter((m) => m.category === section.id && !m.removed && !(m.added && sectionOf(m.category)?.removed)) : [];
  const empty = menuIsEmpty();
  /** "Added" means something only next to a starting menu (the sample); in a shop's own menu everything is. */
  const fromStart = menuItems().some((m) => !m.added);
  const open = Boolean(editing || adding || sectionSheet);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!open) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onBack]);

  const said = (message: string, undo: () => void) => setToast({ id: Date.now(), message, undo });

  return (
    <div className="owner">
      <OwnerNav current="menu" onRegister={onBack} />
      <main className="owner__main menuv" aria-label="Menu">
        <h1 className="menuv__title">{empty && owner ? 'Add your menu' : 'Menu'}</h1>
        <p className="menuv__lead">
          {!owner ? 'Mark something sold out for today. Prices and names are changed by the owner.'
            : !sections.length ? 'Start with a section, like Kottu, Rice & curry or Drinks. Then add its items, one after another.'
              : empty ? `Now add what you sell in ${section!.name}.`
                : 'Change a price, a name or what is on offer, or add something new. It reaches the counter, the kitchen and online ordering at once.'}
        </p>
        {(sections.length > 0 || owner) && (
          <nav className="cats" aria-label="Menu sections">
            {sections.map((x) => (
              <button key={x.id} type="button" className="pill" aria-pressed={section?.id === x.id} onClick={() => setPicked(x.id)}>{x.name}</button>
            ))}
            {owner && <button type="button" className={sections.length ? 'pill' : 'cta'} onClick={() => setSectionSheet('new')}>+ Add a section</button>}
          </nav>
        )}
        {section && (
          <p className="menuv__section">
            <span>
              Ready in {section.cookMinutes} min
              {section.sizes.length > 0 && ` · ${section.sizes.map((z) => z.label).join(', ')}`}
              {section.adds.length > 0 && ` · extras: ${section.adds.map((a) => a.label).join(', ')}`}
            </span>
            {owner && NEW_SECTION_ID.test(section.id) && (
              <button type="button" className="linkbtn" onClick={() => setSectionSheet(section)}>Change section</button>
            )}
          </p>
        )}
        <ul className="menuv__list">
          {items.map((m) => (
            <li key={m.id} className={`menuv__row${m.hidden ? ' menuv__row--hidden' : ''}`}>
              <div className="menuv__name">
                <b>{m.number !== undefined && <span className="card__no num">{m.number}</span>}{m.name.en}</b>
                {(m.name.si || m.name.ta) && <span>{[m.name.si, m.name.ta].filter(Boolean).join(' · ')}</span>}
                <span className="num">{prices(m)}</span>
              </div>
              <div className="menuv__tags">
                {m.added && fromStart && <span className="status status--paid">Added</span>}
                {m.edited && <span className="status status--paid">Changed</span>}
                {m.hidden && <span className="status status--unpaid">Hidden</span>}
              </div>
              {!m.hidden && (
                <button
                  type="button" className="chip menuv__sold" aria-pressed={Boolean(m.soldOut)}
                  onClick={() => {
                    setSoldOut(m.id, !m.soldOut);
                    said(m.soldOut ? `${m.name.en} is back` : `${m.name.en}: sold out until morning`, () => setSoldOut(m.id, Boolean(m.soldOut)));
                  }}
                >
                  {m.soldOut ? 'Sold out today' : 'Available'}
                </button>
              )}
              {owner && <button type="button" className="chip chip--solid" onClick={() => setEditing(m)} aria-label={`Change ${m.name.en}`}>Change</button>}
            </li>
          ))}
        </ul>
        {owner && section && (
          <button type="button" className={items.length ? 'chip menuv__add' : 'cta menuv__add'} onClick={() => setAdding(true)}>+ Add to {section.name}</button>
        )}
        {owner && empty && (
          <p className="menuv__later"><button type="button" className="linkbtn" onClick={onBack}>Do it later</button></p>
        )}
      </main>
      {sectionSheet && (
        <SectionSheet
          section={sectionSheet === 'new' ? null : sectionSheet}
          onClose={() => setSectionSheet(null)}
          onSaved={(msg, undo, id) => {
            const made = sectionSheet === 'new';
            setSectionSheet(null);
            setPicked(id);
            said(msg, undo);
            if (made) setAdding(true); // a new section: straight on to its items
          }}
        />
      )}
      {adding && section && <AddItems section={section} onClose={() => setAdding(false)} />}
      {editing && <Editor item={editing} onClose={() => setEditing(null)} onSaved={(msg, undo) => { setEditing(null); said(msg, undo); }} />}
      {toast && !open && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => { toast.undo(); setToast(null); }}>Undo</button>
        </div>
      )}
    </div>
  );
}
