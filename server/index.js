// Autocado server: JSON API + live updates (Server-Sent Events) + static UI.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { store, newId } from './store.js';
import { forgetAll as forgetCatalogue } from './catalogue.js';
import { itemKey, parseIngredientLine, isPantry } from './ingredients.js';
import { buildList, buildDraft, draftTotal, planTrolleyAdds } from './shopping.js';
import * as importer from './recipes-import.js';
import { RealOcado } from './ocado/real.js';
import { MockOcado } from './ocado/mock.js';
import { Bridge, BridgeOcado } from './ocado/bridge.js';
import { OcadoRouter } from './ocado/router.js';
import { LoginManager } from './ocado/login.js';
import { OcadoError } from './ocado/errors.js';
import { advertiseName, cleanName, ownAddresses } from './lan-name.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 3456);
const HOST = process.env.HOST || '127.0.0.1';
// Reachable from other devices on the network (phones, the kitchen screen)?
const SHARED = !['127.0.0.1', 'localhost', '::1'].includes(HOST);
// Its name on the network: http://autocado.local (AUTOCADO_NAME=off to skip).
const NAME = SHARED ? cleanName(process.env.AUTOCADO_NAME) : null;
const MOCK = /^(1|true|yes)$/i.test(process.env.OCADO_MOCK || '');
// A visible browser window is the most reliable way past Ocado's bot check,
// but a headless Pi (no screen) can't show one.
const HAS_DISPLAY = process.platform === 'darwin' || process.platform === 'win32' || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// When the Autocado add-on is running in Firefox, Ocado requests go through it
// (see server/ocado/bridge.js); otherwise Autocado uses its own saved sign-in.
const bridge = new Bridge();
const ocado = MOCK ? new MockOcado() : new OcadoRouter(new RealOcado(), new BridgeOcado(bridge), bridge);
const ADDON_DIR = path.join(ROOT, 'addon');
const login = new LoginManager(async (cookies, csrf) => {
  ocado.saveCookies(cookies, csrf);
  await refreshOcadoStatus({ freshSignIn: true });
});

// ---------------------------------------------------------------- helpers --

const jobs = { draft: null, send: null, deals: null };
const progress = {}; // job -> { done, total, message }

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
store.on('change', version => broadcast('state', { version }));
login.on('change', s => broadcast('login', s));
const setProgress = (job, p) => { progress[job] = p; broadcast('progress', { job, ...p }); };

function publicState() {
  const s = store.get();
  return {
    ...s,
    lists: { weekly: buildList(s, 'weekly'), topup: buildList(s, 'topup') },
    draftTotal: draftTotal(s.draft),
    trolley: trolleyCache,
    env: {
      mock: MOCK,
      claude: importer.claudeAvailable(),
      claudeFromEnv: !!process.env.ANTHROPIC_API_KEY,
      model: importer.MODEL,
      hasDisplay: HAS_DISPLAY,
      ocadoEmail: store.getSecret('ocadoEmail') || null,
      ocadoPasswordSaved: !!store.getSecret('ocadoPassword'),
      jobs: Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, !!v])),
      progress,
      login: login.state,
      bridge: { ...bridge.status(), addonPath: path.join(ADDON_DIR, 'manifest.json') },
      via: ocado.via ?? (MOCK ? 'demo' : 'server'),
      lan: { shared: SHARED, urls: lanUrls() },
    },
  };
}

/**
 * Two different problems, kept apart:
 *  - signed out      → connected: false (sign in again)
 *  - bot check stale → connected stays true, botCheck set (refresh sign-in);
 *    the login is fine, Ocado just refuses some requests until a real browser
 *    visit renews its token.
 */
