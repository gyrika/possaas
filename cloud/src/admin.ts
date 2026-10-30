import { PRODUCT_NAME } from '../../src/domain/brand.ts';
import { salesWindows, severity, shopProblems, type ShopProblem } from '../../src/domain/shopHealth.ts';
import { PULL_LIMIT, type PullResponse } from '../../src/domain/sync.ts';
import { isNewer } from '../../src/domain/version.ts';
import { shopClockOff, type D1Like } from './cloud.ts';
import { json, sha256Hex } from './http.ts';

/**
 * /admin: the developer's view of every shop (not the owner's). Which version each
 * Station runs, when it last checked in, how its last update went, what looks wrong there
 * (src/domain/shopHealth.ts; those shops come first), and one tap into a shop's Owner view, read-only.
 * Every sign-in and every shop opened is kept in an audit log (/admin/log), and a shop that leaves
 * can be removed with everything of it (/admin/shops/<id>/remove), by typing its id.
 *
 * Signed in with one long random password (the Worker secret ADMIN_KEY, made by
 * `npm run admin-key` in cloud/). Typed once, it becomes a signed session cookie for
 * 30 days: HttpOnly (no script reads it), Secure, SameSite=Strict, only for /admin,
 * and never in the address. Without ADMIN_KEY, /admin does not exist. The data under
 * /admin/api/ also answers to the password as a Bearer key: the Shops screen on the
 * developer's laptop reads it through its own local server (server/fleet.ts).
 */

const SESSION = 'cb_admin';
const SESSION_DAYS = 30;

const hmacHex = async (key: string, text: string): Promise<string> => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Compares without leaking, through timing, how much of a guess was right. */
const sameText = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const cookie = (req: Request, name: string): string | null =>
  req.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

/** A session that ends at `until` (ms), signed with the admin key. */
export const sessionCookie = async (key: string, until: number): Promise<string> =>
  `${SESSION}=${until}.${await hmacHex(key, `admin-session:${until}`)}; Path=/admin; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Strict`;

/** Is this request signed in (a session the key signed, not yet ended)? */
export const signedIn = async (req: Request, key: string, now: number): Promise<boolean> => {
  const [until, sig] = cookie(req, SESSION)?.split('.') ?? [];
  if (!until || !sig || !/^\d{1,16}$/.test(until) || Number(until) <= now) return false;
  return sameText(sig, await hmacHex(key, `admin-session:${until}`));
};

/** Is this the admin password? (Hashed first, so the comparison is always the same length.) */
export const rightKey = async (typed: string, key: string): Promise<boolean> =>
  sameText(await sha256Hex(typed.trim()), await sha256Hex(key));

// ----- the shop list -----

const COLOMBO = 5.5 * 60 * 60_000; // Sri Lanka: UTC+5:30, no summer time
const DAY = 24 * 60 * 60_000;
export const startOfDayColombo = (t: number): number => Math.floor((t + COLOMBO) / DAY) * DAY - COLOMBO;

export interface ShopRow {
  id: string;
  name: string;
  version: string | null;
  update: { phase: string; percent: number; version: string; at: number } | null;
  lastSeenAt: number | null;
  lastSaleAt: number | null;
  eventsToday: number;
  /** What looks wrong, worst first; empty for a shop that is fine. */
  problems: ShopProblem[];
}

/** The two weeks' closes of the day: the business day and counted minus expected cash (float + cash taken). */
const CLOSES_SQL = `
  SELECT e.tenant_id, e.at, json_extract(e.body, '$.from') AS day_from,
    json_extract(e.body, '$.counted') - json_extract(e.body, '$.float') - json_extract(e.body, '$.count.byTender.cash.cents') AS diff
  FROM shops s JOIN events e ON e.tenant_id = s.id AND e.type = 'day.closed' AND e.at >= ?`;

