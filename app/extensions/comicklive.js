// RAW source: "Comick (comick.live)". NOT the original Comick, whose operator shut it down; this is an unofficial copy.
// List and chapter data come from its JSON API; details and pages from the JSON each page embeds. English chapters only.
const mangayomiSources = [{
  name: 'Comick (comick.live)',
  id: 'raw-comicklive',
  lang: 'en',
  baseUrl: 'https://comick.live',
  apiUrl: '',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: false },
}];

class DefaultExtension extends MProvider {
  cursor = null;

  async get(path, accept) {
    const res = await new Client().get(`${this.source.baseUrl}${path}`, { Accept: accept, Referer: `${this.source.baseUrl}/` });
    if (res.statusCode === 429) throw new Error('comick.live asked us to slow down (HTTP 429). Try again in a moment.');
    if (res.statusCode !== 200) throw new Error(`comick.live answered HTTP ${res.statusCode}`);
    return res.body;
  }

  items(rows) { return (rows || []).map((c) => ({ name: c.title, imageUrl: c.default_thumbnail || '', link: c.slug })); }

  // Latest = newest chapters; the same comic can appear twice, so keep the first of each.
  async browse(page, o = {}) {
    if ((o.q || '').trim()) return this.search(o.q, page);
    if (o.sort !== 'latest') return this.getPopular(page);
    const p = page || 1;
    if (p === 1) this.latestCursor = null;
    const cursor = p > 1 && this.latestCursor ? `&cursor=${encodeURIComponent(this.latestCursor)}` : '';
    const j = JSON.parse(await this.get(`/api/chapters/latest?order=new&page=${p}${cursor}`, 'application/json'));
    this.latestCursor = j.next_cursor || null;
    const seen = new Set();
    const list = this.items(j.data).filter((c) => !seen.has(c.link) && seen.add(c.link));
    return { list, hasNextPage: !!j.next_cursor };
  }

  // "top" lists come in 6 fixed windows (week/month/quarter x two ranking types)
  async getPopular(page) {
    const p = page || 1;
    if (p > 6) return { list: [], hasNextPage: false };
    const day = [7, 30, 90][(p - 1) % 3];
    const type = p <= 3 ? 'follow' : 'most_follow_new';
    const j = JSON.parse(await this.get(`/api/comics/top?day=${day}&type=${type}`, 'application/json'));
    return { list: this.items(j.data), hasNextPage: p < 6 };
  }

  async search(query, page) {
    const q = (query || '').trim();
    if (!q) return this.getPopular(page);
    if (q.length < 3) throw new Error('Search needs at least 3 characters.');
    if ((page || 1) === 1) this.cursor = null;
    const cursor = (page || 1) > 1 && this.cursor ? `&cursor=${encodeURIComponent(this.cursor)}` : '';
    const j = JSON.parse(await this.get(`/api/search?showAll=false&exclude_mylist=false&q=${encodeURIComponent(q)}&type=comic${cursor}`, 'application/json'));
    this.cursor = j.next_cursor || null;
    return { list: this.items(j.data), hasNextPage: !!j.next_cursor };
  }

  async getDetail(slug) {
    const doc = new Document(await this.get(`/comic/${slug}`, 'text/html'));
    const raw = doc.selectFirst('#comic-data')?.html;
    if (!raw) throw new Error('Could not read this comic.');
    const d = JSON.parse(raw);
    const titles = d.md_titles ? (Array.isArray(d.md_titles) ? d.md_titles : Object.values(d.md_titles)) : [];
    const desc = new Document(`<div>${d.desc || ''}</div>`).text;

    // chapter list: paged JSON, English only; keep the first upload of each chapter number
    const base = `/api/comics/${slug}/chapter-list?lang=en`;
    const first = JSON.parse(await this.get(base, 'application/json'));
    let rows = first.data || [];
    const last = (first.pagination && first.pagination.lastPage) || 1;
    for (let p = 2; p <= last && p <= 60; p++) {
      rows = rows.concat(JSON.parse(await this.get(`${base}&page=${p}`, 'application/json')).data || []);
    }
    const seen = new Set();
    const chapters = [];
    for (const c of rows) {
      if (c.lang && c.lang !== 'en') continue;
      const key = `${c.vol || ''}|${c.chap}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chapters.push({
        name: `${c.vol ? `Vol. ${c.vol} ` : ''}Ch. ${c.chap}${c.title ? `: ${c.title}` : ''}`,
        url: `/comic/${slug}/${c.hid}-chapter-${c.chap}-${c.lang || 'en'}`,
        dateUpload: String(Date.parse(c.created_at) || 0),
      });
    }
    return {
      name: d.title,
      imageUrl: d.default_thumbnail || '',
      author: (d.authors || []).map((a) => a.name).join(', '),
      description: [desc, titles.length ? `Alternative titles: ${titles.map((t) => t.title).join(' / ')}` : ''].filter(Boolean).join('\n\n'),
      genre: [d.country === 'ko' ? 'Manhwa' : d.country === 'cn' ? 'Manhua' : d.country === 'jp' ? 'Manga' : '', ...(d.md_comic_md_genres || []).map((g) => g.md_genres && g.md_genres.name)].filter(Boolean),
      status: d.status === 2 ? 1 : 0,
      chapters,
    };
  }

  async getPageList(url) {
    const doc = new Document(await this.get(url, 'text/html'));
    const raw = doc.selectFirst('#sv-data')?.html;
    if (!raw) throw new Error('No reader data on this page.');
    const images = ((JSON.parse(raw).chapter || {}).images || []).map((i) => i.url).filter(Boolean);
    if (!images.length) throw new Error('No images found for this chapter.');
    return images;
  }
}