async function refreshOcadoStatus({ freshSignIn = false } = {}) {
  let st;
  try {
    st = await ocado.status();
  } catch (e) {
    st = e.code === 'BLOCKED' ? { connected: true, botCheck: e.message } : { connected: false, reason: e.message, code: e.code };
  }
  store.update(s => {
    const prevBotCheck = freshSignIn ? null : s.ocado.botCheck;
    s.ocado = {
      via: ocado.via ?? null,
      connected: !!st.connected,
      lastError: st.connected ? null : (st.reason || null),
      checkedAt: new Date().toISOString(),
      botCheck: st.botCheck ? { at: new Date().toISOString(), message: st.botCheck } : (st.connected ? prevBotCheck ?? null : null),
    };
  });
  return st;
}

function noteBotCheck(message) {
  store.update(s => { s.ocado = { ...s.ocado, botCheck: { at: new Date().toISOString(), message } }; });
}

/** Wrap a route so thrown errors become tidy JSON the UI can show. */
const route = fn => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof OcadoError) {
      if (e.code === 'BLOCKED') noteBotCheck(e.message);
      else if (e.needsReconnect) store.update(s => { s.ocado = { ...s.ocado, connected: false, lastError: e.message }; });
      return res.status(e.needsReconnect ? 401 : 502).json({ error: e.message, code: e.code, reconnect: e.needsReconnect });
    }
    if (e.code === 'NO_API_KEY') return res.status(400).json({ error: e.message, code: e.code });
    if (e.status && e.error) { // Anthropic SDK error
      const msg = e.status === 401 ? 'The Claude API key was rejected — check it in Settings.' : `Claude API error (${e.status}): ${e.error?.error?.message || e.message}`;
      return res.status(502).json({ error: msg, code: 'CLAUDE' });
    }
    const status = e.statusCode || 400;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.message || String(e) });
  }
};

const bad = msg => Object.assign(new Error(msg), { statusCode: 400 });
const notFound = msg => Object.assign(new Error(msg), { statusCode: 404 });
const busy = msg => Object.assign(new Error(msg), { statusCode: 409 });

function cleanIngredient(i) {
  const item = String(i.item || i.text || '').trim();
  if (!item) return null;
  const quantity = i.quantity === '' || i.quantity == null ? null : Number(i.quantity);
  return {
    id: i.id || newId(),
    text: String(i.text || item).trim(),
    item,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit: i.unit ? String(i.unit).trim() : null,
    pantry: i.pantry === undefined ? isPantry(item) : !!i.pantry,
  };
}

function cleanRecipe(body, existing = {}) {
  const name = String(body.name ?? existing.name ?? '').trim();
  if (!name) throw bad('A recipe needs a name.');
  const ingredients = (body.ingredients ?? existing.ingredients ?? []).map(cleanIngredient).filter(Boolean);
  const servings = body.servings === '' || body.servings == null ? null : Number(body.servings);
  return {
    ...existing,
    id: existing.id || newId(),
    name,
    servings: Number.isFinite(servings) && servings > 0 ? servings : null,
    staple: body.staple ?? existing.staple ?? true,
    notes: body.notes ?? existing.notes ?? '',
    source: body.source ?? existing.source ?? { type: 'manual' },
    ingredients,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function productSnapshot(p) {
  if (!p?.productId) throw bad('Missing product.');
  const pick = ({ productId, sku, name, brand, price, wasPrice, unitPrice, unitLabel, size, image, available, organic, offers, labels, url }) =>
    ({ productId, sku, name, brand, price, wasPrice, unitPrice, unitLabel, size, image, available, organic, offers: offers || [], labels: labels || [], url });
  return pick(p);
}

// ------------------------------------------------------------------- app --

const app = express();
app.use(express.json({ limit: '25mb' })); // recipe photos arrive as base64

const clients = new Set();
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ version: store.get().version })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

app.get('/api/state', route(() => publicState()));

// ---- Firefox add-on bridge (see server/ocado/bridge.js)

app.get('/api/bridge/poll', async (req, res) => {
  const wait = Math.max(0, Math.min(30, Number(req.query.wait) || 25)) * 1000;
  const info = { version: req.query.v || null, ocadoTab: req.query.tab === '1', browser: req.query.b || null };
  let closed = false;
  req.on('close', () => { closed = true; });
  const commands = await bridge.poll(info, wait);
  if (closed) {
    // The add-on went away mid-poll: put the work back for the next poll.
    if (commands.length) bridge.queue.unshift(...commands);
    return;
  }
  res.json({ commands });
});

