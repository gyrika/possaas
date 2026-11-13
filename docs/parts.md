# Parts of the POS (the dashboard)

Each shop gets the parts of Lume POS it is ready for. You switch them at **`/admin` → a shop → Parts**
on the cloud (`melo…workers.dev/admin`, your admin password). Every change goes in **Activity**
with what it was ("Two kitchens on").

| Part | Off means |
|---|---|
| Kitchen screen | no Kitchen key in the Register corner, `#kitchen` shows the Register, no kitchen QR codes in Shop setup → Devices, no Cooking / Done beside orders. Orders still make kitchen tickets, so switching it on later starts cleanly. A kitchen screen already paired keeps showing its kitchen |
| Cash out | no F3, no Cash out tab, no card in the Owner view |
| Two kitchens | one kitchen whatever the menu's Left/Right say: one ticket, one key, nothing flies |
| Busy mode | no Busy key, F6 does nothing |
| Online orders | no Online key at the counter |
| Owner's phone | no owner QR code in Shop setup (paired phones keep working until withdrawn) |
| Serving list | a pay-first kitchen shows cooking tickets (Done) instead of the Serving list; the bill says Cooking / Done |

Defaults (a shop never set): everything on except **Kitchen screen** (Bata Kade has no kitchen screen
yet, 2026-11-14), **Two kitchens** and **Serving list** (the kitchen's next module, once the owner is at
home with the POS). Paying (or Send, in an eat-first shop) always flies
the order off the Register with a whap: to its side with two kitchens, to the left with one. The list and the defaults are
`src/domain/features.ts` (`PARTS`, `DEFAULT_FEATURES`).

## How a switch reaches the shop

1. `/admin` stores the shop's parts in the cloud (`shops.features`).
2. The shop server already copies its sales to the cloud every 30 s (`server/replicator.ts`). The
   cloud's answer to that copy (`GET /api/v1/replica`) now carries `features`; the server keeps
   them in its settings (`features`), so they hold without internet.
3. The server says which parts it has on every copy (`x-station-features`); `/admin` shows
   "The shop has these" or "Waiting for the shop".
4. The screens re-read the shop's details every 30 s (`GET /api/v1/shop-details` → `features`)
   and hide what is off.

## Adding a part later

1. Add it to `ShopFeatures`, `DEFAULT_FEATURES` and `PARTS` in `src/domain/features.ts`.
2. Hide its keys and screens with `useFeatures()` (`src/services/shop.ts`) where they appear.
3. Release. The dashboard shows the new switch by itself.

## Other systems (CheesyBeez)

CheesyBeez (Thalwila) is on other code (the ERP repo) with its own cloud. `/admin` lists it apart
under **Other systems**, as a link to its own admin; none of its data is in this cloud. The list is
`OTHER_SYSTEMS` in `cloud/wrangler.toml` (`[{ name, place, about, url }]`).

To switch CheesyBeez's parts from its own admin later, do the same three things in the ERP repo
(its own parts list, its cloud handing them out on its copy pass, its screens hiding what is off).
The two systems stay apart.

## Deploying this

The cloud needs its schema change first (`cloud/migrations/0011_shop_parts.sql`), then the Worker:

```sh
cd cloud
npm run migrate
npm run deploy
```

Wrangler must be signed in to the Cloudflare account that owns `melo`. The shop PCs get their side
with the next release; until the cloud is deployed they keep their defaults.