export const shopRows = async (db: D1Like, now: number, latest: string | null = null): Promise<ShopRow[]> => {
  const windows = salesWindows(now);
  const [{ results: sales }, { results: closes }] = await Promise.all([
    db.prepare(`SELECT tenant_id, paid_at FROM sales WHERE status = 'paid' AND (${windows.map(() => '(paid_at >= ? AND paid_at < ?)').join(' OR ')})`)
      .bind(...windows.flat()).all<{ tenant_id: string; paid_at: number }>(),
    db.prepare(CLOSES_SQL).bind(now - 15 * DAY).all<{ tenant_id: string; at: number; day_from: number; diff: number }>(),
  ]);
  const salesOf = new Map<string, number[]>();
  for (const r of sales) (salesOf.get(r.tenant_id) ?? salesOf.set(r.tenant_id, []).get(r.tenant_id)!).push(r.paid_at);
  const closesOf = new Map<string, { from: number; at: number; difference: number }[]>();
  for (const r of closes) (closesOf.get(r.tenant_id) ?? closesOf.set(r.tenant_id, []).get(r.tenant_id)!).push({ from: r.day_from, at: r.at, difference: r.diff });

  const { results } = await db.prepare(`
    SELECT s.id, s.name, d.version, d.update_status, d.last_seen_at, d.clock_off_ms,
      (SELECT MAX(at) FROM events e WHERE e.tenant_id = s.id AND e.type = 'order.paid') AS last_sale,
      (SELECT COUNT(*) FROM events e WHERE e.tenant_id = s.id AND e.at >= ?) AS events_today
    FROM shops s LEFT JOIN devices d ON d.tenant_id = s.id AND d.kind = 'shop_server'
    ORDER BY COALESCE(d.last_seen_at, 0) DESC, s.name`)
    .bind(startOfDayColombo(now))
    .all<{ id: string; name: string; version: string | null; update_status: string | null; last_seen_at: number | null; clock_off_ms: number | null; last_sale: number | null; events_today: number }>();
  const rows = results.map((r): ShopRow => {
    const update = r.update_status ? (JSON.parse(r.update_status) as ShopRow['update']) : null;
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      update,
      lastSeenAt: r.last_seen_at,
      lastSaleAt: r.last_sale,
      eventsToday: r.events_today,
      problems: shopProblems({
        lastSeenAt: r.last_seen_at, version: r.version, update, latest, clockOffMs: r.clock_off_ms,
        sales: salesOf.get(r.id) ?? [], closes: closesOf.get(r.id) ?? [], now,
      }),
    };
  });
  // Shops with something wrong first (the worst at the top); within each, the last heard from first, as the query had it.
  return rows.map((r, i) => ({ r, i })).sort((a, b) => severity(a.r.problems) - severity(b.r.problems) || a.i - b.i).map((x) => x.r);
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export const ago = (t: number | null, now: number): string => {
  if (t === null) return 'never';
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
};

/** Online: checked in within 2 minutes (it does every 30 s while the internet is up). */
export const isOnline = (row: ShopRow, now: number): boolean => row.lastSeenAt !== null && now - row.lastSeenAt < 2 * 60_000;

const UPDATE_WORDS: Record<string, string> = {
  done: 'Updated', back: 'Went back', failed: 'Update failed', 'going-back': 'Going back', 'up-to-date': 'Up to date',
  checking: 'Checking', downloading: 'Downloading', backup: 'Backing up', installing: 'Installing', starting: 'Starting',
};

