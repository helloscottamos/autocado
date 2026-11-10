// "Needed": things we've run out of, plus ad-hoc items for a top-up shop.
// Both the weekly shop and a top-up include everything here; items clear
// once they've been sent to the Ocado trolley.
import { html } from 'htm/preact';
import { useMemo, useState } from 'preact/hooks';
import { post, del } from '../api.js';
import { Btn, Empty, toast, toastError } from '../ui.js';

export function NeededView({ state, go }) {
  const [text, setText] = useState('');
  const [bulk, setBulk] = useState(false);
  const items = state.required;

  const add = async (value = text) => {
    const v = value.trim();
    if (!v) return;
    const { added } = await post('/api/required', { text: v });
    if (!added.length) toast('Already on the list', 'info', 2000);
    if (value === text) setText('');
  };

  // Quick-add suggestions: favourites and things bought recently.
  const suggestions = useMemo(() => {
    const onList = new Set(items.map(i => i.item.toLowerCase()));
    const names = new Map();
    for (const f of Object.values(state.favourites)) names.set((f.item || shortName(f.name)).toLowerCase(), f.item || shortName(f.name));
    for (const h of state.history.slice(0, 5)) for (const l of h.lines) if (l.status === 'sent') names.set(l.item.toLowerCase(), l.item);
    return [...names.entries()].filter(([k]) => !onList.has(k)).map(([, v]) => v).slice(0, 14);
  }, [state.favourites, state.history, items]);

  return html`
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Needed</h1>
          <p class="sub">Run out of something? Add it here — it goes in the next shop.</p>
        </div>
      </div>

      <form class="add-row" onSubmit=${e => { e.preventDefault(); add().catch(toastError); }}>
        ${bulk
          ? html`<textarea rows="5" placeholder=${'One item per line, e.g.\nmilk\n2 tins chopped tomatoes\nbin bags'} value=${text} onInput=${e => setText(e.currentTarget.value)} aria-label="Items to add"></textarea>`
          : html`<input type="text" placeholder="We've run out of…" value=${text} onInput=${e => setText(e.currentTarget.value)} aria-label="Item to add" enterkeyhint="done" autocomplete="off" />`}
        <${Btn} kind="primary" type="submit" onClick=${() => add()}>Add<//>
      </form>
      <button class="link-btn" onClick=${() => setBulk(!bulk)}>${bulk ? 'Add one at a time' : 'Paste a list instead'}</button>

      ${suggestions.length ? html`
        <div class="chips" aria-label="Quick add">
          ${suggestions.map(s => html`<button class="chip" onClick=${() => add(s).catch(toastError)}>+ ${s}</button>`)}
        </div>` : null}

      ${items.length === 0 ? html`
        <${Empty} icon="✅" title="Nothing needed">
          <p>When something runs out, add it here. It will be included in the weekly shop or a quick top-up.</p>
        <//>` : html`
        <ul class="list">
          ${items.map(i => html`<li class="list-line" key=${i.id}>
            <div class="list-line-main">
              <div class="list-item">${i.item}</div>
              ${i.quantity ? html`<div class="list-meta">${i.quantity}${i.unit ? ` ${i.unit}` : ''}</div>` : null}
            </div>
            <button class="icon-btn" aria-label=${`Remove ${i.item}`} onClick=${() => del(`/api/required/${i.id}`).catch(toastError)}>✕</button>
          </li>`)}
        </ul>
        <div class="cta-bar">
          <${Btn} kind="ghost" small onClick=${() => confirm('Clear the whole needed list?') && post('/api/required/clear')}>Clear all<//>
          <span class="spacer"></span>
          <${Btn} kind="primary" onClick=${() => go('basket', { mode: 'topup' })}>Top-up shop with these →<//>
        </div>`}
    </section>
  `;
}

/** "Yeo Valley Organic Fresh Whole Milk 2L" -> "Yeo Valley Organic Fresh Whole Milk" (keeps it recognisable). */
function shortName(name) {
  return String(name || '').replace(/\s+\d+(\.\d+)?\s?(g|kg|ml|l|pack)\b.*$/i, '').trim();
}
