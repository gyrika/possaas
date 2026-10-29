import { useSyncExternalStore } from 'react';
import { storageKey } from './storage.ts';

/**
 * Busy mode, for the rush: one tap on "Collected" takes the cash, sends the order to its
 * kitchen and starts the next one. No change screen, no receipt. Remembered on this counter.
 */
const KEY = () => storageKey('busy');
const listeners = new Set<() => void>();

export const busyOn = (): boolean => {
  try { return localStorage.getItem(KEY()) === 'on'; } catch { return false; }
};

export const setBusy = (on: boolean): void => {
  try { localStorage.setItem(KEY(), on ? 'on' : 'off'); } catch { /* blocked storage: the switch still flips below */ }
  memo = on;
  listeners.forEach((l) => l());
};

let memo: boolean | null = null;
const read = (): boolean => (memo ??= busyOn());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useBusy = (): boolean => useSyncExternalStore(subscribe, read);
