// Settings + first-run setup: connect Ocado, add a Claude key, preferences.
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { api, post } from '../api.js';
import { Btn, Segmented, Sheet, Switch, botCheckActive, toast, toastError, timeAgo } from '../ui.js';

export function SettingsView({ state, login, setup, go }) {
  const finishSetup = () => {
    try { localStorage.setItem('autocado.setupSeen', '1'); } catch { /* ignore */ }
    go('recipes', state.recipes.length ? undefined : { add: '1' });
    location.reload();
  };

  return html`
    <section class="view">
      ${setup ? html`<div class="welcome">
        <h1>Welcome to Autocado 🥑</h1>
        <p>Pick this week's recipes, say what you already have, and Autocado fills your Ocado trolley — preferring organic and your favourites. It never places the order: you check the trolley and book a slot on Ocado.</p>
        <ol class="steps">
          <li><strong>Connect Ocado</strong> so Autocado can fill your trolley. The Firefox add-on is the most reliable way.</li>
          <li><strong>Optional:</strong> add a Claude API key to read recipes from photos.</li>
          <li>Add your staple recipes.</li>
        </ol>
      </div>` : html`<div class="view-head"><div><h1>Settings</h1></div></div>`}

      ${!state.env.mock ? html`<${FirefoxCard} state=${state} />` : null}
      <${OcadoCard} state=${state} login=${login} />
      <${ClaudeCard} state=${state} />
      ${!setup ? html`<${PrefsCard} state=${state} />` : null}

      ${setup ? html`<div class="btn-row"><span class="spacer"></span><${Btn} kind="primary" onClick=${finishSetup}>${state.ocado.connected ? 'Continue' : 'Skip for now'} →<//></div>` : html`<${KioskCard} state=${state} /><${ResetCard} state=${state} go=${go} />`}
    </section>
  `;
}

function OcadoCard({ state, login }) {
  const env = state.env;
  const [method, setMethod] = useState(env.hasDisplay ? 'manual' : 'credentials');
  const [email, setEmail] = useState(env.ocadoEmail || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState('');
  const [cookies, setCookies] = useState('');
  const status = login?.status || 'idle';
  const inProgress = ['starting', 'signing_in', 'waiting_for_otp', 'waiting_for_user'].includes(status);
  const [refreshing, setRefreshing] = useState(false);
  const viaFirefox = !!env.bridge?.online;
  const showSignIn = !viaFirefox && (!state.ocado.connected || refreshing || inProgress);
  useEffect(() => { if (status === 'success') setRefreshing(false); }, [status]);

  const start = async body => {
    const r = await post('/api/ocado/login', body);
    if (env.mock) toast('Demo mode: connected to the fake Ocado.', 'success');
    return r;
  };
  const check = async () => {
    const r = await api('/api/ocado/status');
    toast(r.connected ? 'Ocado is connected.' : `Not connected: ${r.reason || 'unknown'}`, r.connected ? 'success' : 'warn');
  };

  return html`<div class="card">
    <div class="card-head">
      <h2>Ocado account</h2>
      <span class=${`status-pill ${state.ocado.connected ? 'ok' : 'off'}`}><span class="dot" aria-hidden="true"></span>${state.ocado.connected ? 'Connected' : 'Not connected'}</span>
    </div>
    ${viaFirefox ? html`
      <p>${state.ocado.connected ? 'Signed in through your Firefox (Autocado add-on).' : (state.ocado.lastError || 'Sign in on ocado.com in Firefox.')} Checked ${timeAgo(state.ocado.checkedAt)}.</p>
      <div class="btn-row"><${Btn} small onClick=${check}>Check connection<//></div>
    ` : null}
    ${state.ocado.connected && !viaFirefox ? html`
      <p>Signed in with Autocado's own sign-in${env.ocadoEmail ? ` as ${env.ocadoEmail}` : ''}. Checked ${timeAgo(state.ocado.checkedAt)}.</p>
      <div class="btn-row">
        <${Btn} small onClick=${check}>Check connection<//>
        ${!showSignIn ? html`<${Btn} small onClick=${() => setRefreshing(true)}>Refresh sign-in<//>` : null}
        <${Btn} small kind="ghost" onClick=${() => confirm('Disconnect Ocado? You will need to sign in again.') && post('/api/ocado/logout', { forget: true })}>Disconnect<//>
      </div>
      ${botCheckActive(state) && !showSignIn ? html`<div class="banner banner-warn">
        <span>${state.ocado.botCheck.message} <span class="muted small">(${timeAgo(state.ocado.botCheck.at)})</span></span>
        <${Btn} small kind="primary" onClick=${() => setRefreshing(true)}>Refresh sign-in<//>
      </div>` : html`<p class="muted small">Ocado's bot check goes stale a while after signing in. Searching and reading the trolley keep working, but syncing favourites, looking up new products and sometimes changing the trolley need a fresh sign-in. Autocado will say when.</p>`}
    ` : null}
    ${showSignIn ? html`
      ${!state.ocado.connected && state.ocado.lastError ? html`<p class="warn-text">${state.ocado.lastError}</p>` : null}

      ${inProgress || status === 'error' || status === 'success' ? html`<div class=${`login-status login-${status}`} role="status">
        <p>${login.message}</p>
        ${status === 'waiting_for_otp' ? html`<form class="add-row" onSubmit=${e => { e.preventDefault(); post('/api/ocado/login/otp', { code }).then(() => setCode('')).catch(toastError); }}>
          <input type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="Code from the email" value=${code} onInput=${e => setCode(e.currentTarget.value)} aria-label="One-time code" />
          <button class="btn btn-primary" type="submit">Submit code</button>
        </form>` : null}
        ${inProgress ? html`<${Btn} small kind="ghost" onClick=${() => post('/api/ocado/login/cancel')}>Cancel<//>` : null}
      </div>` : null}

      ${!inProgress ? html`
        <${Segmented} label="Sign-in method" value=${method} onChange=${setMethod} options=${[
          ...(env.hasDisplay ? [{ value: 'manual', label: 'Sign in myself' }] : []),
          { value: 'credentials', label: 'Email & password' },
          { value: 'cookies', label: 'Paste cookies' },
        ]} />

        ${method === 'manual' ? html`<div class="stack">
          <p>Opens a browser window on this computer at ocado.com. Sign in there as normal (including any emailed code), and the window closes by itself once you're in. Most reliable option.</p>
          <${Btn} kind="primary" onClick=${() => start({ method: 'manual' })}>Open Ocado sign-in<//>
        </div>` : null}

        ${method === 'credentials' ? html`<form class="stack" onSubmit=${e => { e.preventDefault(); start({ method: 'credentials', email, password, remember }).then(() => setPassword('')).catch(toastError); }}>
          <label class="field"><span>Email</span><input type="email" autocomplete="username" value=${email} onInput=${e => setEmail(e.currentTarget.value)} required /></label>
          <label class="field"><span>Password</span><input type="password" autocomplete="current-password" value=${password} onInput=${e => setPassword(e.currentTarget.value)} placeholder=${env.ocadoPasswordSaved ? 'Saved — leave blank to reuse' : ''} required=${!env.ocadoPasswordSaved} /></label>
          <label class="check-label"><input type="checkbox" checked=${remember} onChange=${e => setRemember(e.currentTarget.checked)} /> Remember password on this device (stored in data/secrets.json, readable only by your user)</label>
          <p class="muted small">Autocado signs in for you in a ${env.hasDisplay ? 'browser window' : 'hidden browser'}. If Ocado emails a code, you'll be asked for it here. Only the session cookies are kept.</p>
          <button class="btn btn-primary" type="submit">Connect</button>
        </form>` : null}

        ${method === 'cookies' ? html`<div class="stack">
          <p>For when sign-in is blocked by Ocado's bot check: sign in on ocado.com in your normal browser, export cookies with the <em>Cookie-Editor</em> extension (Export → JSON), and paste them here.</p>
          <textarea rows="5" value=${cookies} onInput=${e => setCookies(e.currentTarget.value)} placeholder='[{"name": "...", "value": "...", "domain": ".ocado.com"}, …]' aria-label="Exported cookies"></textarea>
          <${Btn} kind="primary" disabled=${!cookies.trim()} onClick=${async () => { await post('/api/ocado/cookies', { cookies }); setCookies(''); toast('Connected to Ocado.', 'success'); }}>Import cookies<//>
        </div>` : null}
        ${refreshing && state.ocado.connected ? html`<button class="link-btn" onClick=${() => setRefreshing(false)}>Never mind</button>` : null}
      ` : null}
    ` : null}
  </div>`;
}

function ClaudeCard({ state }) {
  const env = state.env;
  const [key, setKey] = useState('');
  return html`<div class="card">
    <div class="card-head">
      <h2>Claude (reads recipe photos)</h2>
      <span class=${`status-pill ${env.claude ? 'ok' : 'off'}`}><span class="dot" aria-hidden="true"></span>${env.claude ? 'Ready' : 'Not set up'}</span>
    </div>
    <p class="muted">Optional. Used to read cookbook photos, pasted recipes and web pages, and to recall recipes from books. Model: <code>${env.model}</code>.</p>
    ${env.claudeFromEnv ? html`<p>Using the <code>ANTHROPIC_API_KEY</code> environment variable.</p>` : html`
      <form class="add-row" onSubmit=${e => { e.preventDefault(); post('/api/settings/claude', { apiKey: key }).then(() => { setKey(''); toast('Claude key saved.', 'success'); }).catch(toastError); }}>
        <input type="password" autocomplete="off" placeholder=${env.claude ? 'Key saved — paste a new one to replace' : 'sk-ant-…'} value=${key} onInput=${e => setKey(e.currentTarget.value)} aria-label="Claude API key" />
        <button class="btn btn-primary" type="submit" disabled=${!key.trim()}>Save</button>
      </form>
      ${env.claude ? html`<${Btn} small kind="ghost" onClick=${() => post('/api/settings/claude', { apiKey: '' })}>Remove key<//>` : html`<p class="muted small">Get a key at console.anthropic.com → API keys.</p>`}
    `}
  </div>`;
}

function PrefsCard({ state }) {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('autocado.theme') || 'dark'; } catch { return 'dark'; } });
  const changeTheme = t => {
    setTheme(t);
    try { localStorage.setItem('autocado.theme', t); } catch { /* ignore */ }
    const dark = t === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : t !== 'light';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  return html`<div class="card">
    <h2>Shopping preferences</h2>
    <${Switch} label="Prefer organic" hint="Searches organic first and picks organic when there's a good match." checked=${state.settings.preferOrganic !== false} onChange=${v => post('/api/settings', { preferOrganic: v }).catch(toastError)} />
    <div class="field-row"><span>Theme on this screen</span>
      <${Segmented} label="Theme" value=${theme} onChange=${changeTheme} options=${[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto' }]} />
    </div>
    <div class="btn-row">
      <span class="muted small">${Object.keys(state.productChoices).length} remembered product choices</span>
      <${Btn} small kind="ghost" disabled=${!Object.keys(state.productChoices).length} onClick=${() => confirm('Forget all remembered product choices? The next basket will search fresh.') && post('/api/settings', { resetChoices: true }).then(() => toast('Product choices forgotten.', 'success'))}>Forget product choices<//>
    </div>
  </div>`;
}

