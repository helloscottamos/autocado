// Weeks and orders.
//
// There is always a current week. Everything Autocado puts in the Ocado
// trolley is recorded as a "shop" in that week, and a shop stays open
// ("in-trolley") until you place the order on Ocado. Placing the weekly
// shop's order files the week under pastWeeks and starts a fresh one; a
// top-up order is logged in the current week without closing it.
//
// Autocado can't see Ocado orders, but Ocado empties the trolley when an
// order goes through. So when a shop is open and the trolley turns up empty
// (and Autocado didn't empty it), we ask whether you checked out.
//
// Everything here is a plain function of the state object, so it is easy to
// test; the server calls these inside store.update().
import { newId } from './store.js';

const KEEP_WEEKS = 104;            // two years of past weeks
const OWN_EMPTY_GRACE_MS = 3 * 60_000;

export function newWeek(at = new Date().toISOString()) {
  return { id: newId(), startedAt: at, shops: [] };
}

/** The shop whose items are in the Ocado trolley, waiting for checkout. */
export function openShop(state) {
  return state.currentWeek?.shops.find(s => s.status === 'in-trolley') ?? null;
}

export function weekStatus(state) {
  return openShop(state) ? 'in-trolley' : 'planning';
}

/**
 * Record items that just landed in the trolley. Joins the open shop if there
 * is one: it's one Ocado trolley, so it's one order. A weekly send makes the
 * whole shop the weekly one.
 *   lines: [{ item, name, productId, packs, price }]
 */
export function recordSend(state, { kind = 'weekly', lines = [], at = new Date().toISOString() } = {}) {
  if (!lines.length) return null;
  let shop = openShop(state);
  if (!shop) {
    shop = { id: newId(), kind, status: 'in-trolley', firstSentAt: at, lastSentAt: at, items: [] };
    state.currentWeek.shops.push(shop);
  }
  if (kind === 'weekly') shop.kind = 'weekly';
  shop.lastSentAt = at;
  for (const l of lines) {
    const existing = shop.items.find(i => i.productId && i.productId === l.productId) ?? shop.items.find(i => i.item === l.item);
    if (existing) Object.assign(existing, { ...l, packs: Math.max(existing.packs || 0, l.packs || 0) });
    else shop.items.push({ item: l.item, name: l.name ?? null, productId: l.productId ?? null, packs: l.packs ?? 1, price: l.price ?? null });
  }
  shop.estimate = estimate(shop.items);
  state.orderCheck = null;
  return shop;
}

const estimate = items => Math.round(items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.packs) || 0), 0) * 100) / 100;

const plannedRecipes = state => state.recipes
  .filter(r => state.plan.selected[r.id])
  .map(r => ({ id: r.id, name: r.name, servings: Number(state.plan.servings?.[r.id]) || r.servings || null }));

/**
 * The order was placed on Ocado. Marks the open shop as ordered (or records
 * an order Autocado didn't fill, if there's no open shop). A weekly order
 * closes the week: it moves to pastWeeks and a fresh week begins, with the
 * recipes unticked and the cupboard answers cleared. The Needed list stays.
 *   trolley: the last full trolley seen, { count, total }, if known
 */
export function markOrdered(state, { at = new Date().toISOString(), how = 'you', trolley = null } = {}) {
  const week = state.currentWeek;
  let shop = openShop(state);
  if (!shop) {
    shop = { id: newId(), kind: Object.keys(state.plan.selected).length ? 'weekly' : 'topup', status: 'in-trolley', firstSentAt: null, lastSentAt: null, items: [], estimate: 0 };
    week.shops.push(shop);
  }
  shop.status = 'ordered';
  shop.orderedAt = at;
  shop.how = how;
  if (trolley?.count) shop.trolley = { count: trolley.count, total: trolley.total ?? null };
  state.orderCheck = null;

  const closeWeek = shop.kind === 'weekly';
  const restore = { plan: structuredClone(state.plan), checks: { ...state.checks }, draft: state.draft };
  if (closeWeek) {
    state.pastWeeks.unshift({ ...week, orderedAt: at, recipes: plannedRecipes(state) });
    state.pastWeeks = state.pastWeeks.slice(0, KEEP_WEEKS);
    state.currentWeek = newWeek(at);
    state.plan = { selected: {}, servings: {} };
    state.checks = {};
    state.draft = null;
  }
  state.lastOrdered = { at, weekId: week.id, shopId: shop.id, closedWeek: closeWeek, kind: shop.kind, total: shop.trolley?.total ?? shop.estimate ?? null, restore };
  return state.lastOrdered;
}