app.post('/api/bridge/result', route(req => {
  const { id } = req.body || {};
  if (!id) throw bad('Missing request id.');
  return { ok: bridge.result(id, req.body) };
}));

bridge.on('online', () => { console.log('[bridge] Firefox add-on connected'); refreshOcadoStatus({ freshSignIn: true }).catch(() => {}); forgetTrolley(); });
bridge.on('offline', () => { console.log('[bridge] Firefox add-on went away'); refreshOcadoStatus().catch(() => {}); forgetTrolley(); });

app.post('/api/settings', route(req => {
  store.update(s => {
    if (typeof req.body.preferOrganic === 'boolean') s.settings.preferOrganic = req.body.preferOrganic;
    if (req.body.resetChoices === true) s.productChoices = {};
  });
}));

// "Reset all data": recipes, plan, needed list, favourites, remembered
// products, lists and history. Never touches the Ocado account itself (trolley
// and Ocado favourites stay as they are). Optionally signs out too.
app.post('/api/reset', route(async req => {
  if (String(req.body.confirm || '').trim().toLowerCase() !== 'confirm') throw bad('Type the word confirm to reset.');
  if (jobs.draft || jobs.send || jobs.deals) throw busy('Something is still talking to Ocado — try again in a moment.');
  const backup = store.backup();
  store.resetData();
  forgetCatalogue();
  if (req.body.signOut) {
    await login.cancel().catch(() => {});
    await ocado.logout();
    forgetTrolley();
    for (const k of ['ocadoEmail', 'ocadoPassword', 'anthropicApiKey']) store.setSecret(k, null);
    await refreshOcadoStatus({ freshSignIn: true });
  }
  return { ok: true, backup: backup ? path.relative(ROOT, backup) : null, signedOut: !!req.body.signOut };
}));

app.post('/api/settings/claude', route(async req => {
  const key = String(req.body.apiKey || '').trim();
  if (!key) { store.setSecret('anthropicApiKey', null); store.update(() => {}); return { ok: true }; }
  try {
    await importer.verifyKey(key);
  } catch (e) {
    if (e.status === 401) throw bad('That Claude API key was rejected.');
    throw bad(`Could not check the key: ${e.message}`);
  }
  store.setSecret('anthropicApiKey', key);
  store.update(() => {});
}));

// ---- Ocado connection

app.get('/api/ocado/status', route(() => refreshOcadoStatus()));

app.post('/api/ocado/login', route(async req => {
  const { method } = req.body;
  if (MOCK) {
    ocado.saveCookies([]);
    if (req.body.email) store.setSecret('ocadoEmail', req.body.email);
    await refreshOcadoStatus({ freshSignIn: true });
    return { status: 'success' };
  }
  if (method === 'manual') {
    if (!HAS_DISPLAY) throw bad('This machine has no screen to open a browser window on. Use email & password, or paste cookies.');
    return login.startManual();
  }
  if (method === 'credentials') {
    const email = String(req.body.email || store.getSecret('ocadoEmail') || '').trim();
    const password = String(req.body.password || store.getSecret('ocadoPassword') || '');
    if (!email || !password) throw bad('Enter your Ocado email and password.');
    store.setSecret('ocadoEmail', email);
    store.setSecret('ocadoPassword', req.body.remember ? password : null);
    // Default: show the browser window when there is a screen (gets past Ocado's bot check more often).
    const headless = !HAS_DISPLAY || (req.body.showBrowser === undefined ? false : !req.body.showBrowser);
    return login.startCredentials({ email, password, headless });
  }
  throw bad('Unknown sign-in method.');
}));

app.post('/api/ocado/login/otp', route(req => { login.submitOtp(req.body.code); }));
app.post('/api/ocado/login/cancel', route(() => login.cancel()));

