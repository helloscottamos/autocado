import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressFor, cleanName, ownAddresses } from '../server/lan-name.js';

const IFACES = {
  lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
  en0: [
    { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false },
    { address: '192.168.1.158', netmask: '255.255.255.0', family: 'IPv4', internal: false },
  ],
  utun3: [{ address: '100.101.102.103', netmask: '255.192.0.0', family: 'IPv4', internal: false }],
};

test('answers with the address on the asking device\'s network', () => {
  assert.equal(addressFor('192.168.1.42', IFACES), '192.168.1.158');
  assert.equal(addressFor('100.64.0.9', IFACES), '100.101.102.103');
  assert.equal(addressFor('10.0.0.5', IFACES), '192.168.1.158', 'unknown network: first address');
  assert.equal(addressFor(undefined, IFACES), '192.168.1.158');
  assert.equal(addressFor('192.168.1.42', { lo0: IFACES.lo0 }), null, 'no network at all');
  assert.deepEqual(ownAddresses(IFACES).map(a => a.address), ['192.168.1.158', '100.101.102.103']);
});

test('AUTOCADO_NAME becomes a valid .local name', () => {
  assert.equal(cleanName(undefined), 'autocado');
  assert.equal(cleanName(''), 'autocado');
  assert.equal(cleanName('Our Kitchen'), 'our-kitchen');
  assert.equal(cleanName('shopping.local'), 'shopping');
  assert.equal(cleanName('off'), null);
  assert.equal(cleanName('0'), null);
  assert.equal(cleanName('!!!'), 'autocado');
});
