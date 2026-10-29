import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Sends raw ESC/POS bytes to the receipt printer (SCRUM-71). The browser
 * builds the bytes (src/domain/receipt.ts); this only delivers them.
 *
 * Windows: through the normal printer queue with the RAW datatype
 * (server/rawprint.ps1), so the Windows driver stays installed and other
 * programs can still print. Linux/macOS (development): `lp -o raw`.
 * Dry run (no printer yet): each receipt is saved to server/prints/ as .bin.
 */
export interface RawPrinter {
  readonly name: string;
  print(bytes: Uint8Array): Promise<void>;
}

const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err, _out, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve();
    });
  });

/** Prints one job at a time, in order: two receipts must never interleave on the paper. */
const serial = (printer: Omit<RawPrinter, 'print'> & { send(bytes: Uint8Array): Promise<void> }): RawPrinter => {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    name: printer.name,
    print(bytes) {
      const job = queue.then(() => printer.send(bytes));
      queue = job.catch(() => {});
      return job;
    },
  };
};

const withTempFile = async (bytes: Uint8Array, fn: (path: string) => Promise<void>) => {
  const path = join(tmpdir(), `lume-receipt-${process.pid}-${Date.now()}.bin`);
  await writeFile(path, bytes);
  try { await fn(path); } finally { await unlink(path).catch(() => {}); }
};

export function systemPrinter(printerName: string): RawPrinter {
  const script = fileURLToPath(new URL('./rawprint.ps1', import.meta.url));
  return serial({
    name: printerName,
    send: (bytes) => withTempFile(bytes, (path) =>
      process.platform === 'win32'
        ? run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', printerName, '-Path', path])
        : run('lp', ['-d', printerName, '-o', 'raw', path])),
  });
}

/**
 * A network receipt printer (Ethernet or Wi-Fi): its IP address, port 9100, the bytes as they are.
 * No Windows driver at all. Chosen in Shop setup as "net:192.168.1.50" (or "net:192.168.1.50:9100").
 */
export const NETWORK = /^net:([a-z0-9.-]{1,253})(?::(\d{1,5}))?$/i;
export const networkAddress = (name: string): { host: string; port: number } | null => {
  const m = NETWORK.exec(name);
  return m ? { host: m[1], port: Number(m[2] ?? 9100) } : null;
};

export function networkPrinter(name: string, { timeoutMs = 5000 } = {}): RawPrinter {
  const { host, port } = networkAddress(name)!;
  return serial({
    name,
    send: (bytes) => new Promise<void>((resolve, reject) => {
      const socket = connect({ host, port });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`no answer from ${host}:${port}`)));
      socket.once('error', reject);
      socket.once('connect', () => socket.end(Buffer.from(bytes)));
      socket.once('close', (failed) => { if (!failed) resolve(); });
    }),
  });
}

/** The printer a name stands for: a network one ("net:…"), or one Windows knows. */
export const printerFor = (name: string): RawPrinter => (networkAddress(name) ? networkPrinter(name) : systemPrinter(name));

export function dryRunPrinter(dir: string): RawPrinter {
  let n = 0;
  return serial({
    name: `dry run (${dir})`,
    async send(bytes) {
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(dir, `${stamp}-${++n}.bin`), bytes);
    },
  });
}

/** The printers Windows (or CUPS) knows, for the wizard to choose from. Empty if it cannot tell. */
export const listPrinters = (): Promise<string[]> =>
  new Promise((resolve) => {
    const [cmd, args] = process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']]
      : ['lpstat', ['-e']];
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, out) => {
      resolve(err ? [] : String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });

/**
 * The printer the server prints to, switchable while it runs: the wizard picks
 * one and the next receipt goes there, no restart.
 */
export function switchablePrinter(initial: RawPrinter) {
  let current = initial;
  return {
    get name() { return current.name; },
    print: (bytes: Uint8Array) => current.print(bytes),
    use(p: RawPrinter) { current = p; },
  };
}
