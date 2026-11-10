// Demo/dev adapter: a small fake catalogue and an in-memory trolley, so the
// whole app can be tried (and tested) without an Ocado account.
// Start with `npm run demo` (OCADO_MOCK=1).
import { OcadoError } from './errors.js';

const P = (sku, name, price, size, { organic = false, offer = null, was = null, available = true } = {}) => ({
  productId: `mock-${sku}`, sku: String(sku), name, brand: name.split(' ')[0], price, wasPrice: was,
  unitPrice: null, unitLabel: null, size, image: null, available, organic,
  offers: offer ? [{ id: `o-${sku}`, description: offer, minQty: null }] : (was ? [{ id: `w-${sku}`, description: `Now £${price.toFixed(2)}, was £${was.toFixed(2)}`, minQty: null }] : []),
  favourite: false, sponsored: false, url: null,
});

const CATALOGUE = [
  P(1001, 'Ocado Organic Brown Onions', 1.1, '3 per pack', { organic: true }),
  P(1002, 'Ocado Brown Onions', 0.85, '1kg'),
  P(1003, 'Ocado Organic Red Onions', 1.25, '3 per pack', { organic: true }),
  P(1004, 'Ocado Organic Garlic', 0.95, '2 per pack', { organic: true }),
  P(1005, 'Ocado Garlic', 0.55, '4 per pack'),
  P(1006, 'Ocado Organic Carrots', 0.95, '700g', { organic: true }),
  P(1007, 'Ocado Carrots', 0.6, '1kg'),
  P(1008, 'Yeo Valley Organic Fresh Whole Milk', 3.15, '2L', { organic: true, offer: 'Buy any 2 for £4.50' }),
  P(1009, 'Yeo Valley Organic Semi Skimmed Milk', 3.15, '2L', { organic: true, offer: 'Buy any 2 for £4.50' }),
  P(1010, 'Ocado British Semi Skimmed Milk', 1.6, '2.272L'),
  P(1011, 'Clarence Court Organic Free Range Eggs', 3.5, '6 per pack', { organic: true }),
  P(1012, 'Ocado Free Range Eggs', 2.2, '6 per pack'),
  P(1013, 'Ocado Organic Chopped Tomatoes', 0.95, '400g', { organic: true, offer: 'Buy 3 for £2.40' }),
  P(1014, 'Mutti Chopped Tomatoes', 1.4, '400g'),
  P(1015, 'Ocado Organic Chickpeas', 0.9, '400g', { organic: true }),
  P(1016, 'Ocado Organic Red Lentils', 2.25, '500g', { organic: true }),
  P(1017, 'Ocado Organic Basmati Rice', 2.5, '1kg', { organic: true, was: 3.1 }),
  P(1018, 'Tilda Basmati Rice', 3.0, '1kg'),
  P(1019, 'Ocado Organic British Chicken Thighs', 6.5, '600g', { organic: true }),
  P(1020, 'Ocado British Chicken Thighs', 3.9, '1kg'),
  P(1021, 'Daylesford Organic Beef Mince', 7.5, '500g', { organic: true }),
  P(1022, 'Ocado British Beef Mince 5% Fat', 4.5, '500g'),
  P(1023, 'Ocado Organic Spinach', 2.0, '200g', { organic: true }),
  P(1024, 'Ocado Organic Lemons', 1.6, '4 per pack', { organic: true }),
  P(1025, 'Ocado Organic Coriander', 0.9, '30g', { organic: true }),
  P(1026, 'Ocado Organic Fresh Ginger', 0.8, '150g', { organic: true }),
  P(1027, 'Ocado Organic Coconut Milk', 1.5, '400ml', { organic: true, offer: 'Buy 1, add 2nd Half Price.' }),
  P(1028, 'Ocado Organic Extra Virgin Olive Oil', 6.5, '500ml', { organic: true }),
  P(1029, 'Ocado Organic Spaghetti', 1.2, '500g', { organic: true }),
  P(1030, 'Ocado Organic Parmigiano Reggiano', 4.5, '200g', { organic: true }),
  P(1031, 'Ocado Organic Unsalted Butter', 3.0, '250g', { organic: true }),
  P(1032, 'Ocado Organic Wholemeal Bread', 2.0, '800g', { organic: true }),
  P(1033, 'Ocado Organic Bananas', 1.35, '5 per pack', { organic: true }),
  P(1034, 'Ocado Organic Greek Yogurt', 2.25, '500g', { organic: true, was: 2.75 }),
  P(1035, 'Ocado Organic Red Peppers', 2.1, '2 per pack', { organic: true }),
  P(1036, 'Ocado Organic Courgettes', 1.5, '500g', { organic: true }),
  P(1037, 'Ocado Organic Vegetable Stock Cubes', 1.6, '8 per pack', { organic: true }),
  P(1038, 'Ocado Organic Ground Cumin', 1.8, '40g', { organic: true }),
  P(1039, 'Ocado Organic Potatoes', 1.75, '1.5kg', { organic: true }),
  P(1040, 'Ocado Organic Kidney Beans', 0.85, '400g', { organic: true }),
  P(1041, 'Ocado Organic Cheddar', 3.5, '350g', { organic: true }),
  P(1042, 'Ocado Organic Salmon Fillets', 7.0, '2 x 120g', { organic: true }),
  P(1043, 'Ocado Organic Broccoli', 1.2, '350g', { organic: true }),
  P(1044, 'Ocado Organic Mushrooms', 1.6, '250g', { organic: true }),
  P(1045, 'Ocado Organic Avocados', 2.5, '2 per pack', { organic: true, available: false }),
  P(1046, 'Ocado Ripe Avocados', 1.8, '2 per pack'),
];

