import { execFile } from 'node:child_process';
import type { PrinterState } from '../src/domain/printerHelp.ts';

/**
 * What Windows knows about the receipt printer (its state, and receipts waiting in its queue), and
 * clearing that queue, for Shop setup → Printer's "Did it print? No". Elsewhere (development) it
 * knows nothing, and says so as an unknown state.
 */
type Run = (command: string, args: string[]) => Promise<string>;

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
      if (platform !== 'win32') return 0;
      const [command, args] = ps(`$j = @(Get-PrintJob -PrinterName ${quoted(name)} -ErrorAction SilentlyContinue); $j | Remove-PrintJob; $j.Count`);
      return Number((await run(command, args)).trim()) || 0;
    },
  };
}
export type PrinterQueue = ReturnType<typeof printerQueue>;
