// "This week", in two pages that follow the step bar:
//   Recipes  (#/week)               tick what you're cooking; past weeks below
//   Cupboard (#/week?step=cupboard) "have we got enough?" for each item
// then on to Basket to find it all on Ocado. The bar at the bottom of each
// page is always the next step.
import { html } from 'htm/preact';
import { useRef, useState } from 'preact/hooks';
import { post } from '../api.js';
import { Btn, Empty, Icon, Sheet, toastError } from '../ui.js';
import { CheckoutCard, JourneyBar, OrderedBanner, PastWeeks, hadWhen } from '../journey.js';

const SEARCH_FROM = 6; // recipes before a search box is worth its space
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function WeekView(props) {
  return props.params?.step === 'cupboard' ? html`<${CupboardStep} ...${props} />` : html`<${RecipesStep} ...${props} />`;
}

function Head({ state, sub, children }) {
  return html`<div class="view-head">
    <div>
      <h1>This week</h1>
      ${state.week.openShop?.kind === 'weekly' || sub ? html`<p class="sub">
        ${state.week.openShop?.kind === 'weekly' ? html`<span class="badge badge-ok">In your Ocado trolley</span> ` : null}${sub}
      </p>` : null}
    </div>
    ${children}
  </div>`;
}

/** Banners and the step bar, at the top of both pages. */
function Top({ state, trolley, here }) {
  return html`
    <${OrderedBanner} state=${state} />
    ${state.recipes.length ? html`<${JourneyBar} state=${state} mode="weekly" here=${here} />` : null}
    <${CheckoutCard} state=${state} trolley=${trolley} />`;
}

