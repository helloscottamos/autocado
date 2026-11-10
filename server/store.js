// Tiny JSON-file store. The whole household state is small (recipes, a few
// hundred product choices), so one file with atomic writes is simpler and
// more portable than a database — copy data/ to move the app to a Pi.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.AUTOCADO_DATA_DIR
  ? path.resolve(process.env.AUTOCADO_DATA_DIR)
  : path.resolve(import.meta.dirname, '..', 'data');

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');

export const newId = () => crypto.randomUUID().slice(0, 8);

export function emptyState() {
  return {
    version: 0,
    settings: { preferOrganic: true },
    recipes: [],
    plan: { selected: {}, servings: {} },
    checks: {},          // itemKey -> 'have' | 'need'  (the "do we have enough?" answers)
    required: [],        // things we've run out of / ad-hoc items to buy
    productChoices: {},  // itemKey -> remembered Ocado product
    favourites: {},      // productId -> product snapshot (+ offers)
    draft: null,         // the matched basket being reviewed before it's sent
    history: [],         // what was sent to the trolley, newest first
    ocado: { connected: false, lastError: null, checkedAt: null },
    dealsCheckedAt: null,
  };
}

function writeAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.state = this.#load();
    this.secrets = this.#loadSecrets();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // Merge onto defaults so new fields appear after upgrades.
      const base = emptyState();
      return { ...base, ...raw, settings: { ...base.settings, ...raw.settings }, plan: { ...base.plan, ...raw.plan } };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep a copy of an unreadable file rather than silently overwriting it.
        try { fs.copyFileSync(STATE_FILE, `${STATE_FILE}.corrupt-${Date.now()}`); } catch {}
        console.error('[store] could not read state, starting fresh:', e.message);
      }
      return emptyState();
    }
  }

  #loadSecrets() {
    try { return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch { return {}; }
  }

  get() { return this.state; }

  /** Mutate state inside fn, persist, and notify listeners (SSE clients). */
  update(fn) {
    const result = fn(this.state);
    this.state.version = (this.state.version || 0) + 1;
    writeAtomic(STATE_FILE, JSON.stringify(this.state, null, 2));
    this.emit('change', this.state.version);
    return result;
  }

  setSecret(key, value) {
    if (value === undefined || value === null || value === '') delete this.secrets[key];
    else this.secrets[key] = value;
    writeAtomic(SECRETS_FILE, JSON.stringify(this.secrets, null, 2), 0o600);
  }

  getSecret(key) { return this.secrets[key]; }

  /** Copy state.json to data/backups/ (returns the backup path, or null if there was nothing to back up). */
  backup() {
    if (!fs.existsSync(STATE_FILE)) return null;
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `state-${stamp}.json`);
    fs.copyFileSync(STATE_FILE, file);
    return file;
  }

  /** Back to an empty app, keeping only the Ocado connection status. */
  resetData() {
    this.update(s => {
      const fresh = emptyState();
      for (const k of Object.keys(s)) if (!(k in fresh)) delete s[k];
      for (const [k, v] of Object.entries(fresh)) if (k !== 'version' && k !== 'ocado') s[k] = v;
    });
  }
}

export const store = new Store();
