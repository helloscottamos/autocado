// Ocado sign-in, driven from the web UI.
//
// Three ways in, because Ocado sits behind AWS WAF bot detection and
// sometimes emails a one-time code:
//   1. credentials — we fill email/password in a Playwright browser; if Ocado
//      asks for an emailed code, the UI prompts for it and we type it in.
//   2. manual      — we open a real browser window at ocado.com/login and the
//      person signs in themselves; we capture the session when it's done.
//   3. cookies     — paste a cookie export (Cookie-Editor extension). Handled
//      by the adapter, not here.
// Only the resulting session cookies are kept (~/.ocado/session.json).
import { EventEmitter } from 'node:events';

const BASE = 'https://www.ocado.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const OTP_TIMEOUT_MS = 5 * 60_000;
const MANUAL_TIMEOUT_MS = 10 * 60_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class LoginManager extends EventEmitter {
  constructor(onCookies) {
    super();
    this.onCookies = onCookies; // async (cookies) => void
    this.state = { status: 'idle', message: null, method: null };
    this.browser = null;
    this.otpWaiter = null;
  }

  #set(status, message = null) {
    this.state = { ...this.state, status, message };
    this.emit('change', this.state);
  }

  get busy() {
    return ['starting', 'signing_in', 'waiting_for_otp', 'waiting_for_user'].includes(this.state.status);
  }

  async #launch(headless) {
    let chromium;
    try { ({ chromium } = await import('playwright')); } catch {
      throw new Error('Playwright is not installed. Run `npm install` then `npm run setup:browser`.');
    }
    try {
      this.browser = await chromium.launch({ headless });
    } catch (e) {
      if (/Executable doesn't exist|browserType.launch/i.test(e.message)) {
        throw new Error('The Chromium browser used for sign-in is not installed. Run `npm run setup:browser` on this machine, then try again.');
      }
      if (/display|DISPLAY|headed/i.test(e.message)) {
        throw new Error('No screen available to open a browser window. Use "Sign in with email & password" (headless) or paste cookies instead.');
      }
      throw e;
    }
    const context = await this.browser.newContext({ userAgent: UA, locale: 'en-GB', viewport: { width: 1100, height: 850 } });
    return { context, page: await context.newPage() };
  }

  async #close() {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }

  async #dismissCookieBanner(page) {
    // Prefer "reject non-essential"; fall back to closing the banner.
    for (const sel of ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', '#onetrust-accept-btn-handler']) {
      const btn = page.locator(sel);
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(800);
        return;
      }
    }
  }

  static async #isSignedIn(page) {
    if (page.url().includes('/login')) return false;
    const html = await page.content().catch(() => '');
    if (/"isLoggedIn":true/.test(html)) return true;
    if (/"isLoggedIn":false/.test(html)) return false;
    return null; // page not settled yet
  }

  async #finish(context, page) {
    // The page's CSRF token lasts the whole session; keeping it means trolley
    // changes don't have to re-load Ocado's homepage to get one.
    let csrf = null;
    try {
      if (!/"csrf":\{"token"/.test(await page.content())) await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      csrf = /"csrf":\{"token":"([^"]+)"/.exec(await page.content())?.[1] ?? null;
    } catch { /* optional */ }
    const cookies = await context.cookies();
    await this.onCookies(cookies, csrf);
  }

  /** Sign in with email + password, pausing for an emailed code if asked. */
  async startCredentials({ email, password, headless = true }) {
    if (this.busy) throw new Error('A sign-in is already in progress.');
    this.state = { status: 'starting', message: 'Opening Ocado…', method: 'credentials' };
    this.emit('change', this.state);
    (async () => {
      try {
        const { context, page } = await this.#launch(headless);
        this.#set('signing_in', 'Signing in to Ocado…');
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(2500);
        await this.#dismissCookieBanner(page);

        const emailSel = 'input[type="email"], input[name="email"], #username';
        await page.waitForSelector(emailSel, { timeout: 20_000 }).catch(() => {
          throw new Error('Ocado did not show its login form (it may be showing a bot check). Try "Open Ocado and sign in myself" instead.');
        });
        await page.fill(emailSel, email);
        await page.fill('input[type="password"], input[name="password"], #password', password);
        const submit = page.locator('[data-synthetics="login-submit-button"], button[type="submit"]').first();
        await submit.click();

        // Wait for one of: signed in, OTP prompt, error message.
        const otpInput = page.locator('[data-synthetics="username-input"], input[name="otpVerify"], input[autocomplete="one-time-code"]');
        const deadline = Date.now() + 30_000;
        let needsOtp = false;
        while (Date.now() < deadline) {
          if (await otpInput.first().isVisible().catch(() => false)) { needsOtp = true; break; }
          if (!page.url().includes('/login')) break;
          const err = await page.locator('[role="alert"], [data-synthetics*="error"]').first().textContent({ timeout: 300 }).catch(() => null);
          if (err && /incorrect|invalid|wrong|try again/i.test(err)) throw new Error(`Ocado said: ${err.trim()}`);
          await sleep(700);
        }

        if (needsOtp) {
          this.#set('waiting_for_otp', 'Ocado has emailed you a code. Enter it to finish signing in.');
          const code = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('Timed out waiting for the emailed code.')), OTP_TIMEOUT_MS);
            this.otpWaiter = { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } };
          });
          this.otpWaiter = null;
          this.#set('signing_in', 'Checking the code…');
          await otpInput.first().fill(code);
          await page.waitForTimeout(300);
          await page.locator('[data-synthetics="password-reset-button"], button[type="submit"]').first().click();
        }

        const done = Date.now() + 30_000;
        let ok = null;
        while (Date.now() < done) {
          ok = await LoginManager.#isSignedIn(page);
          if (ok) break;
          await sleep(1000);
        }
        if (!ok) {
          // Load the home page once to be sure — some flows land on /login?redirect.
          await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
          ok = await LoginManager.#isSignedIn(page);
        }
        if (!ok) throw new Error('Still not signed in after submitting. Check the email/password, or use "Open Ocado and sign in myself".');
        await this.#finish(context, page);
        this.#set('success', 'Connected to Ocado.');
      } catch (e) {
        this.#set('error', e.message);
      } finally {
        await this.#close();
      }
    })();
    return this.state;
  }

  submitOtp(code) {
    if (!this.otpWaiter) throw new Error('Ocado is not waiting for a code right now.');
    const clean = String(code || '').replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(clean)) throw new Error('That does not look like the code from the email.');
    this.otpWaiter.resolve(clean);
  }

  /** Open a visible browser window and let the person sign in themselves. */
  async startManual() {
    if (this.busy) throw new Error('A sign-in is already in progress.');
    this.state = { status: 'starting', message: 'Opening a browser window…', method: 'manual' };
    this.emit('change', this.state);
    (async () => {
      try {
        const { context, page } = await this.#launch(false);
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        this.#set('waiting_for_user', 'Sign in to Ocado in the browser window that just opened. It will close by itself when you are in.');
        const deadline = Date.now() + MANUAL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (!this.browser) throw new Error('Sign-in cancelled.');
          if (page.isClosed()) throw new Error('The browser window was closed before signing in finished.');
          if (await LoginManager.#isSignedIn(page)) {
            await page.waitForTimeout(1500); // let the session cookies settle
            await this.#finish(context, page);
            this.#set('success', 'Connected to Ocado.');
            return;
          }
          await sleep(2000);
        }
        throw new Error('Timed out waiting for you to sign in.');
      } catch (e) {
        this.#set('error', e.message);
      } finally {
        await this.#close();
      }
    })();
    return this.state;
  }

  async cancel() {
    this.otpWaiter?.reject(new Error('Sign-in cancelled.'));
    await this.#close();
    this.#set('idle', null);
  }
}