function RecipesStep({ state, trolley, go }) {
  const [q, setQ] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const selected = state.plan.selected;
  const chosen = state.recipes.filter(r => selected[r.id]);
  const staples = state.recipes.filter(r => r.staple !== false);
  const others = state.recipes.filter(r => r.staple === false);
  const found = q.trim() ? searchRecipes(state.recipes, q) : null;

  const toggle = r => post('/api/plan/toggle', { recipeId: r.id, on: !selected[r.id] }).catch(toastError);
  const tile = (r, hint) => html`<${RecipeToggle} key=${r.id} recipe=${r} on=${!!selected[r.id]} onToggle=${() => toggle(r)}
    servings=${state.plan.servings[r.id]} had=${hadWhen(state, r.id)} hint=${hint} />`;

  return html`<section class="view">
    <${Head} state=${state} sub=${chosen.length ? `${plural(chosen.length, 'recipe')} chosen` : null}>
      ${chosen.length ? html`<${Btn} small kind="ghost" onClick=${() => confirm('Untick all recipes and forget the cupboard answers?') && post('/api/plan/clear')}>Clear choices<//>` : null}
    <//>
    <${Top} state=${state} trolley=${trolley} here="recipes" />

    ${state.recipes.length === 0 ? html`
      <${Empty} icon="book" title="No recipes yet">
        <p>Add your staple recipes — from a photo of the cookbook page, a web link, or by typing them in.</p>
        <${Btn} kind="primary" onClick=${() => go('recipes', { add: '1' })}>Add a recipe<//>
      <//>` : html`
      ${state.recipes.length >= SEARCH_FROM ? html`<${RecipeSearch} value=${q} onChange=${setQ} />` : null}
      ${found ? (found.length
        ? html`<div class="recipe-grid">${found.map(f => tile(f.recipe, f.hint))}</div>`
        : html`<p class="muted">No recipes match “${q.trim()}”.</p>`) : html`
        <div class="recipe-grid">${staples.map(r => tile(r))}</div>
        ${others.length ? html`
          <button class="link-btn" onClick=${() => setShowOthers(!showOthers)}>${showOthers ? 'Hide' : 'Show'} other recipes (${others.length})</button>
          ${showOthers ? html`<div class="recipe-grid">${others.map(r => tile(r))}</div>` : null}
        ` : null}`}

      <div class="cta-bar">
        <span class="cta-text">
          <strong>${chosen.length ? `${plural(chosen.length, 'recipe')} chosen` : 'Tick what you are cooking'}</strong>
          ${chosen.length ? html`<span class="cta-names">${chosen.map(r => r.name).join(', ')}</span>` : null}
        </span>
        <${Btn} kind="primary" disabled=${!chosen.length} onClick=${() => go('week', { step: 'cupboard' })}>Check the cupboard →<//>
      </div>
    `}

    <${PastWeeks} state=${state} />
  </section>`;
}

/** Name matches first, then recipes with a matching ingredient ("chickpeas"). */
function searchRecipes(recipes, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const recipe of recipes) {
    const name = recipe.name.toLowerCase();
    let hint = null;
    const ok = words.every(w => {
      if (name.includes(w)) return true;
      const ing = recipe.ingredients.find(i => (i.item || '').toLowerCase().includes(w));
      if (ing) hint ??= `has ${ing.item}`;
      return !!ing;
    });
    if (ok) out.push({ recipe, hint });
  }
  return out.sort((a, b) => Number(!!a.hint) - Number(!!b.hint));
}

function RecipeSearch({ value, onChange }) {
  return html`<form class="recipe-search" role="search" onSubmit=${e => { e.preventDefault(); e.currentTarget.querySelector('input').blur(); }}>
    <${Icon} name="search" size=${18} />
    <input type="search" enterkeyhint="search" placeholder="Search recipes or ingredients" aria-label="Search recipes"
      value=${value} onInput=${e => onChange(e.currentTarget.value)} onKeyDown=${e => e.key === 'Escape' && onChange('')} />
    ${value ? html`<button type="button" class="icon-btn" aria-label="Clear search" onClick=${() => onChange('')}><${Icon} name="close" size=${18} /></button>` : null}
  </form>`;
}

function CupboardStep({ state, trolley, go }) {
  const list = state.lists.weekly;
  const [checking, setChecking] = useState(false);
  const chosen = state.recipes.filter(r => state.plan.selected[r.id]);
  const answer = (line, value) => post('/api/checks', { key: line.key, value }).catch(toastError);
  const neededLines = list.lines.filter(l => l.required);
  const otherLines = list.lines.filter(l => !l.required);
  const have = list.lines.filter(l => l.check === 'have').length;
  const toOcado = () => go('basket', { mode: 'weekly' });
  const back = html`<${Btn} small kind="ghost" onClick=${() => go('week')}><${Icon} name="back" size=${18} /> Recipes<//>`;

  if (!chosen.length) {
    return html`<section class="view">
      <${Head} state=${state}>${back}<//>
      <${Top} state=${state} trolley=${trolley} here="cupboard" />
      <${Empty} icon="week" title="No recipes chosen yet">
        <${Btn} kind="primary" onClick=${() => go('week')}>Choose recipes<//>
      <//>
    </section>`;
  }

  return html`<section class="view">
    <${Head} state=${state} sub=${chosen.map(r => r.name).join(' · ')}>${back}<//>
    <${Top} state=${state} trolley=${trolley} here="cupboard" />

    ${list.lines.length ? html`
      <div class="section-head">
        <h2>Got enough?</h2>
        <span class="sub">${list.toBuy} to buy · ${have} already have${list.unanswered ? html` · <strong>${list.unanswered} to check</strong>` : null}</span>
      </div>
      ${neededLines.length ? html`
        <h3 class="list-group">From the Needed list <a class="small" href="#/needed">Edit</a></h3>
        <ul class="list">${neededLines.map(l => html`<${ListLine} key=${l.key} line=${l} onAnswer=${v => answer(l, v)} />`)}</ul>
        ${otherLines.length ? html`<h3 class="list-group">For your recipes</h3>` : null}` : null}
      <ul class="list">
        ${otherLines.map(l => html`<${ListLine} key=${l.key} line=${l} onAnswer=${v => answer(l, v)} />`)}
      </ul>

      <div class="cta-bar">
        <span class="cta-text"><strong>${list.unanswered ? `${list.unanswered} to check` : `${plural(list.toBuy, 'item')} to buy`}</strong></span>
        ${list.unanswered ? html`<div class="btn-row">
          <${Btn} kind="ghost" disabled=${!list.toBuy} onClick=${toOcado}>Skip<//>
          <${Btn} kind="primary" onClick=${() => setChecking(true)}>Check what we have →<//>
        </div>` : html`<${Btn} kind="primary" disabled=${!list.toBuy} onClick=${toOcado}>Find products on Ocado →<//>`}
      </div>
    ` : html`<p class="muted">The chosen recipes have no ingredients yet — edit them in <a href="#/recipes">Recipes</a>.</p>`}

    ${checking ? html`<${CheckFlow} lines=${list.lines} onAnswer=${answer} onClose=${() => setChecking(false)} go=${go} />` : null}
  </section>`;
}