app.post('/api/ocado/cookies', route(async req => {
  const raw = req.body.cookies;
  if (!raw) throw bad('Paste the exported cookies first.');
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {
    throw bad('That does not look like a cookie export. In Cookie-Editor choose Export → JSON and paste the whole thing.');
  }
  try { ocado.importCookies(parsed); } catch (e) {
    throw bad(`Could not read those cookies: ${e.message}`);
  }
  const st = await refreshOcadoStatus({ freshSignIn: true });
  if (!st.connected) throw bad(`Cookies imported, but Ocado does not see a signed-in session (${st.reason || 'unknown reason'}). Export them again while signed in.`);
}));

app.post('/api/ocado/logout', route(async req => {
  await ocado.logout();
  forgetTrolley();
  if (req.body?.forget) { store.setSecret('ocadoPassword', null); store.setSecret('ocadoEmail', null); }
  await refreshOcadoStatus();
}));

app.get('/api/ocado/search', route(async req => {
  const q = String(req.query.q || '').trim();
  if (!q) return { products: [] };
  const products = await ocado.search(q, { limit: 24 });
  const favs = store.get().favourites;
  return { products: products.map(p => ({ ...p, favourite: p.favourite || !!favs[p.productId] })) };
}));

// ---- The live Ocado trolley (source of truth for "what's in the basket")

let trolleyCache = null; // { items, total, count, fetchedAt }
let trolleyInFlight = null;

/** Read the real trolley from Ocado and push it to every open screen. */
async function fetchTrolley({ force = false } = {}) {
  if (!force && trolleyCache && Date.now() - Date.parse(trolleyCache.fetchedAt) < 10_000) return trolleyCache;
  if (trolleyInFlight) return trolleyInFlight;
  trolleyInFlight = (async () => {
    const t = await ocado.trolley();
    trolleyCache = { ...t, count: t.items.reduce((n, i) => n + i.quantity, 0), fetchedAt: new Date().toISOString() };
    broadcast('trolley', trolleyCache);
    return trolleyCache;
  })().finally(() => { trolleyInFlight = null; });
  return trolleyInFlight;
}

function forgetTrolley() {
  trolleyCache = null;
  broadcast('trolley', null);
}

const qtyIn = (trolley, productId) => trolley?.items.find(i => i.productId === productId)?.quantity ?? 0;
const pause = ms => new Promise(r => setTimeout(r, ms));

/**
 * Re-read the trolley until `ok(trolley)` holds (one retry). Ocado can quietly
 * ignore a write when its bot check wants a fresh sign-in, so every change is
 * checked against the real trolley rather than trusted.
 */
async function confirmTrolley(ok) {
  let t = await fetchTrolley({ force: true });
  if (ok(t)) return { trolley: t, confirmed: true };
  await pause(1500);
  t = await fetchTrolley({ force: true });
  return { trolley: t, confirmed: ok(t) };
}

const NOT_APPLIED = 'Ocado did not apply this change. That usually means its bot check wants a fresh sign-in: use "Refresh sign-in" in Settings, then try again.';

app.get('/api/ocado/trolley', route(req => fetchTrolley({ force: req.query.fresh === '1' })));

app.post('/api/ocado/trolley/quantity', route(async req => {
  const { productId } = req.body;
  const quantity = Math.max(0, Math.min(48, Math.round(Number(req.body.quantity))));
  if (!productId || !Number.isFinite(quantity)) throw bad('Missing product or quantity.');
  await ocado.setTrolleyQuantity(productId, quantity);
  const { trolley, confirmed } = await confirmTrolley(t => qtyIn(t, productId) === quantity);
  if (!confirmed) throw new OcadoError('BLOCKED', NOT_APPLIED);
  return trolley;
}));

app.post('/api/ocado/trolley/clear', route(async () => {
  await ocado.clearTrolley();
  const { trolley, confirmed } = await confirmTrolley(t => t.items.length === 0);
  if (!confirmed) throw new OcadoError('BLOCKED', NOT_APPLIED);
  return trolley;
}));

// ---- Recipes

