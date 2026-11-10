// Turning recipes + the "needed" list into a shopping list, and a shopping
// list into a matched basket draft.
import { itemKey, suggestPacks, describeNeeds } from './ingredients.js';
import { newId } from './store.js';

/**
 * Build the live shopping list. Pure function of state, so it is recomputed
 * whenever a recipe is toggled or a "have we got enough?" answer changes.
 *  mode 'weekly' = selected recipes + needed items
 *  mode 'topup'  = needed items only
 */
export function buildList(state, mode = 'weekly') {
  const lines = new Map();
  const get = (key, item) => {
    if (!lines.has(key)) {
      lines.set(key, { key, item, needs: [], recipes: [], pantry: false, required: false, requiredIds: [] });
    }
    return lines.get(key);
  };

  if (mode === 'weekly') {
    for (const recipe of state.recipes) {
      if (!state.plan.selected[recipe.id]) continue;
      const want = Number(state.plan.servings?.[recipe.id]) || recipe.servings || null;
      const scale = recipe.servings && want ? want / recipe.servings : 1;
      for (const ing of recipe.ingredients || []) {
        const key = itemKey(ing.item);
        if (!key) continue;
        const line = get(key, ing.item);
        line.needs.push({ quantity: ing.quantity != null ? ing.quantity * scale : null, unit: ing.unit || null, recipe: recipe.name });
        if (!line.recipes.includes(recipe.name)) line.recipes.push(recipe.name);
        line.pantry = line.pantry || !!ing.pantry;
      }
    }
  }

  for (const r of state.required) {
    const key = itemKey(r.item);
    if (!key) continue;
    const line = get(key, r.item);
    line.required = true;
    line.requiredIds.push(r.id);
    if (r.quantity != null) line.needs.push({ quantity: r.quantity, unit: r.unit || null, recipe: null });
  }

  const out = [];
  for (const line of lines.values()) {
    const answer = state.checks[line.key] ?? null;
    // Pantry staples default to "we have it" but can be flipped.
    const check = line.required ? 'need' : (answer ?? (line.pantry ? 'have' : null));
    out.push({
      ...line,
      check,
      answered: line.required || answer !== null,
      include: check !== 'have',
      needsText: describeNeeds(line.needs.filter(n => n.quantity != null || n.unit)),
    });
  }
  out.sort((a, b) => Number(a.pantry) - Number(b.pantry) || a.item.localeCompare(b.item));
  return {
    mode,
    lines: out,
    toBuy: out.filter(l => l.include).length,
    unanswered: out.filter(l => !l.answered && !l.pantry).length,
  };
}

// ---- product matching ------------------------------------------------------

const DESCRIPTORS = new Set([
  'fresh', 'large', 'small', 'medium', 'ripe', 'chopped', 'diced', 'sliced', 'grated', 'minced',
  'crushed', 'peeled', 'finely', 'roughly', 'good', 'quality', 'handful', 'optional', 'organic',
  'to', 'serve', 'for', 'of', 'a', 'the', 'and', 'or',
]);

function words(s) {
  return itemKey(s).split(' ').filter(Boolean);
}

/** 0..1 — share of the meaningful item words that appear in the product name. */
export function relevance(item, productName) {
  const name = itemKey(productName);
  const all = words(item);
  const core = all.filter(w => !DESCRIPTORS.has(w));
  const pool = core.length ? core : all;
  if (!pool.length) return 0;
  const hit = pool.filter(w => name.includes(w)).length;
  return hit / pool.length;
}

function score(p, { item, preferOrganic, rememberedId, favouriteIds, rank }) {
  let s = 0;
  const rel = relevance(item, p.name);
  if (p.productId === rememberedId) s += 1000;
  if (favouriteIds.has(p.productId)) s += 300 * rel;
  if (preferOrganic && p.organic) s += 120;
  s += rel * 200;
  if (rel < 0.5) s -= 400;
  // Small bonus when descriptors match too ("chopped tomatoes" → tinned, not fresh).
  const all = words(item);
  const name = itemKey(p.name);
  if (all.length) s += (all.filter(w => name.includes(w)).length / all.length) * 60;
  if (!p.available) s -= 3000;
  if (p.sponsored) s -= 5;
  s -= rank;
  return s;
}

/**
 * Pick a product for one shopping line. Order of preference:
 *   remembered choice for this item → favourite that matches → organic → best match.
 */
