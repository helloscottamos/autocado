// "Basket": the live Ocado trolley (what's really in it, kept in sync), plus
// a shopping list matched to Ocado products that tops the trolley up.
// Autocado never checks out — you book the slot and pay on ocado.com.
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, post } from '../api.js';
import { Btn, ProductRow, ProductThumb, Segmented, Sheet, Spinner, Stepper, botCheckActive, money, toast, toastError, timeAgo } from '../ui.js';

const OCADO_BASKET = 'https://www.ocado.com/basket';
// The page Ocado's own "Book a slot" button opens (home delivery).
const OCADO_SLOTS = 'https://www.ocado.com/delivery/home/slots?in-checkout-walk=false&shippingGroup=default+home+delivery';
const POLL_MS = 120_000;         // re-read the trolley every 2 minutes while this screen is open…
const IDLE_STOP_MS = 10 * 60_000; // …but stop after 10 minutes without anyone touching the screen

export function BasketView({ state, params, progress, trolley, go }) {
  const draft = state.draft;
  const [mode, setMode] = useState(params.mode === 'topup' ? 'topup' : (draft?.mode || 'weekly'));
  useEffect(() => { if (params.mode) setMode(params.mode === 'topup' ? 'topup' : 'weekly'); }, [params.mode]);

  const list = state.lists[mode];
  const building = !!progress.draft || state.env.jobs.draft;
  const sending = !!progress.send || state.env.jobs.send;

  const build = async () => {
    if (draft && draft.lines.length && !confirm('Replace the list you are reviewing with a fresh one? Your Ocado trolley is not changed.')) return;
    try {
      await post('/api/draft/build', { mode });
    } catch (e) {
      if (e.reconnect) { toastError(e); go('settings'); return; }
      throw e;
    }
  };

  return html`
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Basket</h1>
          <p class="sub">Your real Ocado trolley, and a list to top it up. Nothing is ordered until you check out on Ocado.</p>
        </div>
      </div>

      ${botCheckActive(state) ? html`<div class="banner banner-warn">
        <span>${state.ocado.botCheck.message}</span>
        <a class="btn btn-small btn-secondary" href="#/settings">Refresh sign-in</a>
      </div>` : null}
      ${!state.ocado.connected ? html`<div class="banner banner-warn">
        <span>${state.ocado.lastError || 'Ocado is not connected.'} Product search still works; seeing and filling the trolley needs you signed in.</span>
        <a class="btn btn-small btn-secondary" href="#/settings">Connect Ocado</a>
      </div>` : null}

      <${TrolleyCard} state=${state} trolley=${trolley} collapsed=${!!draft && !building} />

      <div class="section-head"><h2>Add to the trolley</h2></div>
      ${draft && !building ? html`<${Draft} draft=${draft} state=${state} trolley=${trolley} sending=${sending} progress=${progress.send} onRebuild=${build} />` : html`
        <${Segmented} label="Type of shop" value=${mode} onChange=${setMode} options=${[{ value: 'weekly', label: 'Weekly shop' }, { value: 'topup', label: 'Top-up' }]} />
        <div class="card">
          ${mode === 'weekly' ? html`
            <p><strong>${list.toBuy}</strong> item${list.toBuy === 1 ? '' : 's'} from ${Object.keys(state.plan.selected).length} recipe(s) and the needed list.</p>
            ${list.unanswered ? html`<p class="warn-text">${list.unanswered} item${list.unanswered === 1 ? '' : 's'} not checked yet — they will be included. <a href="#/week">Check them first</a></p>` : null}
          ` : html`
            <p><strong>${list.toBuy}</strong> item${list.toBuy === 1 ? '' : 's'} on the needed list.</p>
            ${!list.toBuy ? html`<p class="muted">Add items on the <a href="#/needed">Needed</a> tab first.</p>` : null}
          `}
          <p class="muted small">Prefers ${state.settings.preferOrganic ? 'organic, then ' : ''}your usual choice and favourites. Anything already in your trolley counts, so nothing gets doubled up.</p>
          ${building ? html`<${ProgressBar} p=${progress.draft} />` : html`
            <${Btn} kind="primary" class="wide" disabled=${!list.toBuy} onClick=${build}>Find products on Ocado<//>`}
        </div>
      `}
      ${state.history.length ? html`<${History} history=${state.history} />` : null}
    </section>
  `;
}