app.post('/api/recipes', route(req => {
  const recipe = cleanRecipe(req.body);
  store.update(s => {
    s.recipes.push(recipe);
    if (req.body.selectThisWeek) s.plan.selected[recipe.id] = true;
  });
  return recipe;
}));

app.put('/api/recipes/:id', route(req => {
  const existing = store.get().recipes.find(r => r.id === req.params.id);
  if (!existing) throw notFound('Recipe not found.');
  const recipe = cleanRecipe(req.body, existing);
  store.update(s => { s.recipes = s.recipes.map(r => (r.id === recipe.id ? recipe : r)); });
  return recipe;
}));

app.delete('/api/recipes/:id', route(req => {
  store.update(s => {
    s.recipes = s.recipes.filter(r => r.id !== req.params.id);
    delete s.plan.selected[req.params.id];
    delete s.plan.servings[req.params.id];
  });
}));

app.post('/api/recipes/import', route(async req => {
  const { kind } = req.body;
  if (kind === 'photo') return importer.fromPhotos(req.body.images, req.body.hint);
  if (kind === 'text') return importer.fromText(req.body.text);
  if (kind === 'url') return importer.fromUrl(String(req.body.url || '').trim());
  if (kind === 'book') return importer.fromBook(req.body.title, req.body.book);
  throw bad('Unknown import type.');
}));

app.post('/api/parse-lines', route(req => ({
  ingredients: String(req.body.text || '').split(/\r?\n/).map(parseIngredientLine).filter(Boolean),
})));

// ---- This week's plan + "have we got enough?" answers

app.post('/api/plan/toggle', route(req => {
  const { recipeId, on } = req.body;
  if (!store.get().recipes.some(r => r.id === recipeId)) throw notFound('Recipe not found.');
  store.update(s => { if (on) s.plan.selected[recipeId] = true; else delete s.plan.selected[recipeId]; });
}));

app.post('/api/plan/servings', route(req => {
  const { recipeId, servings } = req.body;
  store.update(s => {
    const n = Number(servings);
    if (Number.isFinite(n) && n > 0) s.plan.servings[recipeId] = n; else delete s.plan.servings[recipeId];
  });
}));

app.post('/api/plan/clear', route(() => store.update(s => { s.plan.selected = {}; s.checks = {}; })));

app.post('/api/checks', route(req => {
  const key = itemKey(req.body.key);
  const value = req.body.value;
  if (!key) throw bad('Missing item.');
  if (![null, 'have', 'need'].includes(value)) throw bad('Answer must be have, need or null.');
  store.update(s => { if (value === null) delete s.checks[key]; else s.checks[key] = value; });
}));

app.post('/api/checks/reset', route(() => store.update(s => { s.checks = {}; })));

// ---- Needed items (ran out / ad-hoc top-up)

app.post('/api/required', route(req => {
  const raw = req.body.items ?? req.body.text ?? req.body.item;
  const lines = (Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n|,(?![^(]*\))/)).map(l => String(l).trim()).filter(Boolean);
  if (!lines.length) throw bad('Nothing to add.');
  const added = [];
  store.update(s => {
    for (const line of lines) {
      const p = parseIngredientLine(line);
      const key = itemKey(p.item);
      if (!key || s.required.some(r => itemKey(r.item) === key)) continue;
      const entry = { id: newId(), item: p.item, quantity: p.quantity, unit: p.unit, addedAt: new Date().toISOString() };
      s.required.push(entry);
      added.push(entry);
    }
  });
  return { added };
}));

app.delete('/api/required/:id', route(req => {
  store.update(s => { s.required = s.required.filter(r => r.id !== req.params.id); });
}));

app.post('/api/required/clear', route(() => store.update(s => { s.required = []; })));

// ---- Favourites + deals

