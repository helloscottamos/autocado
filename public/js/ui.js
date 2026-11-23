// Small shared UI pieces.
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---- icons: line icons on a 24px grid, the same set and stroke as hengroveFM and homeView
const AVOCADO = 'M12 2.5C14.6 2.5 15.6 5.4 16.4 8c.5 1.7 2.1 3.6 2.1 7a6.5 6.5 0 0 1-13 0c0-3.4 1.6-5.3 2.1-7 .8-2.6 1.8-5.5 4.4-5.5z';
const P = {
  week: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4"/><path d="M8 2.5v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 17.5h.01"/><path d="M12 17.5h.01"/>',
  needed: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h2.1l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1"/>',
  star: '<path d="M12 2.6 14.5 9l6.8.4-5.3 4.3 1.8 6.6L12 16.6l-5.8 3.7L8 13.7 2.7 9.4 9.5 9z"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  done: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>',
  external: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  avocado: `<path d="${AVOCADO}"/><circle cx="12" cy="15" r="2.8"/>`,
};

/** A line icon. `filled` fills the shape too (a starred star). */
export function Icon({ name, size = 20, class: cls = '', filled }) {
  return html`<svg class=${`icon ${filled ? 'filled' : ''} ${cls}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: P[name] || '' }} />`;
}

/** Autocado's mark: the avocado from the app icon. */
export function Mark({ size = 22 }) {
  return html`<svg class="mark" width=${size} height=${size} viewBox="4 1.5 16 21.5" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: `
    <defs><linearGradient id="mark-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2f29a"/><stop offset="1" stop-color="#9ccf62"/></linearGradient>
    <radialGradient id="mark-p" cx=".38" cy=".34" r=".75"><stop offset="0" stop-color="#a8723c"/><stop offset="1" stop-color="#5a3518"/></radialGradient></defs>
    <path d="${AVOCADO}" fill="#3a5a1c"/>
    <path transform="translate(12 14) scale(.8) translate(-12 -14)" d="${AVOCADO}" fill="url(#mark-f)"/>
    <circle cx="12" cy="15.2" r="3.3" fill="url(#mark-p)"/>` }} />`;
}

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
    <button type="button" aria-label="Fewer" disabled=${value <= min} onClick=${() => onChange(Math.max(min, value - 1))}><${Icon} name="minus" size=${18} /></button>
    <span class="stepper-value" aria-live="polite">${value}</span>
    <button type="button" aria-label="More" disabled=${value >= max} onClick=${() => onChange(Math.min(max, value + 1))}><${Icon} name="plus" size=${18} /></button>
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
      <header class="sheet-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button></header>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

export function Empty({ icon = 'avocado', title, children }) {
  return html`<div class="empty"><div class="empty-icon"><${Icon} name=${icon} size=${36} /></div><h3>${title}</h3>${children ? html`<div class="empty-body">${children}</div>` : null}</div>`;
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
    : html`<span class="thumb thumb-empty" aria-hidden="true"><${Icon} name="cart" size=${22} /></span>`;
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
      ${onFav ? html`<button class=${`star ${fav ? 'on' : ''}`} aria-pressed=${!!fav} aria-label=${fav ? 'Remove from favourites' : 'Add to favourites'} title=${fav ? 'Favourite' : 'Add to favourites'} onClick=${onFav}><${Icon} name="star" size=${22} filled=${!!fav} /></button>` : null}
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
