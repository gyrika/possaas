import { PRODUCT_NAME } from '../domain/brand.ts';
import { useShopLogo, useShopName } from '../services/shop.ts';

/** The corner of every working screen: the shop's own logo and name (Shop setup → Printer). */
export function ShopBrand() {
  const logo = useShopLogo();
  return (
    <span className="brand">
      {logo && <img className="brand__logo" src={logo} alt="" width={32} height={32} />}
      {useShopName()}
    </span>
  );
}

/** Before there is a shop (setup, a device not connected yet): the product's name. */
export function ProductBrand() {
  return <span className="brand">{PRODUCT_NAME}</span>;
}
