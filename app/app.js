// RAW — portrait manhwa reader UI. Series/progress persist in localStorage; sources run in sandboxed workers.
import { loadFiles } from './local.js';
import { installed, addSourceCode, addMangayomiCode, installedIds } from './sources.js';
import { fetchText, fetchBytes } from './net.js';
import { loadStore } from './store.js';
const $app = document.getElementById('app');

const COLORS = ['#FFE600', '#FF3B1D', '#FFFFFF', '#C8C5BA', '#FFE600', '#FF3B1D'];
// Every series known this session, by stable id: "<sourceId>:<remoteId>" or "local:<n>".
const SERIES = new Map();
const pc = (s, ch) => s.chs[ch - 1].pages?.length ?? 1;
const chName = (s, ch) => s.chs[ch - 1].name;
const enc = encodeURIComponent;
const colorOf = (id) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
// Remote chapters fetch their page list the first time they are opened.
async function ensurePages(s, ch) {
  const c = s.chs?.[ch - 1];
  if (!c || c.pages) return;
  if (!c.loading) {
    c.loading = (async () => {
      const src = s.src ?? (await installed()).find((e) => e.meta.id === s.srcId)?.src;
      if (!src) throw new Error(`Source "${s.srcId}" is not installed any more.`);
      s.src = src;
      c.pages = await src.call('pages', [c.remoteId]);
    })().finally(() => { c.loading = null; });
  }
  await c.loading;
  if (!c.pages?.length) throw new Error('This chapter has no pages here.');
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('raw.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('raw.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
let settings = Object.assign({ mode: 'webtoon' }, store.get('settings', {}));
let progress = store.get('progress', {}); // { [seriesId]: { ch, read: [n...] } }

// Mark: a webtoon strip (three stacked panels) on a black tile.
const LOGO = `<span class="logo" role="img" aria-label="RAW"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" fill="#0A0A0A"/><rect x="9" y="4" width="14" height="7" fill="#FFE600"/><rect x="9" y="13" width="14" height="9" fill="#FFE600"/><rect x="9" y="24" width="14" height="4" fill="#FF3B1D"/></svg></span>`;
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const prog = (id) => (progress[id] ??= { ch: 1, read: [], t: 0 });
const save = () => store.set('progress', progress);
const unreadOf = (s) => (s.chs ? Math.max(0, s.chs.length - (progress[s.id]?.read?.length ?? 0)) : 0);

/* ---------- persistence: remote series + library flags (local files are session-only) ---------- */
function persistSeries() {
  const recs = [...SERIES.values()].filter((s) => s.remote).map((s) => ({
    id: s.id, name: s.name, author: s.author, desc: s.desc, cover: s.cover, srcId: s.srcId, itemId: s.itemId,
    inLib: !!s.inLib, t: progress[s.id]?.t || s.openedAt || 0,
    chs: s.chs.map((c) => [c.name, c.remoteId]),
  }));
  const keep = recs.filter((r) => r.inLib).concat(recs.filter((r) => !r.inLib).sort((a, b) => b.t - a.t).slice(0, 40));
  store.set('series', keep);
}
function hydrate() {
  for (const r of store.get('series', [])) {
    SERIES.set(r.id, {
      id: r.id, name: r.name, author: r.author, desc: r.desc, cover: r.cover, color: colorOf(r.id), srcId: r.srcId, itemId: r.itemId,
      remote: true, inLib: !!r.inLib, openedAt: r.t, chapters: r.chs.length,
      chs: r.chs.map(([name, remoteId]) => ({ name, remoteId, pages: null })),
    });
  }
}
hydrate();

// A screen may set node._cleanup; it runs when the next screen replaces it (and only then).
let cleanup = null;
function mount(node) {
  if (cleanup) { cleanup(); cleanup = null; }
  cleanup = node._cleanup || null;
  $app.replaceChildren(node);
}

/* ---------- shell with bottom nav ---------- */
const TABS = [['library', 'Library'], ['browse', 'Browse'], ['history', 'History']];
function shell(tab, inner) {
  const s = el(`<section class="screen"></section>`);
  s.append(inner);
  const unread = [...SERIES.values()].filter((x) => x.inLib).reduce((a, x) => a + unreadOf(x), 0);
  const nav = el(`<nav class="nav" aria-label="Main">${TABS.map(([k, l]) => `<button data-go="#/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}${k === 'library' && unread ? `<i class="cnt">${unread}</i>` : ''}</button>`).join('')}</nav>`);
  s.append(nav);
  return s;
}

function topbar(placeholder) {
  return `<header class="h-top">${LOGO}<input class="search" data-k="filter" placeholder="${placeholder}" aria-label="Search"><button class="icon-btn" data-go="#/more" aria-label="Settings">⚙</button></header>`;
}

function card(s) {
  const u = unreadOf(s);
  return `<button class="card" data-go="#/series/${enc(s.id)}"><div class="cover${s.cover ? ' has-img' : ''}"${s.cover ? '' : ` style="background:${s.color}"`}>${coverImg(s.cover)}${u ? `<span class="badge">${u}</span>` : ''}${s.cover ? '' : `<b>${esc(s.name)}</b>`}</div><div class="name">${esc(s.name)}</div></button>`;
}

// Covers are real <img> elements, scaled smoothly (no hatch overlay on top of them).
const coverImg = (url) => (url ? `<img class="cimg" src="${esc(url)}" loading="lazy" decoding="async" alt="">` : '');

const inLibrary = () => [...SERIES.values()].filter((s) => s.inLib);

function library() {
  const list = inLibrary().sort((a, b) => (progress[b.id]?.t || 0) - (progress[a.id]?.t || 0));
  const body = el(`<div class="scroll">${topbar('SEARCH LIBRARY_')}<h1 class="title">Library</h1><p class="meta">${list.length} series / ${list.reduce((a, s) => a + unreadOf(s), 0)} unread</p><div class="addrow"><button class="btn" data-add="files">+ CBZ / images</button><button class="btn" data-add="dir">+ Folder</button></div><div data-k="shelf"></div></div>`);
  const shelf = body.querySelector('[data-k="shelf"]');
  const draw = (q) => {
    const rows = list.filter((s) => s.name.toLowerCase().includes(q));
    shelf.innerHTML = rows.length
      ? `<div class="grid">${rows.map(card).join('')}</div>`
      : list.length ? '<div class="empty"><b>No match</b>Nothing in your library has that name.</div>'
        : '<div class="empty"><b>Empty</b>Open Browse, pick a title and tap Add to library. Local files you open stay here until you close the app.</div>';
  };
  draw('');
  body.querySelector('[data-k="filter"]').addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
  return shell('library', body);
}

function history() {
  const ids = Object.keys(progress).filter((id) => SERIES.has(id) && progress[id].t).sort((a, b) => progress[b].t - progress[a].t);
  const rows = ids.map((id) => SERIES.get(id)).map((s) => `<button class="ch" data-go="#/read/${enc(s.id)}/${prog(s.id).ch}"><span>${esc(s.name)}<br><small>${esc(chName(s, prog(s.id).ch))}</small></span><small>RESUME</small></button>`).join('');
  return shell('history', el(`<div class="scroll"><h1 class="title">History</h1><p class="meta">Continue reading</p>${rows ? `<div class="chlist">${rows}</div>` : '<div class="empty"><b>Nothing yet</b>Open a chapter and it shows up here.</div>'}</div>`));
}

/* ---------- browse: sources + extension store ---------- */
// Sites RAW does not read itself: they open in your normal browser.
const WEBSITES = [{ name: 'Comix', url: 'https://comix.to/' }];
function openExternal(url) {
  const inv = window.__TAURI__?.core?.invoke;
  if (inv) inv('open_external', { url }).catch((err) => toast(String(err.message ?? err)));
  else window.open(url, '_blank', 'noopener');
}
const DEFAULT_STORE ='https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.pb';
let storeCache = null;
let toastTimer = 0;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  $app.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4500);
}
function busyOverlay(label) {
  const o = el(`<div class="loading"><b>${esc(label)}</b></div>`);
  $app.append(o); return () => o.remove();
}

function browse() {
  const body = el(`<div class="scroll"><header class="h-top">${LOGO}<span class="topt">Browse</span></header>
    <h2 class="sec">Sources</h2><div class="chlist" data-k="sources"><div class="empty">Loading…</div></div>
    <div class="addrow"><button class="btn" data-k="addsrc">+ Source file (.js)</button></div>
    <h2 class="sec">Websites</h2>
    <div class="chlist">${WEBSITES.map((w) => `<button class="ch" data-open-url="${esc(w.url)}"><span>${esc(w.name)}<br><small>${esc(new URL(w.url).hostname)} · opens in your browser</small></span><small>OPEN ↗</small></button>`).join('')}</div>
    <h2 class="sec">Extension store</h2>
    <div class="storebar"><input class="search" data-k="url" value="${esc(store.get('storeUrl', DEFAULT_STORE))}" aria-label="Store index URL" spellcheck="false"><button class="btn" data-k="load">Load</button></div>
    <div class="addrow"><button class="btn" data-preset="my">Mangayomi (JS, runs)</button><button class="btn" data-preset="kei">Keiyoushi (APK list)</button></div>
    <p class="meta" data-k="meta">Mangayomi JS sources run inside RAW. Android APKs (Keiyoushi) can only be listed.</p>
    <div class="storebar" data-k="tools" hidden><input class="search" data-k="q" placeholder="FILTER_" aria-label="Filter extensions"><select class="search sel" data-k="lang" aria-label="Language"></select><button class="icon-btn nsfw" data-k="nsfw" aria-pressed="false" aria-label="Show NSFW extensions" title="Show NSFW">18+</button></div>
    <div class="chlist" data-k="list"></div>
    <div class="addrow" data-k="morewrap" hidden><button class="btn" data-k="more">Show more</button></div></div>`);
  const k = (n) => body.querySelector(`[data-k="${n}"]`);
  let own = [];
  let ownIds = installedIds();
  const PRESETS = { kei: DEFAULT_STORE, my: 'https://kodjodevf.github.io/mangayomi-extensions/index.json' };
  body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { k('url').value = PRESETS[b.dataset.preset]; k('load').click(); }));
  k('list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-install]'); if (!b) return;
    const row = b.querySelector('span').firstChild.textContent;
    b.setAttribute('disabled', ''); const tag = b.querySelector('.tag'); tag.textContent = '…';
    try {
      const r = await fetchText(b.dataset.install);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const meta = await addMangayomiCode(r.text);
      ownIds = installedIds();
      toast(`Added ${meta.name}. It can reach: ${meta.hosts.join(', ') || 'nothing'}`);
      route();
    } catch (err) { tag.textContent = 'ADD'; b.removeAttribute('disabled'); toast(`${row}: ${err.message ?? err}`); }
  });
  installed().then((list) => {
    own = list;
    k('sources').innerHTML = list.length
      ? list.map((e) => `<button class="ch" data-go="#/source/${esc(e.meta.id)}"><span>${esc(e.meta.name)}<br><small>${esc(e.meta.lang)} · v${esc(e.meta.version)} · ${esc((e.meta.hosts || []).join(', '))}</small></span><small>OPEN</small></button>`).join('')
      : '<div class="empty"><b>No sources</b>Add a .js source file.</div>';
    if (storeCache) renderList();
  });
  k('addsrc').addEventListener('click', () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.js';
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      try {
        const code = await f.text();
        // Mangayomi-style files define a DefaultExtension class; anything else is treated as a JSON-API source
        const meta = /class\s+DefaultExtension\s+extends\s+MProvider/.test(code) ? await addMangayomiCode(code) : await addSourceCode(code);
        toast(`Added ${meta.name}. It can reach: ${(meta.hosts || []).join(', ') || 'nothing'}`);
        location.hash = '#/browse'; route();
      } catch (err) { toast(`Not a valid source: ${err.message}`); }
    });
    input.click();
  });

  let shown = 50;
  const ownMatch = (e) => own.find((o) => o.meta.name.toLowerCase() === e.name.toLowerCase() || e.sources.some((s) => s.name.toLowerCase() === o.meta.name.toLowerCase()));
  function renderList() {
    if (!storeCache) return;
    const q = k('q').value.trim().toLowerCase(), lang = k('lang').value;
    const nsfw = k('nsfw').getAttribute('aria-pressed') === 'true';
    const rows = storeCache.extensions.filter((e) => (nsfw || e.warn !== 'nsfw') && (!lang || e.lang === lang) && (!q || e.name.toLowerCase().includes(q) || e.sources.some((s) => s.name.toLowerCase().includes(q))));
    k('list').innerHTML = rows.slice(0, shown).map((e) => {
      const meta = `${esc(e.lang)} · v${esc(e.version)}${e.sources.length > 1 ? ` · ${e.sources.length} sources` : ''}${e.cloudflare ? ' · cloudflare' : ''}`;
      if (storeCache.kind === 'mangayomi') {
        const have = ownIds.has(`my-${e.pkg}`);
        const tag = !e.runnable ? 'DART' : have ? 'ADDED' : 'ADD';
        const nsfwCls = e.warn === 'nsfw' ? ' w-nsfw' : '';
        return `<${e.runnable && !have ? 'button' : 'div'} class="ch ext" ${e.runnable && !have ? `data-install="${esc(e.codeUrl)}"` : ''}><img class="eicon" src="${esc(e.iconUrl)}" loading="lazy" alt=""><span>${esc(e.name)}<br><small>${meta}</small></span><small class="tag${nsfwCls}">${tag}</small></${e.runnable && !have ? 'button' : 'div'}>`;
      }
      const m = ownMatch(e);
      return `<div class="ch ext"><img class="eicon" src="${esc(e.iconUrl)}" loading="lazy" alt=""><span>${esc(e.name.replace(/^Tachiyomi: /, ''))}<br><small>${meta}</small></span><small class="tag w-${e.warn}">${m ? 'IN RAW' : e.warn === 'nsfw' ? 'NSFW' : e.warn === 'mixed' ? 'MIXED' : 'APK'}</small></div>`;
    }).join('') || '<div class="empty"><b>No match</b>Try another filter.</div>';
    k('morewrap').hidden = rows.length <= shown;
    k('meta').textContent = `${storeCache.name} (${storeCache.badge}) · ${rows.length} of ${storeCache.extensions.length} extensions`;
  }
  k('q').addEventListener('input', () => { shown = 50; renderList(); });
  k('lang').addEventListener('change', () => { shown = 50; renderList(); });
  k('more').addEventListener('click', () => { shown += 50; renderList(); });
  k('nsfw').addEventListener('click', () => { const on = k('nsfw').getAttribute('aria-pressed') !== 'true'; k('nsfw').setAttribute('aria-pressed', on); shown = 50; renderList(); });
  k('load').addEventListener('click', async () => {
    const url = k('url').value.trim(); store.set('storeUrl', url);
    k('meta').textContent = 'Loading store…';
    try {
      storeCache = await loadStore(url);
      const langs = [...new Set(storeCache.extensions.map((e) => e.lang))].sort();
      k('lang').innerHTML = `<option value="">All languages</option>${langs.map((l) => `<option>${esc(l)}</option>`).join('')}`;
      k('tools').hidden = false; shown = 50; renderList();
    } catch (err) { k('meta').textContent = `Could not load store: ${err.message}`; }
  });
  if (storeCache) { k('tools').hidden = false; const langs = [...new Set(storeCache.extensions.map((e) => e.lang))].sort(); k('lang').innerHTML = `<option value="">All languages</option>${langs.map((l) => `<option>${esc(l)}</option>`).join('')}`; renderList(); }
  return shell('browse', body);
}

