import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restartApp } from './restart.ts';
import { Root } from './Root.tsx';
import { SetupWizard } from './SetupWizard.tsx';

vi.mock('./restart.ts', () => ({ restartApp: vi.fn() }));

interface Person { id: string; name: string; role: string; pin: string; active: boolean }

/** The shop server's setup endpoints, remembering what they are told (and refusing as the real one does). */
function fakeShopServer({ done = false, status = 200, newFails = false, updatesOff = false, printer = { status: 'Normal', jobs: 0 } } = {}) {
  const s = { version: '1.0.0', down: false, installedAt: 0, done, cloud: false, shop: null as null | { id: string; name: string; place: string; footer: string; paper?: 58 | 80; payFirst?: boolean }, printed: 0, cleared: 0, printers: ['XP-80T'], usbPorts: [] as string[], drives: [] as { letter: string; label: string; freeBytes: number }[], backups: [] as string[], printer: null as string | null, staff: [] as Person[] };
  const pub = () => s.staff.map(({ pin: _p, ...m }) => m);
  const ownerOk = (pin: unknown) => !s.done || s.staff.some((m) => m.active && m.role === 'owner' && m.pin === pin);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (status !== 200) return new Response('{}', { status });
    if (s.down) throw new TypeError('fetch failed'); // the installer stopped the shop server
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const step = String(url).replace('/api/v1/setup', '');
    const ok = (b: unknown) => Response.json(b);
    const no = (code: number, message: string) => Response.json({ message }, { status: code });
    if (String(url) === '/api/v1/print') { s.printed += 1; return ok({ ok: true }); }
    if (String(url) === '/api/v1/health') { if (s.down) throw new TypeError('fetch failed'); return ok({ ok: true, version: s.version }); }
    if (step === '') return ok({ done: s.done, shop: s.shop, printer: s.printer, printers: s.printers, usbPorts: s.usbPorts, cloud: s.cloud, ...(s.done ? {} : { staff: pub() }) });
    if (!ownerOk(body.ownerPin)) return no(401, "that is not the owner's PIN");
    if (step === '/shop') { const first = !s.shop; s.shop = { id: 'bata-kade-galle', name: body.name, place: body.place, footer: 'Thank you!' }; return ok({ shopId: s.shop.id, ...(first ? { counterToken: 'counter-token' } : {}) }); }
    if (step === '/printer/usb') { s.usbPorts = []; s.printers = [...s.printers, `Receipt printer (${body.port})`]; s.printer = `Receipt printer (${body.port})`; return ok({ printer: s.printer }); }
    if (step === '/pay-when') { s.shop = { ...s.shop!, payFirst: body.payFirst }; return ok({ payFirst: body.payFirst }); }
    if (step === '/paper') { s.shop = { ...s.shop!, paper: body.width }; return ok({ paper: body.width }); }
    if (step === '/printer/state') return ok({ state: { ...printer, jobs: printer.jobs - s.cleared, offline: false } });
    if (step === '/printer/clear') { s.cleared = printer.jobs; return ok({ cleared: printer.jobs }); }
    if (step === '/details') { s.shop = { ...s.shop!, name: body.name, place: body.place, footer: body.footer }; return ok({ shop: s.shop }); }
    if (step === '/printer') { s.printer = body.name; return ok({ printer: body.name }); }
    if (step === '/staff') {
      if (s.staff.some((m) => m.active && m.pin === body.pin)) return no(409, 'someone already has that PIN: choose another');
      s.staff.push({ id: `s${s.staff.length}`, name: body.name, role: body.role, pin: body.pin, active: true });
      return ok({ staff: pub() });
    }
    if (step === '/staff/list') return ok({ staff: pub() });
    if (step === '/pair') return ok(body.kind === 'counter' ? { counterToken: 'second-screen', shopId: 'bata-kade-galle' } : { link: `http://10.0.0.5:8080/?pair=k&as=${body.kind}` });
    if (step === '/cloud') { if (body.code !== 'CB-7K3M-Q9XZ') return no(403, 'that shop code is not right'); s.cloud = true; return ok({ cloud: true }); }
    if (step === '/finish') { s.done = true; return ok({ done: true }); }
    if (step === '/update/check') return ok(updatesOff ? { current: s.version, latest: null, newer: false, off: true } : { current: s.version, latest: '1.0.1', newer: s.version !== '1.0.1' });
    // What station-update.ps1 writes as it goes: downloading (real %), then backing up.
    if (step === '/backup/drives') return ok({ drives: s.drives });
    if (step === '/backup/usb') { s.backups.push(body.drive); return ok({ file: `${body.drive}:\\Lume POS backups\\pos.sqlite`, events: 1234 }); }
    if (step === '/support') return ok({ name: 'Lume POS support 2026-10-21 1432.zip', path: 'C:\\Users\\Public\\Desktop\\x.zip' });
    if (step === '/update/status') {
      const t = Date.now() - s.installedAt;
      return ok({ status: s.installedAt ? { phase: t < 1500 ? 'downloading' : 'backup', percent: t < 1500 ? 30 : 61, version: '1.0.1', at: Date.now() } : null });
    }
    if (step === '/update/install') {
      // The installer stops the server; the new version starts, or (newFails) the updater puts the old one back.
      s.installedAt = Date.now();
      setTimeout(() => { s.down = true; }, 2500);
      setTimeout(() => { s.down = false; if (!newFails) s.version = '1.0.1'; }, 5000);
      return ok({ started: true, from: s.version });
    }
    return no(404, 'no such step');
  }));
  return s;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_SETUP_CHECK', '1');
  vi.mocked(restartApp).mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

