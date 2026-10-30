import { readFileSync } from 'node:fs';

/** Bata Kade's logo (possaas is its POS): every screen shows it until the owner picks another in Shop setup. */
export const BATA_KADE_LOGO = `data:image/webp;base64,${readFileSync(new URL('../src/shop/bata-kade-logo.webp', import.meta.url)).toString('base64')}`;