/* ---------- one source: popular / search -> series ---------- */
const sourceState = new Map(); // per source: last list shown, so Back returns to it
function sourceView(id) {
  const sec = el(`<section class="screen"></section>`);
  const body = el(`<div class="scroll"><header class="h-top"><button class="icon-btn" data-go="#/browse" aria-label="Back">←</button><input class="search" data-k="q" placeholder="SEARCH_" aria-label="Search"><button class="icon-btn" data-k="go" aria-label="Search">↵</button></header>
    <h1 class="title" data-k="name">…</h1><p class="meta" data-k="meta">Popular</p>
    <div class="chips" data-k="chips" hidden>
      <div class="seg" data-k="sortseg" aria-label="Order"><button data-sort="popular" aria-pressed="true">Popular</button><button data-sort="latest" aria-pressed="false">Latest</button></div>
      <div class="seg" data-k="typeseg" aria-label="Type"><button data-type="" aria-pressed="true">All</button><button data-type="manhwa" aria-pressed="false">Manhwa</button><button data-type="manhua" aria-pressed="false">Manhua</button><button data-type="manga" aria-pressed="false">Manga</button></div>
    </div>
    <div class="grid" data-k="grid"></div>
    <div class="addrow" data-k="morewrap" hidden><button class="btn" data-k="more">Load more</button></div></div>`);
  sec.append(body);
  const k = (n) => body.querySelector(`[data-k="${n}"]`);
  let entry = null, page = 0, query = '', items = [], loading = false, sort = 'popular', type = '', hasNext = false;
  // Coming back from a title should land on the same list: same order, type, results and scroll position.
  const saved = sourceState.get(id);
  if (saved) ({ page, query, items, sort, type, hasNext } = saved);
  const remember = () => sourceState.set(id, { page, query, items, sort, type, hasNext, scroll: body.scrollTop });
  sec._cleanup = remember;
  const cardHtml = (it, i) => `<button class="card" data-open="${i}"><div class="cover has-img">${coverImg(it.cover)}</div><div class="name">${esc(it.title)}</div></button>`;
  async function load(reset) {
    if (loading || !entry) return; loading = true;
    if (reset) { page = 0; items = []; k('grid').innerHTML = ''; }
    const f = entry.meta.filters;
    k('meta').textContent = query ? `Search: ${query}` : `${sort === 'latest' ? 'Latest' : 'Popular'}${type ? ` · ${type}` : ''}`;
    try {
      const r = f
        ? await entry.src.call('browse', [page + 1, { sort, type, q: query }])
        : await entry.src.call(query ? 'search' : 'popular', query ? [query, page + 1] : [page + 1]);
      page++;
      const start = items.length; items = items.concat(r.items);
      k('grid').insertAdjacentHTML('beforeend', r.items.map((it, i) => cardHtml(it, start + i)).join(''));
      hasNext = !!r.hasNext;
      k('morewrap').hidden = !hasNext;
      if (!items.length) k('meta').textContent = 'Nothing found';
    } catch (err) { toast(`${entry.meta.name}: ${err.message}`); }
    loading = false;
    remember();
  }
  installed().then((list) => {
    entry = list.find((e) => e.meta.id === id);
    if (!entry) { k('name').textContent = 'Unknown source'; return; }
    k('name').textContent = entry.meta.name;
    const f = entry.meta.filters;
    if (f) { // only offer the filters this source can actually do
      k('chips').hidden = false;
      k('sortseg').hidden = !f.sort;
      k('typeseg').hidden = !f.type;
    }
    if (saved && items.length) { // restore the list as it was
      k('grid').innerHTML = items.map(cardHtml).join('');
      k('morewrap').hidden = !hasNext;
      k('q').value = query;
      k('meta').textContent = query ? `Search: ${query}` : `${sort === 'latest' ? 'Latest' : 'Popular'}${type ? ` · ${type}` : ''}`;
      k('sortseg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sort === sort));
      k('typeseg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.type === type));
      requestAnimationFrame(() => { body.scrollTop = saved.scroll || 0; });
    } else load(true);
  });
  const pick = (seg, attr, set) => k(seg).addEventListener('click', (e) => {
    const b = e.target.closest(`[data-${attr}]`); if (!b || loading) return;
    set(b.dataset[attr]);
    k(seg).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    load(true);
  });
  pick('sortseg', 'sort', (v) => { sort = v; });
  pick('typeseg', 'type', (v) => { type = v; });
  const run = () => { query = k('q').value.trim(); load(true); };
  k('go').addEventListener('click', run);
  k('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  k('more').addEventListener('click', () => load(false));
  body.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-open]'); if (!c || !entry) return;
    const it = items[+c.dataset.open];
    const done = busyOverlay('Opening…');
    try { location.hash = `#/series/${enc(await openRemote(entry, it))}`; } catch (err) { toast(err.message); } finally { done(); }
  });
  return sec;
}

