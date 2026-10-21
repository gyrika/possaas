/**
 * The product's own name (the installer, the setup wizard, the update screen), never the shop's:
 * each shop's name, town and receipt footer come from its setup (server/setup.ts → /api/v1/shop-details).
 */
export const PRODUCT_NAME = 'Lume POS';

/** The receipt's last line until the shop writes its own in Shop setup → Printer. */
export const DEFAULT_FOOTER = 'Thank you!';