/** "No, I emptied it": the trolley is empty, so nothing from that shop is waiting any more. */
export function markNotOrdered(state, { at = new Date().toISOString() } = {}) {
  const shop = openShop(state);
  if (shop) { shop.status = 'cleared'; shop.clearedAt = at; }
  state.orderCheck = null;
  return shop;
}

/** Can the last "ordered" be taken back? Only while the fresh week is still untouched. */
export function canUndoOrdered(state) {
  const last = state.lastOrdered;
  if (!last?.restore) return false;
  if (!last.closedWeek) return state.currentWeek.shops.some(s => s.id === last.shopId && s.status === 'ordered') && !openShop(state);
  return state.pastWeeks[0]?.id === last.weekId
    && !Object.keys(state.plan.selected).length
    && !state.currentWeek.shops.length;
}

export function undoOrdered(state) {
  if (!canUndoOrdered(state)) return false;
  const last = state.lastOrdered;
  if (last.closedWeek) {
    const { orderedAt, recipes, ...week } = state.pastWeeks.shift();
    state.currentWeek = week;
    state.plan = last.restore.plan;
    state.checks = last.restore.checks;
    state.draft = last.restore.draft ?? null;
  }
  const shop = state.currentWeek.shops.find(s => s.id === last.shopId);
  if (shop) {
    if (!shop.firstSentAt && !shop.items.length) state.currentWeek.shops = state.currentWeek.shops.filter(s => s !== shop);
    else { shop.status = 'in-trolley'; delete shop.orderedAt; delete shop.how; delete shop.trolley; }
  }
  state.lastOrdered = null;
  return true;
}

/**
 * Tick the recipes from a past week again (same servings), replacing the
 * current choices. Recipes deleted since then are skipped.
 */
export function repeatWeek(state, weekId) {
  const week = state.pastWeeks.find(w => w.id === weekId);
  if (!week) return null;
  const exists = new Set(state.recipes.map(r => r.id));
  const ticked = week.recipes.filter(r => exists.has(r.id));
  state.plan.selected = Object.fromEntries(ticked.map(r => [r.id, true]));
  state.plan.servings = {};
  for (const r of ticked) {
    const usual = state.recipes.find(x => x.id === r.id)?.servings;
    if (r.servings && r.servings !== usual) state.plan.servings[r.id] = r.servings;
  }
  state.checks = {};
  return { ticked: ticked.length, missing: week.recipes.length - ticked.length };
}

/** recipeId -> when it was last in an ordered week (newest first). */
export function lastHad(state) {
  const out = {};
  for (const w of state.pastWeeks) for (const r of w.recipes || []) if (!out[r.id]) out[r.id] = w.orderedAt;
  return out;
}

/**
 * Did the trolley just empty because an order went through? True when a shop
 * is waiting, the trolley is now empty, we haven't already asked, and
 * Autocado itself didn't empty it in the last few minutes.
 */
export function looksCheckedOut(state, trolley, { ownEmptyAt = 0, now = Date.now() } = {}) {
  if (!trolley || (trolley.items?.length ?? trolley.count ?? 0) > 0) return false;
  if (!openShop(state) || state.orderCheck) return false;
  return now - ownEmptyAt > OWN_EMPTY_GRACE_MS;
}

/**
 * Older data has no weeks. Start one, and if things were sent to the trolley
 * in the last fortnight, treat them as a shop still waiting for checkout.
 */
export function migrate(state, { now = Date.now() } = {}) {
  if (state.currentWeek?.shops) return false;
  state.currentWeek = newWeek(new Date(now).toISOString());
  state.pastWeeks = Array.isArray(state.pastWeeks) ? state.pastWeeks : [];
  const recent = (state.history || []).filter(h => now - Date.parse(h.at) < 14 * 86400_000).reverse();
  for (const h of recent) {
    const lines = h.lines.filter(l => l.status === 'sent' && l.productId).map(l => ({ item: l.item, name: l.name, productId: l.productId, packs: l.packs }));
    recordSend(state, { kind: h.mode === 'topup' ? 'topup' : 'weekly', lines, at: h.at });
  }
  return true;
}
