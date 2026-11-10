// The Firefox add-on bridge.
//
// Ocado's bot check (AWS WAF) only trusts real browsers, and a real browser
// keeps its token fresh by itself. So when the Autocado add-on is running in
// your Firefox, Ocado requests are carried out *inside your signed-in
// ocado.com tab* instead of from this server:
//
//   server ── queue a request ──▶ add-on long-polls /api/bridge/poll
//   add-on ── runs it in the ocado.com tab (same as Ocado's own web app)
//   add-on ── posts the response ──▶ /api/bridge/result ──▶ server continues
//
// The add-on only accepts a short allowlist of Ocado paths (trolley, product
// info, favourites, search, "who's signed in"). All the logic stays here.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { OcadoError } from './errors.js';
import { productsFromHtml, normaliseEntity } from './normalise.js';
import { remember, known } from '../catalogue.js';
import {
  CART_URL, APPLY_QTY_URL, PRODUCTS_URL, CUSTOMER_URL, FAVOURITES_URL, SEARCH_URL, FAVOURITES_PAGE,
  cartLines, mapCart,
} from './cart.js';

const ONLINE_MS = 75_000; // the add-on polls every ~25s; two missed polls = offline

export class Bridge extends EventEmitter {
  constructor({ timeoutMs = 60_000 } = {}) {
    super();
    this.timeoutMs = timeoutMs;
    this.queue = [];             // requests waiting for the add-on to collect
    this.pending = new Map();    // id -> { resolve, reject, timer }
    this.pollers = new Set();    // long-poll responders waiting for work
    this.lastSeen = 0;
    this.info = {};
    this.wasOnline = false;
    this.watch = setInterval(() => this.#checkOnline(), 10_000);
    this.watch.unref?.();
  }

  get online() {
    return Date.now() - this.lastSeen < ONLINE_MS;
  }

  status() {
    return { online: this.online, lastSeen: this.lastSeen ? new Date(this.lastSeen).toISOString() : null, ...this.info };
  }

  #checkOnline() {
    const now = this.online;
    if (now !== this.wasOnline) {
      this.wasOnline = now;
      this.emit(now ? 'online' : 'offline');
    }
  }

  /** Called by the add-on's long-poll. Resolves with work, or [] after waitMs. */
  poll(info = {}, waitMs = 25_000) {
    this.lastSeen = Date.now();
    this.info = { version: info.version ?? null, ocadoTab: info.ocadoTab ?? null, browser: info.browser ?? null };
    this.#checkOnline();
    if (this.queue.length) return Promise.resolve(this.queue.splice(0));
    return new Promise(resolve => {
      const poller = { resolve, timer: null };
      poller.timer = setTimeout(() => { this.pollers.delete(poller); resolve([]); }, waitMs);
      this.pollers.add(poller);
    });
  }

  /** The add-on's answer to one request. */
  result(id, payload) {
    this.lastSeen = Date.now();
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (payload.ok) p.resolve({ status: payload.status, text: payload.text ?? '' });
    else p.reject(new OcadoError(payload.code === 'NOT_SIGNED_IN' ? 'SESSION_EXPIRED' : 'UNKNOWN', `Firefox add-on: ${payload.error || 'request failed'}`));
    return true;
  }

  /** Ask the add-on to perform one Ocado request; resolves with { status, text }. */
  request(req) {
    if (!this.online) {
      return Promise.reject(new OcadoError('NOT_CONNECTED', 'The Autocado add-on in Firefox is not running. Open Firefox (with the add-on installed).'));
    }
    const id = randomUUID();
    const cmd = { id, method: req.method || 'GET', path: req.path, body: req.body, accept: req.accept || 'json' };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.queue = this.queue.filter(c => c.id !== id);
        reject(new OcadoError('NETWORK', 'The Firefox add-on did not answer in time. Is Firefox open with an ocado.com tab?'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const poller = this.pollers.values().next().value;
      if (poller) {
        this.pollers.delete(poller);
        clearTimeout(poller.timer);
        poller.resolve([cmd]);
      } else {
        this.queue.push(cmd);
      }
    });
  }

  close() {
    clearInterval(this.watch);
    for (const p of this.pollers) { clearTimeout(p.timer); p.resolve([]); }
    this.pollers.clear();
  }
}

/** Same interface as RealOcado / MockOcado, but every request goes through the add-on. */
export class BridgeOcado {
  constructor(bridge) {
    this.bridge = bridge;
    this.mock = false;
    this.via = 'firefox';
    this.searchCache = new Map();
  }

  hasSession() { return this.bridge.online; }

