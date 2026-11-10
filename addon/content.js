// Autocado for Ocado — runs inside ocado.com pages.
//
// Performs requests on behalf of your Autocado server *as the page*, so they
// carry your signed-in session and the bot-check token Firefox keeps fresh —
// the same requests Ocado's own web app makes. Only a short allowlist of Ocado
// paths is accepted; anything else is refused.
'use strict';

const ALLOWED = [
  ['GET', /^\/api\/cart\/v1\/carts\/active\?/],
  ['POST', /^\/api\/cart\/v1\/carts\/active\/apply-quantity\?/],
  ['PUT', /^\/api\/webproductpagews\/v6\/products$/],
  ['PUT', /^\/api\/customer-favorites\/v1\/customers\/favorites\/[0-9a-f-]{8,}$/],
  ['DELETE', /^\/api\/customer-favorites\/v1\/customers\/favorites\/[0-9a-f-]{8,}$/],
  ['GET', /^\/api\/customer\/v3\/customers\/current$/],
  ['GET', /^\/search\?q=[^&]*$/],
  ['GET', /^\/favorites$/],
];

// In Firefox, content.fetch runs as the page itself (same origin, page cookies).
const pageWindow = typeof content !== 'undefined' && content ? content : window;
const page = pageWindow.wrappedJSObject || pageWindow;
const toPage = obj => (typeof cloneInto === 'function' ? cloneInto(obj, pageWindow) : obj);
const pageFetch = (url, init) => pageWindow.fetch(url, toPage(init));

const CSRF_RE = /"csrf":\{"token":"([^"]+)"/;
let csrf = null;

function csrfFromDocument() {
  for (const s of document.scripts) {
    const m = CSRF_RE.exec(s.textContent || '');
    if (m) return m[1];
  }
  return null;
}

async function getCsrf(force = false) {
  if (csrf && !force) return csrf;
  csrf = force ? null : csrfFromDocument();
  if (!csrf) {
    const res = await pageFetch('/', { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    csrf = CSRF_RE.exec(await res.text())?.[1] || null;
  }
  return csrf;
}

function signedIn() {
  const html = document.documentElement.innerHTML;
  if (html.includes('"isLoggedIn":true')) return true;
  if (html.includes('"isLoggedIn":false')) return false;
  return null;
}

/** Let Ocado's own bot-check SDK refresh its token first, as the page does before its requests. */
async function freshenBotToken() {
  try {
    const waf = page.AwsWafIntegration;
    if (waf && typeof waf.getToken === 'function') {
      await Promise.race([waf.getToken(), new Promise(r => setTimeout(r, 4000))]);
    }
  } catch { /* optional */ }
}

async function run(cmd) {
  const method = String(cmd.method || 'GET').toUpperCase();
  const path = String(cmd.path || '');
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) {
    return { error: `Autocado add-on refused a request it does not allow: ${method} ${path.split('?')[0]}` };
  }
  await freshenBotToken();
  const headers = {
    Accept: cmd.accept === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
    'ecom-request-source': 'web',
  };
  if (method !== 'GET') headers['x-csrf-token'] = await getCsrf();
  if (cmd.body !== undefined && cmd.body !== null) headers['Content-Type'] = 'application/json; charset=utf-8';
  const send = () => pageFetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: cmd.body !== undefined && cmd.body !== null ? JSON.stringify(cmd.body) : undefined,
  });
  let res = await send();
  if (res.status === 403 && method !== 'GET') {
    headers['x-csrf-token'] = await getCsrf(true); // stale CSRF token: fetch a new one once
    res = await send();
  }
  return { status: res.status, text: await res.text() };
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'autocado:ping') return Promise.resolve({ ok: true, signedIn: msg.detail ? signedIn() : undefined });
  if (msg?.type === 'autocado:fetch') return run(msg.cmd).catch(e => ({ error: e.message || String(e) }));
  return undefined;
});