const STYLE = `:root{--bg:#F2F1EF;--card:#FFF;--fg:#1C1C1E;--muted:#6E6D72;--line:#E3E1DE;--ok:#1E7A4F;--warn:#9A6514;--bad:#C8363B}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1C1C1E;--fg:#F5F5F7;--muted:#A1A1A6;--line:#3A3A3C;--ok:#30A46C;--warn:#E8A94B;--bad:#E5484D;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 "DM Sans",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px;display:flex;flex-direction:column;gap:14px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
h1{margin:0;font-size:28px;letter-spacing:-.5px}
.lead{margin:0 0 6px;color:var(--muted)}
.shop{position:relative;display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:16px 18px;border-radius:16px;background:var(--card);border:1px solid transparent}
.shop:hover,.shop:focus-within{border-color:var(--line)}
.name{font-weight:600;font-size:18px;grid-column:1;color:inherit;text-decoration:none}
.name::after{content:"";position:absolute;inset:0;border-radius:16px}
.name:focus-visible{outline:none}
.remove{position:relative;z-index:1;color:var(--muted)}
a{color:inherit}
nav{display:flex;gap:8px;align-items:center}
table{width:100%;border-collapse:collapse;font-size:14px;background:var(--card);border-radius:16px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500}
.danger{background:var(--bad);color:#fff}
.box{background:var(--card);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.box p{margin:0}
.state{grid-column:2;grid-row:1;font-size:14px;font-weight:600}
.state.on{color:var(--ok)}.state.off{color:var(--muted)}
.id{grid-column:1/-1;color:var(--muted);font-size:13px}
.facts{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:6px;font-size:14px;color:var(--muted)}
.warn{color:var(--warn)}.bad{color:var(--bad)}
.problems{grid-column:1/-1;list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;font-weight:500}
.problems li::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;margin-right:8px;vertical-align:1px}
.shop.is-bad{border-left:5px solid var(--bad)}.shop.is-warn{border-left:5px solid var(--warn)}
.empty{color:var(--muted)}
form{display:flex;flex-direction:column;gap:12px}
input{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-height:50px;width:100%}
input:focus{outline:2px solid var(--fg);outline-offset:1px}
button{font:inherit;font-weight:600;min-height:50px;padding:0 24px;border-radius:12px;border:0;background:var(--fg);color:var(--bg);cursor:pointer}
.quiet{min-height:48px;padding:0 14px;background:transparent;color:var(--muted);border:1px solid var(--line)}
.signin{max-width:420px;margin-top:12vh}`;

