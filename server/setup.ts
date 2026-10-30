import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { Role } from '../src/domain/auth.ts';
import { DEFAULT_FOOTER } from '../src/domain/brand.ts';
import type { PaperWidth } from '../src/domain/receipt.ts';
import { isPin } from './pins.ts';
import { dryRunPrinter, listPrinters, networkAddress, printerFor, type RawPrinter } from './printer.ts';
import { printerQueue, type PrinterQueue } from './printerStatus.ts';
import type { UsbBackup } from './usbBackup.ts';
import type { Settings } from './settings.ts';
import { PinTaken, type EventStore, type StaffMember } from './store.ts';
import type { UpdatesApi } from './updates.ts';

/**
 * The setup wizard's side of the server: the shop, the printer, the staff and
 * pairing devices (QR codes). It answers ONLY the shop PC itself (localhost):
 * a tablet on the Wi-Fi, or anyone else, cannot set up or change the shop.
 * While the shop is new, the PC alone is enough; once set up, every change
 * also needs the owner's PIN.
 */
export interface SetupContext {
  store: EventStore;
  /** The logo a shop shows until the owner picks another (possaas: Bata Kade's, server/shopLogo.ts). */
  defaultLogo?: string;
  settings: Settings;
  usePrinter: (p: RawPrinter) => void;
  printsDir: string;
  port: number;
  /** The cloud copy as it stands now (null: not connected), for owner-phone links. */
  cloud: () => { url: string; token: string } | null;
  /** Where a new shop registers itself with the shop code. */
  cloudUrl: string;
  /** The wizard connected the cloud: start copying, no restart. */
  onCloudConnected?: () => void;
  /** The Station's versions ("Update now"). */
  updates?: UpdatesApi;
  /** Windows' view of the printer, for "Did it print? No" (tests pass their own). */
  queue?: PrinterQueue;
  /** Shop setup → Backup: a copy of the sales on a USB stick (server/usbBackup.ts). */
  usb?: UsbBackup;
  /** Shop setup → Help: the support file on the desktop (server/supportFile.ts). */
  support?: () => Promise<{ path: string; name: string }>;
  fetch?: typeof fetch;
  now?: () => number;
}

/** What every screen and the receipt show (GET /api/v1/shop-details): the shop's own name, never the product's. */
export interface ShopInfo { name: string; place: string; footer: string; paper: PaperWidth; payFirst: boolean; logo?: string }

/** The logo the counter has already made small (256 px): a PNG, JPEG or WebP data: URL. */
export const MAX_LOGO = 200_000;
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export interface SetupState {
  done: boolean;
  shop: ({ id: string } & ShopInfo) | null;
  printer: string | null;
  printers: string[];
  /** USB printer ports with no printer on them: a receipt printer plugged in without its driver. */
  usbPorts: string[];
  cloud: boolean;
  /** Only while the shop is new; afterwards the staff list needs the owner's PIN. */
  staff?: StaffMember[];
}

