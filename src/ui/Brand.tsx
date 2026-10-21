import { PRODUCT_NAME } from '../domain/brand.ts';
import { useShopName } from '../services/shop.ts';

/** The corner of every working screen: the shop's own name (Shop setup → Printer). */
export function ShopBrand() {
  return <span className="brand">{useShopName()}</span>;
}

/** Before there is a shop (setup, a device not connected yet): the product's name. */
export function ProductBrand() {
  return <span className="brand">{PRODUCT_NAME}</span>;
}