const shell = (title: string, body: string, refresh = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>${refresh ? '\n<meta http-equiv="refresh" content="30">' : ''}
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/icons/favicon-32.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap">
<style>${STYLE}</style></head><body>${body}</body></html>`;

/** The sign-in box, and nothing else, for anyone without a session. */
const TITLE = `${PRODUCT_NAME} admin`;
export const signInPage = (wrong: boolean): string => shell(TITLE, `<main class="signin">
<h1>${TITLE}</h1>
<form method="post" action="/admin/login">
  <input name="key" type="password" autocomplete="current-password" aria-label="Admin password" placeholder="Admin password" required autofocus>
  ${wrong ? '<p class="bad" role="alert">That password is not right.</p>' : ''}
  <button type="submit">Sign in</button>
</form>
</main>`);

export const adminPage = (rows: ShopRow[], latest: string | null, now: number): string => {
  const online = rows.filter((r) => isOnline(r, now)).length;
  const behind = rows.filter((r) => latest && r.version && isNewer(latest, r.version)).length;
  const attention = rows.filter((r) => r.problems.length).length;
  const row = (r: ShopRow) => {
    const on = isOnline(r, now);
    const old = !!(latest && r.version && isNewer(latest, r.version));
    const upd = r.update
      ? `${UPDATE_WORDS[r.update.phase] ?? r.update.phase}${r.update.version ? ` ${esc(r.update.version)}` : ''} · ${ago(r.update.at, now)}`
      : 'No update yet';
    const bad = r.update && ['failed', 'back'].includes(r.update.phase);
    const level = ['is-bad', 'is-warn', ''][severity(r.problems)];
    const problems = r.problems.length
      ? `\n  <ul class="problems">${r.problems.map((p) => `<li class="${p.level}">${esc(p.text)}</li>`).join('')}</ul>`
      : '';
    const id = encodeURIComponent(r.id);
    return `<article class="${level ? `shop ${level}` : 'shop'}">
  <span class="state ${on ? 'on' : 'off'}">${on ? 'Online' : `Offline · ${ago(r.lastSeenAt, now)}`}</span>
  <a class="name" href="/admin/shop/${id}#owner">${esc(r.name)}</a>
  <span class="id">${esc(r.id)}</span>${problems}
  <span class="facts">
    <span class="${old ? 'warn' : ''}">Version ${esc(r.version ?? 'unknown')}${old ? ` · ${esc(latest!)} waiting` : ''}</span>
    <span class="${bad ? 'bad' : ''}">${upd}</span>
    <span>Last sale ${ago(r.lastSaleAt, now)} · ${r.eventsToday} events today</span>
    <a class="remove" href="/admin/shops/${id}/remove">Remove</a>
  </span>
</article>`;
  };
  return shell(TITLE, `<main>
<header><h1>Shops</h1>${NAV}</header>
<p class="lead">${attention ? `${attention} need${attention === 1 ? 's' : ''} attention · ` : rows.length ? 'All fine · ' : ''}${online} of ${rows.length} online · latest release ${esc(latest ?? 'unknown')}${behind ? ` · ${behind} still to update` : ''}</p>
${rows.length ? rows.map(row).join('\n') : '<p class="empty">No shops yet.</p>'}
</main>`, true);
};

const NAV = '<nav><a href="/admin/log">Activity</a><form method="post" action="/admin/logout"><button class="quiet" type="submit">Sign out</button></form></nav>';

// ----- the audit log -----

export type AdminAction = 'signed-in' | 'wrong-password' | 'signed-out' | 'opened-shop' | 'read-shop' | 'removed-shop';
type Via = 'browser' | 'key';

const ACTION_WORDS: Record<AdminAction, string> = {
  'signed-in': 'Signed in', 'wrong-password': 'Wrong password', 'signed-out': 'Signed out',
  'opened-shop': 'Opened the shop', 'read-shop': "Read the shop's data", 'removed-shop': 'Removed the shop',
};

export interface LogRow { at: number; action: AdminAction; shop_id: string | null; shop_name: string | null; via: Via; ip: string | null }

const logStatement = (db: D1Like, req: Request, now: number, action: AdminAction, via: Via, shop?: { id: string; name: string | null }) =>
  db.prepare('INSERT INTO admin_log (at, action, shop_id, shop_name, via, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(now, action, shop?.id ?? null, shop?.name ?? null, via, req.headers.get('cf-connecting-ip'));

const shopName = async (db: D1Like, id: string): Promise<string | null> =>
  (await db.prepare('SELECT name FROM shops WHERE id = ?').bind(id).first<{ name: string }>())?.name ?? null;

const colombo = (t: number) => new Date(t + COLOMBO).toISOString().slice(0, 16).replace('T', ' ');

export const logPage = (rows: LogRow[]): string => shell(TITLE, `<main>
<header><h1>Activity</h1>${NAV}</header>
<p class="lead"><a href="/admin">← Shops</a> · the last ${rows.length} things done in admin, Sri Lanka time</p>
${rows.length ? `<table><thead><tr><th>When</th><th>What</th><th>Shop</th><th>From</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${colombo(r.at)}</td><td class="${r.action === 'wrong-password' || r.action === 'removed-shop' ? 'bad' : ''}">${ACTION_WORDS[r.action] ?? esc(r.action)}</td><td>${r.shop_id ? `${esc(r.shop_name ?? '')} <span class="id">${esc(r.shop_id)}</span>` : ''}</td><td>${r.via === 'key' ? 'Laptop' : 'Browser'}${r.ip ? ` · ${esc(r.ip)}` : ''}</td></tr>`).join('\n')}
</tbody></table>` : '<p class="empty">Nothing yet.</p>'}
</main>`);

// ----- removing a shop -----

