// "Favourites": products we like (synced with Ocado favourites), with deals
// highlighted. Favourites are preferred when matching the shopping list.
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { api, post } from '../api.js';
import { Btn, Empty, ProductRow, Segmented, Spinner, toast, toastError, timeAgo } from '../ui.js';
import { DEMO_SEARCH_HINT } from './basket.js';

export function FavouritesView({ state, progress }) {
  const favs = Object.values(state.favourites).sort((a, b) => (b.offers?.length ? 1 : 0) - (a.offers?.length ? 1 : 0) || a.name.localeCompare(b.name));
  const onOffer = favs.filter(f => f.offers?.length);
  const [filter, setFilter] = useState(onOffer.length ? 'offers' : 'all');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const refreshing = !!progress.deals || state.env.jobs.deals;

  const toggle = async p => {
    const on = !state.favourites[p.productId];
    const r = await post('/api/favourites/toggle', { product: p, on });
    if (on && r.syncError) toast(`Saved here, but Ocado didn't take it: ${r.syncError}`, 'warn', 7000);
    else if (on && !r.synced) toast('Saved as a favourite (Ocado not connected, so it is only saved here).', 'info');
    if (results) setResults(results.map(x => (x.productId === p.productId ? { ...x, favourite: on } : x)));
  };
  const need = async p => {
    // Use the product name, so matching picks exactly this favourite.
    await post('/api/required', { items: [p.name] });
    toast(`Added ${p.name} to Needed`, 'success', 2500);
  };
  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    try { setResults((await api(`/api/ocado/search?q=${encodeURIComponent(q)}`)).products); }
    catch (e) { setResults(null); setSearchError(e.message); }
    finally { setSearching(false); }
  };
  const refresh = async () => {
    const r = await post('/api/favourites/refresh');
    toast(r.warning ? `Refreshed with a problem: ${r.warning}` : `Prices and offers updated for ${r.count} favourites`, r.warning ? 'warn' : 'success');
  };

  const shown = filter === 'offers' ? onOffer : favs;
  return html`
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Favourites</h1>
          <p class="sub">${onOffer.length ? html`<strong>${onOffer.length} on offer</strong> · ` : ''}prices checked ${timeAgo(state.dealsCheckedAt)}</p>
        </div>
        <${Btn} small kind="secondary" busy=${refreshing} onClick=${refresh}>${state.ocado.connected ? 'Sync with Ocado' : 'Refresh prices'}<//>
      </div>

      <form class="add-row" onSubmit=${e => { e.preventDefault(); search(); }}>
        <input type="search" placeholder="Search Ocado to add favourites" value=${q} onInput=${e => { setQ(e.currentTarget.value); if (!e.currentTarget.value) setResults(null); }} aria-label="Search Ocado" />
        <button class="btn btn-primary" type="submit">Search</button>
      </form>

      ${searching ? html`<${Spinner} label="Searching Ocado…" />` : null}
      ${searchError && !searching ? html`<div class="banner banner-error">Search failed: ${searchError}</div>` : null}
      ${results ? html`
        <div class="section-head"><h2>Results for “${q}”</h2><button class="link-btn" onClick=${() => setResults(null)}>Close</button></div>
        <ul class="pick-list">
          ${results.map(p => html`<li key=${p.productId}><${ProductRow} product=${p} fav=${!!state.favourites[p.productId]} onFav=${() => toggle(p).catch(toastError)} /></li>`)}
        </ul>
        ${results.length === 0 ? html`<p class="muted">Nothing on Ocado matches “${q}”.${state.env.mock ? html`<br /><span class="warn-text small">${DEMO_SEARCH_HINT}</span>` : null}</p>` : null}
      ` : html`
        ${favs.length ? html`<${Segmented} label="Show" value=${filter} onChange=${setFilter} options=${[{ value: 'offers', label: `On offer (${onOffer.length})` }, { value: 'all', label: `All (${favs.length})` }]} />` : null}
        ${favs.length === 0 ? html`
          <${Empty} icon="⭐" title="No favourites yet">
            <p>Search above and tap ☆ to favourite a product, or star products in the basket. ${state.ocado.connected ? 'Tap “Sync with Ocado” to bring in your Ocado favourites.' : ''}</p>
          <//>` : shown.length === 0 ? html`<p class="muted">None of your favourites are on offer right now.</p>` : html`
          <ul class="pick-list">
            ${shown.map(p => html`<li key=${p.productId}>
              <${ProductRow} product=${p} fav=${true} onFav=${() => toggle(p).catch(toastError)}>
                <${Btn} small kind="secondary" onClick=${() => need(p)}>Need<//>
              <//>
              <div class="fav-sync small muted">${p.onOcado ? 'On your Ocado favourites' : p.syncError ? `Only saved here — ${p.syncError}` : 'Only saved here'}</div>
            </li>`)}
          </ul>`}
      `}
    </section>
  `;
}
