import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { UpdateStep } from '../src/domain/updating.ts';
import { isNewer } from '../src/domain/version.ts';

export { isNewer };

/**
 * "Update now" in Shop setup. Lume POS keeps its version beside the
 * program (version.txt) and an updater script (station-update.ps1, also run
 * every 5 minutes). This asks GitHub for the latest release and, when the
 * owner says so, runs that updater straight away. In development there is no
 * Station, so there is nothing to update.
 */
const LATEST = 'https://api.github.com/repos/gyrika/possaas/releases/latest';

/**
 * On: LATEST is possaas' own public releases (no other repository). Turned off and on together with $UpdatesOn in deploy/station/station-update.ps1.
 */
export const AUTO_UPDATES = true;

/** Registered by deploy/station/station-install.ps1: station-update.ps1 -Force, as SYSTEM. */
export const UPDATE_NOW_TASK = 'Lume POS update now';

export interface UpdateCheck {
  current: string;
  latest: string | null;
  newer: boolean;
  /** Automatic updates are off (AUTO_UPDATES): nothing was asked of GitHub. */
  off?: true;
}

/** Where an update is (station-update.ps1 writes it), for the progress bars. */
export type UpdateStatus = UpdateStep;

export interface UpdatesOptions {
  versionFile: string;
  updaterScript: string;
  /** update-status.json beside the shop's data. */
  statusFile?: string;
  /** Defaults to AUTO_UPDATES. */
  enabled?: boolean;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  run?: (command: string, args: string[]) => void;
}

export function updatesApi(o: UpdatesOptions) {
  const http = o.fetch ?? fetch;
  const platform = o.platform ?? process.platform;
  const enabled = o.enabled ?? AUTO_UPDATES;
  const run = o.run ?? ((command, args) => {
    spawn(command, args, { stdio: 'ignore', windowsHide: true }).on('error', () => { /* the screen says it did not start */ });
  });
  const current = (): string => {
    try { return existsSync(o.versionFile) ? readFileSync(o.versionFile, 'utf8').trim() || 'development' : 'development'; }
    catch { return 'development'; }
  };
  const installable = () => platform === 'win32' && existsSync(o.updaterScript) && current() !== 'development';

  return {
    current,

    async check(): Promise<UpdateCheck> {
      if (!enabled) return { current: current(), latest: null, newer: false, off: true };
      const r = await http(LATEST, { headers: { 'user-agent': 'Lume-POS', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const latest = String(((await r.json()) as { tag_name?: string }).tag_name ?? '').replace(/^v/, '') || null;
      const now = current();
      return { current: now, latest, newer: latest !== null && isNewer(latest, now) };
    },

    /** The updater's latest step, or null (none yet, or an older updater that does not say). */
    status(): UpdateStatus | null {
      try {
        if (!o.statusFile || !existsSync(o.statusFile)) return null;
        const s = JSON.parse(readFileSync(o.statusFile, 'utf8').replace(/^\uFEFF/, '')) as UpdateStatus;
        return typeof s.phase === 'string' && Number.isFinite(s.percent) ? s : null;
      } catch {
        return null; // being written right now: the next look gets it
      }
    },

    /**
     * Starts the updater now (it downloads the latest release and installs it quietly), through its
     * own Windows task: the installer stops this very server and everything it started, and
     * PowerShell started detached from node quits without running the script.
     */
    install(): void {
      if (!enabled) throw new Error('automatic updates are off: run the new Setup.exe on this PC');
      if (!installable()) throw new Error('updates are installed by Lume POS on Windows');
      run('schtasks.exe', ['/Run', '/TN', UPDATE_NOW_TASK]);
    },
  };
}
export type UpdatesApi = ReturnType<typeof updatesApi>;