/** Keeps the trolley fresh: on open, on focus, and every 2 minutes while someone is using the screen. */
function useTrolleyRefresh(connected) {
  const [error, setError] = useState(null);
  const lastActivity = useRef(Date.now());
  const load = async (fresh = false) => {
    if (!connected) return;
    try { await api(`/api/ocado/trolley${fresh ? '?fresh=1' : ''}`); setError(null); } // result arrives over SSE
    catch (e) { setError(e.message); }
  };
  useEffect(() => {
    if (!connected) return undefined;
    load();
    const touch = () => { lastActivity.current = Date.now(); };
    const onFocus = () => { touch(); if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity.current < IDLE_STOP_MS) load();
    }, POLL_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, [connected]);
  return { error, reload: () => load(true) };
}

function TrolleyCard({ state, trolley, collapsed }) {
  const connected = state.ocado.connected;
  const { error, reload } = useTrolleyRefresh(connected);
  const [open, setOpen] = useState(!collapsed);
  const [busyId, setBusyId] = useState(null);
  useEffect(() => setOpen(!collapsed), [collapsed]);

  const setQty = async (item, quantity) => {
    if (quantity === 0 && !confirm(`Remove ${item.name} from your Ocado trolley?`)) return;
    setBusyId(item.productId);
    try { await post('/api/ocado/trolley/quantity', { productId: item.productId, quantity }); }
    catch (e) { toastError(e); }
    finally { setBusyId(null); }
  };
  const empty = async () => {
    if (!confirm('Empty your whole Ocado trolley? This removes everything in it on ocado.com too.')) return;
    await post('/api/ocado/trolley/clear');
    toast('Ocado trolley emptied.', 'success');
  };

  if (!connected) return null;
  const items = trolley?.items ?? [];
  const shown = open ? items : [];
  return html`<div class="card trolley-card">
    <div class="card-head">
      <div>
        <h2>${state.env.mock ? 'Demo ' : ''}Ocado trolley</h2>
        <p class="muted small" aria-live="polite">
          ${trolley ? html`<strong class="trolley-sum">${trolley.count} item${trolley.count === 1 ? '' : 's'} · ${money(trolley.total)}</strong> · updated ${timeAgo(trolley.fetchedAt)}` : error ? null : html`<${Spinner} label="Reading your Ocado trolley…" />`}
        </p>
      </div>
      <div class="btn-row">
        <button class="icon-btn" aria-label="Refresh trolley from Ocado" title="Refresh from Ocado" onClick=${reload}>↻</button>
        ${items.length ? html`<button class="btn btn-small btn-secondary" aria-expanded=${open} onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'} items</button>` : null}
      </div>
    </div>
    ${error ? html`<div class="banner banner-error"><span>Could not read the trolley: ${error}</span><button class="btn btn-small btn-secondary" onClick=${reload}>Try again</button></div>` : null}
    ${trolley && !items.length ? html`<p class="muted">Your Ocado trolley is empty.</p>` : null}
    ${trolley?.unknownNames ? html`<div class="banner banner-warn"><span>${trolley.unknownNames} item${trolley.unknownNames === 1 ? ' was' : 's were'} added on ocado.com and Ocado won't share ${trolley.unknownNames === 1 ? 'its name' : 'their names'} right now. Refresh the sign-in to see ${trolley.unknownNames === 1 ? 'it' : 'them'}.</span><a class="btn btn-small btn-secondary" href="#/settings">Settings</a></div>` : null}
    ${shown.length ? html`<ul class="trolley-items">
      ${shown.map(i => html`<li key=${i.productId} class=${busyId === i.productId ? 'busy' : ''}>
        <${ProductThumb} product=${i} />
        <div class="product-main">
          <div class="product-name">${i.name}</div>
          <div class="product-meta">
            <span class="price">${money(i.total ?? (i.price != null ? i.price * i.quantity : null))}</span>
            ${i.size ? html`<span>${i.size}</span>` : null}
            ${i.organic ? html`<span class="badge badge-organic">Organic</span>` : null}
            ${i.offers?.[0] ? html`<span class="badge badge-offer">${i.offers[0].description}</span>` : null}
            ${i.available === false ? html`<span class="badge badge-warn">Out of stock</span>` : null}
          </div>
        </div>
        <${Stepper} label=${`Quantity of ${i.name} in the trolley`} value=${i.quantity} onChange=${v => setQty(i, v)} />
      </li>`)}
    </ul>` : null}
    ${state.env.mock ? html`<p class="warn-text small">Demo trolley: not your real Ocado account.</p>` : html`<div class="btn-row">
      <a class="btn btn-small btn-primary" href=${OCADO_BASKET} target="_blank" rel="noopener">Check out on Ocado ↗</a>
      <a class="btn btn-small btn-secondary" href=${OCADO_SLOTS} target="_blank" rel="noopener">Book a delivery slot ↗</a>
      <span class="spacer"></span>
      ${items.length ? html`<${Btn} small kind="ghost" onClick=${empty}>Empty trolley<//>` : null}
    </div>`}
    ${state.env.mock && items.length ? html`<div class="btn-row"><span class="spacer"></span><${Btn} small kind="ghost" onClick=${empty}>Empty trolley<//></div>` : null}
  </div>`;
}

function ProgressBar({ p }) {
  const pct = p?.total ? Math.round((p.done / p.total) * 100) : 0;
  return html`<div class="progress" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100">
    <div class="progress-bar" style=${`width:${pct}%`}></div>
    <span class="progress-label">${p?.message || 'Working…'}</span>
  </div>`;
}

/** Same rule as the server: top the trolley up to what the list needs. */
function planAdds(lines, trolley) {
  const have = new Map((trolley?.items ?? []).map(i => [i.productId, i.quantity]));
  const byProduct = new Map();
  for (const l of lines) {
    if (!l.product || !(l.packs > 0)) continue;
    const e = byProduct.get(l.product.productId) ?? { price: l.product.price || 0, packs: 0 };
    e.packs += l.packs;
    byProduct.set(l.product.productId, e);
  }
  let adds = 0;
  let cost = 0;
  let already = 0;
  for (const [id, e] of byProduct) {
    const add = Math.max(0, e.packs - (have.get(id) ?? 0));
    adds += add;
    cost += add * e.price;
    if (add === 0) already++;
  }
  return { adds, cost, already, products: byProduct.size, have };
}

function Draft({ draft, state, trolley, sending, progress, onRebuild }) {
  const [swapLine, setSwapLine] = useState(null);
  const [adding, setAdding] = useState(false);
  const [clearFirst, setClearFirst] = useState(false);
  const favs = state.favourites;
  const lines = draft.lines;
  const missing = lines.filter(l => !l.product);
  const failed = lines.filter(l => l.status === 'failed');
  const plan = planAdds(lines, clearFirst ? null : trolley);

  const update = body => post('/api/draft/line', body).catch(toastError);
  const fav = (p, item) => post('/api/favourites/toggle', { product: p, on: !favs[p.productId], item }).then(r => {
    if (!favs[p.productId] && r.syncError) toast(`Saved as a favourite here (Ocado sync failed: ${r.syncError})`, 'warn');
  }).catch(toastError);

  const send = async () => {
    if (!state.ocado.connected) { toast('Connect Ocado first (Settings).', 'error'); return; }
    if (clearFirst && !confirm('Empty your Ocado trolley before adding these items?')) return;
    const r = await post('/api/draft/send', { clearFirst });
    const extra = r.alreadyThere ? ` ${r.alreadyThere} ${r.alreadyThere === 1 ? 'was' : 'were'} already in the trolley.` : '';
    toast(r.failed ? `Added ${r.added} items — ${r.failed} could not be added.${extra}` : `Added ${r.added} item${r.added === 1 ? '' : 's'} to your Ocado trolley.${extra}`, r.failed ? 'warn' : 'success', 7000);
  };

  return html`
    <div class="draft-head">
      <span class="badge">${draft.mode === 'topup' ? 'Top-up list' : 'Weekly list'}</span>
      <span class="muted small">built ${timeAgo(draft.builtAt)}</span>
      <span class="spacer"></span>
      <${Btn} small kind="ghost" onClick=${onRebuild}>Rebuild<//>
      <${Btn} small kind="ghost" onClick=${() => confirm('Discard this list? Your Ocado trolley is not changed.') && post('/api/draft/discard')}>Discard list<//>
    </div>

    ${draft.warning ? html`<div class="banner banner-warn"><span>${draft.warning}</span><a class="btn btn-small btn-secondary" href="#/settings">Settings</a></div>` : null}
    ${failed.length ? html`<div class="banner banner-warn">${failed.length} item${failed.length === 1 ? '' : 's'} could not be added to the trolley — see below, then try again.</div>` : null}
    ${missing.length ? html`<div class="banner banner-warn">${missing.length} item${missing.length === 1 ? '' : 's'} need${missing.length === 1 ? 's' : ''} a product picking — tap “Choose”.</div>` : null}

    <ul class="draft-lines">
      ${lines.map(l => {
        const inTrolley = l.product ? (plan.have.get(l.product.productId) ?? 0) : 0;
        return html`<li key=${l.key} class=${`draft-line status-${l.status} ${l.packs === 0 ? 'skipped' : ''}`}>
        <div class="draft-line-head">
          <span class="draft-item">${l.item}</span>
          ${l.needsText ? html`<span class="muted small">need ${l.needsText}</span>` : null}
          <span class=${`reason reason-${slug(l.reason)}`}>${l.reason}</span>
          ${inTrolley ? html`<span class="badge badge-ok" title="Already in your Ocado trolley">${inTrolley >= l.packs ? `Already in trolley ×${inTrolley}` : `×${inTrolley} in trolley — adds ${l.packs - inTrolley}`}</span>` : null}
          ${l.status === 'failed' ? html`<span class="badge badge-warn" title=${l.error}>Not added</span>` : null}
        </div>
        ${l.product ? html`
          <${ProductRow} product=${l.product} fav=${!!favs[l.product.productId]} onFav=${() => fav(l.product, l.key)}>
            <${Stepper} label=${`Packs of ${l.product.name}`} value=${l.packs} onChange=${v => update({ key: l.key, packs: v })} />
            <button class="btn btn-small btn-secondary" onClick=${() => setSwapLine(l)}>Swap</button>
          <//>` : html`
          <div class="product-row missing">
            <span class="thumb thumb-empty" aria-hidden="true">?</span>
            <div class="product-main"><div class="product-name">${l.error || 'No match found'}</div></div>
            <div class="product-actions"><button class="btn btn-small btn-primary" onClick=${() => setSwapLine(l)}>Choose</button></div>
          </div>`}
        ${l.error && l.status === 'failed' ? html`<p class="warn-text small">${l.error}</p>` : null}
        <button class="link-btn small" onClick=${() => update({ key: l.key, remove: true })}>Remove from list</button>
      </li>`;
      })}
    </ul>

    <button class="btn btn-secondary wide" onClick=${() => setAdding(true)}>+ Add something else</button>

    <div class="send-bar">
      ${sending ? html`<${ProgressBar} p=${progress} />` : html`
        <div class="send-total">
          <span class="muted small">Adds to trolley</span>
          <strong>${plan.adds} item${plan.adds === 1 ? '' : 's'} · ${money(plan.cost)}</strong>
          ${plan.already ? html`<span class="muted small">${plan.already} already in trolley</span>` : null}
        </div>
        <label class="check-label"><input type="checkbox" checked=${clearFirst} onChange=${e => setClearFirst(e.currentTarget.checked)} /> Empty trolley first</label>
        ${plan.adds === 0 && plan.products > 0
          ? html`<${Btn} kind="primary" onClick=${() => post('/api/draft/discard')}>All in the trolley — clear list<//>`
          : html`<${Btn} kind="primary" disabled=${!plan.adds} onClick=${send}>Add to Ocado trolley<//>`}`}
    </div>

    ${swapLine ? html`<${SwapSheet} line=${swapLine} favs=${favs} demo=${state.env.mock} onClose=${() => setSwapLine(null)} onPick=${async p => { await update({ key: swapLine.key, product: p }); setSwapLine(null); }} onFav=${fav} />` : null}
    ${adding ? html`<${SwapSheet} line=${null} favs=${favs} demo=${state.env.mock} onClose=${() => setAdding(false)} onPick=${async (p, q) => { await post('/api/draft/add', { product: p, item: q }); setAdding(false); }} onFav=${fav} />` : null}
  `;
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z]+/g, '-');