  async #call(method, path, { body, accept = 'json', okStatuses = [200, 201, 204] } = {}) {
    const res = await this.bridge.request({ method, path, body, accept });
    if (res.status === 401 || res.status === 403) {
      throw new OcadoError('SESSION_EXPIRED', 'You are not signed in to Ocado in Firefox. Sign in on ocado.com in Firefox, then try again.');
    }
    if (res.status === 202) {
      throw new OcadoError('BLOCKED', 'Ocado showed Firefox a bot check. Open the ocado.com tab in Firefox (it may ask you to confirm you are human), then try again.');
    }
    if (!okStatuses.includes(res.status)) throw new OcadoError('UNKNOWN', `Ocado answered HTTP ${res.status}.`);
    if (accept !== 'json') return res.text;
    if (!res.text) return null;
    try { return JSON.parse(res.text); } catch { throw new OcadoError('UNKNOWN', 'Ocado sent something that was not JSON.'); }
  }

  async status() {
    if (!this.bridge.online) return { connected: false, reason: 'The Firefox add-on is not running.' };
    try {
      const me = await this.#call('GET', CUSTOMER_URL);
      return me?.customerId ? { connected: true } : { connected: false, reason: 'Sign in on ocado.com in Firefox.' };
    } catch (e) {
      if (e.code === 'SESSION_EXPIRED') return { connected: false, reason: 'Not signed in to Ocado in Firefox. Sign in on ocado.com in Firefox.' };
      throw e;
    }
  }

  async search(query, { limit = 24 } = {}) {
    const key = `${String(query).trim().toLowerCase()}|${limit}`;
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.products;
    const html = await this.#call('GET', SEARCH_URL(query), { accept: 'html' });
    if (!html.includes('"productEntities"')) throw new OcadoError('BLOCKED', 'Ocado search did not return products in Firefox. Open the ocado.com tab and try again.');
    const { extractProductEntities } = await loadExtractor();
    const products = remember(productsFromHtml(html, extractProductEntities, limit));
    this.searchCache.set(key, { at: Date.now(), products });
    if (this.searchCache.size > 300) this.searchCache.delete(this.searchCache.keys().next().value);
    return products;
  }

  async favourites() {
    const html = await this.#call('GET', FAVOURITES_PAGE, { accept: 'html' });
    if (!html.includes('"productEntities"')) throw new OcadoError('SESSION_EXPIRED', 'Could not read your Ocado favourites in Firefox. Are you signed in there?');
    const { extractProductEntities } = await loadExtractor();
    return remember(productsFromHtml(html, extractProductEntities, 500).map(p => ({ ...p, favourite: true })));
  }

  async products(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 40) {
      const data = await this.#call('PUT', PRODUCTS_URL, { body: ids.slice(i, i + 40) });
      for (const p of data?.products ?? []) if (p?.productId) out.push(normaliseEntity(p));
    }
    return remember(out);
  }

  async setFavourite(productId, on) {
    await this.#call(on ? 'PUT' : 'DELETE', FAVOURITES_URL(productId));
  }

  async #cart() {
    const cart = await this.#call('GET', CART_URL);
    if (!cart || typeof cart !== 'object') throw new OcadoError('UNKNOWN', 'Ocado did not return the trolley.');
    return cart;
  }

  async trolley() {
    const cart = await this.#cart();
    const unknown = cartLines(cart).map(i => i.productId).filter(id => !known(id));
    let detailsBlocked = false;
    if (unknown.length) {
      try { await this.products(unknown); } catch { detailsBlocked = true; }
    }
    return { ...mapCart(cart), detailsBlocked };
  }

  /** Ocado's one trolley write: quantities are deltas (+2 adds two, -1 removes one). */
  async #apply(changes) {
    if (!changes.length) return;
    await this.#call('POST', APPLY_QTY_URL, { body: changes });
  }

  async addToTrolley(productId, quantity) {
    await this.#apply([{ productId, quantity }]);
  }

  async setTrolleyQuantity(productId, quantity) {
    const current = cartLines(await this.#cart()).find(i => i.productId === productId)?.quantity ?? 0;
    const delta = Math.max(0, quantity) - Number(current);
    if (delta) await this.#apply([{ productId, quantity: delta }]);
  }

  async clearTrolley() {
    await this.#apply(cartLines(await this.#cart()).map(i => ({ productId: i.productId, quantity: -Number(i.quantity) })));
  }
}

// open-supermarkets' extractor is CommonJS; load it lazily.
let extractor = null;
async function loadExtractor() {
  if (!extractor) {
    const { createRequire } = await import('node:module');
    extractor = createRequire(import.meta.url)('open-supermarkets/dist/providers/ocado.js');
  }
  return extractor;
}