async function openRemote(entry, item) {
  const id = `${entry.meta.id}:${item.id}`;
  const known = SERIES.get(id);
  if (known) { known.src = entry.src; return id; }
  const [d, chs] = await Promise.all([entry.src.call('details', [item.id]), entry.src.call('chapters', [item.id])]);
  if (!chs.length) throw new Error('No readable English chapters here (some titles only link to the official site).');
  SERIES.set(id, { id, name: d.title, author: d.author || entry.meta.name, desc: d.description || '', color: colorOf(id), cover: d.cover || item.cover, chapters: chs.length, remote: true, srcId: entry.meta.id, itemId: item.id, src: entry.src, openedAt: Date.now(), inLib: false, chs: chs.map((c) => ({ name: c.name, remoteId: c.id, pages: null })) });
  persistSeries();
  return id;
}

async function refreshChapters(s) {
  const e = (await installed()).find((x) => x.meta.id === s.srcId);
  if (!e) throw new Error(`Source "${s.srcId}" is not installed.`);
  const fresh = await e.src.call('chapters', [s.itemId]);
  const had = s.chs.length;
  // chapters come oldest -> newest, so new ones are appended; keep loaded pages of the rest
  s.chs = fresh.map((c, i) => (s.chs[i] && s.chs[i].remoteId === c.id ? s.chs[i] : { name: c.name, remoteId: c.id, pages: null }));
  s.chapters = s.chs.length; s.src = e.src;
  persistSeries();
  return s.chs.length - had;
}