export const DEMO_SEARCH_HINT = 'Demo mode searches a small fake catalogue (try onions, milk, rice, tomatoes, chicken). Run `npm start` to search the real Ocado.';

function SwapSheet({ line, favs, demo, onClose, onPick, onFav }) {
  const [q, setQ] = useState(line?.item || '');
  const [results, setResults] = useState(null);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();

  const search = async (term = q) => {
    if (!term.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults((await api(`/api/ocado/search?q=${encodeURIComponent(term)}`)).products);
      setSearched(term);
    } catch (e) {
      setResults(null);
      setError(e.message); // show why, rather than "no products found"
    } finally { setLoading(false); }
  };
  useEffect(() => { if (!line?.alternatives?.length && q) search(); inputRef.current?.focus(); }, []);

  const favList = Object.values(favs);
  const shown = results ?? line?.alternatives ?? [];
  return html`<${Sheet} title=${line ? `Choose: ${line.item}` : 'Add an item'} onClose=${onClose} wide>
    <form class="add-row" onSubmit=${e => { e.preventDefault(); search(); }}>
      <input ref=${inputRef} type="search" value=${q} onInput=${e => setQ(e.currentTarget.value)} placeholder="Search Ocado" aria-label="Search Ocado" />
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    ${!line && favList.length && !results ? html`<h3 class="mini-head">Favourites</h3>` : null}
    ${loading ? html`<${Spinner} label="Searching Ocado…" />` : null}
    <ul class="pick-list">
      ${(!line && !results ? favList : shown).map(p => html`<li key=${p.productId}>
        <${ProductRow} product=${p} fav=${!!favs[p.productId]} onFav=${() => onFav(p, line?.key)}>
          <${Btn} small kind="primary" disabled=${p.available === false} onClick=${() => onPick(p, q)}>${line ? 'Use this' : 'Add'}<//>
        <//>
      </li>`)}
    </ul>
    ${!loading && error ? html`<div class="banner banner-error"><span>Search failed: ${error}</span>${/connect|session|sign/i.test(error) ? html`<a class="btn btn-small btn-secondary" href="#/settings">Settings</a>` : null}</div>` : null}
    ${!loading && !error && results && results.length === 0 ? html`<p class="muted">Nothing on Ocado matches “${searched}”. Try fewer or different words.${demo ? html`<br /><span class="warn-text small">${DEMO_SEARCH_HINT}</span>` : null}</p>` : null}
    ${!loading && !error && line && !results && shown.length ? html`<p class="muted small">Other matches for this item. Search to see more.</p>` : null}
  <//>`;
}

function History({ history }) {
  return html`<details class="history">
    <summary>Sent to Ocado — log (${history.length})</summary>
    <p class="muted small">A record of what Autocado added to your one Ocado trolley. The trolley above is what's actually in it now.</p>
    <ul>
      ${history.slice(0, 8).map(h => html`<li key=${h.id}>
        <strong>${new Date(h.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
        · ${h.mode === 'topup' ? 'top-up' : 'weekly'} list · added ${h.added ?? h.lines.filter(l => l.status === 'sent').reduce((n, l) => n + (l.packs || 0), 0)} item(s)
        ${h.lines.some(l => l.status === 'failed') ? html` · <span class="warn-text">${h.lines.filter(l => l.status === 'failed').length} failed</span>` : null}
      </li>`)}
    </ul>
  </details>`;
}