function RecipeToggle({ recipe, on, onToggle, servings, had, hint }) {
  return html`<button class=${`recipe-toggle ${on ? 'on' : ''}`} aria-pressed=${on} onClick=${onToggle}>
    <span class="tick" aria-hidden="true">${on ? html`<${Icon} name="check" size=${16} />` : null}</span>
    <span class="recipe-toggle-name">${recipe.name}</span>
    <span class="recipe-toggle-meta">${recipe.ingredients.length} ingredients${recipe.servings ? ` · serves ${servings || recipe.servings}` : ''}</span>
    ${hint ? html`<span class="recipe-toggle-had">${hint}</span>` : null}
    ${had ? html`<span class="recipe-toggle-had">${had}</span>` : null}
  </button>`;
}

function ListLine({ line, onAnswer }) {
  const from = line.recipes.join(', ');
  return html`<li class=${`list-line ${line.include ? '' : 'have'}`}>
    <div class="list-line-main">
      <div class="list-item">${line.item}
        ${line.required ? html` <span class="badge badge-need">Needed</span>` : null}
        ${line.pantry ? html` <span class="badge">Cupboard</span>` : null}
      </div>
      <div class="list-meta">${[line.needsText, from].filter(Boolean).join(' · ')}</div>
    </div>
    ${line.required ? html`<span class="muted small">on needed list</span>` : html`
      <div class="have-need" role="group" aria-label=${`Do we have enough ${line.item}?`}>
        <button class=${line.check === 'have' ? 'on' : ''} aria-pressed=${line.check === 'have'} onClick=${() => onAnswer(line.check === 'have' ? null : 'have')}>Got it</button>
        <button class=${line.check === 'need' ? 'on need' : ''} aria-pressed=${line.check === 'need'} onClick=${() => onAnswer(line.check === 'need' ? null : 'need')}>Buy</button>
      </div>`}
  </li>`;
}

/** One question at a time — easiest to do while standing at the fridge. */
function CheckFlow({ lines, onAnswer, onClose, go }) {
  // Questions to ask: unanswered first (non-cupboard), then cupboard items.
  const [queue] = useState(() => [
    ...lines.filter(l => !l.answered && !l.pantry),
    ...lines.filter(l => !l.answered && l.pantry),
  ]);
  const [i, setI] = useState(0);
  const idx = useRef(0); // ref, so quick double taps can't answer the same item twice
  const line = queue[i];
  const next = v => {
    const current = queue[idx.current];
    if (!current) return;
    idx.current += 1;
    setI(idx.current);
    if (v) onAnswer(current, v);
  };
  return html`<${Sheet} title="What do we have?" onClose=${onClose}>
    ${line ? html`
      <div class="check-card">
        <div class="check-progress">${i + 1} of ${queue.length}</div>
        <p class="check-q">Do we have enough <strong>${line.item}</strong>?</p>
        <p class="check-need">${[line.needsText && `Need ${line.needsText}`, line.recipes.length && `for ${line.recipes.join(', ')}`].filter(Boolean).join(' ')}</p>
        <div class="check-buttons">
          <button class="btn btn-big btn-have" onClick=${() => next('have')}>Yes, we have enough</button>
          <button class="btn btn-big btn-need" onClick=${() => next('need')}>No, buy some</button>
        </div>
        <button class="link-btn" onClick=${() => next(null)}>Not sure — skip</button>
      </div>` : html`
      <div class="check-card">
        <span class="check-done"><${Icon} name="done" size=${44} /></span>
        <p class="check-q">All checked</p>
        <div class="check-buttons">
          <button class="btn btn-big btn-primary" onClick=${() => { onClose(); go('basket', { mode: 'weekly' }); }}>Find products on Ocado →</button>
          <button class="btn btn-secondary" onClick=${onClose}>Back to the list</button>
        </div>
      </div>`}
  <//>`;
}