app.post('/api/favourites/toggle', route(async req => {
  const on = !!req.body.on;
  const product = req.body.product ? productSnapshot(req.body.product) : store.get().favourites[req.body.productId];
  if (!product) throw bad('Missing product.');
  const item = req.body.item ? itemKey(req.body.item) : null;

  let synced = false;
  let syncError = null;
  if (store.get().ocado.connected) {
    try { await ocado.setFavourite(product.productId, on); synced = true; } catch (e) { syncError = e.message; }
  }
  store.update(s => {
    if (on) {
      s.favourites[product.productId] = {
        ...s.favourites[product.productId], ...product,
        item: item ?? s.favourites[product.productId]?.item ?? null,
        onOcado: synced, syncError, addedAt: s.favourites[product.productId]?.addedAt || new Date().toISOString(),
      };
    } else {
      delete s.favourites[product.productId];
    }
  });
  return { synced, syncError };
}));

async function refreshFavourites() {
  if (jobs.deals) return jobs.deals;
  jobs.deals = (async () => {
    setProgress('deals', { done: 0, total: 2, message: 'Reading Ocado favourites…' });
    let fromOcado = null;
    let warning = null;
    if (store.get().ocado.connected) {
      try { fromOcado = await ocado.favourites(); } catch (e) { warning = e.message; if (e.needsReconnect) throw e; }
    }
    setProgress('deals', { done: 1, total: 2, message: 'Checking prices and offers…' });
    const localIds = Object.keys(store.get().favourites).filter(id => !fromOcado?.some(p => p.productId === id));
    let fresh = [];
    if (localIds.length) {
      try { fresh = await ocado.products(localIds); } catch (e) { warning = warning || e.message; }
    }
    store.update(s => {
      const now = new Date().toISOString();
      if (fromOcado) {
        const ids = new Set(fromOcado.map(p => p.productId));
        // Favourites that were on Ocado but have been removed there: drop them.
        for (const [id, f] of Object.entries(s.favourites)) if (f.onOcado && !ids.has(id)) delete s.favourites[id];
        for (const p of fromOcado) s.favourites[p.productId] = { ...s.favourites[p.productId], ...productSnapshot(p), onOcado: true, syncError: null, addedAt: s.favourites[p.productId]?.addedAt || now };
      }
      for (const p of fresh) if (s.favourites[p.productId]) s.favourites[p.productId] = { ...s.favourites[p.productId], ...productSnapshot(p) };
      s.dealsCheckedAt = now;
    });
    setProgress('deals', { done: 2, total: 2, message: warning ? `Done, with a problem: ${warning}` : 'Up to date' });
    return { warning, count: Object.keys(store.get().favourites).length };
  })().finally(() => { jobs.deals = null; setProgress('deals', null); });
  return jobs.deals;
}

app.post('/api/favourites/refresh', route(() => refreshFavourites()));

// ---- Basket draft: match → review → send to the Ocado trolley (never checkout)

app.post('/api/draft/build', route(async req => {
  const mode = req.body.mode === 'topup' ? 'topup' : 'weekly';
  if (jobs.draft) throw busy('Already matching products — hang on.');
  const list = buildList(store.get(), mode);
  if (!list.lines.some(l => l.include)) throw bad(mode === 'weekly' ? 'Nothing to buy yet — pick some recipes or add needed items.' : 'The needed list is empty.');
  setProgress('draft', { done: 0, total: list.toBuy, message: 'Finding products…' });
  jobs.draft = buildDraft(ocado, store.get(), mode, (done, total) => setProgress('draft', { done, total, message: `Matched ${done} of ${total}` }));
  try {
    const draft = await jobs.draft;
    store.update(s => { s.draft = draft; });
    return { ok: true };
  } finally {
    jobs.draft = null;
    setProgress('draft', null);
  }
}));

app.post('/api/draft/line', route(req => {
  const { key } = req.body;
  store.update(s => {
    const line = s.draft?.lines.find(l => l.key === key);
    if (!line) throw notFound('That item is no longer in the basket.');
    if (req.body.product) {
      const product = productSnapshot(req.body.product);
      if (line.product && line.product.productId !== product.productId) {
        line.alternatives = [line.product, ...line.alternatives.filter(a => a.productId !== product.productId)].slice(0, 8);
      }
      line.product = product;
      line.reason = 'Your choice';
      line.status = 'pending';
      line.error = null;
      s.productChoices[key] = { ...product, chosenAt: new Date().toISOString() }; // remember for next time
    }
    if (req.body.packs !== undefined) line.packs = Math.max(0, Math.min(24, Math.round(Number(req.body.packs) || 0)));
    if (req.body.remove) s.draft.lines = s.draft.lines.filter(l => l.key !== key);
  });
}));

