import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { arch, cpus, freemem, homedir, release, totalmem, uptime, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME } from '../src/domain/brand.ts';
import { zip, type ZipEntry } from './zip.ts';

/**
 * The support file: one .zip on the desktop that the shop sends to whoever looks after its POS
 * (WhatsApp is fine), so a problem on a PC far away can be seen without being there. It has the
 * logs and this PC's details; never the sales, the database, staff names or PINs, or any key.
 * Made from Shop setup → Help, or, when the POS will not even open, from the Start menu's
 * "Lume POS support file" (station-support.ps1 runs this file).
 */
export interface SupportOptions {
  dataDir: string;
  /** Where the file goes: the desktop everyone at the counter sees. */
  outDir?: string;
  version: string;
  port: number;
  now?: () => Date;
  platform?: NodeJS.Platform;
  /** Runs a Windows command and gives back what it printed (tests pass their own). */
  run?: (command: string, args: string[]) => Promise<string>;
  fetch?: typeof fetch;
}

/** Each log is cut to its newest part: enough to see what happened, small enough for WhatsApp. */
const LOG_TAIL = 1_000_000;
/** A setting whose value must never leave the PC. */
const SECRET = /token|secret|password|key|database_url|code/i;

const runCommand = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 15_000, windowsHide: true, maxBuffer: 2_000_000 }, (err, out, errOut) => {
      resolve(err ? `(could not read: ${(String(errOut).trim() || err.message).split('\n')[0]})` : String(out).trim());
    });
  });

const ps = (script: string): [string, string[]] => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]];

/** What Windows says about the parts the POS needs. */
const WINDOWS_CHECKS: [string, [string, string[]]][] = [
  ['Windows', ps('Get-CimInstance Win32_OperatingSystem | Format-List Caption, Version, BuildNumber, OSArchitecture, LastBootUpTime')],
  ['Printers', ps('Get-Printer | Format-Table -AutoSize Name, DriverName, PortName, PrinterStatus')],
  ['Scheduled tasks', ps("Get-ScheduledTask -TaskName 'CheesyBeez Station*' | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; '{0}: {1}, last run {2}, result {3}' -f $_.TaskName, $_.State, $i.LastRunTime, $i.LastTaskResult }")],
  ['WebView2', ['reg.exe', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', '/v', 'pv']]],
  ['Firewall', ps("Get-NetFirewallRule -DisplayName 'CheesyBeez POS' | Format-List DisplayName, Enabled, Profile, Action")],
  ['Network', ps("Get-NetConnectionProfile | Format-Table -AutoSize Name, InterfaceAlias, NetworkCategory, IPv4Connectivity")],
  ['Antivirus', ps("Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct | Format-Table -AutoSize displayName, productState")],
];

/** settings.json without its secrets: the cloud's keys become "(hidden)". */
export const redactSettings = (text: string): string => {
  try {
    const s = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, SECRET.test(k) && v ? '(hidden)' : v])), null, 2);
  } catch {
    return '(settings.json could not be read)';
  }
};

/** station.env with only its names: a value may be a password. */
export const redactEnv = (text: string): string =>
  text.split(/\r?\n/).map((l) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    return m ? `${m[1]}=${m[1] === 'PORT' || m[1] === 'PRINTER' ? l.slice(l.indexOf('=') + 1).trim() : '(set)'}` : l.trim().startsWith('#') ? l : '';
  }).filter(Boolean).join('\n');

const tail = (file: string): string => {
  const buf = readFileSync(file);
  return buf.length > LOG_TAIL ? `(older lines left out)\n${buf.subarray(buf.length - LOG_TAIL).toString('utf8')}` : buf.toString('utf8');
};

const pad = (n: number) => String(n).padStart(2, '0');
/** "Lume POS support 2026-10-21 1432.zip" */
export const supportFileName = (d: Date): string =>
  `${PRODUCT_NAME} support ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}.zip`;

