// "Recipes": staple recipes, added from a photo, pasted text, a web link, a
// cookbook by name, or typed in. Every import opens the editor to check
// before saving — the "item" column is what gets searched on Ocado.
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { post, put, del, photoToBase64 } from '../api.js';
import { Btn, Empty, Segmented, Sheet, toast, toastError } from '../ui.js';

export function RecipesView({ state, params, go }) {
  const [adding, setAdding] = useState(params.add === '1');
  const [editing, setEditing] = useState(null); // recipe object (new or existing)
  useEffect(() => { if (params.add === '1') setAdding(true); }, [params.add]);

  const recipes = [...state.recipes].sort((a, b) => Number(b.staple !== false) - Number(a.staple !== false) || a.name.localeCompare(b.name));
  const closeAdd = () => { setAdding(false); if (params.add) go('recipes'); };

  return html`
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Recipes</h1>
          <p class="sub">${recipes.length} recipe${recipes.length === 1 ? '' : 's'} · staples show on This week</p>
        </div>
        <${Btn} kind="primary" onClick=${() => setAdding(true)}>+ Add recipe<//>
      </div>

      ${recipes.length === 0 ? html`<${Empty} icon="📖" title="No recipes yet"><p>Add the meals you cook most often. A photo of the cookbook page is quickest.</p><//>` : html`
        <ul class="recipe-list">
          ${recipes.map(r => html`<li key=${r.id} class="recipe-card">
            <button class="recipe-card-main" onClick=${() => setEditing(r)}>
              <span class="recipe-card-name">${r.name}</span>
              <span class="muted small">${[sourceLabel(r.source), r.servings && `serves ${r.servings}`, `${r.ingredients.length} ingredients`].filter(Boolean).join(' · ')}</span>
            </button>
            <label class="check-label small"><input type="checkbox" checked=${r.staple !== false} onChange=${e => put(`/api/recipes/${r.id}`, { staple: e.currentTarget.checked }).catch(toastError)} /> Staple</label>
            <label class="check-label small"><input type="checkbox" checked=${!!state.plan.selected[r.id]} onChange=${e => post('/api/plan/toggle', { recipeId: r.id, on: e.currentTarget.checked }).catch(toastError)} /> This week</label>
          </li>`)}
        </ul>`}

      ${adding ? html`<${AddRecipe} claude=${state.env.claude} onClose=${closeAdd} onReady=${draft => { closeAdd(); setEditing(draft); }} />` : null}
      ${editing ? html`<${RecipeEditor} recipe=${editing} onClose=${() => setEditing(null)} />` : null}
    </section>
  `;
}

function sourceLabel(s) {
  if (!s) return null;
  if (s.book) return `${s.book}${s.page ? `, p.${s.page}` : ''}`;
  if (s.url) { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return 'web'; } }
  return null;
}

