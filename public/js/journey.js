// The shopping journey: where you are in this week's shop, what's next, and
// weeks (checking out, the "did you place the order?" question, past weeks).
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { api, post } from './api.js';
import { Btn, money, toast } from './ui.js';

export const OCADO_BASKET = 'https://www.ocado.com/basket';
// The page Ocado's own "Book a slot" button opens (home delivery).
export const OCADO_SLOTS = 'https://www.ocado.com/delivery/home/slots?in-checkout-walk=false&shippingGroup=default+home+delivery';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The steps of a shop and how far along it is.
 *   weekly: Recipes → Cupboard → Products → Trolley → Check out
 *   topup:  Needed → Products → Trolley → Check out
 * A later step being done means the earlier ones are behind you (the cupboard
 * check is optional, for instance). `place` is the page each step is done on.
 */
export function journeySteps(state, mode = 'weekly') {
  const shop = state.week.openShop;
  const draft = state.draft?.lines.length && state.draft.mode === mode ? state.draft : null;
  const list = state.lists[mode];
  const chosen = Object.keys(state.plan.selected).length;
  const steps = mode === 'topup'
    ? [{ id: 'needed', label: 'Needed', place: 'needed', done: state.required.length > 0 }]
    : [
      { id: 'recipes', label: 'Recipes', place: 'recipes', done: chosen > 0 },
      { id: 'cupboard', label: 'Cupboard', place: 'cupboard', done: chosen > 0 && list.lines.some(l => l.recipes.length) && list.unanswered === 0 },
    ];
  steps.push(
    { id: 'products', label: 'Products', place: 'basket', done: !!draft },
    { id: 'trolley', label: 'Trolley', place: 'basket', done: !!shop && (mode === 'topup' || shop.kind === 'weekly') },
    { id: 'checkout', label: 'Check out', place: 'basket', done: false },
  );
  let reached = -1;
  steps.forEach((s, i) => { if (s.done) reached = i; });
  return steps.map((s, i) => ({ ...s, status: i <= reached ? 'done' : i === reached + 1 ? 'current' : 'todo' }));
}

/** The page a step is done on, as a link. */
function stepHref(place, mode) {
  return { recipes: '#/week', cupboard: '#/week?step=cupboard', needed: '#/needed' }[place] ?? `#/basket?mode=${mode}`;
}

/**
 * The step bar at the top of This week and Basket: tap a step to go to it.
 * `here` is the page it's on (recipes, cupboard or basket), which is outlined.
 */
export function JourneyBar({ state, mode = 'weekly', here }) {
  const steps = journeySteps(state, mode);
  return html`<nav class="journey" aria-label=${mode === 'topup' ? 'Top-up shop steps' : "This week's shop steps"}>
    <ol class="journey-steps" style=${`--n:${steps.length}`}>
      ${steps.map((s, i) => html`<li key=${s.id} class=${`journey-step ${s.status}${s.place === here ? ' here' : ''}`}>
        <a href=${stepHref(s.place, mode)} aria-current=${s.place === here ? 'page' : undefined}>
          <span class="journey-dot" aria-hidden="true">${s.status === 'done' ? '✓' : i + 1}</span>
          <span class="journey-label">${s.label}<span class="visually-hidden">${s.status === 'done' ? ' (done)' : s.status === 'current' ? ' (next)' : ''}</span></span>
        </a>
      </li>`)}
    </ol>
  </nav>`;
}

