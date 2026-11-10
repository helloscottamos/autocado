// A friendly address on the home network: http://autocado.local
//
// Phones, tablets and computers look up ".local" names by asking the whole
// network (multicast DNS, the thing Apple calls Bonjour). Autocado answers when
// something asks for autocado.local, giving this computer's address. No router
// setup is needed, and it keeps working when the router hands out a new address.
import os from 'node:os';
import makeMdns from 'multicast-dns';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const toInt = ip => ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
const isV4 = a => a && (a.family === 'IPv4' || a.family === 4);

/** This computer's own network addresses (IPv4, not loopback). */
export function ownAddresses(interfaces = os.networkInterfaces()) {
  return Object.values(interfaces).flat().filter(a => isV4(a) && !a.internal);
}

/** The address of ours that `peer` can reach: the one on its network, else our first. */
export function addressFor(peer, interfaces = os.networkInterfaces()) {
  const mine = ownAddresses(interfaces);
  if (peer && IPV4.test(peer)) {
    const p = toInt(peer);
    const same = mine.find(a => a.netmask && ((toInt(a.address) ^ p) & toInt(a.netmask)) === 0);
    if (same) return same.address;
  }
  return mine[0]?.address ?? null;
}

/** AUTOCADO_NAME → a valid .local name ("Our Kitchen" → "our-kitchen"), or null to switch it off. */
export function cleanName(raw) {
  if (raw == null || raw === '') return 'autocado';
  if (/^(0|off|false|no|none)$/i.test(raw.trim())) return null;
  const name = raw.trim().toLowerCase().replace(/\.local\.?$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return name || 'autocado';
}

/**
 * Answer lookups for `<name>.local` until stopped. Checks first whether
 * something else on the network already answers to that name; if so it
 * leaves it alone and calls onTaken with that device's address.
 */
export function advertiseName(name, { onReady = () => {}, onTaken = () => {}, onError = () => {} } = {}) {
  const host = `${name}.local`;
  let mdns;
  try {
    mdns = makeMdns(); // shares port 5353 with the computer's own Bonjour/Avahi
  } catch (e) {
    onError(e);
    return { host, stop() {} };
  }
  let answering = false;
  let stopped = false;
  let refresh;

  const isOurs = q => q.name.toLowerCase() === host && ['A', 'AAAA', 'ANY'].includes(q.type);

  mdns.on('response', (res, rinfo) => {
    if (answering || stopped) return;
    const a = [...res.answers, ...res.additionals].find(r => r.type === 'A' && r.name.toLowerCase() === host);
    if (!a) return;
    stopped = true;
    // The computer itself may already be called this (its own Bonjour name). That's fine.
    const ours = ownAddresses().some(x => x.address === a.data || x.address === rinfo.address);
    if (ours) onReady({ host, already: true }); else onTaken(a.data || rinfo.address);
    stop();
  });

  mdns.on('query', (query, rinfo) => {
    if (!answering || !query.questions.some(isOurs)) return;
    const ip = addressFor(rinfo.address);
    if (!ip) return;
    mdns.respond({
      answers: [{ name: host, type: 'A', ttl: 120, flush: true, data: ip }],
      // "There's no IPv6 address": stops phones and Macs waiting for one.
      additionals: [{ name: host, type: 'NSEC', ttl: 120, flush: true, data: { nextDomain: host, rrtypes: ['A'] } }],
    }, e => { if (e) onError(e); });
  });

  mdns.on('error', e => onError(e));
  mdns.on('warning', () => {}); // an interface that can't join multicast; others still work

  // Ask once and give anything already using the name a moment to reply.
  mdns.query([{ name: host, type: 'A' }]);
  const probe = setTimeout(() => {
    if (stopped) return;
    answering = true;
    onReady({ host, already: false });
    // Pick up Wi-Fi reconnects and new networks.
    refresh = setInterval(() => { try { mdns.update(); } catch { /* try again next time */ } }, 60_000);
    refresh.unref();
  }, 1500);
  probe.unref();

  function stop() {
    stopped = true;
    clearTimeout(probe);
    clearInterval(refresh);
    try { mdns.destroy(); } catch { /* already closed */ }
  }
  return { host, stop };
}