/** Every table that holds a shop's rows; the shop itself goes last. */
const SHOP_TABLES = ['sale_items', 'sales', 'sales_cursor', 'inbox', 'photos', 'online_orders', 'devices', 'events'];

export const removePage = (shop: { id: string; name: string }, counts: { events: number; sales: number; devices: number }, wrong = false): string => shell(TITLE, `<main>
<header><h1>Remove ${esc(shop.name)}</h1>${NAV}</header>
<p class="lead"><a href="/admin">← Shops</a></p>
<form class="box" method="post">
  <p>This removes <strong>${esc(shop.name)}</strong> from the cloud for good: ${counts.events} events, ${counts.sales} sales and ${counts.devices} linked devices (the shop PC, owner and manager phones). It cannot be undone.</p>
  <p>The shop PC keeps all its own data and goes on selling; it just stops copying to the cloud, and the owner's phone stops showing the shop.</p>
  <label for="confirm">Type the shop's id, <strong>${esc(shop.id)}</strong>, to remove it</label>
  <input id="confirm" name="confirm" autocomplete="off" spellcheck="false" required autofocus>
  ${wrong ? '<p class="bad" role="alert">That is not this shop\'s id. Nothing was removed.</p>' : ''}
  <button class="danger" type="submit">Remove for good</button>
</form>
</main>`);

// ----- routes -----

export interface AdminOptions {
  db: D1Like;
  /** The admin password (Worker secret ADMIN_KEY), or null: then /admin does not exist. */
  key: string | null;
  latest: () => Promise<string | null>;
  /** The Owner view (the cloud build's index.html), for one shop. */
  app: (req: Request) => Promise<Response>;
  now?: () => number;
}

const notFound = () => new Response('Not found', { status: 404 });
const html = (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, {
  status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...extra },
});
const back = (cookieHeader: string) => new Response(null, { status: 303, headers: { location: '/admin', 'set-cookie': cookieHeader, 'cache-control': 'no-store' } });

/** A key too short to be the generated one is refused outright: /admin stays shut. */
export const MIN_KEY_LENGTH = 32;

