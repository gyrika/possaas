import { useCallback, useRef, useState } from 'react';
import type { Actor } from '../domain/auth.ts';
import { clunk } from './sound.ts';

/**
 * Manager mode session: who unlocked it. It stays on until Esc or Done (no idle timer;
 * the screen's own idle lock still ends it). `onEnd` runs however the session ends,
 * so callers can close what belongs to it.
 */
export function useManagerMode(onEnd: () => void) {
  const [manager, setManager] = useState<Actor | null>(null);
  const active = useRef<Actor | null>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  const exit = useCallback(() => {
    if (!active.current) return;
    active.current = null;
    setManager(null);
    endRef.current();
  }, []);

  const enter = useCallback((actor: Actor) => {
    active.current = actor;
    setManager(actor);
    clunk(); // with the unlock motion; plays even with reduced motion (only the spring is swapped)
  }, []);

  return { manager, enter, exit };
}