const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`;

/** The desktop everyone at the counter sees (Windows' Public desktop), or this user's elsewhere. */
export const defaultOutDir = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === 'win32') return join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop');
  const desktop = join(homedir(), 'Desktop');
  return existsSync(desktop) ? desktop : homedir();
};

export async function saveSupportFile(o: SupportOptions): Promise<{ path: string; name: string; files: string[] }> {
  const now = (o.now ?? (() => new Date()))();
  const platform = o.platform ?? process.platform;
  const run = o.run ?? runCommand;
  const http = o.fetch ?? fetch;
  const entries: ZipEntry[] = [];
  const has = (name: string) => existsSync(join(o.dataDir, name));

  let health: string;
  try {
    const r = await http(`http://127.0.0.1:${o.port}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    health = `answering (${r.status}): ${await r.text()}`;
  } catch (e) {
    health = `NOT answering (${e instanceof Error ? e.message : String(e)})`;
  }

  const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()) : []);
  const db = files(o.dataDir).filter((f) => f.startsWith('pos.sqlite'));
  const backups = files(join(o.dataDir, 'backups')).sort();
  let disk = '(unknown)';
  try { const s = statfsSync(o.dataDir); disk = `${mb(s.bavail * s.bsize)} free of ${mb(s.blocks * s.bsize)}`; } catch { /* not there */ }

  const about = [
    `${PRODUCT_NAME} support file, made ${now.toString()}`,
    '',
    `Version:        ${o.version}`,
    `Shop server:    ${health}`,
    `Data folder:    ${o.dataDir}`,
    `Database:       ${db.length ? db.map((f) => `${f} ${mb(statSync(join(o.dataDir, f)).size)}`).join(', ') : 'none (MySQL, or not set up yet)'}`,
    `Backups:        ${backups.length} (newest: ${backups.at(-1) ?? 'none'})`,
    `Saved receipts: ${files(join(o.dataDir, 'prints')).length} (no printer chosen: receipts are saved as files)`,
    `Disk:           ${disk}`,
    `System:         ${platform} ${release()} ${osVersion()} ${arch()}`,
    `Processor:      ${cpus()[0]?.model ?? '?'} x ${cpus().length}`,
    `Memory:         ${mb(freemem())} free of ${mb(totalmem())}`,
    `Up for:         ${Math.round(uptime() / 3600)} hours`,
    `Node.js:        ${process.version}`,
    `Time zone:      ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ];
  if (platform === 'win32') {
    for (const [title, [command, args]] of WINDOWS_CHECKS) about.push('', `----- ${title} -----`, (await run(command, args)) || '(nothing reported)');
  }
  entries.push({ name: 'about.txt', data: `${about.join('\r\n')}\r\n` });

  if (has('settings.json')) entries.push({ name: 'settings.json', data: redactSettings(readFileSync(join(o.dataDir, 'settings.json'), 'utf8')) });
  if (has('station.env')) entries.push({ name: 'station.env', data: redactEnv(readFileSync(join(o.dataDir, 'station.env'), 'utf8')) });
  for (const f of ['update-status.json', 'update-skip.txt', 'update-waiting.txt']) {
    if (has(f)) entries.push({ name: f, data: readFileSync(join(o.dataDir, f)) });
  }
  for (const f of files(join(o.dataDir, 'logs'))) entries.push({ name: `logs/${f}`, data: tail(join(o.dataDir, 'logs', f)) });

  const outDir = o.outDir ?? defaultOutDir(platform);
  const name = supportFileName(now);
  const path = join(outDir, name);
  writeFileSync(path, zip(entries, now));
  return { path, name, files: entries.map((e) => e.name) };
}

// The Start menu's "Lume POS support file" (station-support.ps1): works even when the POS does not start.
if (import.meta.main) {
  const station = fileURLToPath(new URL('../../', import.meta.url));
  const dataDir = process.argv[2] ?? process.env.DATA_DIR ?? join(process.env.ProgramData ?? 'C:\\ProgramData', 'CheesyBeez');
  const version = existsSync(join(station, 'version.txt')) ? readFileSync(join(station, 'version.txt'), 'utf8').trim() : 'development';
  const envFile = join(dataDir, 'station.env');
  const port = Number((existsSync(envFile) && /^\s*PORT\s*=\s*(\d+)/m.exec(readFileSync(envFile, 'utf8'))?.[1]) || process.env.PORT || 8080);
  saveSupportFile({ dataDir, version, port }).then(
    (r) => console.log(r.path),
    (e) => { console.error(`The support file could not be made: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); },
  );
}
