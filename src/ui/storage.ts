/**
 * Device storage keys. /?demo uses its own namespace, so the demo's fake
 * orders never mix with the real counter's orders, kitchen or event log.
 * /?demo=rice is a second demo (a rice & curry shop that takes payment first), kept apart from both.
 */
export const isDemo = (): boolean =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

/** The rice & curry demo: its own menu, pay first, no sample orders. */
export const isRiceDemo = (): boolean =>
  isDemo() && new URLSearchParams(location.search).get('demo') === 'rice';

export const storageKey = (name: string): string => `${isRiceDemo() ? 'cb.demo.rice.' : isDemo() ? 'cb.demo.' : 'cb.'}${name}`;
