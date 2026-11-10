// Autocado for Ocado — background script.
//
// Long-polls your Autocado server for Ocado requests, runs each one inside an
// ocado.com tab (where your real, signed-in Firefox session and Ocado's own
// bot-check token live), and posts the answer back. If no ocado.com tab is
// open, one is opened in the background.
'use strict';

const VERSION = browser.runtime.getManifest().version;
const DEFAULT_SERVER = 'http://localhost:3456';
const OCADO_URL = 'https://www.ocado.com/';
const OCADO_MATCH = 'https://www.ocado.com/*';

const state = {
  server: DEFAULT_SERVER,
  connected: false,      // talking to the Autocado server
  lastPoll: null,
  lastError: null,
  lastRequest: null,     // { at, path, status }
  handled: 0,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadServer() {
  const { server } = await browser.storage.local.get('server');
  state.server = (server || DEFAULT_SERVER).replace(/\/+$/, '');
  return state.server;
}

browser.storage.onChanged.addListener(changes => {
  if (changes.server) state.server = (changes.server.newValue || DEFAULT_SERVER).replace(/\/+$/, '');
});

function setBadge() {
  browser.browserAction.setBadgeText({ text: state.connected ? '' : '!' });
  browser.browserAction.setBadgeBackgroundColor({ color: '#c62828' });
  browser.browserAction.setTitle({
    title: state.connected ? `Autocado: connected to ${state.server}` : `Autocado: can't reach ${state.server}`,
  });
}

// ---- ocado.com tab ---------------------------------------------------------

async function ocadoTabs() {
  return browser.tabs.query({ url: OCADO_MATCH });
}

async function ping(tabId, detail = false) {
  try {
    const r = await browser.tabs.sendMessage(tabId, { type: 'autocado:ping', detail });
    return r && r.ok ? r : null;
  } catch {
    return null; // content script not loaded yet
  }
}

async function waitForReady(tabId, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await ping(tabId);
    if (r) return r;
    await sleep(700);
  }
  throw new Error('The ocado.com tab did not finish loading.');
}

let opening = null;
/** A ready ocado.com tab, opening one in the background if needed. */
async function readyOcadoTab() {
  for (const tab of await ocadoTabs()) {
    if (await ping(tab.id)) return tab;
  }
  const tabs = await ocadoTabs();
  if (tabs.length) {
    await waitForReady(tabs[0].id, 20000);
    return tabs[0];
  }
  if (!opening) {
    opening = (async () => {
      const tab = await browser.tabs.create({ url: OCADO_URL, active: false });
      await waitForReady(tab.id);
      return tab;
    })().finally(() => { opening = null; });
  }
  return opening;
}

/** Run one request in the ocado.com tab. Reloads the tab once if Ocado shows a bot check. */
async function runInOcado(cmd) {
  let tab = await readyOcadoTab();
  let res = await browser.tabs.sendMessage(tab.id, { type: 'autocado:fetch', cmd });
  if (res && res.status === 202) {
    // Ocado wants a fresh bot-check token: reloading the page lets Firefox get one,
    // exactly as when you refresh the page yourself.
    await browser.tabs.reload(tab.id);
    await sleep(1500);
    await waitForReady(tab.id);
    res = await browser.tabs.sendMessage(tab.id, { type: 'autocado:fetch', cmd });
  }
  return res;
}

// ---- talking to the Autocado server ---------------------------------------

async function handle(cmd) {
  let payload;
  try {
    const r = await runInOcado(cmd);
    if (!r) throw new Error('No answer from the ocado.com tab.');
    if (r.error) payload = { id: cmd.id, ok: false, error: r.error };
    else payload = { id: cmd.id, ok: true, status: r.status, text: r.text };
    state.lastRequest = { at: Date.now(), path: cmd.path.split('?')[0], status: r.status ?? null, error: r.error ?? null };
  } catch (e) {
    payload = { id: cmd.id, ok: false, error: e.message };
    state.lastRequest = { at: Date.now(), path: cmd.path.split('?')[0], status: null, error: e.message };
  }
  state.handled++;
  try {
    await fetch(`${state.server}/api/bridge/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* server went away; it will time the request out */ }
}

let running = 0;
const queue = [];
function enqueue(cmd) {
  queue.push(cmd);
  pump();
}
function pump() {
  while (running < 3 && queue.length) {
    const cmd = queue.shift();
    running++;
    handle(cmd).finally(() => { running--; pump(); });
  }
}

async function pollLoop() {
  await loadServer();
  for (;;) {
    try {
      const hasTab = (await ocadoTabs()).length > 0;
      const url = `${state.server}/api/bridge/poll?wait=25&v=${encodeURIComponent(VERSION)}&tab=${hasTab ? 1 : 0}&b=firefox`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Autocado answered HTTP ${res.status}`);
      const { commands = [] } = await res.json();
      state.connected = true;
      state.lastPoll = Date.now();
      state.lastError = null;
      setBadge();
      for (const cmd of commands) enqueue(cmd);
    } catch (e) {
      state.connected = false;
      state.lastError = e.message === 'NetworkError when attempting to fetch resource.'
        ? `Can't reach Autocado at ${state.server}. Is it running?`
        : e.message;
      setBadge();
      await sleep(5000);
    }
  }
}

// ---- popup ------------------------------------------------------------------

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === 'autocado:status') {
    const tabs = await ocadoTabs();
    let page = null;
    for (const t of tabs) { page = await ping(t.id, true); if (page) break; }
    return { ...state, version: VERSION, ocadoTabs: tabs.length, signedIn: page ? page.signedIn : null };
  }
  if (msg?.type === 'autocado:openOcado') {
    const tabs = await ocadoTabs();
    if (tabs.length) await browser.tabs.update(tabs[0].id, { active: true });
    else await browser.tabs.create({ url: OCADO_URL });
    return { ok: true };
  }
  return undefined;
});

setBadge();
pollLoop();