function KioskCard({ state }) {
  const lan = state.env.lan || {};
  const [first, ...rest] = lan.urls || [];
  return html`<details class="card" open=${!!first}>
    <summary><strong>Phones, tablets & kitchen screen</strong></summary>
    ${first ? html`
      <p>On any phone, tablet or computer on your home Wi-Fi, open <a href=${first}><strong>${first.replace(/^http:\/\//, '')}</strong></a>. Add it to the home screen for one tap next time.</p>
      <${CopyText} text=${first} />
      ${rest.length ? html`<p class="muted">If a device can't find that, use ${rest.map((u, i) => html`${i ? ' or ' : ''}<a href=${u}>${u.replace(/^http:\/\//, '')}</a>`)}. That number can change when your router restarts.</p>` : null}
    ` : lan.shared ? html`
      <p>Autocado is shared on your network, but this computer doesn't seem to be on Wi-Fi or a network right now.</p>
    ` : html`
      <p>Only this computer can open Autocado at the moment. To use it from phones on your home Wi-Fi, add <code>HOST=0.0.0.0</code> to the <code>.env</code> file and restart Autocado. It then appears at <strong>autocado.local</strong>.</p>
    `}
    <p class="muted">Autocado has no login, so anyone on your Wi-Fi can use it. For a Raspberry Pi kitchen screen, see <code>docs/raspberry-pi.md</code>. Add <code>?theme=dark</code> to the address to force the dark theme (best for a mirror).</p>
  </details>`;
}

function ResetCard({ state, go }) {
  const [open, setOpen] = useState(false);
  const counts = [
    [state.recipes.length, 'recipe'],
    [Object.keys(state.favourites).length, 'favourite'],
    [state.required.length, 'needed item'],
    [Object.keys(state.productChoices).length, 'remembered product'],
    [state.history.length, 'log entry', 'log entries'],
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : (many || `${one}s`)}`);
  return html`<div class="card card-danger">
    <h2>Reset all data</h2>
    <p class="muted">Clears everything Autocado has stored, so you can start fresh. Your Ocado account isn't touched: the trolley and your favourites on ocado.com stay as they are.</p>
    <div class="btn-row"><${Btn} kind="danger" onClick=${() => setOpen(true)}>Reset all data…<//></div>
    ${open ? html`<${ResetSheet} counts=${counts} onClose=${() => setOpen(false)} onDone=${r => { setOpen(false); go('week'); }} />` : null}
  </div>`;
}

function ResetSheet({ counts, onClose, onDone }) {
  const [typed, setTyped] = useState('');
  const [signOut, setSignOut] = useState(false);
  const ok = typed.trim().toLowerCase() === 'confirm';
  const reset = async () => {
    const r = await post('/api/reset', { confirm: typed, signOut });
    if (signOut) { try { localStorage.removeItem('autocado.setupSeen'); } catch { /* ignore */ } }
    toast(`All data reset.${r.backup ? ` A backup copy was saved to ${r.backup}.` : ''}`, 'success', 9000);
    onDone(r);
  };
  return html`<${Sheet} title="Reset all data" onClose=${onClose}>
    <p>This deletes:</p>
    <ul class="reset-list">
      <li>${counts.length ? counts.join(', ') : 'nothing saved yet'}</li>
      <li>this week's plan, the “have we got enough?” answers and any list you're reviewing</li>
      <li>prices and pictures remembered for Ocado products</li>
    </ul>
    <p class="muted small">A backup copy of the data is saved in <code>data/backups/</code> first, in case you change your mind. Delete that folder if you want it gone completely.</p>
    <label class="check-label"><input type="checkbox" checked=${signOut} onChange=${e => setSignOut(e.currentTarget.checked)} /> Also sign out of Ocado and remove the Claude API key</label>
    <form class="stack" onSubmit=${e => { e.preventDefault(); if (ok) reset().catch(toastError); }}>
      <label class="field"><span>Type <strong>confirm</strong> to reset</span>
        <input type="text" value=${typed} onInput=${e => setTyped(e.currentTarget.value)} autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="confirm" aria-label="Type confirm to reset" />
      </label>
      <div class="btn-row">
        <span class="spacer"></span>
        <${Btn} kind="ghost" onClick=${onClose}>Cancel<//>
        <${Btn} kind="danger" disabled=${!ok} onClick=${reset}>Reset everything<//>
      </div>
    </form>
  <//>`;
}

function CopyText({ text }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied', 'success', 1500); } catch { toast('Select and copy it by hand.', 'info'); }
  };
  return html`<span class="copy-text"><code>${text}</code><button class="btn btn-small btn-ghost" onClick=${copy}>Copy</button></span>`;
}

function FirefoxCard({ state }) {
  const b = state.env.bridge || {};
  return html`<div class=${`card ${b.online ? 'card-success' : ''}`}>
    <div class="card-head">
      <h2>Firefox add-on</h2>
      <span class=${`status-pill ${b.online ? 'ok' : 'off'}`}><span class="dot" aria-hidden="true"></span>${b.online ? 'Running' : 'Not running'}</span>
    </div>
    ${b.online ? html`
      <p>Autocado sends its Ocado requests through your Firefox${b.version ? ` (add-on ${b.version})` : ''}, so Ocado's bot check stays happy and there's no sign-in to refresh.</p>
      <p class="muted small">Seen ${timeAgo(b.lastSeen)}. ${b.ocadoTab ? 'An ocado.com tab is open.' : 'It opens an ocado.com tab in the background when it needs one.'}</p>
    ` : html`
      <p>The reliable way to connect: Autocado works through your own Firefox, signed in to Ocado as normal, so the bot check never goes stale.</p>
      <ol class="steps">
        <li>In Firefox, sign in at <strong>ocado.com</strong> (you only need to do this once).</li>
        <li>In Firefox, open <${CopyText} text="about:debugging#/runtime/this-firefox" /> and click <strong>Load Temporary Add-on…</strong></li>
        <li>Choose this file: <${CopyText} text=${b.addonPath || 'addon/manifest.json'} /></li>
        <li>Keep Firefox open. This card turns green within about 30 seconds.</li>
      </ol>
      <p class="muted small">A temporary add-on lasts until Firefox restarts. To install it permanently, see <code>docs/firefox-addon.md</code> (Mozilla signs it for free).</p>
      ${b.lastSeen ? html`<p class="warn-text small">Last seen ${timeAgo(b.lastSeen)}. Is Firefox still open?</p>` : null}
    `}
  </div>`;
}