const MODE_NAMES = { webtoon: 'Webtoon', ltr: 'Paged L→R', rtl: 'Paged R→L' };
function more() {
  const body = el(`<div class="scroll"><header class="h-top"><button class="icon-btn" data-go="#/library" aria-label="Back">←</button><span class="topt">Settings</span></header>
    <h2 class="sec">Reading mode</h2>
    <div class="opt" style="padding:0 14px 16px"><div class="seg">${Object.entries(MODE_NAMES).map(([k, l]) => `<button data-m="${k}" aria-pressed="${settings.mode === k}">${l}</button>`).join('')}</div></div>
    <div class="chlist"><button class="ch" data-go="#/browse"><span>Sources and extensions</span><small>OPEN</small></button><div class="ch"><span>About RAW<br><small>v0.1 · portrait manhwa reader</small></span></div></div></div>`);
  body.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    settings.mode = b.dataset.m; store.set('settings', settings);
    body.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  const sec = el(`<section class="screen"></section>`); sec.append(body); return sec;
}

/* ---------- series ---------- */
function seriesView(id) {
  const s = SERIES.get(id); if (!s) return library();
  const p = prog(id);
  const chs = Array.from({ length: s.chapters }, (_, i) => s.chapters - i);
  const body = el(`<div class="scroll"><header class="h-top"><button class="icon-btn" data-back="${esc(id)}" aria-label="Back">←</button>${LOGO}</header>
    <div class="hero"><div class="cover${s.cover ? ' has-img' : ''}"${s.cover ? '' : ` style="background:${s.color}"`}>${coverImg(s.cover)}${s.cover ? '' : `<b>${esc(s.name)}</b>`}</div><div><h1>${esc(s.name)}</h1><p>${esc(s.author)}<br>${s.chapters} CH. / ${unreadOf(s)} UNREAD</p></div></div>
    <p class="desc" data-k="desc" tabindex="0" role="button" aria-expanded="false">${esc(s.desc)}</p>
    <div class="addrow">${s.remote ? `<button class="btn" data-k="lib" aria-pressed="${!!s.inLib}">${s.inLib ? '✓ In library' : '+ Add to library'}</button><button class="btn" data-k="refresh">↻ Chapters</button>` : '<p class="meta">Local files: kept until you close the app.</p>'}</div>
    <div class="resume"><button class="btn" data-go="#/read/${enc(id)}/${p.ch}">${p.t ? 'Resume' : 'Start'} ${esc(chName(s, p.ch))}</button></div>
    <div class="chlist">${chs.map((n) => `<button class="ch ${p.read.includes(n) ? 'read' : ''}" data-go="#/read/${enc(id)}/${n}"><span>${esc(chName(s, n))}</span><small>${s.chs[n - 1].pages ? `${pc(s, n)} pages` : ''}</small></button>`).join('')}</div></div>`);
  const k = (n) => body.querySelector(`[data-k="${n}"]`);
  const desc = k('desc');
  desc.addEventListener('click', () => desc.setAttribute('aria-expanded', desc.getAttribute('aria-expanded') !== 'true'));
  desc.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); desc.click(); } });
  k('lib')?.addEventListener('click', () => {
    s.inLib = !s.inLib; persistSeries();
    const b = k('lib'); b.setAttribute('aria-pressed', !!s.inLib); b.textContent = s.inLib ? '✓ In library' : '+ Add to library';
    toast(s.inLib ? 'Added to library' : 'Removed from library');
  });
  k('refresh')?.addEventListener('click', async () => {
    const done = busyOverlay('Checking…');
    try { const n = await refreshChapters(s); toast(n > 0 ? `${n} new chapter${n === 1 ? '' : 's'}` : 'No new chapters'); route(); }
    catch (err) { toast(err.message); } finally { done(); }
  });
  const sec = el(`<section class="screen"></section>`); sec.append(body); return sec;
}