test('a new shop: name, printer, staff (owner first), a QR code, finish', async () => {
  const server = fakeShopServer();
  const user = userEvent.setup();
  render(<Root />);

  expect(await screen.findByRole('heading', { name: 'Name your shop' })).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Shop name' }), 'Bata Kade');
  await user.type(screen.getByRole('textbox', { name: 'Town' }), 'Galle{Enter}');
  expect(await screen.findByRole('heading', { name: 'Your receipt printer' })).toBeTruthy();
  expect(localStorage.getItem('cb.sync.token')).toBe('counter-token'); // the PC paired itself as the counter

  await user.click(screen.getByRole('radio', { name: 'XP-80T' }));
  expect(server.printer).toBe('XP-80T');
  await user.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByRole('heading', { name: 'Your staff' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true); // no owner yet
  const form = within(screen.getByRole('form', { name: 'Add a person' }));
  await user.type(form.getByRole('textbox'), 'Nisal Vimukthi');
  expect(form.getByRole('radio', { name: 'Owner' }).getAttribute('aria-checked')).toBe('true'); // owner comes first
  await user.type(form.getByLabelText('Their own 4-digit PIN'), '1234');
  await user.click(form.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Nisal Vimukthi')).toBeTruthy();

  await user.type(form.getByRole('textbox'), 'Kamal');
  await user.type(form.getByLabelText('Their own 4-digit PIN'), '1234');
  await user.click(form.getByRole('button', { name: 'Add' }));
  expect((await screen.findByRole('alert')).textContent).toContain('already has that PIN');

  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('heading', { name: 'Connect to the cloud' })).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Shop code' }), 'cb-0000-0000');
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  expect((await screen.findByRole('alert')).textContent).toBe('that shop code is not right');
  await user.clear(screen.getByRole('textbox', { name: 'Shop code' }));
  await user.type(screen.getByRole('textbox', { name: 'Shop code' }), 'cb-7k3m-q9xz'); // typed in lower case: shown and sent in capitals
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  expect(await screen.findByText('Connected: sales are copied to the cloud.')).toBeTruthy();
  expect(server.cloud).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Next' }));

  expect(await screen.findByRole('heading', { name: 'Connect your devices' })).toBeTruthy();
  // Connected to the cloud, so the owner's phone can have its QR code too.
  expect(within(screen.getByRole('region', { name: "Owner's phone" })).getByRole('button', { name: 'Show QR code' })).toBeTruthy();
  await user.click(within(screen.getByRole('region', { name: 'Kitchen tablet' })).getByRole('button', { name: 'Show QR code' }));
  expect(await screen.findByRole('img', { name: 'QR code for the kitchen tablet' })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Finish' }));
  await vi.waitFor(() => expect(restartApp).toHaveBeenCalled());
  expect(server.done).toBe(true);
});

test('a tablet that has not scanned its code is told so, and never sees a register', async () => {
  fakeShopServer({ status: 403 });
  render(<Root />);
  expect(await screen.findByRole('heading', { name: 'This device is not connected yet' })).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: 'Current order' })).toBeNull();
});