/** Shown while a shop is waiting in the Ocado trolley. */
export function CheckoutCard({ state, trolley }) {
  const shop = state.week.openShop;
  if (!shop || state.orderCheck) return null; // the "did you place the order?" question takes over
  const demo = state.env.mock;
  const count = trolley?.count;
  const ordered = async () => {
    const r = await post('/api/weeks/ordered', { how: 'you' });
    toast(r.closedWeek ? "Ordered. That week is filed under Past weeks, and a fresh week has started." : 'Top-up marked as ordered.', 'success', 6000);
  };
  const demoCheckout = () => post('/api/ocado/demo-checkout');
  return html`<div class="card checkout-card" id="checkout">
    <h2>${shop.kind === 'topup' ? 'Your top-up' : "This week's shop"} is in your Ocado trolley</h2>
    ${count ? html`<p><strong>${plural(count, 'item')} · ${money(trolley.total)}</strong></p>` : null}
    <div class="btn-row">
      ${demo
        ? html`<${Btn} kind="primary" onClick=${demoCheckout}>Demo: check out on Ocado<//>`
        : html`<a class="btn btn-primary" href=${OCADO_SLOTS} target="_blank" rel="noopener">Book a slot and check out ↗</a>`}
      <${Btn} kind="secondary" onClick=${ordered}>I've placed the order<//>
    </div>
  </div>`;
}

/** "Your trolley has emptied — did you place the order?" Shown on every screen. */
export function OrderCheckBanner({ state }) {
  const c = state.orderCheck;
  if (!c) return null;
  const yes = async () => {
    const r = await post('/api/weeks/ordered', { how: 'detected' });
    toast(r.closedWeek ? 'Ordered. A fresh week has started.' : 'Top-up marked as ordered.', 'success', 6000);
  };
  return html`<div class="banner banner-order" role="alert">
    <span>Your Ocado trolley has emptied${c.count ? ` (it had ${plural(c.count, 'item')}${c.total != null ? `, ${money(c.total)}` : ''})` : ''}. Did you place the order?</span>
    <div class="btn-row">
      <${Btn} small kind="primary" onClick=${yes}>Yes, it's ordered<//>
      <${Btn} small kind="secondary" onClick=${() => post('/api/weeks/not-ordered')}>No, I emptied it<//>
    </div>
  </div>`;
}

/** "Ordered ✓" with Undo, for a day after an order is marked. */
export function OrderedBanner({ state }) {
  const o = state.lastOrdered;
  if (!o || Date.now() - Date.parse(o.at) > 24 * 3600_000) return null;
  if (state.week.openShop || state.orderCheck) return null; // already onto the next shop
  return html`<div class="banner banner-done" role="status">
    <span>✓ ${o.closedWeek ? "This week's shop" : 'Your top-up'} is ordered${o.total ? ` (${money(o.total)})` : ''}.${o.closedWeek ? ' A fresh week has started, and your Needed list carried over.' : ''}</span>
    <div class="btn-row">
      ${state.week.canUndo ? html`<${Btn} small kind="ghost" onClick=${() => post('/api/weeks/undo')}>Undo<//>` : null}
      <${Btn} small kind="secondary" onClick=${() => post('/api/weeks/ack')}>OK<//>
    </div>
  </div>`;
}

/**
 * While a shop waits in the trolley, look at the trolley whenever Autocado
 * is opened or comes back into view, so a checkout is noticed straight away.
 */
export function useOrderWatch(state) {
  const waiting = !!state?.week?.openShop && !state?.orderCheck && !!state?.ocado?.connected;
  useEffect(() => {
    if (!waiting) return undefined;
    const look = () => { if (document.visibilityState === 'visible') api('/api/ocado/trolley').catch(() => {}); };
    look();
    document.addEventListener('visibilitychange', look);
    window.addEventListener('focus', look);
    return () => { document.removeEventListener('visibilitychange', look); window.removeEventListener('focus', look); };
  }, [waiting]);
}

const day = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** "in your last shop" / "had 3 weeks ago" for a recipe, from past weeks. */
export function hadWhen(state, recipeId) {
  if (state.pastWeeks[0]?.recipes?.some(r => r.id === recipeId)) return 'in your last shop';
  const at = state.week.lastHad[recipeId];
  if (!at) return null;
  const weeks = Math.max(1, Math.round((Date.now() - Date.parse(at)) / (7 * 86400_000)));
  return weeks === 1 ? 'had last week' : `had ${weeks} weeks ago`;
}

export function PastWeeks({ state }) {
  const [shown, setShown] = useState(4);
  const past = state.pastWeeks;
  if (!past.length) return null;
  return html`<section class="past-weeks" aria-labelledby="past-weeks-h">
    <div class="section-head">
      <h2 id="past-weeks-h">Past weeks</h2>
      <span class="sub">Shop one again, then swap meals in and out</span>
    </div>
    <ul class="past-list">
      ${past.slice(0, shown).map(w => html`<${PastWeek} key=${w.id} week=${w} state=${state} />`)}
    </ul>
    ${past.length > shown ? html`<button class="link-btn" onClick=${() => setShown(shown + 8)}>Show older weeks</button>` : null}
  </section>`;
}

function PastWeek({ week, state }) {
  const orders = week.shops.filter(s => s.status === 'ordered');
  const topups = orders.filter(s => s.kind === 'topup').length;
  const total = orders.reduce((sum, s) => sum + (s.trolley?.total ?? s.estimate ?? 0), 0);
  const items = orders.flatMap(s => s.items);
  const known = new Set(state.recipes.map(r => r.id));
  const again = async () => {
    if (Object.keys(state.plan.selected).length && !confirm("Replace this week's recipes with the ones from this week?")) return;
    const r = await post(`/api/weeks/${week.id}/repeat`);
    toast(`Ticked ${plural(r.ticked, 'recipe')}${r.missing ? ` (${r.missing} no longer in your recipes)` : ''}. Swap any in or out to keep it varied.`, 'success', 6000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return html`<li class="card past-week">
    <div class="card-head">
      <div>
        <h3>Ordered ${day(week.orderedAt)}</h3>
        <p class="muted small">${[plural(week.recipes.length, 'recipe'), items.length ? plural(items.length, 'item') : null, total ? money(total) : null, topups ? plural(topups, 'top-up') : null].filter(Boolean).join(' · ')}</p>
      </div>
      ${week.recipes.some(r => known.has(r.id)) ? html`<${Btn} small kind="secondary" onClick=${again}>Shop this week again<//>` : null}
    </div>
    ${week.recipes.length ? html`<p class="past-recipes">${week.recipes.map(r => r.name).join(' · ')}</p>` : null}
    ${items.length ? html`<details class="past-items">
      <summary>What was ordered</summary>
      <ul>${items.map((i, n) => html`<li key=${n}>${i.name || i.item}${i.packs > 1 ? ` ×${i.packs}` : ''}</li>`)}</ul>
    </details>` : null}
  </li>`;
}