// The fake catalogue is tiny; map a few everyday words onto what it has.
const SYNONYMS = { yoghurt: 'yogurt', parmesan: 'parmigiano', cheese: 'cheddar' };

const delay = (ms = 150) => new Promise(r => setTimeout(r, ms));

export class MockOcado {
  constructor() {
    this.mock = true;
    this.connected = true; // demo starts "signed in"; Disconnect/Connect in Settings still work
    // Mimic Ocado quietly ignoring writes when its bot check wants a fresh sign-in.
    this.ignoreWrites = process.env.OCADO_MOCK_IGNORE_WRITES === '1';
    this.favs = new Set(['mock-1008', 'mock-1013', 'mock-1017', 'mock-1033']);
    this.trolleyItems = new Map();
  }

  hasSession() { return this.connected; }
  reload() {}

  async status() {
    return this.connected ? { connected: true } : { connected: false, reason: 'Demo mode — press Connect (any details work)' };
  }

  #decorate(p) { return { ...p, favourite: this.favs.has(p.productId) }; }

  #require() {
    if (!this.connected) throw new OcadoError('NOT_CONNECTED', 'Connect your Ocado account first (Settings).');
  }

  async search(query, { limit = 24 } = {}) {
    await delay();
    const words = String(query).toLowerCase().split(/\s+/).filter(w => w && w !== 'organic').map(w => SYNONYMS[w] ?? w);
    const wantsOrganic = /\borganic\b/i.test(query);
    const stem = w => w.replace(/(es|s)$/, '');
    const hits = CATALOGUE.filter(p => {
      const name = p.name.toLowerCase();
      return words.every(w => name.includes(stem(w)));
    });
    hits.sort((a, b) => (wantsOrganic ? Number(b.organic) - Number(a.organic) : 0));
    return hits.slice(0, limit).map(p => this.#decorate(p));
  }

  async favourites() {
    this.#require();
    await delay();
    return CATALOGUE.filter(p => this.favs.has(p.productId)).map(p => this.#decorate(p));
  }

  async products(ids) {
    await delay();
    return CATALOGUE.filter(p => ids.includes(p.productId)).map(p => this.#decorate(p));
  }

  async setFavourite(productId, on) {
    this.#require();
    await delay(80);
    if (on) this.favs.add(productId); else this.favs.delete(productId);
  }

  async trolley() {
    this.#require();
    await delay();
    const items = [...this.trolleyItems.entries()].map(([id, quantity]) => {
      const p = CATALOGUE.find(c => c.productId === id);
      return { ...(p ? this.#decorate(p) : { productId: id, name: id, offers: [], labels: [] }), quantity, total: p ? Math.round(p.price * quantity * 100) / 100 : null };
    });
    return { items, total: Math.round(items.reduce((s, i) => s + (i.total ?? 0), 0) * 100) / 100 };
  }

  async setTrolleyQuantity(productId, quantity) {
    this.#require();
    await delay(100);
    if (this.ignoreWrites) return;
    if (quantity > 0) this.trolleyItems.set(productId, quantity); else this.trolleyItems.delete(productId);
  }

  async addToTrolley(productId, quantity) {
    this.#require();
    await delay(120);
    const p = CATALOGUE.find(c => c.productId === productId);
    if (!p) throw new OcadoError('UNKNOWN', `Unknown product ${productId}`);
    if (!p.available) throw new OcadoError('UNKNOWN', `${p.name} is out of stock`);
    if (this.ignoreWrites) return;
    this.trolleyItems.set(productId, (this.trolleyItems.get(productId) ?? 0) + quantity);
  }

  async clearTrolley() { this.#require(); if (!this.ignoreWrites) this.trolleyItems.clear(); }

  importCookies() { this.connected = true; }
  saveCookies() { this.connected = true; }
  async logout() { this.connected = false; this.trolleyItems.clear(); }
}
