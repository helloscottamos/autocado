import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { favouritesFromHtml, readFavourites, FAVOURITES_PAGE_MAX } = await import('../server/ocado/normalise.js');
const { extractProductEntities } = createRequire(import.meta.url)('open-supermarkets/dist/providers/ocado.js');

const entity = n => ({ productId: `id-${n}`, retailerProductId: `${1000 + n}`, name: `Product ${n}`, favorite: {}, price: { current: { amount: '1.50' } } });

/** A cut-down /favorites page: an id list, details for some, tiles for fewer. */
function page({ ids, detailed, tiles = 0, groups = true }) {
  const entities = Object.fromEntries(detailed.map(n => [`id-${n}`, entity(n)]));
  const links = detailed.slice(0, tiles).map(n => `<a href="/products/product-${n}/${1000 + n}">Product ${n}</a>`).join('');
  const list = groups ? `,"list":{"productGroups":[{"type":"favorite","products":${JSON.stringify(ids.map(n => `id-${n}`))},"name":"Favourites [all] \\"yours\\""}]}` : '';
  return `<html><body>${links}<script>window.__STATE__={"products":{"productEntities":${JSON.stringify(entities)}}${list}}</script></body></html>`;
}

const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);

test('reads every favourite id, not just the ones with a tile', () => {
  const html = page({ ids: range(0, 20), detailed: range(0, 12), tiles: 3 });
  const r = favouritesFromHtml(html, extractProductEntities);
  assert.equal(r.ids.length, 20);
  assert.deepEqual(r.products.map(p => p.name).slice(0, 2), ['Product 0', 'Product 1']);
  assert.equal(r.products.length, 12);
  assert.deepEqual(r.missing, range(12, 20).map(n => `id-${n}`));
  assert.equal(r.complete, true);
});

test('a list cut off at Ocado\'s limit is marked incomplete', () => {
  const r = favouritesFromHtml(page({ ids: range(0, FAVOURITES_PAGE_MAX), detailed: range(0, 50) }), extractProductEntities);
  assert.equal(r.ids.length, FAVOURITES_PAGE_MAX);
  assert.equal(r.complete, false);
});

test('details for the rest are fetched, in Ocado\'s order', async () => {
  const html = page({ ids: [5, 0, 9, 1], detailed: [0, 1], tiles: 1 });
  const asked = [];
  const list = await readFavourites(html, extractProductEntities, async ids => { asked.push(...ids); return ids.map(id => ({ productId: id, name: `Fetched ${id}` })); });
  assert.deepEqual(asked, ['id-5', 'id-9']);
  assert.deepEqual(list.map(p => p.productId), ['id-5', 'id-0', 'id-9', 'id-1']);
  assert.ok(list.every(p => p.favourite));
  assert.equal(list.complete, true);
  assert.equal(list.warning, null);
});

test('if the details lookup fails, keep what the page had and say so', async () => {
  const list = await readFavourites(page({ ids: range(0, 10), detailed: range(0, 4) }), extractProductEntities, async () => { throw new Error('bot check'); });
  assert.equal(list.length, 4);
  assert.equal(list.complete, false, 'so nothing gets dropped as "removed on Ocado"');
  assert.match(list.warning, /Only read 4 .*bot check/);
});

test('without an id list, falls back to the products marked as favourites', () => {
  const r = favouritesFromHtml(page({ ids: [], detailed: range(0, 6), tiles: 2, groups: false }), extractProductEntities);
  assert.equal(r.products.length, 6);
  assert.deepEqual(r.missing, []);
});

test('reads the product-info API\'s shape: prices, pence, price cuts, badges', async () => {
  const { normaliseEntity } = await import('../server/ocado/normalise.js');
  const cut = normaliseEntity({
    productId: 'k', name: 'Tissues', packSizeDescription: '48 per pack',
    price: { amount: '1.00', currency: 'GBP' }, promoPrice: { amount: '0.75', currency: 'GBP' },
    unitPrice: { price: { amount: '2.1', currency: 'GBX' }, unit: 'fop.price.per.each' },
    promoUnitPrice: { price: { amount: '1.6', currency: 'GBX' }, unit: 'fop.price.per.each' },
    promotions: [{ retailerPromotionId: '1', description: 'Now 75p, was £1' }],
  });
  assert.deepEqual([cut.price, cut.wasPrice, cut.unitPrice, cut.unitLabel, cut.size], [0.75, 1, 0.016, 'each', '48 per pack']);
  assert.deepEqual(cut.offers.map(o => o.description), ['Now 75p, was £1']);

  const multi = normaliseEntity({
    productId: 'b', name: 'Beans', price: { amount: '1.20', currency: 'GBP' }, promoPrice: { amount: '1.00', currency: 'GBP' },
    promotions: [{ description: 'Any 2 for £2' }], iconAttributes: [{ label: 'Organic', file: 'organic' }],
  });
  assert.equal(multi.price, 1.2, 'a multi-buy is not a price cut');
  assert.equal(multi.wasPrice, null);
  assert.equal(multi.organic, true);
});
