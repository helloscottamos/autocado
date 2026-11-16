import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the store away from the real data/ folder.
process.env.AUTOCADO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autocado-test-'));
const { emptyState } = await import('../server/store.js');
const weeks = await import('../server/weeks.js');

function planned() {
  const s = emptyState();
  s.recipes = [
    { id: 'a', name: 'Curry', servings: 4, ingredients: [] },
    { id: 'b', name: 'Bolognese', servings: 4, ingredients: [] },
    { id: 'c', name: 'Salmon', servings: 2, ingredients: [] },
  ];
  s.plan.selected = { a: true, b: true };
  s.plan.servings = { b: 6 };
  s.checks = { salt: 'have' };
  s.required = [{ id: 'r1', item: 'bin bags' }];
  return s;
}

const line = (item, productId, packs = 1, price = 1) => ({ item, name: `Ocado ${item}`, productId, packs, price });

test('a send opens a shop in the current week, and later sends join it', () => {
  const s = planned();
  assert.equal(weeks.weekStatus(s), 'planning');
  weeks.recordSend(s, { kind: 'topup', lines: [line('milk', 'p1', 1, 1.5)] });
  weeks.recordSend(s, { kind: 'weekly', lines: [line('onions', 'p2', 2, 1), line('milk', 'p1', 2, 1.5)] });
  const shop = weeks.openShop(s);
  assert.equal(weeks.weekStatus(s), 'in-trolley');
  assert.equal(s.currentWeek.shops.length, 1, 'one trolley, one order');
  assert.equal(shop.kind, 'weekly', 'a weekly send makes it the weekly shop');
  assert.equal(shop.items.length, 2);
  assert.equal(shop.items.find(i => i.productId === 'p1').packs, 2, 'topping up, not doubling');
  assert.equal(shop.estimate, 5);
});

test('ordering the weekly shop files the week and starts a fresh one', () => {
  const s = planned();
  const weekId = s.currentWeek.id;
  weeks.recordSend(s, { kind: 'weekly', lines: [line('onions', 'p2')] });
  const r = weeks.markOrdered(s, { how: 'detected', trolley: { count: 12, total: 48.2 }, at: '2026-11-14T10:00:00.000Z' });
  assert.equal(r.closedWeek, true);
  assert.equal(s.pastWeeks.length, 1);
  const past = s.pastWeeks[0];
  assert.equal(past.id, weekId);
  assert.equal(past.orderedAt, '2026-11-14T10:00:00.000Z');
  assert.deepEqual(past.recipes.map(x => [x.name, x.servings]), [['Curry', 4], ['Bolognese', 6]]);
  assert.equal(past.shops[0].status, 'ordered');
  assert.deepEqual(past.shops[0].trolley, { count: 12, total: 48.2 });
  assert.notEqual(s.currentWeek.id, weekId);
  assert.deepEqual(s.plan.selected, {}, 'recipes unticked');
  assert.deepEqual(s.checks, {}, 'cupboard answers cleared');
  assert.equal(s.required.length, 1, 'the Needed list carries over');
  assert.equal(weeks.weekStatus(s), 'planning');
});

test('a top-up order is logged without closing the week', () => {
  const s = planned();
  weeks.recordSend(s, { kind: 'topup', lines: [line('milk', 'p1')] });
  const r = weeks.markOrdered(s, {});
  assert.equal(r.closedWeek, false);
  assert.equal(s.pastWeeks.length, 0);
  assert.equal(s.currentWeek.shops[0].status, 'ordered');
  assert.deepEqual(s.plan.selected, { a: true, b: true }, 'plan untouched');
});

test('marking ordered with nothing sent records an order Autocado did not fill', () => {
  const s = planned();
  const r = weeks.markOrdered(s, {});
  assert.equal(r.closedWeek, true, 'recipes were chosen, so it was the weekly shop');
  assert.equal(s.pastWeeks[0].shops.length, 1);
});

test('undo puts the week back while the new week is untouched', () => {
  const s = planned();
  weeks.recordSend(s, { kind: 'weekly', lines: [line('onions', 'p2')] });
  const weekId = s.currentWeek.id;
  weeks.markOrdered(s, {});
  assert.equal(weeks.canUndoOrdered(s), true);
  assert.equal(weeks.undoOrdered(s), true);
  assert.equal(s.currentWeek.id, weekId);
  assert.equal(s.pastWeeks.length, 0);
  assert.deepEqual(s.plan.selected, { a: true, b: true });
  assert.deepEqual(s.checks, { salt: 'have' });
  assert.equal(weeks.openShop(s)?.status, 'in-trolley');
  assert.equal(s.lastOrdered, null);
});

