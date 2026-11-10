// Fetch helpers + a live state hook (server pushes "state changed" over SSE,
// every open screen — phone, laptop, kitchen mirror — refetches).
import { useEffect, useState, useCallback, useRef } from 'preact/hooks';

export class ApiError extends Error {
  constructor(message, { status, code, reconnect } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.reconnect = reconnect;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the Autocado server. Is it running?', { code: 'OFFLINE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, { status: res.status, ...data });
  return data;
}

export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const del = path => api(path, { method: 'DELETE' });

export function useLiveState() {
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(true);
  const [progress, setProgress] = useState({});
  const [login, setLogin] = useState(null);
  const [trolley, setTrolley] = useState(undefined); // undefined = not loaded yet, null = unknown/not connected
  const pending = useRef(null);

  const refresh = useCallback(async () => {
    if (pending.current) return pending.current;
    pending.current = api('/api/state')
      .then(s => {
        setState(s); setOnline(true); setProgress(s.env.progress || {}); setLogin(s.env.login);
        setTrolley(prev => (prev === undefined || (s.trolley && (!prev || s.trolley.fetchedAt > prev.fetchedAt)) ? s.trolley : prev));
      })
      .catch(() => setOnline(false))
      .finally(() => { pending.current = null; });
    return pending.current;
  }, []);

  useEffect(() => {
    refresh();
    let es;
    let retry;
    const connect = () => {
      es = new EventSource('/api/events');
      es.addEventListener('hello', () => { setOnline(true); refresh(); });
      es.addEventListener('state', () => refresh());
      es.addEventListener('progress', e => {
        const { job, ...p } = JSON.parse(e.data);
        setProgress(prev => ({ ...prev, [job]: p.total !== undefined || p.message ? p : null }));
      });
      es.addEventListener('login', e => setLogin(JSON.parse(e.data)));
      es.addEventListener('trolley', e => setTrolley(JSON.parse(e.data)));
      es.onerror = () => { setOnline(false); es.close(); retry = setTimeout(connect, 3000); };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, [refresh]);

  return { state, online, progress, login, trolley, refresh };
}

/** Shrink a photo in the browser before upload (phones take 12MP images). */
export async function photoToBase64(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
