import type { Role } from '../domain/auth.ts';
import type { PrinterState } from '../domain/printerHelp.ts';

/**
 * The setup wizard's calls to the shop server (server/setup.ts). They work only
 * on the shop PC itself. After setup, changes carry the owner's PIN.
 */
export interface StaffRow { id: string; name: string; role: Role; active: boolean }
export interface SetupState {
  done: boolean;
  shop: { id: string; name: string; place: string; footer: string; paper: 58 | 80 } | null;
  printer: string | null;
  printers: string[];
  /** USB printer ports with no printer: a receipt printer plugged in without its driver. */
  usbPorts?: string[];
  cloud: boolean;
  staff?: StaffRow[];
}

export class SetupFailed extends Error {}

const call = async <T>(step: string, body?: unknown): Promise<T> => {
  const r = await fetch(`/api/v1/setup${step}`, body === undefined ? { signal: AbortSignal.timeout(15_000) } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const data = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new SetupFailed(data.message ?? `The shop server said ${r.status}.`);
  return data;
};

export const setupClient = {
  state: () => call<SetupState>(''),
  nameShop: (name: string, place: string) => call<{ shopId: string; counterToken?: string }>('/shop', { name, place }),
  shopDetails: (d: { name: string; place: string; footer: string }, ownerPin?: string) =>
    call<{ shop: { id: string; name: string; place: string; footer: string } }>('/details', { ...d, ownerPin }),
  setPaper: (width: 58 | 80, ownerPin?: string) => call<{ paper: 58 | 80 }>('/paper', { width, ownerPin }),
  printerState: (ownerPin?: string) => call<{ state: PrinterState }>('/printer/state', { ownerPin }),
  addUsbPrinter: (port: string, ownerPin?: string) => call<{ printer: string }>('/printer/usb', { port, ownerPin }),
  clearPrinter: (ownerPin?: string) => call<{ cleared: number }>('/printer/clear', { ownerPin }),
  setPrinter: (name: string | null, ownerPin?: string) => call<{ printer: string | null }>('/printer', { name, ownerPin }),
  staff: (ownerPin?: string) => call<{ staff: StaffRow[] }>('/staff/list', { ownerPin }),
  addStaff: (name: string, role: Role, pin: string, ownerPin?: string) => call<{ staff: StaffRow[] }>('/staff', { name, role, pin, ownerPin }),
  removeStaff: (id: string, ownerPin?: string) => call<{ staff: StaffRow[] }>('/staff/remove', { id, ownerPin }),
  pair: (kind: 'kitchen' | 'owner', ownerPin?: string) => call<{ link: string }>('/pair', { kind, ownerPin }),
  pairCounter: (ownerPin: string) => call<{ counterToken: string; shopId: string }>('/pair', { kind: 'counter', ownerPin }),
  connectCloud: (code: string, ownerPin?: string) => call<{ cloud: boolean }>('/cloud', { code, ownerPin }),
  finish: () => call<{ done: boolean }>('/finish', {}),
  saveSupport: (ownerPin?: string) => call<{ name: string; path: string }>('/support', { ownerPin }),
  checkUpdate: (ownerPin?: string) => call<{ current: string; latest: string | null; newer: boolean; off?: boolean }>('/update/check', { ownerPin }),
  installUpdate: (ownerPin?: string) => call<{ started: boolean; from: string }>('/update/install', { ownerPin }),
  updateStatus: (ownerPin?: string) =>
    call<{ status: { phase: string; percent: number; version: string; at: number } | null }>('/update/status', { ownerPin }),
};
