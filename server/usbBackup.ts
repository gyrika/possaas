import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { backupDatabase } from './sqliteBackup.ts';

/**
 * A copy of the shop's sales on a USB stick (Shop setup → Backup). The nightly backup stays on
 * this PC; if its disk dies, so do they. Until the cloud keeps a copy, the stick is the copy that
 * survives. The same safe copy as the nightly one (checked before it counts), then onto the stick.
 * Putting one back is a support job: docs/install-windows.md → "Putting a backup back".
 */
export interface Drive { letter: string; label: string; freeBytes: number }
type Run = (command: string, args: string[]) => Promise<string>;

const runPs: Run = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 15_000, windowsHide: true }, (err, out, errOut) => {
    if (err) reject(new Error(String(errOut).trim() || err.message));
    else resolve(String(out));
  });
});

export const BACKUP_FOLDER = 'Lume POS backups';

export function usbBackup({ dataDir, platform = process.platform, run = runPs, now = () => new Date() }: {
  dataDir: string; platform?: NodeJS.Platform; run?: Run; now?: () => Date;
}) {
  return {
    /** USB sticks and memory cards plugged in now. */
    async drives(): Promise<Drive[]> {
      if (platform !== 'win32') return [];
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter } | ForEach-Object { '{0}|{1}|{2}' -f $_.DriveLetter, $_.FileSystemLabel, $_.SizeRemaining }"]).catch(() => '');
      return out.split(/\r?\n/).map((l) => l.trim().split('|')).filter((p) => /^[A-Z]$/.test(p[0] ?? ''))
        .map(([letter, label, free]) => ({ letter, label: label || 'USB stick', freeBytes: Number(free) || 0 }));
    },

    /** Copies the sales onto that stick, in "Lume POS backups"; says where and how much. */
    async save(letter: string, root = `${letter}:\\`): Promise<{ file: string; events: number }> {
      if (!(await this.drives()).some((d) => d.letter === letter)) throw new Error('that USB stick is not plugged in');
      const copy = backupDatabase(dataDir, 'usb', 14, now());
      if (!copy) throw new Error('there are no sales on this computer to copy');
      const dir = join(root, BACKUP_FOLDER);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, basename(copy.file));
      copyFileSync(copy.file, file);
      if (statSync(file).size !== statSync(copy.file).size) throw new Error('the copy on the stick is not complete: try another stick');
      return { file, events: copy.events };
    },
  };
}
export type UsbBackup = ReturnType<typeof usbBackup>;
