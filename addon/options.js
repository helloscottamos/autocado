'use strict';
const input = document.getElementById('server');
const msg = document.getElementById('msg');

browser.storage.local.get('server').then(({ server }) => { input.value = server || 'http://localhost:3456'; });

document.getElementById('save').addEventListener('click', async () => {
  msg.textContent = '';
  let url;
  try {
    url = new URL(input.value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    msg.textContent = 'That is not a valid http(s) address.';
    return;
  }
  const origin = url.origin;
  const builtIn = ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
  if (!builtIn) {
    // Any other address needs permission to talk to it.
    const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) { msg.textContent = 'Permission was not granted, so the address was not saved.'; return; }
  }
  await browser.storage.local.set({ server: origin });
  input.value = origin;
  msg.textContent = 'Saved ✓';
});