/* ---------- reader ---------- */
function pageEl(sid, ch, p) {
  const s = SERIES.get(sid);
  const node = el(`<div class="page img" data-ch="${ch}" data-p="${p}"><img src="${esc(s.chs[ch - 1].pages[p - 1])}" alt="Chapter ${ch} page ${p}" decoding="async" ${p > 2 ? 'loading="lazy"' : ''}></div>`);
  const img = node.firstElementChild;
  img.addEventListener('error', () => proxyImage(img, s, ch), { once: true });
  if (img.getAttribute('src').includes('#{')) descramble(img, s, ch); // tiles in a fragment: put them back in order
  return node;
}

// Some pages ship as a grid of shuffled tiles plus the order to put them in (the same data the site's own
// reader uses). Fetch the image, redraw each tile where it belongs, and show the result.
async function descramble(img, s, ch) {
  const full = img.getAttribute('src'), cut = full.indexOf('#');
  const url = full.slice(0, cut);
  try {
    const { tiles, tileCols, tileRows } = JSON.parse(decodeURIComponent(full.slice(cut + 1)));
    const headers = s.src?.imageHeaders?.(s.chs[ch - 1].remoteId) ?? {};
    const r = await fetchBytes(url, headers, { hosts: [new URL(url).hostname] });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const bmp = await createImageBitmap(new Blob([r.bytes]));
    const tw = Math.floor(bmp.width / tileCols), th = Math.floor(bmp.height / tileRows);
    const canvas = document.createElement('canvas');
    canvas.width = tw * tileCols; canvas.height = th * tileRows;
    const g = canvas.getContext('2d');
    tiles.forEach((dst, i) => g.drawImage(bmp, (i % tileCols) * tw, Math.floor(i / tileCols) * th, tw, th, (dst % tileCols) * tw, Math.floor(dst / tileCols) * th, tw, th));
    canvas.toBlob((b) => { if (b) img.src = URL.createObjectURL(b); }, 'image/webp', 1);
  } catch { /* leave the page blank rather than show a scrambled one */ }
}

