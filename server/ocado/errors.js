// One error type for everything Ocado-related, with a code the UI can act on.
export class OcadoError extends Error {
  /**
   * @param {'NOT_CONNECTED'|'SESSION_EXPIRED'|'BLOCKED'|'NETWORK'|'LOGIN_FAILED'|'UNKNOWN'} code
   */
  constructor(code, message) {
    super(message);
    this.name = 'OcadoError';
    this.code = code;
  }
  get needsReconnect() {
    return this.code === 'NOT_CONNECTED' || this.code === 'SESSION_EXPIRED' || this.code === 'BLOCKED';
  }
}

export function classifyError(e) {
  if (e instanceof OcadoError) return e;
  const status = e?.response?.status;
  const msg = String(e?.message || e);
  if (status === 401 || status === 403 || /session expired|logged out|No CSRF token|HTTP 40[13]\b/i.test(msg)) {
    return new OcadoError('SESSION_EXPIRED', 'Your Ocado session has expired. Reconnect in Settings.');
  }
  if (status === 202 || /WAF|challenge/i.test(msg)) {
    return new OcadoError('BLOCKED', 'Ocado asked for a bot check. Reconnect in Settings to refresh the session.');
  }
  if (['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'].includes(e?.code) || /timeout|network/i.test(msg)) {
    return new OcadoError('NETWORK', 'Could not reach Ocado — check the internet connection.');
  }
  return new OcadoError('UNKNOWN', `Ocado error${status ? ` (HTTP ${status})` : ''}: ${msg}`);
}
