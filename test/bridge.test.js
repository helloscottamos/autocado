import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AUTOCADO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autocado-bridge-'));
const { Bridge, BridgeOcado } = await import('../server/ocado/bridge.js');
const { OcadoRouter } = await import('../server/ocado/router.js');
const { CART_URL, APPLY_QTY_URL, PRODUCTS_URL, CUSTOMER_URL } = await import('../server/ocado/cart.js');

/** A pretend add-on: answers each request the bridge hands out using `respond`. */
function fakeAddon(bridge, respond) {
  let stop = false;
  const seen = [];
  (async () => {
    while (!stop) {
      const cmds = await bridge.poll({ version: 'test', ocadoTab: true }, 50);
      for (const c of cmds) {
        seen.push(c);
        const r = await respond(c);
        bridge.result(c.id, r.error ? { ok: false, error: r.error } : { ok: true, status: r.status ?? 200, text: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}) });
      }
    }
  })();
  return { seen, stop: () => { stop = true; } };
}

const ENTITY = {
  productId: 'p1', retailerProductId: '111', name: 'Ocado Organic Carrots', available: true,
  price: { current: { amount: '0.95' } }, size: { value: '700g' }, attributes: [{ icon: 'organic' }],
};

test('requests fail fast when the add-on is not running', async () => {
  const bridge = new Bridge();
  assert.equal(bridge.online, false);
  await assert.rejects(bridge.request({ path: CUSTOMER_URL }), e => e.code === 'NOT_CONNECTED');
  bridge.close();
});

test('a request is handed to the add-on and its answer comes back', async () => {
  const bridge = new Bridge();
  const addon = fakeAddon(bridge, c => ({ status: 200, body: { echo: c.path } }));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(bridge.online, true);
  const r = await bridge.request({ path: CUSTOMER_URL });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { echo: CUSTOMER_URL });
  assert.equal(bridge.status().version, 'test');
  addon.stop(); bridge.close();
});

test('an unanswered request times out with a clear message', async () => {
  const bridge = new Bridge({ timeoutMs: 100 });
  bridge.lastSeen = Date.now(); // looks online, but nobody collects the work
  await assert.rejects(bridge.request({ path: CUSTOMER_URL }), e => e.code === 'NETWORK' && /did not answer/.test(e.message));
  assert.equal(bridge.queue.length, 0, 'timed-out work is dropped');
  bridge.close();
});

test('Ocado through the add-on: status, trolley, writes as deltas, search', async () => {
  const bridge = new Bridge();
  let qty = 2;
  const applied = [];
  const addon = fakeAddon(bridge, c => {
    if (c.path === CUSTOMER_URL) return { body: { customerId: 'c1' } };
    if (c.path === CART_URL) return { body: { items: qty ? [{ productId: 'p1', quantity: qty, totalPrices: { finalPrice: { amount: (qty * 0.95).toFixed(2) } } }] : [], totals: { subTotal: { amount: (qty * 0.95).toFixed(2) } } } };
    if (c.path === PRODUCTS_URL && c.method === 'PUT') return { body: { products: [ENTITY] } };
    if (c.path === APPLY_QTY_URL && c.method === 'POST') { applied.push(...c.body); for (const ch of c.body) qty += ch.quantity; return { body: {} }; }
    if (c.path.startsWith('/search')) {
      return { body: `<html><a href="/products/ocado-organic-carrots/111">x</a><script>{"productEntities":${JSON.stringify({ p1: ENTITY })}}</script>${' '.repeat(600)}</html>` };
    }
    return { status: 404, body: {} };
  });
  await new Promise(r => setTimeout(r, 10));
  const ocado = new BridgeOcado(bridge);

  assert.deepEqual(await ocado.status(), { connected: true });

  const t = await ocado.trolley();
  assert.equal(t.items.length, 1);
  assert.equal(t.items[0].name, 'Ocado Organic Carrots', 'name looked up through the add-on');
  assert.equal(t.items[0].quantity, 2);
  assert.equal(t.total, 1.9);

  await ocado.addToTrolley('p1', 3);
  assert.deepEqual(applied.at(-1), { productId: 'p1', quantity: 3 });
  await ocado.setTrolleyQuantity('p1', 1);           // 5 → 1
  assert.deepEqual(applied.at(-1), { productId: 'p1', quantity: -4 });
  await ocado.clearTrolley();
  assert.deepEqual(applied.at(-1), { productId: 'p1', quantity: -1 });
  assert.equal(qty, 0);

  const found = await ocado.search('carrots');
  assert.equal(found[0].name, 'Ocado Organic Carrots');
  assert.equal(found[0].organic, true);
  const searches = addon.seen.filter(c => c.path.startsWith('/search')).length;
  await ocado.search('carrots');
  assert.equal(addon.seen.filter(c => c.path.startsWith('/search')).length, searches, 'second search served from cache');

  addon.stop(); bridge.close();
});

test('signed out and bot-check answers become clear errors', async () => {
  const bridge = new Bridge();
  const addon = fakeAddon(bridge, c => (c.path === CUSTOMER_URL ? { status: 401, body: {} } : { status: 202, body: '' }));
  await new Promise(r => setTimeout(r, 10));
  const ocado = new BridgeOcado(bridge);
  const st = await ocado.status();
  assert.equal(st.connected, false);
  assert.match(st.reason, /Firefox/);
  await assert.rejects(ocado.trolley(), e => e.code === 'BLOCKED');
  addon.stop(); bridge.close();
});

test('the router uses Firefox when the add-on is running, else Autocado\'s own sign-in', async () => {
  const bridge = new Bridge();
  const server = { hasSession: () => true, status: async () => ({ connected: true, from: 'server' }), reload() {} };
  const firefox = { status: async () => ({ connected: true, from: 'firefox' }) };
  const router = new OcadoRouter(server, firefox, bridge);
  assert.equal(router.via, 'server');
  assert.equal((await router.status()).from, 'server');
  bridge.lastSeen = Date.now();
  assert.equal(router.via, 'firefox');
  assert.equal((await router.status()).from, 'firefox');
  bridge.close();
});