/** Everything under /admin, or null for other paths. */
export const adminRoutes = async (req: Request, url: URL, o: AdminOptions): Promise<Response | null> => {
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return null;
  if (!o.key || o.key.length < MIN_KEY_LENGTH) return notFound(); // not set up: /admin does not exist
  const now = (o.now ?? Date.now)();

  if (url.pathname === '/admin/login' && req.method === 'POST') {
    const typed = String((await req.formData().catch(() => null))?.get('key') ?? '');
    if (!(await rightKey(typed, o.key))) {
      await logStatement(o.db, req, now, 'wrong-password', 'browser').run();
      return html(signInPage(true), 401);
    }
    await logStatement(o.db, req, now, 'signed-in', 'browser').run();
    return back(await sessionCookie(o.key, now + SESSION_DAYS * 86_400_000));
  }
  if (url.pathname === '/admin/logout' && req.method === 'POST') {
    if (await signedIn(req, o.key, now)) await logStatement(o.db, req, now, 'signed-out', 'browser').run();
    return back(`${SESSION}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  }

  // The developer's own laptop (its local server, `server/fleet.ts`) asks for data with the password as a key.
  const auth = req.headers.get('authorization');
  const byKey = url.pathname.startsWith('/admin/api/') && auth?.startsWith('Bearer ') && await rightKey(auth.slice(7), o.key);
  if (!byKey && !(await signedIn(req, o.key, now))) {
    return url.pathname === '/admin' || url.pathname === '/admin/' ? html(signInPage(false)) : new Response('Sign in at /admin', { status: 403 });
  }
  const via: Via = byKey ? 'key' : 'browser';

  // Removing a shop: the signed-in pages only (never the laptop's key), and only by typing its id.
  const remove = /^\/admin\/shops\/([a-z0-9-]{1,64})\/remove$/.exec(url.pathname);
  if (remove && !byKey) {
    const id = remove[1];
    const name = await shopName(o.db, id);
    if (name === null) return notFound();
    const count = async (table: string) =>
      (await o.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`).bind(id).first<{ n: number }>())?.n ?? 0;
    const counts = async () => ({ events: await count('events'), sales: await count('sales'), devices: await count('devices') });
    if (req.method === 'GET') return html(removePage({ id, name }, await counts()));
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const typed = String((await req.formData().catch(() => null))?.get('confirm') ?? '').trim();
    if (typed !== id) return html(removePage({ id, name }, await counts(), true), 400);
    // One transaction: the shop is marked (the only way its events may be deleted), emptied, gone, and logged.
    await o.db.batch([
      o.db.prepare('UPDATE shops SET removing = 1 WHERE id = ?').bind(id),
      ...SHOP_TABLES.map((t) => o.db.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).bind(id)),
      o.db.prepare('DELETE FROM shops WHERE id = ?').bind(id),
      logStatement(o.db, req, now, 'removed-shop', via, { id, name }),
    ]);
    return new Response(null, { status: 303, headers: { location: '/admin', 'cache-control': 'no-store' } });
  }
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  if (url.pathname === '/admin/log' && !byKey) {
    const { results } = await o.db.prepare('SELECT at, action, shop_id, shop_name, via, ip FROM admin_log ORDER BY id DESC LIMIT 200').all<LogRow>();
    return html(logPage(results));
  }

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    const latest = await o.latest();
    return html(adminPage(await shopRows(o.db, now, latest), latest, now));
  }
  if (url.pathname === '/admin/api/shops') {
    const latest = await o.latest();
    return json(200, { shops: await shopRows(o.db, now, latest), latest, serverTime: now });
  }

  // One shop's events, for its Owner view: the same answer an owner's phone gets, for any shop.
  const events = /^\/admin\/api\/shops\/([a-z0-9-]{1,64})\/events$/.exec(url.pathname);
  if (events) {
    const shop = events[1];
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    // Logged once per reading (from the start), not for every page or every refresh after it.
    if (after === 0) await logStatement(o.db, req, now, 'read-shop', via, { id: shop, name: await shopName(o.db, shop) }).run();
    const limit = Math.min(PULL_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || PULL_LIMIT));
    const { results } = await o.db.prepare(
      'SELECT seq, source_device, received_at, body FROM events WHERE tenant_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .bind(shop, after, limit + 1)
      .all<{ seq: number; source_device: string; received_at: number; body: string }>();
    const page = results.slice(0, limit).map((r) => ({
      event: JSON.parse(r.body), deviceId: r.source_device, seq: r.seq, receivedAt: r.received_at,
    }));
    const clockOffMs = await shopClockOff(o.db, shop);
    return json(200, {
      events: page, lastSeq: page.at(-1)?.seq ?? after, more: results.length > limit, serverTime: now,
      ...(clockOffMs !== null ? { clockOffMs } : {}),
    } satisfies PullResponse);
  }

  if (/^\/admin\/shop\/[a-z0-9-]{1,64}$/.test(url.pathname)) {
    const id = url.pathname.slice('/admin/shop/'.length);
    const name = await shopName(o.db, id);
    if (name === null) return notFound();
    await logStatement(o.db, req, now, 'opened-shop', via, { id, name }).run();
    // The app's page as the site's root serves it ('/index.html' would answer with a redirect to '/',
    // which would take the browser off this shop's address).
    const page = await o.app(new Request(new URL('/', url), { headers: req.headers }));
    if (page.status !== 200) return new Response('The Owner view is not available', { status: 502 });
    // The Owner view's own files, but never cached and never sent on as a referrer.
    const headers = new Headers(page.headers);
    headers.set('cache-control', 'no-store');
    headers.set('referrer-policy', 'no-referrer');
    return new Response(page.body, { status: page.status, headers });
  }
  return notFound();
};
