import { html, render } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { useLiveState } from './api.js';
import { Toasts, botCheckActive } from './ui.js';
import { WeekView } from './views/week.js';
import { NeededView } from './views/needed.js';
import { BasketView } from './views/basket.js';
import { FavouritesView } from './views/favourites.js';
import { RecipesView } from './views/recipes.js';
import { SettingsView } from './views/settings.js';

const TABS = [
  { id: 'week', label: 'This week', icon: '🗓️' },
  { id: 'needed', label: 'Needed', icon: '📝' },
  { id: 'basket', label: 'Basket', icon: '🛒' },
  { id: 'favourites', label: 'Favourites', icon: '⭐' },
  { id: 'recipes', label: 'Recipes', icon: '📖' },
];

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { view: path || 'week', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function go(view, params) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  location.hash = `#/${view}${q}`;
}

function applyTheme() {
  let pref = 'dark';
  try { pref = new URLSearchParams(location.search).get('theme') || localStorage.getItem('autocado.theme') || 'dark'; } catch { /* private mode */ }
  const dark = pref === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : pref !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function App() {
  const live = useLiveState();
  const { state, online } = live;
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(applyTheme, []);

  if (!state) {
    return html`<div class="boot">${online ? 'Loading…' : 'Cannot reach the Autocado server. Retrying…'}</div>`;
  }

  let setupSeen = false;
  try { setupSeen = localStorage.getItem('autocado.setupSeen') === '1'; } catch { /* ignore */ }
  const needsSetup = !setupSeen && !state.ocado.connected && !state.env.mock && state.recipes.length === 0;
  const view = needsSetup ? 'setup' : route.view;
  const props = { ...live, params: route.params, go };
  const neededCount = state.required.length;
  const onOffer = Object.values(state.favourites).filter(f => f.offers?.length).length;

  const Main = {
    week: WeekView, needed: NeededView, basket: BasketView, favourites: FavouritesView,
    recipes: RecipesView, settings: SettingsView, setup: SettingsView,
  }[view] || WeekView;

  return html`
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#/week" aria-label="Autocado home"><span aria-hidden="true">🥑</span> Autocado</a>
        ${state.env.mock ? html`<span class="badge badge-demo" title="Using a fake Ocado catalogue">Demo mode</span>` : null}
        <span class="spacer"></span>
        <a class=${`status-pill ${!state.ocado.connected ? 'off' : !state.env.bridge?.online && botCheckActive(state) ? 'warn' : 'ok'}`} href="#/settings" title=${state.ocado.botCheck?.message || state.ocado.lastError || ''}>
          <span class="dot" aria-hidden="true"></span>${!state.ocado.connected ? 'Ocado not connected' : state.env.bridge?.online ? 'Ocado connected (Firefox)' : botCheckActive(state) ? 'Ocado: refresh sign-in' : 'Ocado connected'}
        </a>
        <a class="icon-btn" href="#/settings" aria-label="Settings">⚙️</a>
      </header>

      ${!online ? html`<div class="banner banner-error">Lost connection to the Autocado server — reconnecting…</div>` : null}

      <nav class="tabs" aria-label="Sections">
        ${TABS.map(t => html`<a href=${`#/${t.id}`} class=${`tab ${view === t.id ? 'on' : ''}`} aria-current=${view === t.id ? 'page' : undefined}>
          <span class="tab-icon" aria-hidden="true">${t.icon}</span><span class="tab-label">${t.label}</span>
          ${t.id === 'needed' && neededCount ? html`<span class="count">${neededCount}</span>` : null}
          ${t.id === 'basket' && live.trolley?.count ? html`<span class="count count-trolley" title="Items in your Ocado trolley">${live.trolley.count}</span>` : null}
          ${t.id === 'favourites' && onOffer ? html`<span class="count count-offer" title="Favourites on offer">${onOffer}</span>` : null}
        </a>`)}
      </nav>

      <main class="main" id="main">
        <${Main} ...${props} setup=${view === 'setup'} />
      </main>
    </div>
    <${Toasts} />
  `;
}

const root = document.getElementById('app');
root.textContent = ''; // drop the static "Loading…" placeholder
render(html`<${App} />`, root);