export async function matchLine(ocado, line, ctx) {
  const { preferOrganic, choices, favourites, search } = ctx;
  const remembered = choices[line.key] ?? null;
  const favouriteIds = new Set(Object.keys(favourites));
  const candidates = new Map();
  const addAll = (list, rankBase = 0) => list.forEach((p, i) => {
    if (p?.productId && !candidates.has(p.productId)) candidates.set(p.productId, { p, rank: rankBase + i });
  });

  // Fast path — no Ocado search at all for things you've bought before or have
  // favourited for exactly this item. Keeps the request count low, which keeps
  // Ocado's bot check happy. "Swap" still searches when you want alternatives.
  const usual = remembered && (ctx.fresh.get(remembered.productId) ?? remembered);
  if (usual && usual.available !== false) {
    return { product: usual, alternatives: [], reason: 'Your usual', packs: suggestPacks(line.needs, usual.size) };
  }
  const exactFav = Object.values(favourites).find(f => f.item === line.key && (ctx.fresh.get(f.productId) ?? f).available !== false);
  if (exactFav) {
    const p = ctx.fresh.get(exactFav.productId) ?? exactFav;
    return { product: p, alternatives: [], reason: 'Favourite', packs: suggestPacks(line.needs, p.size) };
  }

  if (remembered) addAll([usual], 0);
  addAll(Object.values(favourites).filter(f => f.item === line.key || relevance(line.item, f.name) >= 0.99).map(f => ctx.fresh.get(f.productId) ?? f), 0);

  let error = null;
  try {
    const hasOrganicWord = /\borganic\b/i.test(line.item);
    if (preferOrganic && !hasOrganicWord) {
      const organic = await search(`organic ${line.item}`);
      addAll(organic, 0);
      const good = organic.filter(p => p.available && relevance(line.item, p.name) >= 0.99);
      if (good.length < 2) addAll(await search(line.item), 10);
    } else {
      addAll(await search(line.item), 0);
    }
  } catch (e) {
    error = e;
  }

  const ranked = [...candidates.values()]
    .map(({ p, rank }) => ({ p, s: score(p, { item: line.item, preferOrganic, rememberedId: remembered?.productId, favouriteIds, rank }) }))
    .sort((a, b) => b.s - a.s)
    .map(x => x.p);

  const product = ranked.find(p => p.available && relevance(line.item, p.name) >= 0.5)
    ?? (remembered && ranked.find(p => p.productId === remembered.productId && p.available))
    ?? null;

  let reason = 'No good match — search for one';
  if (product) {
    if (product.productId === remembered?.productId) reason = 'Your usual';
    else if (favouriteIds.has(product.productId)) reason = 'Favourite';
    else if (product.organic && preferOrganic) reason = 'Organic';
    else if (preferOrganic) reason = 'No organic option found';
    else reason = 'Best match';
  }
  if (error && !product) throw error;

  return {
    product,
    alternatives: ranked.filter(p => p.productId !== product?.productId).slice(0, 8),
    reason,
    packs: product ? suggestPacks(line.needs, product.size) : 1,
  };
}

/** Run matchLine across a list with limited concurrency (be polite to Ocado). */
export async function buildDraft(ocado, state, mode, onProgress = () => {}) {
  const list = buildList(state, mode);
  const toBuy = list.lines.filter(l => l.include);
  const cache = new Map();
  let blocked = null; // once Ocado's bot check refuses a search, stop asking for this build
  const search = q => {
    if (blocked) return Promise.reject(blocked);
    const k = q.toLowerCase();
    if (!cache.has(k)) {
      cache.set(k, ocado.search(q, { limit: 24 }).catch(e => {
        cache.delete(k);
        if (e.code === 'BLOCKED') blocked = e;
        throw e;
      }));
    }
    return cache.get(k);
  };

  // Refresh remembered + favourite products in one batch call for current prices/offers.
  const fresh = new Map();
  const keys = new Set(toBuy.map(l => l.key));
  const ids = [...new Set([
    ...toBuy.map(l => state.productChoices[l.key]?.productId).filter(Boolean),
    ...Object.values(state.favourites).filter(f => keys.has(f.item)).map(f => f.productId),
  ])];
  if (ids.length) {
    try { for (const p of await ocado.products(ids)) fresh.set(p.productId, p); } catch { /* fall back to stored snapshots */ }
  }

  const ctx = { preferOrganic: state.settings.preferOrganic !== false, choices: state.productChoices, favourites: state.favourites, search, fresh };
  const results = new Array(toBuy.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < toBuy.length) {
      const i = next++;
      const line = toBuy[i];
      try {
        const m = await matchLine(ocado, line, ctx);
        results[i] = { ...line, ...m, status: 'pending', error: null };
      } catch (e) {
        results[i] = { ...line, product: null, alternatives: [], reason: 'Search failed', packs: 1, status: 'pending', error: e.message };
      }
      onProgress(++done, toBuy.length);
    }
  }
  // Two at a time: gentle on Ocado.
  await Promise.all([worker(), worker()]);
  // Nothing matched at all because Ocado refused every search: report that instead of an empty list.
  if (blocked && !results.some(r => r.product)) throw blocked;

  return {
    id: newId(),
    mode,
    builtAt: new Date().toISOString(),
    sentAt: null,
    warning: blocked ? `Ocado's bot check stopped some searches, so ${results.filter(r => !r.product).length} item(s) still need a product. Use "Refresh sign-in" in Settings, then Rebuild or tap Choose.` : null,
    lines: results.map(l => ({
      key: l.key, item: l.item, needsText: l.needsText, recipes: l.recipes, required: l.required,
      product: l.product, alternatives: l.alternatives, reason: l.reason, packs: l.packs,
      status: l.status, error: l.error,
    })),
  };
}

/**
 * What to add so the live trolley holds at least what the list needs.
 * Lines that resolve to the same product are summed, and whatever is already
 * in the trolley counts — so sending twice never doubles anything up.
 */
export function planTrolleyAdds(lines, trolleyItems = []) {
  const have = new Map(trolleyItems.map(i => [i.productId, Number(i.quantity) || 0]));
  const byProduct = new Map();
  for (const l of lines) {
    if (!l.product?.productId || !(l.packs > 0)) continue;
    const id = l.product.productId;
    const entry = byProduct.get(id) ?? { productId: id, name: l.product.name, keys: [], packs: 0 };
    entry.keys.push(l.key);
    entry.packs += l.packs;
    byProduct.set(id, entry);
  }
  return [...byProduct.values()].map(e => {
    const already = have.get(e.productId) ?? 0;
    return { ...e, already, add: Math.max(0, e.packs - already) };
  });
}

export function draftTotal(draft) {
  if (!draft) return 0;
  return Math.round(draft.lines.reduce((s, l) => s + (l.product?.price ?? 0) * (l.packs || 0), 0) * 100) / 100;
}
