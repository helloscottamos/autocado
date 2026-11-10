// Every Ocado product Autocado has seen (search results, lists, favourites,
// trolley lookups), keyed by product id. Ocado's product-info lookup sits
// behind its bot check and stops answering once the sign-in's browser token
// goes stale — but the trolley API still returns ids, quantities and prices.
// With this catalogue the trolley can still show names and pictures.
// Server-side only (not sent to the browser), saved to data/catalogue.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

const FILE = path.join(DATA_DIR, 'catalogue.json');
const MAX = 3000;
const FIELDS = ['productId', 'sku', 'name', 'brand', 'price', 'wasPrice', 'unitPrice', 'unitLabel', 'size', 'image', 'organic', 'offers', 'labels', 'url'];

const map = new Map();
try {
  for (const p of JSON.parse(fs.readFileSync(FILE, 'utf8'))) if (p?.productId) map.set(p.productId, p);
} catch { /* first run */ }

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (map.size > MAX) {
      const oldest = [...map.values()].sort((a, b) => (a.seenAt || '').localeCompare(b.seenAt || '')).slice(0, map.size - MAX);
      for (const p of oldest) map.delete(p.productId);
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...map.values()]));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error('[catalogue] save failed:', e.message); }
  }, 2000);
  saveTimer.unref?.();
}

export function remember(products) {
  const at = new Date().toISOString();
  for (const p of products || []) {
    if (!p?.productId || !p.name) continue;
    const entry = { seenAt: at };
    for (const f of FIELDS) if (p[f] !== undefined) entry[f] = p[f];
    map.set(p.productId, { ...map.get(p.productId), ...entry });
  }
  scheduleSave();
  return products;
}

export const known = id => map.get(id) ?? null;

/** Forget every remembered product (used by "Reset all data"). */
export function forgetAll() {
  map.clear();
  try { fs.rmSync(FILE, { force: true }); } catch { /* ignore */ }
}
