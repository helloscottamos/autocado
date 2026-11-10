import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the store away from the real data/ folder.
process.env.AUTOCADO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autocado-test-'));
const { emptyState } = await import('../server/store.js');
const { buildList, buildDraft, relevance } = await import('../server/shopping.js');
const { MockOcado } = await import('../server/ocado/mock.js');
const { normaliseEntity, normaliseOffers, isDeal } = await import('../server/ocado/normalise.js');

function stateWith() {
  const s = emptyState();
  s.recipes = [
    { id: 'a', name: 'Curry', servings: 4, ingredients: [
      { item: 'brown onions', quantity: 2, unit: null }, { item: 'chopped tomatoes', quantity: 400, unit: 'g' },
      { item: 'salt', quantity: null, unit: null, pantry: true },
    ] },
    { id: 'b', name: 'Bolognese', servings: 4, ingredients: [
      { item: 'brown onion', quantity: 1, unit: null }, { item: 'chopped tomatoes', quantity: 800, unit: 'g' },
    ] },
    { id: 'c', name: 'Not this week', servings: 2, ingredients: [{ item: 'salmon fillets', quantity: 2, unit: null }] },
  ];
  s.plan.selected = { a: true, b: true };
  return s;
}

test('weekly list aggregates selected recipes and respects answers', () => {
  const s = stateWith();
  s.checks = { 'brown onion': 'have' };
  s.required = [{ id: 'r1', item: 'milk' }];
  const list = buildList(s, 'weekly');
  const byKey = Object.fromEntries(list.lines.map(l => [l.key, l]));
  assert.equal(byKey['chopped tomato'].needsText, '400g + 800g');
  assert.deepEqual(byKey['chopped tomato'].recipes, ['Curry', 'Bolognese']);
  assert.equal(byKey['brown onion'].include, false, 'answered "have"');
  assert.equal(byKey.salt.include, false, 'pantry defaults to have');
  assert.equal(byKey.milk.include, true, 'needed items always included');
  assert.equal(byKey['salmon fillet'], undefined, 'unselected recipe ignored');
});

test('servings override scales quantities', () => {
  const s = stateWith();
  s.plan.selected = { a: true };
  s.plan.servings = { a: 8 };
  const line = buildList(s, 'weekly').lines.find(l => l.key === 'chopped tomato');
  assert.equal(line.needsText, '800g');
});

test('top-up list only has needed items', () => {
  const s = stateWith();
  s.required = [{ id: 'r1', item: 'bananas' }];
  const list = buildList(s, 'topup');
  assert.deepEqual(list.lines.map(l => l.key), ['banana']);
});

test('relevance ignores descriptors but needs the core word', () => {
  assert.equal(relevance('chopped tomatoes', 'Ocado Organic Chopped Tomatoes'), 1);
  assert.equal(relevance('fresh ginger', 'Ocado Organic Fresh Ginger'), 1);
  assert.ok(relevance('brown onions', 'Ocado Organic Red Onions') < 1);
});

test('draft prefers organic, then remembers choices and favourites', async () => {
  const ocado = new MockOcado();
  const s = stateWith();
  s.recipes[0].ingredients.push({ item: 'avocados', quantity: 2, unit: null });
  let draft = await buildDraft(ocado, s, 'weekly');
  const line = k => draft.lines.find(l => l.key === k);
  assert.equal(line('brown onion').product.name, 'Ocado Organic Brown Onions');
  assert.equal(line('brown onion').reason, 'Organic');
  assert.equal(line('chopped tomato').product.organic, true);
  assert.equal(line('chopped tomato').packs, 3, '1200g of 400g tins');
  // Organic avocados are out of stock in the mock → falls back to non-organic.
  assert.equal(line('avocado').product.name, 'Ocado Ripe Avocados');
  assert.equal(line('avocado').reason, 'No organic option found');

  // A remembered choice wins next time.
  s.productChoices['brown onion'] = { productId: 'mock-1002', name: 'Ocado Brown Onions', available: true };
  draft = await buildDraft(ocado, s, 'weekly');
  assert.equal(line('brown onion').product.productId, 'mock-1002');
  assert.equal(line('brown onion').reason, 'Your usual');
});

test('organic preference can be switched off', async () => {
  const s = stateWith();
  s.settings.preferOrganic = false;
  const draft = await buildDraft(new MockOcado(), s, 'weekly');
  assert.notEqual(draft.lines.find(l => l.key === 'brown onion').reason, 'Organic');
});