test("a second screen on the shop PC connects with the owner's PIN", async () => {
  const server = fakeShopServer({ done: true });
  server.staff.push({ id: 'o', name: 'Nisal Vimukthi', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<Root />);
  expect(await screen.findByRole('heading', { name: 'Connect this screen as the counter' })).toBeTruthy();
  await user.type(screen.getByLabelText("The owner's PIN"), '9999{Enter}');
  expect((await screen.findByRole('alert')).textContent).toContain("not the owner's PIN");
  await user.clear(screen.getByLabelText("The owner's PIN"));
  await user.type(screen.getByLabelText("The owner's PIN"), '1234{Enter}');
  await vi.waitFor(() => expect(restartApp).toHaveBeenCalled());
  expect(localStorage.getItem('cb.sync.token')).toBe('second-screen');
});

test("Shop setup → Updates: the owner's PIN, a newer version, Update now, back by itself", async () => {
  const server = fakeShopServer({ done: true });
  server.staff.push({ id: 'o', name: 'Nisal Vimukthi', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Updates' }));
  expect(await screen.findByText('1.0.0')).toBeTruthy();
  expect((await screen.findByText(/is ready/)).textContent).toBe('Version 1.0.1 is ready.');

  await user.click(screen.getByRole('button', { name: 'Update now' }));
  const bar = await screen.findByRole('progressbar', { name: 'Update progress' });
  await vi.waitFor(() => expect(screen.getByText('Downloading version 1.0.1')).toBeTruthy(), { timeout: 4000 });
  expect(bar.getAttribute('aria-valuenow')).toBe('30'); // the updater's own download percentage
  await vi.waitFor(() => expect(screen.getByText('Backing up your sales')).toBeTruthy(), { timeout: 4000 });
  await vi.waitFor(() => expect(screen.getByText('Installing')).toBeTruthy(), { timeout: 4000 }); // the server is away: it keeps moving
  expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(65);
  await vi.waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('100'), { timeout: 6000 });
  expect(screen.getByText('Done: opening the new version')).toBeTruthy();
  await vi.waitFor(() => expect(restartApp).toHaveBeenCalled(), { timeout: 3000 }); // the new version answered
}, 25_000);

test("Shop setup → Printer: the owner changes what the receipt says, and every screen's corner follows", async () => {
  const server = fakeShopServer({ done: true });
  server.shop = { id: 'rasikas-kitchen-kandy-ab12', name: "Rasika's Kitchen", place: 'Kandy', footer: 'Thank you!' };
  server.staff.push({ id: 'o', name: 'Rasika', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Printer' }));
  const form = await screen.findByRole('form', { name: 'On the receipt' });
  const save = within(form).getByRole('button', { name: 'Save' });
  expect((save as HTMLButtonElement).disabled).toBe(true); // nothing changed yet

  const name = within(form).getByRole('textbox', { name: 'Shop name' });
  await user.clear(name);
  await user.type(name, "Rasika's Kitchen & Bakery");
  await user.clear(within(form).getByRole('textbox', { name: 'Last line' }));
  await user.type(within(form).getByRole('textbox', { name: 'Last line' }), 'Come again!');
  await user.click(save);
  await vi.waitFor(() => expect(server.shop?.footer).toBe('Come again!'));
  expect(server.shop?.name).toBe("Rasika's Kitchen & Bakery");
  expect(document.querySelector('.brand')?.textContent).toBe("Rasika's Kitchen & Bakery");
});

test('Shop setup → Help: one tap puts the support file on the desktop, and says what is (not) in it', async () => {
  const server = fakeShopServer({ done: true });
  server.staff.push({ id: 'o', name: 'Rasika', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Help' }));
  expect(screen.getByText(/Never your sales, staff, PINs or passwords/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save support file' }));
  expect((await screen.findByRole('status')).textContent).toBe('Saved on the desktop: Lume POS support 2026-10-21 1432.zip');
});

test("Shop setup → Printer: the test receipt, 'Did it come out? No', the likely cause from Windows, stuck receipts cleared; 58 mm paper", async () => {
  const server = fakeShopServer({ done: true, printer: { status: 'PaperOut', jobs: 2 } });
  server.shop = { id: 'shop-ab12', name: 'Shop', place: '', footer: 'Thank you!', paper: 80 };
  server.printer = 'XP-80T';
  server.staff.push({ id: 'o', name: 'Rasika', role: 'owner', pin: '1234', active: true });
  localStorage.setItem('cb.sync.token', 'counter-token'); // this PC is the counter: it prints
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Printer' }));

  await user.click(screen.getByRole('radio', { name: /58 mm paper/ }));
  await vi.waitFor(() => expect(server.shop?.paper).toBe(58));
  await user.click(screen.getByRole('button', { name: 'Print a test receipt' }));
  expect(await screen.findByText('Did a receipt come out?')).toBeTruthy();
  expect(server.printed).toBe(1);
  await user.click(screen.getByRole('button', { name: 'No' }));

  const help = within(await screen.findByRole('region', { name: 'Printer help' }));
  expect(help.getByText('The printer is out of paper, or the paper is stuck.')).toBeTruthy();
  expect(help.getByText(/^2 receipts are waiting in Windows/)).toBeTruthy();
  await user.click(help.getByRole('button', { name: 'Clear the waiting receipts' }));
  expect((await help.findByRole('status')).textContent).toBe('2 waiting receipts cleared.');
  expect(help.queryByRole('button', { name: 'Clear the waiting receipts' })).toBeNull();

  await user.click(help.getByRole('button', { name: 'Try again' }));
  await user.click(await screen.findByRole('button', { name: 'Yes, it printed' }));
  expect(screen.getByText('The printer is ready.')).toBeTruthy();
  expect(server.printed).toBe(2);
});

test("Shop setup → Printer: no printer yet says how to install one, and Look again asks Windows again", async () => {
  const server = fakeShopServer({ done: true });
  server.printers = [];
  server.staff.push({ id: 'o', name: 'Rasika', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Printer' }));
  const none = within(await screen.findByRole('region', { name: 'No printer found' }));
  expect(none.getByText(/Install its Windows driver/)).toBeTruthy();
  server.printers = ['XP-58']; // plugged in and its driver installed
  await user.click(none.getByRole('button', { name: 'Look again' }));
  expect(await screen.findByRole('radio', { name: 'XP-58' })).toBeTruthy();
});

test('Shop setup → Printer: a USB receipt printer without its driver is set up in one tap; a network printer by its IP', async () => {
  const server = fakeShopServer({ done: true });
  server.printers = [];
  server.usbPorts = ['USB001'];
  server.staff.push({ id: 'o', name: 'Rasika', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Printer' }));
  const usb = within(await screen.findByRole('region', { name: 'Printer on USB001' }));
  expect(screen.queryByRole('region', { name: 'No printer found' })).toBeNull();
  await user.click(usb.getByRole('button', { name: 'Set it up' }));
  expect((await screen.findByRole('radio', { name: 'Receipt printer (USB001)' })).getAttribute('aria-checked')).toBe('true');
  expect(server.printer).toBe('Receipt printer (USB001)');

  const net = within(screen.getByRole('form', { name: 'Network printer' }));
  await user.type(net.getByRole('textbox'), 'printer please');
  await user.click(net.getByRole('button', { name: 'Use it' }));
  expect(screen.getByRole('alert').textContent).toMatch(/IP address, like 192\.168\.1\.50/);
  await user.clear(net.getByRole('textbox'));
  await user.type(net.getByRole('textbox'), '192.168.1.50{Enter}');
  expect((await screen.findByRole('radio', { name: 'Network printer 192.168.1.50' })).getAttribute('aria-checked')).toBe('true');
  expect(server.printer).toBe('net:192.168.1.50');
});

test('Shop setup → Backup: plug in a USB stick, look again, save a copy on it', async () => {
  const server = fakeShopServer({ done: true });
  server.staff.push({ id: 'o', name: 'Rasika', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Backup' }));
  expect(await screen.findByText('Plug in a USB stick.')).toBeTruthy();
  server.drives = [{ letter: 'E', label: 'KINGSTON', freeBytes: 8e9 }];
  await user.click(screen.getByRole('button', { name: 'Look again' }));
  await user.click(await screen.findByRole('button', { name: 'Save a copy on KINGSTON (E:)' }));
  expect((await screen.findByRole('status')).textContent).toMatch(/^Saved on KINGSTON \(E:\), in “Lume POS backups” \(1234 records\)/);
  expect(server.backups).toEqual(['E']);
});

test('Shop setup → Updates when automatic updates are switched off: how to update by hand', async () => {
  const server = fakeShopServer({ done: true, updatesOff: true });
  server.staff.push({ id: 'o', name: 'Nisal Vimukthi', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Updates' }));
  expect((await screen.findByText(/Automatic updates are off on this PC/)).textContent).toMatch(/run the new Setup.exe on this PC/);
  expect(screen.getByText('1.0.0')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
});

test('Update now, and the new version does not start: the owner is told it went back, and that the sales are safe', async () => {
  const server = fakeShopServer({ done: true, newFails: true });
  server.staff.push({ id: 'o', name: 'Nisal Vimukthi', role: 'owner', pin: '1234', active: true });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" />);
  await user.type(await screen.findByLabelText("The owner's PIN"), '1234{Enter}');
  await user.click(await screen.findByRole('button', { name: 'Updates' }));
  await user.click(await screen.findByRole('button', { name: 'Update now' }));
  const alert = await screen.findByRole('alert', {}, { timeout: 12_000 });
  expect(alert.textContent).toBe('Version 1.0.1 did not start on this PC, so Lume POS went back to 1.0.0. All sales are safe. Tell whoever looks after your POS.');
  expect(restartApp).not.toHaveBeenCalled();
}, 20_000);

test("Shop setup with the shop server not answering: says so and offers Try again, never loads for ever", async () => {
  fakeShopServer({ done: true, status: 502 });
  const user = userEvent.setup();
  render(<SetupWizard mode="manage" onClose={() => {}} />);
  expect(await screen.findByRole('heading', { name: "Shop setup can't open" })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toMatch(/server on this PC is not answering/);
  vi.unstubAllGlobals();
  fakeShopServer({ done: true });
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText(/PIN/)).toBeTruthy(); // back to the owner's PIN
});
