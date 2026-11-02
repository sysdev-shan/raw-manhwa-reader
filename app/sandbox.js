// Runs inside <iframe sandbox="allow-scripts" src="sandbox.html">: an opaque origin with no access to RAW's
// storage or IPC, and no network of its own. A Mangayomi-style source is evaluated here after it is sent in.
// Its only door out is Client.get/post, which the parent forwards (for hosts the source declared).
(function () {
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const post = (m) => parent.postMessage(m, '*');
  let rid = 0; const pend = new Map();
  const hostReq = (method, url, headers, body) => new Promise((res, rej) => {
    const id = ++rid; pend.set(id, { res, rej });
    post({ t: 'fetch', id, method, url, headers: headers || {}, body: body == null ? null : String(body) });
  });

  class Client {
    async get(url, headers) { return this._r('GET', url, headers); }
    async post(url, headers, body) { return this._r('POST', url, headers, body); }
    // Like Mihon/Mangayomi, send a normal browser User-Agent unless the source sets its own.
    async _r(m, u, h, b) {
      const headers = Object.assign({}, h || {});
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) headers['User-Agent'] = BROWSER_UA;
      const r = await hostReq(m, String(u), headers, b);
      return { body: r.body, statusCode: r.status, headers: {} };
    }
  }

  // jsoup-flavoured selectors: ":contains(text)" is not CSS, so it is handled here.
  function selectAll(root, sel) {
    const m = sel.match(/^(.*?):contains\(([^)]*)\)(.*)$/);
    if (!m) { try { return [...root.querySelectorAll(sel)]; } catch (e) { return []; } }
    const [, base, needle, rest] = m;
    const text = needle.replace(/^["']|["']$/g, '').toLowerCase();
    const hits = [...root.querySelectorAll(base || '*')].filter((e) => (e.textContent || '').toLowerCase().includes(text));
    const r = rest.trim();
    if (!r) return hits;
    const adj = r.match(/^\+\s*(.+)$/);
    if (adj) return hits.map((e) => e.nextElementSibling).filter((e) => e && e.matches(adj[1]));
    const out = []; for (const h of hits) out.push(...selectAll(h, r.replace(/^>\s*/, ':scope > ')));
    return out;
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const wrap = (e, base) => (e ? new Element(e, base) : null);
  class Element {
    constructor(n, base) { this.n = n; this.base = base; }
    get text() { return norm(this.n.textContent); }
    get ownText() { return norm([...this.n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ')); }
    get html() { return this.n.innerHTML; }
    get innerHtml() { return this.n.innerHTML; }
    get outerHtml() { return this.n.outerHTML; }
    get className() { return this.n.className || ''; }
    get id() { return this.n.id || ''; }
    get tagName() { return (this.n.tagName || '').toLowerCase(); }
    get children() { return [...this.n.children].map((c) => new Element(c, this.base)); }
    get parent() { return wrap(this.n.parentElement, this.base); }
    get nextElementSibling() { return wrap(this.n.nextElementSibling, this.base); }
    get previousElementSibling() { return wrap(this.n.previousElementSibling, this.base); }
    get firstElementChild() { return wrap(this.n.firstElementChild, this.base); }
    get lastElementChild() { return wrap(this.n.lastElementChild, this.base); }
    attr(name) {
      if (name.startsWith('abs:')) { const v = this.n.getAttribute(name.slice(4)); try { return v ? new URL(v, this.base).href : ''; } catch (e) { return v || ''; } }
      const v = this.n.getAttribute(name); return v == null ? '' : v;
    }
    // Mangayomi helpers: first image-ish attribute that is set, and the link target
    get getSrc() { for (const a of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-cfsrc']) { const v = this.n.getAttribute(a); if (v) return v; } return ''; }
    get getHref() { return this.n.getAttribute('href') || ''; }
    get getDataSrc() { return this.n.getAttribute('data-src') || ''; }
    hasAttr(name) { return this.n.hasAttribute(name); }
    hasClass(c) { return this.n.classList.contains(c); }
    select(sel) { return selectAll(this.n, sel).map((e) => new Element(e, this.base)); }
    selectFirst(sel) { return wrap(selectAll(this.n, sel)[0], this.base); }
    getElementsByClassName(c) { return [...this.n.getElementsByClassName(c)].map((e) => new Element(e, this.base)); }
    getElementsByTagName(t) { return [...this.n.getElementsByTagName(t)].map((e) => new Element(e, this.base)); }
    getElementById(i) { return wrap(this.n.querySelector('#' + CSS.escape(i)), this.base); }
  }
  class Document extends Element {
    constructor(html, base) {
      const d = new DOMParser().parseFromString(String(html), 'text/html');
      const src = globalThis.mangayomiSources && globalThis.mangayomiSources[0];
      super(d.documentElement, base || (src && src.baseUrl) || 'http://localhost/');
      this.doc = d;
    }
    get body() { return new Element(this.doc.body, this.base); }
    get title() { return this.doc.title; }
  }

  const prefs = {};
  class SharedPreferences {
    get(k) { return prefs[k]; } getString(k, d) { return prefs[k] ?? d; } getBool(k, d) { return prefs[k] ?? d; }
    getInt(k, d) { return prefs[k] ?? d; } set(k, v) { prefs[k] = v; return true; } setString(k, v) { prefs[k] = v; return true; }
  }
  class MProvider { constructor() { this.source = (globalThis.mangayomiSources && globalThis.mangayomiSources[0]) || {}; } }
  const setPrefs = (list) => {
    for (const p of list || []) {
      const e = p.editTextPreference || p.switchPreferenceCompat || p.checkBoxPreference;
      if (e) prefs[p.key] = e.value;
      else if (p.listPreference) prefs[p.key] = p.listPreference.entryValues[p.listPreference.valueIndex];
      else if (p.multiSelectListPreference) prefs[p.key] = p.multiSelectListPreference.values;
    }
  };
  Object.assign(globalThis, { Client, Document, Element, SharedPreferences, Preferences: SharedPreferences, MProvider });
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker']) {
    try { delete globalThis[k]; } catch (e) { /* not removable */ }
    try { globalThis[k] = undefined; } catch (e) { /* not writable */ }
  }

  // After the source is evaluated, publish its metadata and create the provider in the same scope.
  const BOOT = '\n;globalThis.__meta = (typeof mangayomiSources !== "undefined" && mangayomiSources[0]) || {};' +
    '\nglobalThis.mangayomiSources = (typeof mangayomiSources !== "undefined") ? mangayomiSources : [];' +
    '\nglobalThis.__ext = new DefaultExtension();';
  let ext = null;

  addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || ev.source !== parent) return;
    if (m.t === 'load') {
      try {
        (0, eval)(m.code + BOOT);
        ext = globalThis.__ext;
        try { setPrefs(typeof ext.getSourcePreferences === 'function' ? ext.getSourcePreferences() : []); } catch (e) { /* optional */ }
        post({ t: 'ready', meta: JSON.parse(JSON.stringify(globalThis.__meta)) });
      } catch (e) { post({ t: 'dead', error: String((e && e.message) || e) }); }
      return;
    }
    if (m.t === 'fetchResult') {
      const p = pend.get(m.id); pend.delete(m.id); if (!p) return;
      m.error ? p.rej(new Error(m.error)) : p.res(m.value); return;
    }
    if (m.t === 'call') {
      try {
        const fn = ext && ext[m.method]; if (typeof fn !== 'function') throw new Error('source has no ' + m.method + '()');
        const args = m.args || [];
        // search() expects the source's own default filters, not an empty list
        if (m.method === 'search' && Array.isArray(args[2]) && !args[2].length && typeof ext.getFilterList === 'function') {
          try { args[2] = ext.getFilterList(); } catch (e) { /* keep [] */ }
        }
        const value = await fn.apply(ext, args);
        post({ t: 'result', id: m.id, value: JSON.parse(JSON.stringify(value === undefined ? null : value)) });
      } catch (err) { post({ t: 'result', id: m.id, error: String((err && err.message) || err) }); }
    }
  });
  post({ t: 'booted' });
})();
