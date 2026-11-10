// Real Ocado adapter, built on open-supermarkets (MIT, github.com/abracadabra50/open-supermarkets).
//
// open-supermarkets handles the session file (~/.ocado/session.json), cookies,
// the CSRF dance and every trolley write. This file adds the pieces Autocado
// needs that the library doesn't expose yet:
//   - search/favourites results that keep offers and the Organic badge
//   - adding/removing favourites on Ocado
//   - a reliable "are we signed in?" check
// It reaches into OcadoProvider's `client` / `getCsrfToken()` (TypeScript-private,
// plain properties at runtime). If an upgrade of open-supermarkets breaks this,
// this file is the only place to fix.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { productsFromHtml, normaliseEntity } from './normalise.js';
import { OcadoError, classifyError } from './errors.js';
import { remember, known } from '../catalogue.js';
import { CART_URL, PRODUCTS_URL, CUSTOMER_URL, FAVOURITES_URL, BASE_URL, cartLines, mapCart } from './cart.js';

const require = createRequire(import.meta.url);
const { OcadoProvider, extractProductEntities, importSession } = require('open-supermarkets/dist/providers/ocado.js');

export const SESSION_FILE = path.join(os.homedir(), '.ocado', 'session.json');

const HTML = { headers: { Accept: 'text/html,application/xhtml+xml' } };
const WEB = { 'ecom-request-source': 'web' };
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const BOT_CHECK = 'Ocado\'s bot check wants a fresh sign-in before it will answer this. Use "Refresh sign-in" in Settings (your Ocado login itself is fine).';

// CSRF token captured at sign-in, kept next to the session cookies.
const CSRF_FILE = path.join(os.homedir(), '.ocado', 'autocado-csrf.json');
function readCsrf() {
  try { return JSON.parse(fs.readFileSync(CSRF_FILE, 'utf8')).token || null; } catch { return null; }
}
function writeCsrf(token) {
  try {
    if (token) fs.writeFileSync(CSRF_FILE, JSON.stringify({ token, savedAt: new Date().toISOString() }), { mode: 0o600 });
    else fs.rmSync(CSRF_FILE, { force: true });
  } catch { /* optional */ }
}

export class RealOcado {
  constructor() {
    this.mock = false;
    this.reload();
  }

  /** Re-read the session file (after login / cookie import). */
  reload() {
    this.provider = new OcadoProvider();
    this.loggedIn = null;
    // Reuse the CSRF token captured at sign-in (it lasts the whole session), so
    // trolley changes don't depend on re-loading Ocado's homepage.
    const csrf = readCsrf();
    if (csrf) this.provider.csrfToken = csrf;
    this.#blockedUntil = 0;
  }

  hasSession() {
    return fs.existsSync(SESSION_FILE);
  }

