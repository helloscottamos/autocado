import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredientLine, itemKey, parseSize, suggestPacks, isPantry } from '../server/ingredients.js';

const p = l => { const r = parseIngredientLine(l); return [r.item, r.quantity, r.unit]; };

test('parses common ingredient lines', () => {
  assert.deepEqual(p('2 tbsp extra virgin olive oil'), ['extra virgin olive oil', 2, 'tbsp']);
  assert.deepEqual(p('400g tin chopped tomatoes'), ['chopped tomatoes', 400, 'g']);
  assert.deepEqual(p('3 red onions, finely sliced'), ['red onions', 3, null]);
  assert.deepEqual(p('2 x 400g tins chickpeas'), ['chickpeas', 800, 'g']);
  assert.deepEqual(p('4 cloves garlic'), ['garlic', 4, 'clove']);
  assert.deepEqual(p('½ tsp chilli flakes'), ['chilli flakes', 0.5, 'tsp']);
  assert.deepEqual(p('1 1/2 cups rice'), ['rice', 1.5, 'cup']);
  assert.deepEqual(p('2 tins of coconut milk'), ['coconut milk', 2, 'tin']);
  assert.deepEqual(p('salt'), ['salt', null, null]);
  assert.deepEqual(p('- 1 lemon'), ['lemon', 1, null]);
  assert.equal(parseIngredientLine('parmesan, to serve').note, 'to serve');
});

test('item keys merge plurals and case', () => {
  assert.equal(itemKey('Onions'), itemKey('onion'));
  assert.equal(itemKey('Tomatoes'), 'tomato');
  assert.equal(itemKey('cherries'), 'cherry');
  assert.equal(itemKey('asparagus'), 'asparagus');
  assert.equal(itemKey('hummus'), 'hummus');
  assert.equal(itemKey('Chickpeas (drained)'), 'chickpea');
});

test('pantry staples are recognised', () => {
  assert.equal(isPantry('salt'), true);
  assert.equal(isPantry('olive oil'), true);
  assert.equal(isPantry('ground cumin'), true);
  assert.equal(isPantry('chicken thighs'), false);
});

test('pack sizes and pack counts', () => {
  assert.deepEqual(parseSize('500g'), { base: 'g', amount: 500 });
  assert.deepEqual(parseSize('1.136L'), { base: 'ml', amount: 1136 });
  assert.deepEqual(parseSize('2 x 120g'), { base: 'g', amount: 240 });
  assert.deepEqual(parseSize('6 per pack'), { base: 'count', amount: 6 });
  assert.equal(suggestPacks([{ quantity: 800, unit: 'g' }], '400g'), 2);
  assert.equal(suggestPacks([{ quantity: 400, unit: 'g' }, { quantity: 450, unit: 'g' }], '400g'), 3);
  assert.equal(suggestPacks([{ quantity: 3, unit: null }], '3 per pack'), 1);
  assert.equal(suggestPacks([{ quantity: 4, unit: null }], '3 per pack'), 2);
  assert.equal(suggestPacks([{ quantity: 2, unit: 'tbsp' }], '500ml'), 1, 'incomparable units fall back to 1');
  assert.equal(suggestPacks([{ quantity: 1, unit: 'kg' }], '500g'), 2);
});
