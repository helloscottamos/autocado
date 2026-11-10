'use strict';
const $ = id => document.getElementById(id);

function mark(id, cls, detail) {
  const li = $(id);
  li.className = cls;
  li.querySelector('.detail').textContent = detail || '';
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

async function refresh() {
  const st = await browser.runtime.sendMessage({ type: 'autocado:status' });
  mark('server', st.connected ? 'ok' : 'bad', st.connected ? st.server.replace(/^https?:\/\//, '') : 'not reachable');
  mark('ocado', st.ocadoTabs ? 'ok' : 'warn', st.ocadoTabs ? 'open' : 'opens when needed');
  mark('signin', st.signedIn === true ? 'ok' : st.signedIn === false ? 'bad' : '', st.signedIn === true ? 'yes' : st.signedIn === false ? 'no' : 'unknown');
  let hint = '';
  if (!st.connected) hint = st.lastError || `Can't reach Autocado at ${st.server}. Is it running?`;
  else if (st.signedIn === false) hint = 'Sign in on ocado.com in this Firefox so Autocado can fill your trolley.';
  else if (st.connected) hint = 'All set. Autocado sends its Ocado requests through this Firefox.';
  $('hint').textContent = hint;
  $('last').textContent = st.lastRequest
    ? `Last request ${ago(st.lastRequest.at)}: ${st.lastRequest.path} → ${st.lastRequest.error || st.lastRequest.status}`
    : (st.handled ? '' : 'No requests from Autocado yet.');
}

$('open').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'autocado:openOcado' }); window.close(); });
$('settings').addEventListener('click', () => { browser.runtime.openOptionsPage(); window.close(); });
refresh();
setInterval(refresh, 2000);