  async #html(url) {
    try {
      const res = await this.provider.client.get(url, HTML);
      const html = String(res.data ?? '');
      if (res.status === 202 || html.length < 500) {
        throw new OcadoError('BLOCKED', BOT_CHECK);
      }
      const tok = /"csrf":\{"token":"([^"]+)"/.exec(html)?.[1];
      if (tok) this.provider.csrfToken = tok;
      return html;
    } catch (e) {
      throw classifyError(e);
    }
  }

  async #write(method, url, data) {
    const call = async () => this.provider.client.request({
      method, url, data,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-csrf-token': await this.provider.getCsrfToken() },
    });
    try {
      return await call();
    } catch (e) {
      if (e.response?.status === 403) {
        this.provider.csrfToken = null; // stale token: re-scrape once
        try { return await call(); } catch (e2) { throw classifyError(e2); }
      }
      throw classifyError(e);
    }
  }

  /**
   * Signed in? Asks Ocado's own "current customer" API (small JSON, and it
   * keeps answering when the bot-check token is stale, unlike the HTML pages).
   */
  async status() {
    if (!this.hasSession()) return { connected: false, reason: 'No Ocado session yet' };
    let res;
    try {
      res = await this.provider.client.get(CUSTOMER_URL, { headers: { Accept: 'application/json', ...WEB }, validateStatus: () => true });
    } catch (e) { throw classifyError(e); }
    if (res.status === 202) throw new OcadoError('BLOCKED', BOT_CHECK);
    const loggedIn = res.status === 200 && !!res.data?.customerId;
    this.loggedIn = loggedIn;
    return loggedIn ? { connected: true } : { connected: false, reason: 'Your Ocado sign-in has expired. Sign in again.' };
  }

  async #requireLogin() {
    if (!this.hasSession()) throw new OcadoError('NOT_CONNECTED', 'Connect your Ocado account first (Settings).');
    if (this.loggedIn === false) throw new OcadoError('SESSION_EXPIRED', 'Your Ocado session has expired. Reconnect in Settings.');
  }

  /**
   * Search needs no account, so it's done as an anonymous visitor would; if
   * Ocado refuses that, one try with the session (which works right after a
   * sign-in). Results are cached for 30 minutes, and after a refusal we wait
   * two minutes before asking again — hammering a bot check only makes it worse.
   */
  #searchCache = new Map(); // query -> { at, products }
  #blockedUntil = 0;
  async search(query, { limit = 24 } = {}) {
    const key = `${String(query).trim().toLowerCase()}|${limit}`;
    const hit = this.#searchCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.products;
    if (Date.now() < this.#blockedUntil) {
      throw new OcadoError('BLOCKED', 'Ocado\'s bot check is refusing searches right now. Wait a couple of minutes, or use "Refresh sign-in" in Settings.');
    }
    const path = `/search?q=${encodeURIComponent(query)}`;
    let html = null;
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-GB,en;q=0.9' },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (res.status === 200 && text.includes('"productEntities"')) html = text;
    } catch (e) {
      if (!this.hasSession()) throw classifyError(e);
    }
    if (!html && this.hasSession()) {
      try {
        const text = await this.#html(path);
        if (text.includes('"productEntities"')) html = text;
      } catch { /* fall through */ }
    }
    if (!html) {
      this.#blockedUntil = Date.now() + 2 * 60_000;
      throw new OcadoError('BLOCKED', 'Ocado\'s bot check is refusing searches right now. Wait a couple of minutes, or use "Refresh sign-in" in Settings.');
    }
    const products = remember(productsFromHtml(html, extractProductEntities, limit));
    this.#searchCache.set(key, { at: Date.now(), products });
    if (this.#searchCache.size > 300) this.#searchCache.delete(this.#searchCache.keys().next().value);
    return products;
  }

  async favourites() {
    await this.#requireLogin();
    const html = await this.#html('/favorites');
    if (!html.includes('"productEntities"')) {
      this.loggedIn = false;
      throw new OcadoError('SESSION_EXPIRED', 'Could not read Ocado favourites — session has probably expired.');
    }
    return remember(productsFromHtml(html, extractProductEntities, 500).map(p => ({ ...p, favourite: true })));
  }

  /**
   * Current price / offers / availability for known product ids.
   * Behind Ocado's bot check: once the sign-in's browser token is stale it
   * answers 202 with a challenge page, which we report as BLOCKED.
   */
  async products(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const res = await this.#write('PUT', PRODUCTS_URL, chunk);
      if (res.status === 202 || !Array.isArray(res.data?.products)) {
        throw new OcadoError('BLOCKED', BOT_CHECK);
      }
      for (const p of res.data.products) if (p?.productId) out.push(normaliseEntity(p));
    }
    return remember(out);
  }

  async setFavourite(productId, on) {
    await this.#requireLogin();
    await this.#write(on ? 'PUT' : 'DELETE', FAVOURITES_URL(productId));
  }

  /**
   * The live Ocado trolley: what's really in it right now. Quantities and
   * prices come straight from Ocado's cart; names and pictures come from the
   * catalogue of products we've seen, looked up on Ocado only when unknown.
   */
  async trolley() {
    await this.#requireLogin();
    let cart;
    try { cart = (await this.provider.client.get(CART_URL)).data; } catch (e) { throw classifyError(e); }
    if (!cart || typeof cart !== 'object') throw new OcadoError('BLOCKED', BOT_CHECK);
    const unknown = cartLines(cart).map(i => i.productId).filter(id => !known(id));
    let detailsBlocked = false;
    if (unknown.length) {
      try { await this.products(unknown); } catch { detailsBlocked = true; }
    }
    return { ...mapCart(cart), detailsBlocked };
  }

  async addToTrolley(productId, quantity) {
    await this.#requireLogin();
    try { await this.provider.addToBasket(productId, quantity); } catch (e) { throw classifyError(e); }
  }

  /** Set an absolute quantity (0 removes the line). */
  async setTrolleyQuantity(productId, quantity) {
    await this.#requireLogin();
    try { await this.provider.updateBasketItem(productId, Math.max(0, quantity)); } catch (e) { throw classifyError(e); }
  }

  async clearTrolley() {
    await this.#requireLogin();
    try { await this.provider.clearBasket(); } catch (e) { throw classifyError(e); }
  }

  /** Accepts a Cookie-Editor / Playwright / bare-array cookie export. */
  importCookies(json) {
    const tmp = path.join(os.tmpdir(), `autocado-cookies-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(tmp, typeof json === 'string' ? json : JSON.stringify(json), { mode: 0o600 });
    try { importSession(tmp); } finally { fs.rmSync(tmp, { force: true }); }
    writeCsrf(null);
    this.reload();
  }

  saveCookies(cookies, csrf) {
    OcadoProvider.saveSession(cookies);
    writeCsrf(csrf || null);
    this.reload();
  }

  async logout() {
    writeCsrf(null);
    await this.provider.logout();
    this.reload();
  }
}
