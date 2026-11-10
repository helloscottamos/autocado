// Small shared UI pieces.
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---- toasts ---------------------------------------------------------------
const listeners = new Set();
let toastId = 0;
export function toast(message, kind = 'info', ms = 4500) {
  const t = { id: ++toastId, message, kind };
  listeners.forEach(fn => fn(t, ms));
}
export function toastError(e) {
  toast(e?.message || String(e), 'error', 7000);
}

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t, ms) => {
      setItems(prev => [...prev, t]);
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), ms);
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${items.map(t => html`<div key=${t.id} class=${`toast toast-${t.kind}`} onClick=${() => setItems(p => p.filter(x => x.id !== t.id))}>${t.message}</div>`)}
  </div>`;
}

// ---- async button: shows a spinner and reports errors ----------------------
export function Btn({ onClick, kind = 'secondary', busy: busyProp, disabled, children, class: cls = '', title, type = 'button', small }) {
  const [busy, setBusy] = useState(false);
  const run = async e => {
    if (!onClick) return;
    setBusy(true);
    try { await onClick(e); } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  const isBusy = busy || busyProp;
  return html`<button type=${type} class=${`btn btn-${kind} ${small ? 'btn-small' : ''} ${cls}`} disabled=${disabled || isBusy} onClick=${run} title=${title} aria-busy=${isBusy}>
    ${isBusy ? html`<span class="spinner" aria-hidden="true"></span>` : null}${children}
  </button>`;
}

export function Spinner({ label }) {
  return html`<span class="inline-spin"><span class="spinner" aria-hidden="true"></span>${label ? html`<span>${label}</span>` : null}</span>`;
}

export function Segmented({ value, options, onChange, label }) {
  return html`<div class="segmented" role="radiogroup" aria-label=${label}>
    ${options.map(o => html`<button type="button" role="radio" aria-checked=${value === o.value} class=${value === o.value ? 'on' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function Switch({ checked, onChange, label, hint }) {
  return html`<label class="switch-row">
    <span><span class="switch-label">${label}</span>${hint ? html`<span class="hint">${hint}</span>` : null}</span>
    <input type="checkbox" role="switch" checked=${checked} onChange=${e => onChange(e.currentTarget.checked)} />
    <span class="switch" aria-hidden="true"></span>
  </label>`;
}

export function Stepper({ value, onChange, min = 0, max = 24, label }) {
  return html`<div class="stepper" aria-label=${label}>
    <button type="button" aria-label="Fewer" disabled=${value <= min} onClick=${() => onChange(Math.max(min, value - 1))}>−</button>
    <span class="stepper-value" aria-live="polite">${value}</span>
    <button type="button" aria-label="More" disabled=${value >= max} onClick=${() => onChange(Math.min(max, value + 1))}>+</button>
  </div>`;
}

export function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return html`<div class="sheet-backdrop" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class=${`sheet ${wide ? 'sheet-wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title}>
      <header class="sheet-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></header>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

export function Empty({ icon = '🥑', title, children }) {
  return html`<div class="empty"><div class="empty-icon" aria-hidden="true">${icon}</div><h3>${title}</h3>${children ? html`<div class="empty-body">${children}</div>` : null}</div>`;
}

/** Ocado's bot check refused something recently (login itself is fine). */
export const botCheckActive = st => !!st?.ocado?.connected && !st.env?.bridge?.online && !!st.ocado.botCheck && Date.now() - Date.parse(st.ocado.botCheck.at) < 12 * 3600_000;

export const money = n => (n == null ? '—' : `£${Number(n).toFixed(2)}`);

export function Offers({ offers, compact }) {
  if (!offers?.length) return null;
  return html`<span class="offers">${offers.slice(0, compact ? 1 : 3).map(o => html`<span class="badge badge-offer" title=${o.description}>${o.description}</span>`)}</span>`;
}

export function ProductThumb({ product }) {
  return product?.image
    ? html`<img class="thumb" src=${product.image} alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : html`<span class="thumb thumb-empty" aria-hidden="true">🛒</span>`;
}

/** One product row: picture, name, price, badges, optional actions on the right. */
export function ProductRow({ product, children, onFav, fav }) {
  if (!product) return null;
  return html`<div class=${`product-row ${product.available === false ? 'unavailable' : ''}`}>
    <${ProductThumb} product=${product} />
    <div class="product-main">
      <div class="product-name">${product.name}</div>
      <div class="product-meta">
        <span class="price">${money(product.price)}</span>
        ${product.wasPrice && product.wasPrice > product.price ? html`<s class="was">${money(product.wasPrice)}</s>` : null}
        ${product.size ? html`<span>${product.size}</span>` : null}
        ${product.unitPrice ? html`<span class="muted">${money(product.unitPrice)}/${product.unitLabel || 'unit'}</span>` : null}
        ${product.organic ? html`<span class="badge badge-organic">Organic</span>` : null}
        ${product.available === false ? html`<span class="badge badge-warn">Out of stock</span>` : null}
      </div>
      <${Offers} offers=${product.offers} />
      ${product.labels?.length ? html`<span class="offers">${product.labels.slice(0, 2).map(l => html`<span class="badge">${l}</span>`)}</span>` : null}
    </div>
    <div class="product-actions">
      ${onFav ? html`<button class=${`star ${fav ? 'on' : ''}`} aria-pressed=${!!fav} aria-label=${fav ? 'Remove from favourites' : 'Add to favourites'} title=${fav ? 'Favourite' : 'Add to favourites'} onClick=${onFav}>${fav ? '★' : '☆'}</button>` : null}
      ${children}
    </div>
  </div>`;
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
