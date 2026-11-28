import { useMemo } from 'react';
import { useInstall } from '../services/ownerApp.ts';
import { adminShop, ownerToken } from '../services/pairing.ts';
import { useShopEvents } from '../services/ownerData.ts';
import { ChatGptLink } from './ChatGptLink.tsx';
import { OwnerNav } from './OwnerNav.tsx';
import { GlanceSkeleton, GlanceView } from './Glance.tsx';
import { glanceOf } from '../domain/glance.ts';
import { SHOP_NAME } from '../shop/identity.ts';

/**
 * The Owner view. Serves the owner: they know the shop, not the screens, and
 * read this on a phone between other things. It answers "how is the shop doing?"
 * in one look: the shop at a glance (Glance.tsx, SCRUM-173), whose every number
 * explains itself when tapped. No To do list on Today (owner, 2026-11-28).
 */
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * `phone`: on the owner's phone (the cloud site): no links to the counter's screens.
 * `onBack`: back to the Register (F10 does the same).
 */
export function OwnerView({ phone = false, onBack, shop }: {
  phone?: boolean;
  onBack?: () => void;
  /** Another shop, from the developer's Shops screen: its id in the header, Back goes to Shops. */
  shop?: string;
} = {}) {
  const data = useShopEvents();
  const install = useInstall();
  /** The developer's admin view of a shop: not an owner's phone, so no home-screen offer. */
  const offerInstall = phone && !adminShop();
  const events = data.state === 'ready' ? data.events : data.state === 'error' ? data.events : undefined;
  const at = (data.state === 'loading' ? undefined : data.at) ?? Date.now();

  const glance = useMemo(() => (events ? glanceOf(events, at) : null), [events, at]);

  return (
    <div className="owner">
      {shop ? (
        <header className="owner__head">
          <button type="button" className="shops__back" onClick={onBack}>Shops</button>
          <span className="brand">{shop}</span>
          {data.state !== 'loading' && <span className="owner__updated">Updated {timeOf(at)}</span>}
        </header>
      ) : phone ? (
        <header className="owner__head">
          <span className="brand">{SHOP_NAME}</span>
          {data.state !== 'loading' && <span className="owner__updated">Updated {timeOf(at)}</span>}
        </header>
      ) : <OwnerNav current="owner" onRegister={onBack} />}

      <main className="owner__main owner__main--glance" aria-label="Owner">
        <span className="owner__label">
          Today · {new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>

        {offerInstall && install.kind === 'button' && (
          <p className="owner__install">
            <span>Put {SHOP_NAME} on your home screen.</span>
            <button type="button" className="insight__action" onClick={install.install}>Install app</button>
          </p>
        )}
        {offerInstall && install.kind === 'iphone' && (
          <p className="owner__install">To put it on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>
        )}

        {data.state === 'error' && (
          <p className="owner__note" role="status">
            {data.message.startsWith('This link')
              ? `${data.message} Ask for a new one.`
              : `${phone ? 'No connection' : 'Can’t reach the shop server'}${events ? `: showing the figures from ${timeOf(at)}.` : '.'}`}
          </p>
        )}

        {glance
          ? <GlanceView glance={glance} />
          : <GlanceSkeleton />}

        {phone && !adminShop() && ownerToken() && <ChatGptLink />}
      </main>
    </div>
  );
}
