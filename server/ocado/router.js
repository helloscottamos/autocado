// Picks how to reach Ocado: through the Firefox add-on when it's running
// (robust: your real browser handles Ocado's bot check), otherwise with
// Autocado's own saved sign-in (works, but Ocado's bot check goes stale).
const METHODS = ['status', 'search', 'favourites', 'products', 'setFavourite', 'trolley', 'addToTrolley', 'setTrolleyQuantity', 'clearTrolley'];

export class OcadoRouter {
  constructor(serverOcado, bridgeOcado, bridge) {
    this.server = serverOcado;
    this.firefox = bridgeOcado;
    this.bridge = bridge;
    this.mock = false;
    for (const m of METHODS) this[m] = (...args) => this.active[m](...args);
  }

  get active() { return this.bridge.online ? this.firefox : this.server; }
  get via() { return this.bridge.online ? 'firefox' : 'server'; }

  hasSession() { return this.bridge.online || this.server.hasSession(); }

  // Sign-in management only applies to Autocado's own session.
  reload() { this.server.reload(); }
  saveCookies(...a) { return this.server.saveCookies(...a); }
  importCookies(...a) { return this.server.importCookies(...a); }
  logout() { return this.server.logout(); }
}
