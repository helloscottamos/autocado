// "This week": pick recipes, answer "have we got enough?", see the list update live.
import { html } from 'htm/preact';
import { useRef, useState } from 'preact/hooks';
import { post } from '../api.js';
import { Btn, Empty, Sheet, toastError } from '../ui.js';

export function WeekView({ state, go }) {
  const list = state.lists.weekly;
  const [checking, setChecking] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const selected = state.plan.selected;
  const staples = state.recipes.filter(r => r.staple !== false);
  const others = state.recipes.filter(r => r.staple === false);
  const chosenCount = state.recipes.filter(r => selected[r.id]).length;

  const toggle = (r) => post('/api/plan/toggle', { recipeId: r.id, on: !selected[r.id] }).catch(toastError);
  const answer = (line, value) => post('/api/checks', { key: line.key, value }).catch(toastError);

  const recipeLines = list.lines.filter(l => l.recipes.length);
  const have = recipeLines.filter(l => l.check === 'have').length;

  return html`
    <section class="view">
      <div class="view-head">
        <div>
          <h1>This week</h1>
          <p class="sub">${chosenCount ? `${chosenCount} recipe${chosenCount === 1 ? '' : 's'} chosen` : 'Tap the recipes you are cooking this week'}</p>
        </div>
        ${chosenCount ? html`<${Btn} small kind="ghost" onClick=${() => confirm('Untick all recipes and forget the pantry answers?') && post('/api/plan/clear')}>New week<//>` : null}
      </div>

      ${state.recipes.length === 0 ? html`
        <${Empty} icon="📖" title="No recipes yet">
          <p>Add your staple recipes — from a photo of the cookbook page, a web link, or by typing them in.</p>
          <${Btn} kind="primary" onClick=${() => go('recipes', { add: '1' })}>Add a recipe<//>
        <//>` : html`
        <div class="recipe-grid">
          ${staples.map(r => html`<${RecipeToggle} key=${r.id} recipe=${r} on=${!!selected[r.id]} onToggle=${() => toggle(r)} servings=${state.plan.servings[r.id]} />`)}
        </div>
        ${others.length ? html`
          <button class="link-btn" onClick=${() => setShowOthers(!showOthers)}>${showOthers ? 'Hide' : 'Show'} other recipes (${others.length})</button>
          ${showOthers ? html`<div class="recipe-grid">${others.map(r => html`<${RecipeToggle} key=${r.id} recipe=${r} on=${!!selected[r.id]} onToggle=${() => toggle(r)} servings=${state.plan.servings[r.id]} />`)}</div>` : null}
        ` : null}
      `}

      ${list.lines.length ? html`
        <div class="section-head">
          <h2>Shopping list</h2>
          <span class="sub">${list.toBuy} to buy · ${have} already have${list.unanswered ? html` · <strong>${list.unanswered} to check</strong>` : null}</span>
        </div>
        ${list.unanswered ? html`<${Btn} kind="primary" class="wide" onClick=${() => setChecking(true)}>Check what we have (${list.unanswered} questions)<//>` : null}

        <ul class="list">
          ${list.lines.map(l => html`<${ListLine} key=${l.key} line=${l} onAnswer=${v => answer(l, v)} />`)}
        </ul>

        <div class="cta-bar">
          <span>${list.toBuy} item${list.toBuy === 1 ? '' : 's'} to buy</span>
          <${Btn} kind="primary" disabled=${!list.toBuy} onClick=${() => go('basket', { mode: 'weekly' })}>Build the Ocado basket →<//>
        </div>
      ` : chosenCount ? html`<p class="muted">The chosen recipes have no ingredients yet — edit them in Recipes.</p>` : null}

      ${checking ? html`<${CheckFlow} lines=${list.lines} onAnswer=${answer} onClose=${() => setChecking(false)} onDone=${() => { setChecking(false); }} go=${go} />` : null}
    </section>
  `;
}

function RecipeToggle({ recipe, on, onToggle, servings }) {
  return html`<button class=${`recipe-toggle ${on ? 'on' : ''}`} aria-pressed=${on} onClick=${onToggle}>
    <span class="tick" aria-hidden="true">${on ? '✓' : ''}</span>
    <span class="recipe-toggle-name">${recipe.name}</span>
    <span class="recipe-toggle-meta">${recipe.ingredients.length} ingredients${recipe.servings ? ` · serves ${servings || recipe.servings}` : ''}</span>
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
        <p class="check-q">All checked ✓</p>
        <div class="check-buttons">
          <button class="btn btn-big btn-primary" onClick=${() => { onClose(); go('basket', { mode: 'weekly' }); }}>Build the Ocado basket →</button>
          <button class="btn btn-secondary" onClick=${onClose}>Back to the list</button>
        </div>
      </div>`}
  <//>`;
}