// Some sites refuse images without a Referer, which <img> cannot send. If a direct load fails and the
// source knows which headers it needs, fetch the image through Rust with them and show it from a blob.
async function proxyImage(img, s, ch) {
  const headers = s.src?.imageHeaders?.(s.chs[ch - 1].remoteId);
  const url = img.getAttribute('src');
  if (!headers || !url || url.startsWith('blob:')) return;
  try {
    const host = new URL(url).hostname;
    const r = await fetchBytes(url, headers, { hosts: [host] });
    if (r.status === 200) img.src = URL.createObjectURL(new Blob([r.bytes]));
  } catch { /* leave the broken image as it is */ }
}
function transitionEl(sid, from, to) {
  return el(`<div class="trans" data-trans="${to}"><b>End of chapter ${from}</b><small>Next: chapter ${to}</small></div>`);
}

function reader(sid, startCh) {
  const s = SERIES.get(sid); if (!s) return library();
  startCh = Math.min(Math.max(1, startCh || 1), s.chapters);
  const root = el(`<section class="screen reader" data-mode="${settings.mode}"></section>`);
  const view = el(`<div class="viewport" tabindex="0"></div>`);
  const top = el(`<div class="bar top"><button class="icon-btn" data-go="#/series/${enc(sid)}" aria-label="Back to series">←</button><div class="t"><b>${esc(s.name)}</b><small data-k="chlabel"></small></div><button class="icon-btn" data-k="settings" aria-label="Reader settings">⚙</button></div>`);
  const bottom = el(`<div class="bar bottom"><div class="slider"><span data-k="pcur">01</span><input type="range" min="1" max="${pc(s, startCh)}" value="1" aria-label="Page"><span data-k="ptot">${pad(pc(s, startCh))}</span></div><div class="rowbtns"><button class="icon-btn" data-k="prev">◀ Prev ch</button><button class="icon-btn" data-k="mode"></button><button class="icon-btn" data-k="next">Next ch ▶</button></div></div>`);
  const pnum = el(`<div class="pnum" data-k="pnum"></div>`);
  root.append(view, top, bottom, pnum);

  const q = (k) => root.querySelector(`[data-k="${k}"]`);
  const slider = bottom.querySelector('input');
  let cur = { ch: startCh, p: 1 };
  let lastCh = startCh;
  const loaded = new Set();
  let hidden = false;
  const setHidden = (h) => { hidden = h; root.classList.toggle('hidden', h); };

  const MODES = { webtoon: 'Webtoon', ltr: 'Paged L→R', rtl: 'Paged R→L' };
  q('mode').textContent = MODES[settings.mode];

  function updateHud() {
    q('chlabel').textContent = `CH. ${cur.ch} / PAGE ${pad(cur.p)}`;
    q('pcur').textContent = pad(cur.p);
    slider.value = cur.p;
    const total = pc(s, cur.ch);
    slider.max = total; q('ptot').textContent = pad(total);
    q('pnum').textContent = `${cur.ch} · ${cur.p}/${total}`;
    const pr = prog(sid);
    pr.ch = cur.ch; pr.t = Date.now();
    let justRead = cur.p === total && !pr.read.includes(cur.ch);
    if (justRead) pr.read.push(cur.ch);
    // scrolling from one chapter into the next counts as finishing the one behind
    if (cur.ch === lastCh + 1 && !pr.read.includes(lastCh)) { pr.read.push(lastCh); justRead = true; }
    lastCh = cur.ch;
    save();
    if (justRead || !s.persisted) { s.persisted = true; persistSeries(); } // keeps recents ordered across restarts
  }

  /* webtoon: continuous across chapters */
  let busy = false;
  function fail(err) {
    view.append(el(`<div class="trans"><b>Can't load</b><small>${esc(err.message || err)}</small></div>`));
  }
  async function appendChapter(ch) {
    if (busy || loaded.has(ch) || ch > s.chapters) return;
    busy = true;
    try {
      await ensurePages(s, ch);
      if (loaded.has(ch)) return;
      if (loaded.size) view.append(transitionEl(sid, ch - 1, ch));
      for (let p = 1; p <= pc(s, ch); p++) view.append(pageEl(sid, ch, p));
      loaded.add(ch);
    } catch (err) { fail(err); loaded.add(ch); } finally { busy = false; }
  }
  function detectCurrent() {
    const mid = view.scrollTop + view.clientHeight * 0.4;
    const pages = view.querySelectorAll('.page');
    for (const pg of pages) {
      if (pg.offsetTop + pg.offsetHeight > mid) { cur = { ch: +pg.dataset.ch, p: +pg.dataset.p }; break; }
    }
    updateHud();
  }
  let lastTop = 0;
  function onScroll() {
    const t = view.scrollTop, d = t - lastTop;
    if (Math.abs(d) > 8) { setHidden(d > 0 && t > 40); lastTop = t; }
    if (view.scrollHeight - t - view.clientHeight < 1400) appendChapter(Math.max(...loaded) + 1);
    detectCurrent();
  }

  /* paged */
  function showPaged() {
    view.replaceChildren(pageEl(sid, cur.ch, cur.p));
    const pg = view.firstElementChild; pg.style.aspectRatio = 'auto'; pg.style.height = '100%'; pg.style.minHeight = '100%';
    updateHud();
  }
  async function step(dir) { // dir: +1 forward, -1 back
    let { ch, p } = cur; p += dir;
    try {
      if (p > pc(s, ch)) { if (ch >= s.chapters) return; ch++; await ensurePages(s, ch); p = 1; }
      if (p < 1) { if (ch <= 1) return; ch--; await ensurePages(s, ch); p = pc(s, ch); }
    } catch (err) { return fail(err); }
    cur = { ch, p }; showPaged();
  }

  async function jumpChapter(ch) {
    ch = Math.min(Math.max(1, ch), s.chapters);
    try { await ensurePages(s, ch); } catch (err) { return fail(err); }
    cur = { ch, p: 1 };
    if (settings.mode === 'webtoon') { loaded.clear(); view.replaceChildren(); await appendChapter(ch); view.scrollTop = 0; lastTop = 0; updateHud(); }
    else showPaged();
  }

  view.addEventListener('click', (e) => {
    const r = view.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (settings.mode === 'webtoon') {
      if (y < 0.3) view.scrollBy({ top: -view.clientHeight * 0.85, behavior: 'smooth' });
      else if (y > 0.7) view.scrollBy({ top: view.clientHeight * 0.85, behavior: 'smooth' });
      else setHidden(!hidden);
    } else {
      const left = x < 0.3, right = x > 0.7;
      if (!left && !right) return setHidden(!hidden);
      const fwd = settings.mode === 'ltr' ? right : left;
      step(fwd ? 1 : -1);
    }
  });
  view.addEventListener('scroll', () => { if (settings.mode === 'webtoon') onScroll(); }, { passive: true });
  slider.addEventListener('input', () => {
    const p = +slider.value;
    if (settings.mode === 'webtoon') { const t = view.querySelector(`.page[data-ch="${cur.ch}"][data-p="${p}"]`); if (t) view.scrollTop = t.offsetTop; }
    else { cur.p = p; showPaged(); }
  });
  q('prev').addEventListener('click', () => jumpChapter(cur.ch - 1));
  q('next').addEventListener('click', () => jumpChapter(cur.ch + 1));
  q('mode').addEventListener('click', () => openSheet());
  q('settings').addEventListener('click', () => openSheet());

  function openSheet() {
    const bg = el(`<div class="sheet-bg"></div>`);
    const sh = el(`<div class="sheet" role="dialog" aria-label="Reader settings"><h2>Reader</h2><div class="opt"><label>Reading mode</label><div class="seg">${Object.entries(MODES).map(([k, l]) => `<button data-m="${k}" aria-pressed="${settings.mode === k}">${l}</button>`).join('')}</div></div><button class="btn" style="width:100%" data-close>Done</button></div>`);
    const close = () => { bg.remove(); sh.remove(); };
    bg.addEventListener('click', close);
    sh.querySelector('[data-close]').addEventListener('click', close);
    sh.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      settings.mode = b.dataset.m; store.set('settings', settings); close();
      history.replaceState(null, '', `#/read/${enc(sid)}/${cur.ch}`); route(); // re-mount in place; local files live only in memory
    }));
    root.append(bg, sh);
  }

  const onKey = (e) => {
    if (settings.mode === 'webtoon') {
      if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); view.scrollBy({ top: view.clientHeight * 0.85, behavior: 'smooth' }); }
      if (e.key === 'PageUp') { e.preventDefault(); view.scrollBy({ top: -view.clientHeight * 0.85, behavior: 'smooth' }); }
    } else {
      if (e.key === 'ArrowRight') step(settings.mode === 'ltr' ? 1 : -1);
      if (e.key === 'ArrowLeft') step(settings.mode === 'ltr' ? -1 : 1);
      if (e.key === ' ') { e.preventDefault(); step(1); }
    }
    if (e.key === 'm' || e.key === 'M') setHidden(!hidden);
    if (e.key === ']') jumpChapter(cur.ch + 1);
    if (e.key === '[') jumpChapter(cur.ch - 1);
    if (e.key === 'Escape') location.hash = `#/series/${enc(sid)}`;
  };
  document.addEventListener('keydown', onKey);
  root._cleanup = () => document.removeEventListener('keydown', onKey);

  // initial render
  queueMicrotask(async () => {
    if (settings.mode === 'webtoon') { await appendChapter(startCh); updateHud(); view.focus({ preventScroll: true }); }
    else { try { await ensurePages(s, startCh); showPaged(); } catch (err) { fail(err); } }
  });
  return root;
}