app.post('/api/draft/add', route(async req => {
  if (!store.get().draft) throw bad('Build a basket first.');
  const product = productSnapshot(req.body.product);
  const key = itemKey(req.body.item || product.name);
  store.update(s => {
    if (s.draft.lines.some(l => l.product?.productId === product.productId)) return;
    s.draft.lines.push({ key, item: req.body.item || product.name, needsText: '', recipes: [], required: false, product, alternatives: [], reason: 'Added by you', packs: 1, status: 'pending', error: null });
  });
}));

app.post('/api/draft/discard', route(() => store.update(s => { s.draft = null; })));

// Sending tops the live trolley up to what the list needs: it reads the
// trolley first and only adds the difference, so sending twice (or after
// adding things on ocado.com) never doubles anything up.
app.post('/api/draft/send', route(async req => {
  const draft = store.get().draft;
  if (!draft) throw bad('Nothing to send — build a list first.');
  if (jobs.send) throw busy('Already sending to Ocado.');
  if (!store.get().ocado.connected) throw new OcadoError('NOT_CONNECTED', 'Connect your Ocado account first (Settings).');
  if (!draft.lines.some(l => l.product && l.packs > 0)) throw bad('Nothing to add — every item is removed or set to 0.');

  jobs.send = (async () => {
    if (req.body.clearFirst) {
      setProgress('send', { done: 0, total: 1, message: 'Emptying the Ocado trolley…' });
      await ocado.clearTrolley();
    }
    setProgress('send', { done: 0, total: 1, message: 'Reading your Ocado trolley…' });
    const before = await fetchTrolley({ force: true });
    const plan = planTrolleyAdds(draft.lines, before.items);
    const outcome = new Map(); // line key -> { status, note, error }
    let done = 0;
    let added = 0;
    for (const entry of plan) {
      setProgress('send', { done, total: plan.length, message: entry.add ? `Adding ${entry.name}…` : `${entry.name} is already in the trolley` });
      let result = { status: 'sent', note: entry.add === 0 ? `Already in trolley (×${entry.already})` : entry.already ? `Added ${entry.add} — ${entry.already} were already there` : null, error: null };
      if (entry.add > 0) {
        try {
          await ocado.addToTrolley(entry.productId, entry.add);
          added += entry.add;
        } catch (e) {
          if (e.needsReconnect) throw e;
          result = { status: 'failed', note: null, error: e.message };
        }
      }
      for (const key of entry.keys) outcome.set(key, result);
      done++;
    }
    // Check the adds really landed in the trolley.
    const expected = plan.filter(e => e.add > 0 && outcome.get(e.keys[0])?.status === 'sent');
    const { confirmed, trolley: after } = await confirmTrolley(t => expected.every(e => qtyIn(t, e.productId) >= e.already + e.add));
    if (!confirmed) {
      noteBotCheck(NOT_APPLIED);
      for (const e of expected) {
        if (qtyIn(after, e.productId) >= e.already + e.add) continue;
        added -= e.add;
        for (const key of e.keys) outcome.set(key, { status: 'failed', note: null, error: NOT_APPLIED });
      }
    }

    const failed = [...outcome.values()].filter(o => o.status === 'failed').length;
    const okKeys = new Set([...outcome.entries()].filter(([, o]) => o.status === 'sent').map(([k]) => k));
    store.update(s => {
      const at = new Date().toISOString();
      for (const l of s.draft.lines) {
        const o = outcome.get(l.key);
        if (o) Object.assign(l, o);
        if (okKeys.has(l.key) && l.product) s.productChoices[l.key] = { ...l.product, chosenAt: s.productChoices[l.key]?.chosenAt || at };
      }
      s.required = s.required.filter(r => !okKeys.has(itemKey(r.item)));
      // Pantry answers were for this shop; next week starts fresh.
      if (s.draft.mode === 'weekly') s.checks = {};
      s.history.unshift({
        id: newId(), at, mode: s.draft.mode, added,
        lines: s.draft.lines.map(l => ({ item: l.item, name: l.product?.name ?? null, productId: l.product?.productId ?? null, packs: l.packs, status: l.status, note: l.note ?? null, error: l.error })),
      });
      s.history = s.history.slice(0, 30);
      // The trolley is now the source of truth; keep the list only if something failed.
      if (failed) s.draft.sentAt = at; else s.draft = null;
    });
    return { added, products: plan.length, alreadyThere: plan.filter(p => p.add === 0).length, failed };
  })().finally(() => { jobs.send = null; setProgress('send', null); });
  return jobs.send;
}));

