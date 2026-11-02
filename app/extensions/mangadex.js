// Reference RAW source: MangaDex's public API (https://api.mangadex.org/docs/).
// Only hosts listed in `hosts` can be reached, and only through host.fetchJson.
const API = 'https://api.mangadex.org';
const PAGE = 20;

const qs = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const base = [['includes[]', 'cover_art'], ['availableTranslatedLanguage[]', 'en'], ['contentRating[]', 'safe'], ['hasAvailableChapters', 'true']];

const pick = (t) => (t && (t.en || Object.values(t)[0])) || 'Untitled';
const toItem = (m) => {
  const art = (m.relationships || []).find((r) => r.type === 'cover_art');
  const file = art && art.attributes && art.attributes.fileName;
  return { id: m.id, title: pick(m.attributes.title), cover: file ? `https://uploads.mangadex.org/covers/${m.id}/${file}.256.jpg` : '' };
};
const list = async (extra, page) => {
  const res = await host.fetchJson(`${API}/manga?${qs([['limit', PAGE], ['offset', (page - 1) * PAGE], ...base, ...extra])}`);
  return { items: res.data.map(toItem), hasNext: res.offset + res.limit < res.total };
};

const source = {
  id: 'mangadex',
  name: 'MangaDex',
  lang: 'en',
  version: '0.1.0',
  hosts: ['api.mangadex.org'],
  filters: { sort: true, type: true },
  // sort: 'popular' | 'latest'; type: '' | 'manhwa' | 'manhua' | 'manga' (by original language)
  browse(page = 1, o = {}) {
    const q = (o.q || '').trim();
    const extra = q ? [['title', q]] : [];
    extra.push(o.sort === 'latest' ? ['order[latestUploadedChapter]', 'desc'] : q ? ['order[relevance]', 'desc'] : ['order[followedCount]', 'desc']);
    for (const l of ({ manhwa: ['ko'], manhua: ['zh', 'zh-hk'], manga: ['ja'] }[o.type] || [])) extra.push(['originalLanguage[]', l]);
    return list(extra, page);
  },
  popular: (page = 1) => list([['order[followedCount]', 'desc']], page),
  search: (q, page = 1) => list([['title', q], ['order[relevance]', 'desc']], page),

  async details(id) {
    const res = await host.fetchJson(`${API}/manga/${id}?${qs([['includes[]', 'cover_art'], ['includes[]', 'author']])}`);
    const m = res.data;
    const author = (m.relationships || []).filter((r) => r.type === 'author').map((r) => r.attributes && r.attributes.name).filter(Boolean).join(', ');
    return { ...toItem(m), author, description: (m.attributes.description && m.attributes.description.en) || '' };
  },

  // oldest -> newest, one entry per chapter number
  async chapters(id) {
    const seen = new Set(); const out = [];
    for (let offset = 0, total = 1; offset < total && offset < 2000; offset += 500) {
      const res = await host.fetchJson(`${API}/manga/${id}/feed?${qs([['limit', 500], ['offset', offset], ['translatedLanguage[]', 'en'], ['order[volume]', 'asc'], ['order[chapter]', 'asc'], ['contentRating[]', 'safe'], ['contentRating[]', 'suggestive'], ['includeExternalUrl', '0']])}`);
      total = res.total;
      for (const c of res.data) {
        const a = c.attributes; if (!a.pages) continue;
        const key = a.chapter == null ? 'oneshot:' + c.id : a.chapter;
        if (seen.has(key)) continue; seen.add(key);
        out.push({ id: c.id, name: a.chapter == null ? 'Oneshot' : `Ch. ${a.chapter}${a.title ? ' - ' + a.title : ''}` });
      }
    }
    return out;
  },

  async pages(chapterId) {
    const r = await host.fetchJson(`${API}/at-home/server/${chapterId}`);
    return r.chapter.data.map((f) => `${r.baseUrl}/data/${r.chapter.hash}/${f}`);
  },
};