test('undo is refused once the new week has started', () => {
  const s = planned();
  weeks.markOrdered(s, {});
  s.plan.selected = { c: true };
  assert.equal(weeks.canUndoOrdered(s), false);
  assert.equal(weeks.undoOrdered(s), false);
});

test('"No, I emptied it" closes the waiting shop without ordering', () => {
  const s = planned();
  weeks.recordSend(s, { kind: 'weekly', lines: [line('onions', 'p2')] });
  s.orderCheck = { at: 'x' };
  weeks.markNotOrdered(s);
  assert.equal(weeks.openShop(s), null);
  assert.equal(s.currentWeek.shops[0].status, 'cleared');
  assert.equal(s.orderCheck, null);
  assert.equal(s.pastWeeks.length, 0);
});

test('an empty trolley only looks like a checkout when a shop was waiting', () => {
  const s = planned();
  const empty = { items: [], count: 0 };
  const now = Date.now();
  assert.equal(weeks.looksCheckedOut(s, empty, { now }), false, 'nothing sent yet');
  weeks.recordSend(s, { kind: 'weekly', lines: [line('onions', 'p2')] });
  assert.equal(weeks.looksCheckedOut(s, { items: [{ productId: 'p2', quantity: 1 }] }, { now }), false, 'still full');
  assert.equal(weeks.looksCheckedOut(s, empty, { now, ownEmptyAt: now - 30_000 }), false, 'Autocado emptied it');
  assert.equal(weeks.looksCheckedOut(s, empty, { now, ownEmptyAt: now - 10 * 60_000 }), true);
  s.orderCheck = { at: 'x' };
  assert.equal(weeks.looksCheckedOut(s, empty, { now }), false, 'already asked');
});

test('shopping a past week again ticks its recipes and servings', () => {
  const s = planned();
  weeks.markOrdered(s, {});
  s.recipes = s.recipes.filter(r => r.id !== 'a'); // deleted since
  s.plan.selected = { c: true };
  const r = weeks.repeatWeek(s, s.pastWeeks[0].id);
  assert.deepEqual(r, { ticked: 1, missing: 1 });
  assert.deepEqual(s.plan.selected, { b: true });
  assert.deepEqual(s.plan.servings, { b: 6 });
  assert.equal(weeks.repeatWeek(s, 'nope'), null);
});

test('lastHad gives the most recent week each recipe was in', () => {
  const s = planned();
  weeks.markOrdered(s, { at: '2026-11-01T10:00:00.000Z' });
  s.plan.selected = { a: true };
  weeks.markOrdered(s, { at: '2026-11-08T10:00:00.000Z' });
  assert.deepEqual(weeks.lastHad(s), { a: '2026-11-08T10:00:00.000Z', b: '2026-11-01T10:00:00.000Z' });
});

test('older data gets a week, with recent sends as a shop waiting for checkout', () => {
  const now = Date.parse('2026-11-14T12:00:00.000Z');
  const s = planned();
  delete s.currentWeek;
  s.history = [
    { at: '2026-11-13T20:00:00.000Z', mode: 'topup', lines: [{ item: 'milk', name: 'Milk', productId: 'p1', packs: 1, status: 'sent' }] },
    { at: '2026-11-12T20:00:00.000Z', mode: 'topup', lines: [{ item: 'eggs', name: 'Eggs', productId: 'p3', packs: 1, status: 'sent' }, { item: 'x', productId: 'p9', status: 'failed' }] },
    { at: '2026-10-01T20:00:00.000Z', mode: 'weekly', lines: [{ item: 'old', productId: 'p8', packs: 1, status: 'sent' }] },
  ];
  assert.equal(weeks.migrate(s, { now }), true);
  const shop = weeks.openShop(s);
  assert.equal(shop.kind, 'topup');
  assert.deepEqual(shop.items.map(i => i.item), ['eggs', 'milk']);
  assert.equal(weeks.migrate(s, { now }), false, 'only once');
});
