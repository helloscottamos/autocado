// Ocado endpoints and the trolley (cart) mapping, shared by both ways of
// talking to Ocado: Autocado's own session (real.js) and the Firefox add-on
// (bridge.js).
import { known } from '../catalogue.js';

export const BASE_URL = 'https://www.ocado.com';
export const CART_URL = '/api/cart/v1/carts/active?cartProductSorting=CATEGORIES';
export const APPLY_QTY_URL = '/api/cart/v1/carts/active/apply-quantity?cartProductSorting=CATEGORIES';
export const PRODUCTS_URL = '/api/webproductpagews/v6/products';
export const CUSTOMER_URL = '/api/customer/v3/customers/current';
export const FAVOURITES_URL = id => `/api/customer-favorites/v1/customers/favorites/${encodeURIComponent(id)}`;
export const SEARCH_URL = q => `/search?q=${encodeURIComponent(q)}`;
export const FAVOURITES_PAGE = '/favorites';

const num = v => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };
const round = n => Math.round(n * 100) / 100;

/** Lines with a quantity, from Ocado's cart JSON. */
export function cartLines(cart) {
  const raw = cart?.items ?? [];
  return (Array.isArray(raw) ? raw : Object.values(raw)).filter(i => i?.productId && Number(i.quantity) > 0);
}

/**
 * Turn Ocado's cart JSON into the trolley the app shows. Quantities and
 * prices come from the cart; names and pictures from the product catalogue.
 */
export function mapCart(cart) {
  const items = cartLines(cart).map(i => {
    const p = known(i.productId);
    const quantity = Number(i.quantity);
    const total = num(i?.totalPrices?.finalPrice?.amount) ?? num(i?.finalPrice?.amount);
    const unit = num(i?.productPrices?.finalPrice?.amount) ?? num(i?.price?.amount) ?? p?.price ?? null;
    return {
      ...(p ?? { productId: i.productId, name: 'Item added on ocado.com', offers: [], labels: [], unknown: true }),
      price: unit,
      quantity,
      total: total ?? (unit != null ? round(unit * quantity) : null),
    };
  });
  const total = num(cart?.totals?.subTotal?.amount)
    ?? num(cart?.activeCheckoutGroupTotals?.itemPriceAfterPromos?.amount)
    ?? round(items.reduce((s, i) => s + (i.total ?? 0), 0));
  return { items, total, unknownNames: items.filter(i => i.unknown).length };
}
