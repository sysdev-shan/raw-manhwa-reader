// RAW sources: small JS files that run in a Web Worker with no direct network access.
// The only door out is host.fetchJson / host.fetchText, limited to the hosts the source declares.
// A source file defines `const source = { id, name, lang, version, hosts, popular, search, details, chapters, pages }`.
import { fetchText } from './net.js';
import { MangayomiSource } from './mangayomi.js';

const PRELUDE = `
const __post = self.postMessage.bind(self);
let __id = 0; const __pending = new Map();
const __req = (kind, url, opts) => new Promise((res, rej) => { const id = ++__id; __pending.set(id, { res, rej }); __post({ t: 'fetch', id, kind, url, opts: opts || {} }); });
self.host = Object.freeze({
  fetchJson: (url, opts) => __req('json', url, opts),
  fetchText: (url, opts) => __req('text', url, opts),
});
for (const k of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches','BroadcastChannel','SharedWorker','Worker']) {
  try { delete self[k]; } catch (e) {}
  try { self[k] = undefined; } catch (e) {}
}
`;
const TAIL = `
self.onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'fetchResult') {
    const p = __pending.get(m.id); __pending.delete(m.id); if (!p) return;
    m.error ? p.rej(new Error(m.error)) : p.res(m.value); return;
  }
  if (m.t === 'call') {
    try {
      const fn = source[m.method];
      if (typeof fn !== 'function') throw new Error('source has no ' + m.method + '()');
      __post({ t: 'result', id: m.id, value: await fn.apply(source, m.args || []) });
    } catch (err) { __post({ t: 'result', id: m.id, error: String((err && err.message) || err) }); }
  }
};
__post({ t: 'ready', meta: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(source).filter(([, v]) => typeof v !== 'function')))) });
`;

const hostOk = (url, hosts) => {
  let u; try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
};

export class Source {
  constructor(code) {
    this.pending = new Map(); this.n = 0; this.hosts = [];
    const url = URL.createObjectURL(new Blob([PRELUDE, code, TAIL], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.ready = new Promise((res, rej) => {
      this.worker.onerror = (e) => rej(new Error(e.message || 'source failed to load'));
      this.onReady = res;
    }).then((meta) => {
      if (!meta?.id || !meta?.name) throw new Error('source needs id and name');
      this.meta = meta; this.hosts = Array.isArray(meta.hosts) ? meta.hosts : []; return meta;
    });
    this.worker.onmessage = (e) => this.onMessage(e.data);
  }

  async onMessage(m) {
    if (m.t === 'ready') return this.onReady(m.meta);
    if (m.t === 'result') {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (p) { clearTimeout(p.timer); m.error ? p.rej(new Error(m.error)) : p.res(m.value); }
    } else if (m.t === 'fetch') {
      const reply = (o) => this.worker.postMessage({ t: 'fetchResult', id: m.id, ...o });
      try {
        if (!hostOk(m.url, this.hosts)) throw new Error(`Host not declared by this source: ${new URL(m.url).hostname}`);
        const r = await fetchText(m.url, m.opts.headers, { hosts: this.hosts });
        if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
        reply({ value: m.kind === 'json' ? JSON.parse(r.text) : r.text });
      } catch (err) { reply({ error: String(err.message || err) }); }
    }
  }

  async call(method, args = [], timeoutMs = 30000) {
    await this.ready;
    return new Promise((res, rej) => {
      const id = ++this.n;
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
      this.worker.postMessage({ t: 'call', id, method, args });
    });
  }
}

/* ---- registry: bundled + added by the user (kept in localStorage) ---- */
const BUNDLED = [
  { file: 'extensions/mangadex.js', kind: 'raw' },
  { file: 'extensions/webtoons.js', kind: 'mangayomi' },
  { file: 'extensions/qiscans.js', kind: 'mangayomi' },
  { file: 'extensions/thunderscans.js', kind: 'mangayomi' },
  { file: 'extensions/vortexscans.js', kind: 'mangayomi' },
  { file: 'extensions/elftoon.js', kind: 'mangayomi' },
  { file: 'extensions/asurascans.js', kind: 'mangayomi' },
  { file: 'extensions/comicklive.js', kind: 'mangayomi' },
];
const KEY = 'raw.sources';
const readAdded = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const writeAdded = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };

let loadedAll = null;
export function installed() {
  loadedAll ??= (async () => {
    const out = [];
    const codes = [];
    for (const b of BUNDLED) { try { codes.push({ code: await (await fetch(b.file)).text(), bundled: true, kind: b.kind }); } catch { /* missing file */ } }
    for (const a of readAdded()) codes.push({ code: a.code, bundled: false, kind: a.kind || 'raw' });
    await Promise.all(codes.map(async (c) => {
      try {
        const src = c.kind === 'mangayomi' ? new MangayomiSource(c.code) : new Source(c.code);
        await src.ready;
        out.push({ src, meta: src.meta, bundled: c.bundled, code: c.code });
      } catch { /* bad source: skip */ }
    }));
    out.sort((a, b) => Number(b.bundled) - Number(a.bundled) || a.meta.name.localeCompare(b.meta.name));
    return out;
  })();
  return loadedAll;
}

export async function addSourceCode(code) {
  const src = new Source(code);
  const meta = await Promise.race([src.ready, new Promise((_, r) => setTimeout(() => r(new Error('source did not start')), 5000))]);
  const list = readAdded().filter((a) => a.id !== meta.id);
  list.push({ id: meta.id, code });
  writeAdded(list);
  loadedAll = null;
  return meta;
}

// Install a Mangayomi-style JS source (class DefaultExtension extends MProvider).
export async function addMangayomiCode(code) {
  const src = new MangayomiSource(code);
  let meta;
  try { meta = await src.ready; } catch (err) { src.destroy(); throw err; }
  const list = readAdded().filter((a) => a.id !== meta.id);
  list.push({ id: meta.id, kind: 'mangayomi', code });
  writeAdded(list);
  src.destroy();
  loadedAll = null;
  return meta;
}

export const installedIds = () => new Set(readAdded().map((a) => a.id));

export function removeSource(id) { writeAdded(readAdded().filter((a) => a.id !== id)); loadedAll = null; }