// ---- static UI

app.use('/vendor/preact', express.static(path.join(ROOT, 'node_modules/preact/dist')));
app.use('/vendor/preact-hooks', express.static(path.join(ROOT, 'node_modules/preact/hooks/dist')));
app.use('/vendor/htm', express.static(path.join(ROOT, 'node_modules/htm/dist')));
app.use('/vendor/htm-preact', express.static(path.join(ROOT, 'node_modules/htm/preact')));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ------------------------------------------------------------------ start --

const server = app.listen(PORT, HOST, async () => {
  console.log(`Autocado running at http://${SHARED ? 'localhost' : HOST}:${PORT}${MOCK ? '  (DEMO MODE — fake Ocado)' : ''}`);
  if (SHARED) startSharing().catch(e => console.log(`  Couldn't set up the network address: ${e.message}`));
  await refreshOcadoStatus();
});

// ---- sharing on the home network

const lan = { host: null, port80: PORT === 80, name: null };

/** Addresses other devices can open, friendliest first. */
function lanUrls() {
  if (!SHARED) return [];
  const urls = [];
  if (lan.host) urls.push(`http://${lan.host}${lan.port80 ? '' : `:${PORT}`}`);
  for (const a of ownAddresses()) urls.push(`http://${a.address}:${PORT}`);
  return urls;
}

async function startSharing() {
  // Also answer on port 80, the web's default, so the address needs no ":3456".
  // Optional: skipped if something else has port 80 or it needs admin rights (Linux).
  const port80 = lan.port80 ? Promise.resolve(true) : new Promise(resolve => {
    const s = http.createServer(app);
    s.once('listening', () => resolve(true));
    s.once('error', () => resolve(false));
    s.listen(80, HOST);
  });
  let settled = false;
  const named = !NAME ? Promise.resolve(null) : new Promise(resolve => {
    lan.name = advertiseName(NAME, {
      onReady: ({ host }) => { settled = true; resolve(host); },
      onTaken: ip => { settled = true; console.log(`  ${NAME}.local is already used by another device (${ip}). Set AUTOCADO_NAME in .env to choose another name.`); resolve(null); },
      onError: e => { if (!settled) { settled = true; console.log(`  Couldn't set up ${NAME}.local: ${e.message}`); resolve(null); } },
    });
  });
  [lan.port80, lan.host] = await Promise.all([port80, named]);
  const [first, ...rest] = lanUrls();
  if (first) console.log(`  On your phone or tablet: ${first}`);
  for (const u of rest) console.log(`                      or: ${u}`);
  broadcast('state', {});
}

// Keep deals fresh for the kitchen screen: check favourites every 6 hours.
setInterval(() => {
  const s = store.get();
  const stale = !s.dealsCheckedAt || Date.now() - Date.parse(s.dealsCheckedAt) > 6 * 3600_000;
  if (s.ocado.connected && stale && Object.keys(s.favourites).length) refreshFavourites().catch(() => {});
}, 30 * 60_000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { lan.name?.stop(); await login.cancel().catch(() => {}); server.close(); process.exit(0); });