function AddRecipe({ claude, onClose, onReady }) {
  const [how, setHow] = useState(claude ? 'photo' : 'type');
  const [images, setImages] = useState([]);
  const [hint, setHint] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [book, setBook] = useState('');
  const [busy, setBusy] = useState(false);

  const addPhotos = async files => {
    try {
      const out = [];
      for (const f of [...files].slice(0, 4)) out.push(await photoToBase64(f));
      setImages(prev => [...prev, ...out].slice(0, 4));
    } catch (e) { toastError(e); }
  };

  const run = async () => {
    setBusy(true);
    try {
      let body;
      if (how === 'photo') { if (!images.length) throw new Error('Add a photo first.'); body = { kind: 'photo', images: images.map(({ data, mediaType }) => ({ data, mediaType })), hint }; }
      if (how === 'text') body = { kind: 'text', text };
      if (how === 'url') body = { kind: 'url', url };
      if (how === 'book') body = { kind: 'book', title, book };
      const recipe = await post('/api/recipes/import', body);
      onReady(recipe);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const needsClaude = ['photo', 'book'].includes(how) && !claude;
  return html`<${Sheet} title="Add a recipe" onClose=${onClose} wide>
    <${Segmented} label="How" value=${how} onChange=${setHow} options=${[
      { value: 'photo', label: '📷 Photo' }, { value: 'text', label: 'Paste' }, { value: 'url', label: 'Web link' },
      { value: 'book', label: 'From a book' }, { value: 'type', label: 'Type it' },
    ]} />

    ${needsClaude ? html`<div class="banner banner-warn"><span>Reading photos and books needs a Claude API key.</span><a class="btn btn-small btn-secondary" href="#/settings">Add key</a></div>` : null}

    ${how === 'photo' ? html`<div class="stack">
      <p class="muted">Take a photo of the cookbook page (or a few, if it runs over). Claude reads the ingredients.</p>
      <label class="btn btn-secondary file-btn">📷 Take or choose photos
        <input type="file" accept="image/*" capture="environment" multiple onChange=${e => addPhotos(e.currentTarget.files)} />
      </label>
      ${images.length ? html`<div class="previews">${images.map((img, i) => html`<div class="preview"><img src=${img.preview} alt=${`Page ${i + 1}`} /><button class="icon-btn" aria-label="Remove photo" onClick=${() => setImages(images.filter((_, j) => j !== i))}>✕</button></div>`)}</div>` : null}
      <input type="text" placeholder="Optional note, e.g. “double the garlic, skip the anchovies”" value=${hint} onInput=${e => setHint(e.currentTarget.value)} />
    </div>` : null}

    ${how === 'text' ? html`<div class="stack">
      <p class="muted">Paste a recipe or just the ingredient list.${claude ? '' : ' Without a Claude key each line is read as one ingredient.'}</p>
      <textarea rows="10" value=${text} onInput=${e => setText(e.currentTarget.value)} placeholder=${'2 red onions, sliced\n400g tin chopped tomatoes\n1 tbsp ground cumin'}></textarea>
    </div>` : null}

    ${how === 'url' ? html`<div class="stack">
      <p class="muted">Most recipe sites (BBC Good Food, Guardian, NYT Cooking…) work.</p>
      <input type="url" placeholder="https://…" value=${url} onInput=${e => setUrl(e.currentTarget.value)} />
    </div>` : null}

    ${how === 'book' ? html`<div class="stack">
      <p class="muted">If Claude knows the recipe from that book, it fills in the ingredients from memory. Check them against your copy — a photo of the page is more reliable.</p>
      <input type="text" placeholder="Recipe name" value=${title} onInput=${e => setTitle(e.currentTarget.value)} />
      <input type="text" placeholder="Book (and author)" value=${book} onInput=${e => setBook(e.currentTarget.value)} />
    </div>` : null}

    ${how === 'type' ? html`<div class="stack">
      <p class="muted">Start with a blank recipe and type the ingredients.</p>
      <${Btn} kind="primary" onClick=${() => onReady({ name: '', servings: 4, ingredients: [], source: { type: 'manual' }, staple: true })}>Start typing<//>
    </div>` : html`
      <div class="btn-row"><${Btn} kind="primary" busy=${busy} disabled=${needsClaude} onClick=${run}>${how === 'photo' ? 'Read the recipe' : 'Get ingredients'}<//>
      ${busy ? html`<span class="muted small">This can take 10–30 seconds…</span>` : null}</div>`}
  <//>`;
}

const blankRow = () => ({ id: Math.random().toString(36).slice(2, 10), text: '', item: '', quantity: '', unit: '', pantry: false });

function RecipeEditor({ recipe, onClose }) {
  const isNew = !recipe.id;
  const [r, setR] = useState(() => ({
    ...recipe,
    source: recipe.source || { type: 'manual' },
    ingredients: (recipe.ingredients?.length ? recipe.ingredients : [blankRow()]).map(i => ({ ...blankRow(), ...i, quantity: i.quantity ?? '', unit: i.unit ?? '' })),
  }));
  const [paste, setPaste] = useState('');
  const set = patch => setR(prev => ({ ...prev, ...patch }));
  const setIng = (idx, patch) => setR(prev => ({ ...prev, ingredients: prev.ingredients.map((x, i) => (i === idx ? { ...x, ...patch } : x)) }));

  const addPasted = async () => {
    const { ingredients } = await post('/api/parse-lines', { text: paste });
    setR(prev => ({ ...prev, ingredients: [...prev.ingredients.filter(i => i.item.trim()), ...ingredients.map(i => ({ ...blankRow(), ...i, quantity: i.quantity ?? '', unit: i.unit ?? '' }))] }));
    setPaste('');
  };

  const save = async () => {
    const body = { ...r, ingredients: r.ingredients.filter(i => i.item.trim()) };
    if (isNew) { await post('/api/recipes', { ...body, selectThisWeek: false }); toast(`Saved ${r.name}`, 'success'); }
    else { await put(`/api/recipes/${r.id}`, body); toast('Saved', 'success', 2000); }
    onClose();
  };
  const remove = async () => {
    if (!confirm(`Delete ${r.name}?`)) return;
    await del(`/api/recipes/${r.id}`);
    onClose();
  };

  return html`<${Sheet} title=${isNew ? 'Check the recipe' : 'Edit recipe'} onClose=${onClose} wide>
    ${recipe.warnings ? html`<div class="banner banner-warn">${recipe.warnings}</div>` : null}
    ${recipe.confidence === 'low' ? html`<div class="banner banner-warn">Claude was not confident reading this — check every line.</div>` : null}
    <div class="form-grid">
      <label class="field span-2"><span>Name</span><input type="text" value=${r.name} onInput=${e => set({ name: e.currentTarget.value })} placeholder="e.g. Chicken & chickpea curry" /></label>
      <label class="field"><span>Serves</span><input type="number" min="1" inputmode="numeric" value=${r.servings ?? ''} onInput=${e => set({ servings: e.currentTarget.value })} /></label>
      <label class="field"><span>Book</span><input type="text" value=${r.source.book || ''} onInput=${e => set({ source: { ...r.source, book: e.currentTarget.value } })} /></label>
      <label class="field"><span>Page</span><input type="text" value=${r.source.page || ''} onInput=${e => set({ source: { ...r.source, page: e.currentTarget.value } })} /></label>
      <label class="check-label"><input type="checkbox" checked=${r.staple !== false} onChange=${e => set({ staple: e.currentTarget.checked })} /> Staple (show on This week)</label>
    </div>

    <h3 class="mini-head">Ingredients <span class="muted small">— “Search for” is what we look up on Ocado</span></h3>
    <div class="ing-table" role="table">
      <div class="ing-row ing-head" role="row"><span>Search for</span><span>Qty</span><span>Unit</span><span title="Cupboard staple — assumed we have it">Cupboard</span><span></span></div>
      ${r.ingredients.map((i, idx) => html`<div class="ing-row" role="row" key=${i.id}>
        <span class="ing-item">
          <input type="text" value=${i.item} onInput=${e => setIng(idx, { item: e.currentTarget.value })} aria-label="Search for" placeholder="e.g. red onions" />
          ${i.text && i.text !== i.item ? html`<span class="ing-orig muted small">${i.text}</span>` : null}
        </span>
        <input type="number" step="any" min="0" inputmode="decimal" value=${i.quantity} onInput=${e => setIng(idx, { quantity: e.currentTarget.value })} aria-label="Quantity" />
        <input type="text" value=${i.unit} onInput=${e => setIng(idx, { unit: e.currentTarget.value })} aria-label="Unit" placeholder="g, tbsp…" />
        <input type="checkbox" checked=${!!i.pantry} onChange=${e => setIng(idx, { pantry: e.currentTarget.checked })} aria-label="Cupboard staple" />
        <button class="icon-btn" aria-label="Remove ingredient" onClick=${() => set({ ingredients: r.ingredients.filter((_, j) => j !== idx) })}>✕</button>
      </div>`)}
    </div>
    <button class="link-btn" onClick=${() => set({ ingredients: [...r.ingredients, blankRow()] })}>+ Add ingredient</button>

    <details class="paste-lines">
      <summary>Paste several ingredient lines</summary>
      <textarea rows="5" value=${paste} onInput=${e => setPaste(e.currentTarget.value)} placeholder=${'One per line, e.g.\n2 courgettes\n200g feta'}></textarea>
      <${Btn} small onClick=${addPasted} disabled=${!paste.trim()}>Add these lines<//>
    </details>

    <div class="btn-row sheet-foot">
      ${!isNew ? html`<${Btn} kind="danger" onClick=${remove}>Delete<//>` : null}
      <span class="spacer"></span>
      <${Btn} kind="ghost" onClick=${onClose}>Cancel<//>
      <${Btn} kind="primary" disabled=${!r.name.trim()} onClick=${save}>Save recipe<//>
    </div>
  <//>`;
}
