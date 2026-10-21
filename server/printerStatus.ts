import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import type { PrinterState } from '../src/domain/printerHelp.ts';
import { networkAddress } from './printer.ts';

/**
 * What Windows knows about the receipt printer (its state, and receipts waiting in its queue), and
 * clearing that queue, for Shop setup → Printer's "Did it print? No"; whether a network printer
 * answers; and a USB receipt printer whose maker's driver is not installed, set up with Windows' own
 * "Generic / Text Only" driver (it passes the receipt's bytes through unchanged). Elsewhere
 * (development) it knows nothing, and says so as an unknown state.
 */
type Run = (command: string, args: string[]) => Promise<string>;

/** Does anything answer at the network printer's address? */
const answers = (host: string, port: number, timeoutMs = 3000): Promise<boolean> => new Promise((resolve) => {
  const socket = connect({ host, port });
  socket.setTimeout(timeoutMs, () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(false));
  socket.once('connect', () => { socket.destroy(); resolve(true); });
});

/** A USB printer port Windows made for a plugged-in printer ("USB001"). */
export const USB_PORT = /^USB\d{3}$/;

const runPs: Run = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 15_000, windowsHide: true }, (err, out, errOut) => {
    if (err) reject(new Error(String(errOut).trim() || err.message));
    else resolve(String(out));
  });
});

/** A printer name inside a single-quoted PowerShell string. */
const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;
const ps = (script: string): [string, string[]] => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]];

export function printerQueue({ platform = process.platform, run = runPs }: { platform?: NodeJS.Platform; run?: Run } = {}) {
  return {
    async state(name: string): Promise<PrinterState> {
      const net = networkAddress(name);
      if (net) return { status: (await answers(net.host, net.port)) ? 'Normal' : 'Offline', jobs: 0, offline: false };
      if (platform !== 'win32') return { status: '', jobs: 0, offline: false };
      const [command, args] = ps(
        `$p = Get-Printer -Name ${quoted(name)} -ErrorAction Stop; ` +
        `@{ status = "$($p.PrinterStatus)"; jobs = @(Get-PrintJob -PrinterName ${quoted(name)} -ErrorAction SilentlyContinue).Count; offline = [bool]$p.WorkOffline } | ConvertTo-Json -Compress`,
      );
      try {
        const s = JSON.parse(await run(command, args)) as Partial<PrinterState>;
        return { status: String(s.status ?? ''), jobs: Number(s.jobs) || 0, offline: s.offline === true };
      } catch {
        // Windows no longer knows this printer (unplugged and removed, renamed): as good as off.
        return { status: 'NotAvailable', jobs: 0, offline: false };
      }
    },

    /** Takes every waiting receipt out of the queue, so they do not all print when the printer wakes up. */
    async clear(name: string): Promise<number> {
      if (platform !== 'win32' || networkAddress(name)) return 0;
      const [command, args] = ps(`$j = @(Get-PrintJob -PrinterName ${quoted(name)} -ErrorAction SilentlyContinue); $j | Remove-PrintJob; $j.Count`);
      return Number((await run(command, args)).trim()) || 0;
    },

    /** USB printer ports with no printer on them: a receipt printer plugged in without its driver. */
    async freeUsbPorts(): Promise<string[]> {
      if (platform !== 'win32') return [];
      const [command, args] = ps("$used = @(Get-Printer | ForEach-Object PortName); Get-PrinterPort | Where-Object { $_.Name -match '^USB\\d{3}$' -and $used -notcontains $_.Name } | ForEach-Object Name");
      try { return (await run(command, args)).split(/\r?\n/).map((l) => l.trim()).filter((l) => USB_PORT.test(l)); }
      catch { return []; }
    },

    /** Adds "Receipt printer (USB001)" with Windows' own Generic / Text Only driver; gives its name. */
    async addUsbPrinter(port: string): Promise<string> {
      if (platform !== 'win32' || !USB_PORT.test(port)) throw new Error('not a USB printer port');
      const name = `Receipt printer (${port})`;
      const [command, args] = ps(
        "Add-PrinterDriver -Name 'Generic / Text Only' -ErrorAction SilentlyContinue; " +
        `if (-not (Get-Printer -Name ${quoted(name)} -ErrorAction SilentlyContinue)) { Add-Printer -Name ${quoted(name)} -DriverName 'Generic / Text Only' -PortName ${quoted(port)} }`,
      );
      await run(command, args);
      return name;
    },
  };
}
export type PrinterQueue = ReturnType<typeof printerQueue>;
