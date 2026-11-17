// Map Ocado `productEntities` entries (from search / favourites pages and the
// product-info API) onto the small product shape the app stores and shows.
//
// Field names verified against live ocado.com search pages, 2026-11-10:
//   offers[]: { description: "Buy any 2 for £4.50" | "Now £1.70, was £2.25", requiredProductQuantity }
//   attributes[]: { icon: "organic", label: "Organic" }
//   price: { current: { amount }, unit: { label, current: { amount } }, original? }
//   image: { src }   size: { value: "2L" }   available: boolean
//   favorite: {} when the signed-in customer has favourited it
//
// The product-info API (PUT /api/webproductpagews/v6/products) names things
// differently, verified against live ocado.com 2026-11-17:
//   price: { amount, currency }, promoPrice: { amount } (price cuts)
//   unitPrice / promoUnitPrice: { price: { amount, currency: GBP | GBX }, unit: "fop.price.per.kg" }
//   promotions[]: { description, retailerPromotionId }   packSizeDescription: "370g"
//   iconAttributes[]: { label: "Organic", file }

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** An Ocado money object in pounds. GBX is pence. */
const pounds = m => {
  const n = num(m?.amount);
  return n !== null && m?.currency === 'GBX' ? n / 100 : n;
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
  const list = Array.isArray(e?.offers) && e.offers.length ? e.offers
    : Array.isArray(e?.promotions) && e.promotions.length ? e.promotions
      : (e?.offer ? [e.offer] : []);
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

// The product-info API's promoPrice is the price after a price cut. Only
// trust it when the promotion says so, not for a multi-buy.
const PRICE_CUT_RE = /\bnow\b|\bwas\b|half price|\d+\s?% off/i;
const promoPrice = e => (e?.promoPrice && offerList(e).some(o => PRICE_CUT_RE.test(o.description)) ? pounds(e.promoPrice) : null);

/** { price, wasPrice, unitPrice, unitLabel } from either Ocado shape. */
function prices(e) {
  if (e?.price?.current || e?.price?.original || e?.price?.unit) {
    const unitLabel = e.price.unit?.label;
    return { price: num(e.price.current?.amount), wasPrice: num(e.price.original?.amount), unitPrice: num(e.price.unit?.current?.amount), unitLabel };
  }
  const full = pounds(e?.price);
  const cut = promoPrice(e);
  const unit = (cut !== null && e?.promoUnitPrice) || e?.unitPrice;
  return {
    price: cut ?? full,
    wasPrice: cut !== null && full !== null && full > cut ? full : null,
    unitPrice: pounds(unit?.price),
    unitLabel: unit?.unit,
  };
}

export function normaliseOffers(e) {
  const out = offerList(e).filter(o => isDeal(o.description));
  const { price: current, wasPrice: original } = prices(e);
  if (out.length === 0 && original && current && original > current) {
    out.push({ id: 'price-cut', description: `Now £${current.toFixed(2)}, was £${original.toFixed(2)}`, minQty: null });
  }
  return out;
}

export function isOrganic(e) {
  const attrs = [e?.attributes, e?.iconAttributes].flatMap(a => (Array.isArray(a) ? a : []));
  if (attrs.some(a => [a?.icon, a?.label, a?.file].some(v => String(v || '').toLowerCase() === 'organic'))) return true;
  return /\borganic\b/i.test(e?.name || '');
}

export function normaliseEntity(e) {
  const { price, wasPrice, unitPrice, unitLabel } = prices(e);
  const imageSrc = typeof e?.image === 'string' ? e.image : e?.image?.src;
  return {
    productId: e.productId,
    sku: e.retailerProductId ?? null,
    name: e.name,
    brand: e.brand ?? null,
    price,
    wasPrice,
    unitPrice,
    unitLabel: UNIT_LABELS[unitLabel] ?? (unitLabel ? unitLabel.replace(/^fop\.price\.per\./, '') : null),
    size: e?.size?.value ?? e?.packSizeDescription ?? null,
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

/** The JSON array that starts at `start` (a '['), read with strings in mind. */
function jsonArrayAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (inString) {
      if (c === '\\') j++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Most favourites the /favorites page lists; past this Ocado loads more as you scroll. */
export const FAVOURITES_PAGE_MAX = 300;

/**
 * Ocado's /favorites page, as first sent, lists the ids of up to 300
 * favourites (in Ocado's order) under `productGroups`, includes full details
 * for only the first 50 of them in `productEntities`, and draws tiles for just
 * the first few. So read the id list, and say which ids still need details.
 *
 * Returns { ids, products, missing, complete, nextPageToken }: `complete` is
 * false when the list looks cut off at Ocado's limit, so there may be more.
 */
export function favouritesFromHtml(html, extractProductEntities) {
  const entities = Object.values(extractProductEntities(html)).filter(e => e?.productId && e.name);
  const byId = new Map(entities.map(e => [e.productId, e]));
  let ids = null;
  const at = html.indexOf('"productGroups":[');
  if (at >= 0) {
    const groups = jsonArrayAt(html, html.indexOf('[', at));
    const group = groups?.find(g => g?.type === 'favorite') ?? groups?.[0];
    if (Array.isArray(group?.products)) ids = [...new Set(group.products.filter(id => typeof id === 'string'))];
  }
  if (!ids?.length) {
    // No id list (page layout changed): fall back to the products marked as favourites, then to the tiles.
    const marked = entities.filter(e => e.favorite !== undefined && e.favorite !== null);
    const products = marked.length ? marked.map(normaliseEntity) : productsFromHtml(html, extractProductEntities, 500);
    return { ids: products.map(p => p.productId), products, missing: [], complete: products.length < 50 };
  }
  return {
    ids,
    products: ids.filter(id => byId.has(id)).map(id => normaliseEntity(byId.get(id))),
    missing: ids.filter(id => !byId.has(id)),
    complete: ids.length < FAVOURITES_PAGE_MAX,
    nextPageToken: /"nextPageToken":"([^"\\]+)"/.exec(html)?.[1] ?? null,
  };
}

/**
 * One page of Ocado's favourites API (GET .../product-pages/favorites):
 * { ids, products, nextPageToken }. Verified against live ocado.com 2026-11-17:
 *   productGroups[{ type: 'favorite', decoratedProducts: [50 full products],
 *                   otherProductIds: [250 ids] }]
 *   metadata: { nextPageToken }   (absent on the last page)
 * Also reads a plain `products` list and the shape Ocado's web app stores it in.
 */
export function favouritesPage(json) {
  const root = json?.result ?? json ?? {};
  const groups = root.productGroups ?? json?.productGroups ?? [];
  const group = groups.find(g => g?.type === 'favorite') ?? groups[0];
  const entities = Object.values(json?.entities?.product ?? {});
  const ids = [];
  for (const p of [...(group?.decoratedProducts ?? []), ...(group?.products ?? []), ...(group?.otherProductIds ?? [])]) {
    const id = typeof p === 'string' ? p : p?.productId;
    if (id) ids.push(id);
    if (p && typeof p === 'object' && p.name) entities.push(p);
  }
  const byId = new Map(entities.filter(e => e?.productId && e.name).map(e => [e.productId, e]));
  return {
    ids: [...new Set(ids)],
    products: [...byId.values()].map(normaliseEntity),
    nextPageToken: json?.metadata?.nextPageToken ?? json?.nextPageToken ?? root.nextPageToken ?? null,
  };
}

/** Most extra pages of favourites to read (300 each). */
const MAX_FAVOURITE_PAGES = 10;

/**
 * Every favourite, in Ocado's order. The /favorites page gives the first 300;
 * `fetchPage(token)` (optional) reads the rest a page at a time, the way
 * Ocado's site does as you scroll; `fetchProducts(ids)` fills in details for
 * the ones Ocado left out. The list carries `complete` (false if it may be
 * missing some) and `warning`.
 */
export async function readFavourites(html, extractProductEntities, fetchProducts, fetchPage = null) {
  const first = favouritesFromHtml(html, extractProductEntities);
  const ids = [...first.ids];
  const seen = new Set(ids);
  const details = new Map(first.products.map(p => [p.productId, p]));
  const absorb = page => {
    for (const id of page.ids) if (!seen.has(id)) { seen.add(id); ids.push(id); }
    for (const p of page.products) if (!details.has(p.productId)) details.set(p.productId, p);
  };
  let complete = first.complete;
  let warning = null;

  if (!complete && fetchPage) {
    try {
      let token = first.nextPageToken;
      if (!token) { const top = await fetchPage(null); absorb(top); token = top.nextPageToken; }
      for (let n = 0; token && n < MAX_FAVOURITE_PAGES; n++) {
        const page = await fetchPage(token);
        absorb(page);
        token = page.nextPageToken && page.nextPageToken !== token ? page.nextPageToken : null;
      }
      complete = !token;
    } catch (e) {
      const why = /refused a request it does not allow/.test(e.message)
        ? 'reload the Autocado add-on in Firefox (about:debugging) to read the rest'
        : e.message;
      warning = `Only read the first ${ids.length} of your Ocado favourites: ${why}`;
    }
  }

  const missing = ids.filter(id => !details.has(id));
  if (missing.length) {
    try {
      for (const p of await fetchProducts(missing)) details.set(p.productId, p);
    } catch (e) { warning = warning || `Only read ${details.size} of your Ocado favourites: ${e.message}`; }
  }
  const list = ids.map(id => details.get(id)).filter(Boolean).map(p => ({ ...p, favourite: true }));
  list.complete = complete && list.length === ids.length;
  list.warning = warning;
  return list;
}
