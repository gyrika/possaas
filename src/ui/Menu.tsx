import { menuIsEmpty, menuItems, menuSections, popularItems, sectionsNow, sizeTag } from '../domain/menu.ts';
import { NEW_SECTION_ID } from '../domain/menuEdits.ts';
import { fmtPlain } from '../domain/money.ts';
import type { MenuItem, Section, SizeId } from '../domain/types.ts';
import { usesLogin } from '../services/auth.ts';
import { signedIn } from '../services/serverAuth.ts';
import { useMenu } from './menuStore.ts';

/** 'popular', or one of the shop's sections. */
export type CategoryId = string;

interface Props {
  category: CategoryId;
  onCategory: (c: CategoryId) => void;
  /** One tap on a price adds the item right away. */
  onQuickAdd: (item: MenuItem, size?: SizeId) => void;
  /** Tapping the name opens the extras sheet before adding. */
  onCustomise: (item: MenuItem) => void;
  hint: string;
  /**
   * Manager mode: the menu edits itself. A tap on an item opens it to change (price, sizes, name,
   * sold out), and the section bar adds items and sizes, without leaving the Register.
   */
  edit?: MenuEditing;
}

export interface MenuEditing {
  onItem: (item: MenuItem) => void;
  onAdd: (section: Section) => void;
  /** null: a new section. */
  onSection: (section: Section | null) => void;
}

/**
 * What the owner offers: hidden items and sections out of their hours are not shown (except to change
 * them); sold-out ones show, greyed.
 */
const visible = (c: CategoryId, editing: boolean): MenuItem[] =>
  c === 'popular' ? popularItems().filter((m) => !m.hidden)
    : menuItems().filter((m) => m.category === c && !m.removed && (editing || (!m.hidden && !m.offHours)));

/** A new shop before its menu: the owner is one tap from building it; anyone else knows whom to ask. */
function EmptyMenu() {
  const role = signedIn()?.role;
  const owner = !usesLogin() || role === 'owner' || role === 'manager';
  return (
    <div className="menu-empty" role="status">
      <h2>Your menu is empty</h2>
      {owner ? (
        <>
          <p>Add what you sell, and it appears here to take orders.</p>
          <button type="button" className="cta" onClick={() => { location.hash = '#menu'; }}>Add your menu</button>
        </>
      ) : <p>The owner or a manager adds the menu. Ask them to log in and choose Add your menu.</p>}
    </div>
  );
}

/** "Short Eats · කෙටි කෑම" → "Short Eats": every section fits on one line at the counter; the cards keep both names. */
const shortName = (name: string): string => name.split(' · ')[0] || name;

export function Menu({ category, onCategory, onQuickAdd, onCustomise, hint, edit }: Props) {
  useMenu();
  if (menuIsEmpty() && !edit) return <EmptyMenu />;
  const sections = edit ? menuSections() : sectionsNow();
  const tabs = [{ id: 'popular', name: 'Popular' }, ...sections];
  // A section that closed for the day while it was open goes on to the one taking over its name
  // (morning Rice & Curry → lunch Rice & Curry); one taken off the menu goes back to Popular.
  const was = menuSections().find((x) => x.id === category);
  const shown = tabs.some((t) => t.id === category) ? category
    : sections.find((x) => was && shortName(x.name) === shortName(was.name))?.id ?? 'popular';
  const section = sections.find((x) => x.id === shown);
  // While editing, every tap opens the item; nothing is added to the order.
  const quickAdd = edit ? (item: MenuItem) => edit.onItem(item) : onQuickAdd;
  const customise = edit ? edit.onItem : onCustomise;
  return (
    <>
      <nav className="cats" aria-label="Menu">
        {tabs.map((c) => (
          <button key={c.id} type="button" className="pill" aria-pressed={shown === c.id} onClick={() => onCategory(c.id)}>
            {shortName(c.name)}
          </button>
        ))}
        {edit && <button type="button" className="pill" onClick={() => edit.onSection(null)}>+ Section</button>}
        {edit ? (
          <span className="hint menu-edit">
            {section && NEW_SECTION_ID.test(section.id) && (
              <button type="button" className="linkbtn" onClick={() => edit.onSection(section)}>Sizes &amp; extras</button>
            )}
            <span>Tap an item to change it</span>
          </span>
        ) : <span className="hint">{hint}</span>}
      </nav>

      <div className="grid">
        {visible(shown, Boolean(edit)).map((item) => (
          <div key={item.id} className={`card${item.soldOut || item.hidden || item.offHours ? ' card--soldout' : ''}`}>
            {(item.soldOut || item.hidden || item.offHours) && (
              <span className="card__soldout">{item.hidden ? 'Hidden' : item.offHours ? 'Not now' : 'Sold out'}</span>
            )}
            <button type="button" className="card__title" disabled={item.soldOut && !edit} onClick={() => customise(item)}
              aria-label={edit ? `Change ${item.name.en}` : undefined}>
              <span className="card__name">
                {item.number !== undefined && <span className="card__no num" aria-hidden="true">{item.number}</span>}
                {item.name.en}
              </span>
              {item.name.si && <span className="card__si" lang="si">{item.name.si}</span>}
              <span className="card__desc">{item.description}</span>
            </button>
            <div className="card__prices">
              {item.variants && (item.variants.length === 2 || item.variants.length === 1) ? (
                item.variants.map((v) => (
                  <button key={v.id} type="button" className="price num" disabled={item.soldOut && !edit} onClick={() => quickAdd(item, v.id)}>
                    {sizeTag(v)} {fmtPlain(v.price)}
                  </button>
                ))
              ) : item.variants ? (
                <button type="button" className="price num" disabled={item.soldOut && !edit} onClick={() => customise(item)}>
                  from {fmtPlain(Math.min(...item.variants.map((v) => v.price)))}
                </button>
              ) : (
                <button type="button" className="price num" disabled={item.soldOut && !edit} onClick={() => quickAdd(item)}>
                  {fmtPlain(item.price ?? 0)}
                </button>
              )}
            </div>
          </div>
        ))}
        {edit && section && (
          <button type="button" className="card card--add" onClick={() => edit.onAdd(section)}>+ Add to {shortName(section.name)}</button>
        )}
      </div>
    </>
  );
}