export class SetupError extends Error {
  status: number;
  code: 'forbidden' | 'wrong_pin' | 'too_many' | 'invalid' | 'not_ready';
  constructor(status: number, code: SetupError['code'], message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ROLES: Role[] = ['cashier', 'manager', 'owner', 'kitchen'];
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLocal = (req: IncomingMessage): boolean => LOCAL.has(req.socket.remoteAddress ?? '');

/** "Bata Kade", "Galle" -> "bata-kade-galle". */
export const shopIdFor = (name: string, place: string): string =>
  `${name} ${place}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'shop';

/** The address a tablet on the shop's Wi-Fi uses to reach this PC. */
const lanAddress = (): string | null =>
  Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address ?? null;

export function setupApi(ctx: SetupContext) {
  const now = ctx.now ?? Date.now;
  const http = ctx.fetch ?? fetch;
  const wrong = { count: 0, until: 0 };
  const queue = ctx.queue ?? printerQueue();

  const shop = () => {
    const s = ctx.settings.get();
    const logo = s.logo ?? ctx.defaultLogo;
    return s.shopId
      ? { id: s.shopId, name: s.shopName ?? s.shopId, place: s.place ?? '', footer: s.receiptFooter ?? DEFAULT_FOOTER, paper: s.paperWidth ?? 80,
        payFirst: s.payFirst === true, ...(logo ? { logo } : {}) }
      : null;
  };
  const requireShop = () => {
    const s = shop();
    if (!s) throw new SetupError(409, 'not_ready', 'name the shop first');
    return s;
  };

  /** Before setup is done, the PC itself is enough; after, the owner's PIN too. */
  const authorise = async (ownerPin: unknown): Promise<void> => {
    if (!ctx.settings.get().setupDone) return;
    if (wrong.until > now()) throw new SetupError(429, 'too_many', 'too many wrong PINs: wait a moment');
    const s = shop();
    const who = s && isPin(ownerPin) ? await ctx.store.staffByPin(s.id, ownerPin) : null;
    if (!who || who.role !== 'owner') {
      wrong.count += 1;
      if (wrong.count >= 5) { wrong.count = 0; wrong.until = now() + 30_000; }
      throw new SetupError(401, 'wrong_pin', "that is not the owner's PIN");
    }
    wrong.count = 0;
  };

  const choosePrinter = (name: string | null) => {
    ctx.usePrinter(name ? printerFor(name) : dryRunPrinter(ctx.printsDir));
    ctx.settings.set({ printer: name ?? undefined });
  };

  return {
    choosePrinter,

    /** For every screen on the shop's network (no PIN: it is printed on every receipt anyway). */
    publicShop(): ShopInfo | null {
      const s = shop();
      return s ? { name: s.name, place: s.place, footer: s.footer, paper: s.paper, payFirst: s.payFirst, ...(s.logo ? { logo: s.logo } : {}) } : null;
    },

    async state(): Promise<SetupState> {
      const s = ctx.settings.get();
      const current = shop();
      return {
        done: Boolean(s.setupDone),
        shop: current,
        printer: s.printer ?? null,
        printers: await listPrinters(),
        usbPorts: await queue.freeUsbPorts(),
        cloud: ctx.cloud() !== null,
        ...(!s.setupDone && current ? { staff: await ctx.store.listStaff(current.id) } : {}),
      };
    },

    /** Step 1: name the shop. The first time, this PC also becomes the counter (its token comes back once). */
    async nameShop(body: { name?: unknown; place?: unknown }) {
      if (ctx.settings.get().setupDone) throw new SetupError(409, 'invalid', 'the shop is already set up');
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      const place = typeof body.place === 'string' ? body.place.trim().slice(0, 80) : '';
      if (!name) throw new SetupError(400, 'invalid', 'the shop needs a name');
      const existing = shop();
      // A short random ending: two shops (or a test install) with the same name never mix in the cloud.
      const id = existing?.id ?? `${shopIdFor(name, place)}-${randomBytes(3).toString('hex').slice(0, 4)}`;
      ctx.settings.set({ shopId: id, shopName: name, place });
      if (existing) return { shopId: id };
      const { token } = await ctx.store.addDevice(id, `${name} ${place}`.trim(), 'counter');
      return { shopId: id, counterToken: token };
    },

    /** Shop setup → Printer: the name, town and footer the receipt (and the screens) show. The shop's id never changes. */
    async shopDetails(body: { name?: unknown; place?: unknown; footer?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      requireShop();
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (!name) throw new SetupError(400, 'invalid', 'the shop needs a name');
      const place = typeof body.place === 'string' ? body.place.trim().slice(0, 80) : '';
      const footer = typeof body.footer === 'string' ? body.footer.trim().slice(0, 120) : DEFAULT_FOOTER;
      ctx.settings.set({ shopName: name, place, receiptFooter: footer });
      return { shop: shop() };
    },

    /** Shop setup → Printer: the logo beside the shop's name on every screen; null takes it away. */
    async setLogo(body: { logo?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      requireShop();
      if (body.logo === null) { ctx.settings.set({ logo: '' }); return { logo: null }; } // '': none, not the shop's own
      if (typeof body.logo !== 'string' || body.logo.length > MAX_LOGO || !LOGO.test(body.logo)) {
        throw new SetupError(400, 'invalid', 'the logo is a PNG, JPEG or WebP picture under 200 KB');
      }
      ctx.settings.set({ logo: body.logo });
      return { logo: body.logo };
    },

    /** Shop setup → Printer: 80 mm or 58 mm paper; the receipt is laid out for it. */
    async setPaper(body: { width?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      if (body.width !== 58 && body.width !== 80) throw new SetupError(400, 'invalid', 'the paper is 58 or 80 mm');
      ctx.settings.set({ paperWidth: body.width });
      return { paper: body.width };
    },

    /** Shop setup → Shop: customers pay before the order goes to the kitchen, or eat first and pay after. */
    async setPayWhen(body: { payFirst?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      requireShop();
      if (typeof body.payFirst !== 'boolean') throw new SetupError(400, 'invalid', 'say whether customers pay first');
      ctx.settings.set({ payFirst: body.payFirst });
      return { payFirst: body.payFirst };
    },

    /** "Did it print? No": what Windows knows about the chosen printer. */
    async printerState(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      const name = ctx.settings.get().printer;
      if (!name) throw new SetupError(409, 'not_ready', 'choose a printer first');
      return { state: await queue.state(name) };
    },

    /** A USB receipt printer without its maker's driver: set up with Windows' own, and chosen. */
    async addUsbPrinter(body: { port?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      if (typeof body.port !== 'string' || !(await queue.freeUsbPorts()).includes(body.port)) throw new SetupError(400, 'invalid', 'no receipt printer waiting on that USB port');
      const name = await queue.addUsbPrinter(body.port);
      choosePrinter(name);
      return { printer: name };
    },

    /** Clears receipts stuck in the chosen printer's queue. */
    async clearPrinter(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      const name = ctx.settings.get().printer;
      if (!name) throw new SetupError(409, 'not_ready', 'choose a printer first');
      return { cleared: await queue.clear(name) };
    },

    async setPrinter(body: { name?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
      if (name && !networkAddress(name) && !(await listPrinters()).includes(name)) throw new SetupError(400, 'invalid', `no printer called ${name}`);
      choosePrinter(name);
      return { printer: name };
    },

    async staff(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      return { staff: await ctx.store.listStaff(requireShop().id) };
    },

    async addStaff(body: { name?: unknown; role?: unknown; pin?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      const s = requireShop();
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (!name) throw new SetupError(400, 'invalid', 'a name is needed');
      if (!ROLES.includes(body.role as Role)) throw new SetupError(400, 'invalid', 'pick a role');
      if (!isPin(body.pin)) throw new SetupError(400, 'invalid', 'the PIN must be 4 digits');
      try {
        await ctx.store.addStaff(s.id, name, body.role as Role, body.pin);
      } catch (e) {
        if (e instanceof PinTaken) throw new SetupError(409, 'invalid', 'someone already has that PIN: choose another');
        throw e;
      }
      return { staff: await ctx.store.listStaff(s.id) };
    },

    async removeStaff(body: { id?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      const s = requireShop();
      const list = await ctx.store.listStaff(s.id);
      const target = list.find((m) => m.id === body.id && m.active);
      if (!target) throw new SetupError(404, 'invalid', 'no such person');
      if (target.role === 'owner' && list.filter((m) => m.active && m.role === 'owner').length === 1) {
        throw new SetupError(409, 'invalid', 'the shop needs at least one owner');
      }
      await ctx.store.deactivateStaff(s.id, target.id);
      return { staff: await ctx.store.listStaff(s.id) };
    },

    /**
     * A QR code's link. kitchen: a tablet on the shop Wi-Fi becomes the Kitchen screen (with
     * `station`, the left or right one of a shop with two kitchens).
     * owner: a phone gets the Owner view from the cloud. counter: another screen on this PC.
     */
    async pair(body: { kind?: unknown; ownerPin?: unknown; station?: unknown }) {
      await authorise(body.ownerPin);
      const s = requireShop();
      if (body.kind === 'owner') {
        const cloud = ctx.cloud();
        if (!cloud) throw new SetupError(409, 'not_ready', 'connect the cloud copy first');
        const r = await http(`${cloud.url}/api/v1/devices`, {
          method: 'POST', headers: { authorization: `Bearer ${cloud.token}`, 'content-type': 'application/json' },
          body: '{}', signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) throw new SetupError(502, 'not_ready', 'the cloud did not answer: is the internet up?');
        const { token } = (await r.json()) as { token: string };
        return { link: `${cloud.url}/?owner=${token}#owner` };
      }
      if (body.kind === 'kitchen') {
        if (body.station !== undefined && body.station !== 'left' && body.station !== 'right') {
          throw new SetupError(400, 'invalid', 'station must be left or right');
        }
        const host = lanAddress();
        if (!host) throw new SetupError(409, 'not_ready', 'this PC is not on a network: connect it to the shop Wi-Fi');
        const { token } = await ctx.store.addDevice(s.id, s.name, 'kitchen');
        return { link: `http://${host}:${ctx.port}/?pair=${token}&shop=${encodeURIComponent(s.id)}&as=kitchen${body.station ? `&station=${body.station}` : ''}#kitchen` };
      }
      if (body.kind === 'counter') {
        const { token } = await ctx.store.addDevice(s.id, s.name, 'counter');
        return { counterToken: token, shopId: s.id };
      }
      throw new SetupError(400, 'invalid', 'kind must be kitchen, owner or counter');
    },

    /**
     * The cloud copy, with the shop code the developer gave: this shop server registers
     * itself, keeps its key, and starts copying sales straight away.
     */
    async connectCloud(body: { code?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      const s = requireShop();
      if (typeof body.code !== 'string' || !body.code.trim()) throw new SetupError(400, 'invalid', 'type the shop code');
      // Made once and kept before asking, so a lost answer can simply be tried again.
      const secret = ctx.settings.get().cloudSecret ?? ctx.settings.set({ cloudSecret: randomBytes(32).toString('base64url') }).cloudSecret!;
      let r: Response;
      try {
        r = await http(`${ctx.cloudUrl}/api/v1/enrol`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: body.code, shopId: s.id, name: `${s.name} ${s.place}`.trim(), secret }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new SetupError(502, 'not_ready', 'the cloud did not answer: is the internet up?');
      }
      if (r.status === 403) throw new SetupError(403, 'invalid', 'that shop code is not right');
      if (r.status === 409) throw new SetupError(409, 'invalid', 'this shop is already connected to the cloud from another computer');
      if (!r.ok) throw new SetupError(502, 'not_ready', 'the cloud did not answer: try again in a minute');
      const { token } = (await r.json()) as { token: string };
      ctx.settings.set({ cloudUrl: ctx.cloudUrl, cloudToken: token });
      ctx.onCloudConnected?.();
      return { cloud: true };
    },

    /** Shop setup → Backup: the USB sticks plugged in now. */
    async backupDrives(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      return { drives: ctx.usb ? await ctx.usb.drives() : [] };
    },

    /** Copies the sales onto the chosen USB stick. */
    async backupToUsb(body: { drive?: unknown; ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      if (!ctx.usb || typeof body.drive !== 'string') throw new SetupError(400, 'invalid', 'choose a USB stick');
      try { return await ctx.usb.save(body.drive); }
      catch (e) { throw new SetupError(409, 'not_ready', e instanceof Error ? e.message : String(e)); }
    },

    /** Shop setup → Help: saves the support file on this PC's desktop and says where. */
    async saveSupport(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      if (!ctx.support) throw new SetupError(409, 'not_ready', 'no support file here');
      const { name, path } = await ctx.support();
      return { name, path };
    },

    /** Shop setup → Updates: the installed version and GitHub's latest. */
    async checkUpdate(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      if (!ctx.updates) throw new SetupError(409, 'not_ready', 'no updates here');
      try { return await ctx.updates.check(); }
      catch { throw new SetupError(502, 'not_ready', 'GitHub did not answer: is the internet up?'); }
    },

    /** "Update now": the owner asked, so it runs even during service (the nightly one waits). */
    /** The progress bar: the updater's latest step (null when it has not said anything yet). */
    async updateStatus(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      return { status: ctx.updates?.status() ?? null };
    },

    async installUpdate(body: { ownerPin?: unknown }) {
      await authorise(body.ownerPin);
      if (!ctx.updates) throw new SetupError(409, 'not_ready', 'no updates here');
      try { ctx.updates.install(); } catch (e) { throw new SetupError(409, 'not_ready', e instanceof Error ? e.message : String(e)); }
      return { started: true, from: ctx.updates.current() };
    },

    /** Last step: there must be an owner, or nobody could ever change the shop again. */
    async finish() {
      const s = requireShop();
      if (!(await ctx.store.listStaff(s.id)).some((m) => m.active && m.role === 'owner')) {
        throw new SetupError(409, 'invalid', 'add the owner first');
      }
      ctx.settings.set({ setupDone: true });
      return { done: true };
    },
  };
}
export type SetupApi = ReturnType<typeof setupApi>;