/* ---------- router ---------- */
// Remember where each series was opened from, so its Back arrow returns there (a source list, History, Library...).
let lastHash = '';
const seriesOrigin = new Map();
function route() {
  const hash = location.hash;
  const [, a, b, c] = hash.split('/');
  if (a === 'series' && lastHash && lastHash !== hash && !/^#\/(read|series)\//.test(lastHash)) seriesOrigin.set(decodeURIComponent(b), lastHash);
  lastHash = hash;
  let node;
  switch (a) {
    case 'history': node = history(); break;
    case 'browse': node = browse(); break;
    case 'source': node = sourceView(decodeURIComponent(b)); break;
    case 'more': node = more(); break;
    case 'series': node = seriesView(decodeURIComponent(b)); break;
    case 'read': node = reader(decodeURIComponent(b), +c); break;
    default: node = library();
  }
  mount(node);
}
function addLocal(data) {
  const id = `local:${Date.now()}`;
  SERIES.set(id, { id, name: data.name, author: 'Local files', desc: `${data.chapters.length} chapter(s) opened from your computer. Kept in memory until you close the app.`, color: colorOf(id), cover: data.chapters[0]?.pages?.[0] || '', chapters: data.chapters.length, local: true, inLib: true, chs: data.chapters });
  return id;
}
function pick(kind) {
  const input = document.createElement('input');
  input.type = 'file';
  if (kind === 'dir') input.webkitdirectory = true;
  else { input.multiple = true; input.accept = '.cbz,.zip,image/*'; }
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    try {
      const data = await loadFiles(input.files);
      if (!data) { alert('No images or CBZ files found.'); return; }
      location.hash = `#/series/${enc(addLocal(data))}`;
    } catch (err) { alert(`Could not open: ${err.message}`); }
  });
  input.click();
}
document.addEventListener('click', (e) => {
  const ext = e.target.closest('[data-open-url]');
  if (ext) return openExternal(ext.dataset.openUrl);
  const back = e.target.closest('[data-back]');
  if (back) { location.hash = seriesOrigin.get(back.dataset.back) || '#/library'; return; }
  const add = e.target.closest('[data-add]');
  if (add) return pick(add.dataset.add);
  const t = e.target.closest('[data-go]');
  if (t) { location.hash = t.dataset.go; }
});
window.addEventListener('hashchange', route);
route();
