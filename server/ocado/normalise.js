// Map Ocado `productEntities` entries (from search / favourites pages and the
// product-info API) onto the small product shape the app stores and shows.
//
// Field names verified against live ocado.com search pages, 2026-11-10:
//   offers[]: { description: "Buy any 2 for £4.50" | "Now £1.70, was £2.25", requiredProductQuantity }
//   attributes[]: { icon: "organic", label: "Organic" }
//   price: { current: { amount }, unit: { label, current: { amount } }, original? }
//   image: { src }   size: { value: "2L" }   available: boolean
//   favorite: {} when the signed-in customer has favourited it

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const UNIT_LABELS = {
  'fop.price.per.litre': 'litre', 'fop.price.per.kg': 'kg', 'fop.price.per.100g': '100g',
  'fop.price.per.100ml': '100ml', 'fop.price.per.each': 'each', 'fop.price.per.unit': 'unit',
};

// A real deal names a price, a quantity or a saving ("Buy any 2 for £4.50",
// "Now £1.70, was £2.25", "Half price", "25% off"). Ocado also sends standing
// price labels through the same field ("Everyday Savers") — those aren't deals.
const DEAL_RE = /£\s?\d|\d+\s?%|\bhalf price\b|\bbuy\b|\bfree\b|\bwas\b|\bfor\s+\d|\bsave\s+(£|\d)/i;
export const isDeal = description => DEAL_RE.test(String(description || ''));

function offerList(e) {
  const list = Array.isArray(e?.offers) && e.offers.length ? e.offers : (e?.offer ? [e.offer] : []);
  const seen = new Set();
  const out = [];
  for (const o of list) {
    const description = o?.description || o?.longDescription;
    if (!description || seen.has(description)) continue;
    seen.add(description);
    out.push({ id: o.id ?? o.retailerPromotionId ?? description, description, minQty: o.requiredProductQuantity ?? null });
  }
  return out;
}

/** Non-deal promo labels such as "Everyday Savers". */
export function normaliseLabels(e) {
  return offerList(e).filter(o => !isDeal(o.description)).map(o => o.description);
}

export function normaliseOffers(e) {
  const out = offerList(e).filter(o => isDeal(o.description));
  const original = num(e?.price?.original?.amount);
  const current = num(e?.price?.current?.amount);
  if (out.length === 0 && original && current && original > current) {
    out.push({ id: 'price-cut', description: `Now £${current.toFixed(2)}, was £${original.toFixed(2)}`, minQty: null });
  }
  return out;
}

export function isOrganic(e) {
  const attrs = Array.isArray(e?.attributes) ? e.attributes : [];
  if (attrs.some(a => String(a?.icon || a?.label || '').toLowerCase() === 'organic')) return true;
  return /\borganic\b/i.test(e?.name || '');
}

export function normaliseEntity(e) {
  const unitLabel = e?.price?.unit?.label;
  const imageSrc = typeof e?.image === 'string' ? e.image : e?.image?.src;
  return {
    productId: e.productId,
    sku: e.retailerProductId ?? null,
    name: e.name,
    brand: e.brand ?? null,
    price: num(e?.price?.current?.amount),
    wasPrice: num(e?.price?.original?.amount),
    unitPrice: num(e?.price?.unit?.current?.amount),
    unitLabel: UNIT_LABELS[unitLabel] ?? (unitLabel ? unitLabel.replace(/^fop\.price\.per\./, '') : null),
    size: e?.size?.value ?? null,
    image: imageSrc ? (imageSrc.startsWith('http') ? imageSrc : `https://www.ocado.com${imageSrc}`) : null,
    available: e.available !== false,
    organic: isOrganic(e),
    offers: normaliseOffers(e),
    labels: normaliseLabels(e),
    favourite: e.favorite !== undefined && e.favorite !== null ? true : (e.isFavourite ?? undefined),
    sponsored: !!e.featuredProductCampaign,
    url: e.retailerProductId ? `https://www.ocado.com/products/${e.retailerProductId}` : null,
  };
}

/**
 * Pull the `productEntities` blob out of a server-rendered page and return
 * products in on-page order (the order of /products/... links), which is the
 * site's own ranking.
 */
export function productsFromHtml(html, extractProductEntities, limit = 48) {
  const entities = extractProductEntities(html);
  const bySku = new Map();
  for (const e of Object.values(entities)) if (e?.retailerProductId) bySku.set(String(e.retailerProductId), e);
  const out = [];
  const seen = new Set();
  const re = /href="\/products\/[^"]*?(\d+)\/?"/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const e = bySku.get(m[1]);
    if (!e?.name || seen.has(e.productId)) continue;
    seen.add(e.productId);
    out.push(normaliseEntity(e));
  }
  if (out.length === 0) {
    for (const e of Object.values(entities)) {
      if (out.length >= limit) break;
      if (e?.name && !seen.has(e.productId)) { seen.add(e.productId); out.push(normaliseEntity(e)); }
    }
  }
  return out;
}
