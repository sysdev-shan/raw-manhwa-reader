// Runs Mangayomi-style JavaScript sources (class DefaultExtension extends MProvider).
// The source is evaluated inside sandbox.html: an iframe with an opaque origin (no RAW storage, no IPC, no network).
// Its only door out is Client.get/post, which this class forwards to Rust for hosts the source declared.
import { fetchText } from './net.js';

const hostOk = (url, hosts) => {
  let u; try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
};
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
// A source declared for www.example.com may use m.example.com or cdn.example.com: allow the bare domain and its subdomains.
const scopeOf = (h) => h.replace(/^www\./, '');
const msg = (e) => (e && e.message) || String(e);

export class MangayomiSource {
  constructor(code) {
    this.pending = new Map(); this.n = 0; this.cache = new Map(); this.hosts = [];
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts'); // no allow-same-origin on purpose
    this.frame.hidden = true;
    this.frame.src = 'sandbox.html';
    this.ready = new Promise((res, rej) => {
      this.onReady = res; this.onDead = rej;
      setTimeout(() => rej(new Error('source did not start')), 8000);
    }).then((m) => {
      this.hosts = [...new Set([hostOf(m.baseUrl), hostOf(m.apiUrl)].filter(Boolean).map(scopeOf))];
      this.meta = { id: `my-${m.id ?? m.name}`, name: m.name, lang: m.lang || 'all', version: m.version || '0', hosts: this.hosts, kind: 'mangayomi', baseUrl: m.baseUrl, nsfw: !!m.isNsfw, filters: m.filters || null };
      return this.meta;
    });
    this.listener = (e) => { if (e.source === this.frame.contentWindow) this.onMessage(e.data, code); };
    window.addEventListener('message', this.listener);
    document.body.append(this.frame);
  }

  destroy() { window.removeEventListener('message', this.listener); this.frame.remove(); }

  async onMessage(m, code) {
    if (!m) return;
    if (m.t === 'booted') return this.frame.contentWindow.postMessage({ t: 'load', code }, '*');
    if (m.t === 'ready') return this.onReady(m.meta);
    if (m.t === 'dead') return this.onDead(new Error(m.error));
    if (m.t === 'result') {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (p) { clearTimeout(p.timer); m.error ? p.rej(new Error(m.error)) : p.res(m.value); }
    } else if (m.t === 'fetch') {
      const reply = (o) => this.frame.contentWindow?.postMessage({ t: 'fetchResult', id: m.id, ...o }, '*');
      try {
        if (!hostOk(m.url, this.hosts)) throw new Error(`Host not declared by this source: ${hostOf(m.url) || m.url}`);
        const r = await fetchText(m.url, m.headers, { method: m.method, body: m.body, hosts: this.hosts });
        reply({ value: { status: r.status, body: r.text } });
      } catch (err) { reply({ error: msg(err) }); }
    }
  }

  // Headers to fetch this source's images with when a plain <img> is refused (hotlink protection).
  imageHeaders() { return this.meta?.baseUrl ? { Referer: `${this.meta.baseUrl.replace(/\/$/, '')}/` } : null; }

  raw(method, args = [], timeoutMs = 45000) {
    return new Promise((res, rej) => {
      const id = ++this.n;
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
      this.frame.contentWindow.postMessage({ t: 'call', id, method, args }, '*');
    });
  }

  // Same interface as RAW's own sources: popular/search/details/chapters/pages.
  async call(method, args = []) {
    await this.ready;
    const list = (r) => ({ items: (r.list || []).map((m) => ({ id: m.link, title: m.name, cover: m.imageUrl || '' })), hasNext: !!r.hasNextPage });
    if (method === 'browse') return list(await this.raw('browse', [args[0] || 1, args[1] || {}]));
    if (method === 'popular') return list(await this.raw('getPopular', [args[0] || 1]));
    if (method === 'search') return list(await this.raw('search', [args[0], args[1] || 1, []]));
    if (method === 'details' || method === 'chapters') {
      const id = args[0];
      if (!this.cache.has(id)) this.cache.set(id, this.raw('getDetail', [id]));
      const d = await this.cache.get(id);
      if (method === 'details') return { id, title: d.name || d.title || 'Untitled', cover: d.imageUrl || '', author: d.author || '', description: d.description || '' };
      const ch = (d.chapters || d.episodes || []).map((c) => ({ id: c.url, name: c.name || c.url, t: Number(c.dateUpload) || 0 }));
      const newestFirst = ch.length > 1 && ch[0].t && ch[ch.length - 1].t ? ch[0].t > ch[ch.length - 1].t : true;
      return (newestFirst ? ch.reverse() : ch).map(({ id: cid, name }) => ({ id: cid, name }));
    }
    if (method === 'pages') {
      const r = await this.raw('getPageList', [args[0]]);
      return (r || []).map((p) => (typeof p === 'string' ? p : p.url)).filter(Boolean);
    }
    throw new Error(`unknown method ${method}`);
  }
}