test('normalises live Ocado entity shape (offers, organic badge, image)', () => {
  const e = {
    productId: 'u1', retailerProductId: '30567011', name: 'Yeo Valley Organic Fresh Whole Milk', brand: 'Yeo Valley', available: true,
    price: { current: { amount: '3.15', currency: 'GBP' }, unit: { label: 'fop.price.per.litre', current: { amount: '1.58' } } },
    size: { value: '2L' }, image: { src: 'https://www.ocado.com/images-v3/x/300x300.jpg' },
    attributes: [{ icon: 'organic', label: 'Organic' }],
    offers: [{ id: 'o1', description: 'Buy any 2 for £4.50', requiredProductQuantity: 2 }],
    offer: { id: 'o1', description: 'Buy any 2 for £4.50' },
  };
  const p = normaliseEntity(e);
  assert.equal(p.price, 3.15);
  assert.equal(p.unitLabel, 'litre');
  assert.equal(p.organic, true);
  assert.equal(p.image, 'https://www.ocado.com/images-v3/x/300x300.jpg');
  assert.deepEqual(p.offers.map(o => o.description), ['Buy any 2 for £4.50']);
  assert.equal(p.url, 'https://www.ocado.com/products/30567011');
  assert.deepEqual(normaliseOffers({ price: { current: { amount: '1.70' }, original: { amount: '2.25' } } }).map(o => o.description), ['Now £1.70, was £2.25']);
});

test('standing price labels are not counted as deals', () => {
  assert.equal(isDeal('Everyday Savers'), false);
  assert.equal(isDeal('Ocado Price Promise'), false);
  for (const d of ['Buy any 2 for £4.50', 'Now £7, was £8.30', 'Half price', '25% off', 'Buy 1, add 2nd Half Price.', '3 for 2']) {
    assert.equal(isDeal(d), true, d);
  }
  const p = normaliseEntity({ productId: 'x', name: 'Ocado Parmigiano Reggiano', offers: [{ id: 'l', description: 'Everyday Savers' }] });
  assert.deepEqual(p.offers, []);
  assert.deepEqual(p.labels, ['Everyday Savers']);
});

test('sending tops the trolley up instead of doubling it', async () => {
  const { planTrolleyAdds } = await import('../server/shopping.js');
  const milk = { productId: 'milk', name: 'Milk' };
  const eggs = { productId: 'eggs', name: 'Eggs' };
  const lines = [
    { key: 'milk', product: milk, packs: 2 },
    { key: 'whole milk', product: milk, packs: 1 },   // same product from another line → summed
    { key: 'egg', product: eggs, packs: 1 },
    { key: 'rice', product: { productId: 'rice' }, packs: 0 }, // set to 0 → ignored
    { key: 'parmesan', product: null, packs: 1 },             // unmatched → ignored
  ];
  const byId = plan => Object.fromEntries(plan.map(p => [p.productId, p]));

  let plan = byId(planTrolleyAdds(lines, []));
  assert.equal(plan.milk.add, 3);
  assert.deepEqual(plan.milk.keys, ['milk', 'whole milk']);
  assert.equal(plan.eggs.add, 1);
  assert.equal(plan.rice, undefined);

  // Second send of the same list, or the items were already there: nothing doubles.
  plan = byId(planTrolleyAdds(lines, [{ productId: 'milk', quantity: 3 }, { productId: 'eggs', quantity: 2 }]));
  assert.equal(plan.milk.add, 0);
  assert.equal(plan.eggs.add, 0);
  assert.equal(plan.eggs.already, 2);

  // Partly there: only the difference is added.
  plan = byId(planTrolleyAdds(lines, [{ productId: 'milk', quantity: 1 }]));
  assert.equal(plan.milk.add, 2);
});

test('usual products and exact favourites need no Ocado search', async () => {
  const ocado = new MockOcado();
  let searches = 0;
  const realSearch = ocado.search.bind(ocado);
  ocado.search = (...a) => { searches++; return realSearch(...a); };
  const s = stateWith();
  s.productChoices['brown onion'] = { productId: 'mock-1002', name: 'Ocado Brown Onions', available: true, size: '1kg' };
  s.favourites['mock-1013'] = { productId: 'mock-1013', name: 'Ocado Organic Chopped Tomatoes', item: 'chopped tomato', available: true, size: '400g' };
  const draft = await buildDraft(ocado, s, 'weekly');
  assert.equal(searches, 0, 'nothing searched');
  assert.equal(draft.lines.find(l => l.key === 'brown onion').reason, 'Your usual');
  assert.equal(draft.lines.find(l => l.key === 'chopped tomato').reason, 'Favourite');
  assert.equal(draft.lines.find(l => l.key === 'chopped tomato').packs, 3);
});

test('a bot-check refusal stops searching but keeps what matched', async () => {
  const { OcadoError } = await import('../server/ocado/errors.js');
  const ocado = new MockOcado();
  let searches = 0;
  ocado.search = async () => { searches++; throw new OcadoError('BLOCKED', 'bot check'); };
  const s = stateWith();
  s.productChoices['brown onion'] = { productId: 'mock-1002', name: 'Ocado Brown Onions', available: true };
  const draft = await buildDraft(ocado, s, 'weekly');
  assert.ok(searches <= 2, `stopped after the first refusal (searched ${searches}x)`);
  assert.equal(draft.lines.find(l => l.key === 'brown onion').product.productId, 'mock-1002');
  assert.equal(draft.lines.find(l => l.key === 'chopped tomato').product, null);
  assert.match(draft.warning, /bot check/);
});
