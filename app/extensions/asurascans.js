// RAW source: Asura Scans (asurascans.com). The list uses a JSON API; details, chapters and pages come from the data
// each page embeds in its <astro-island props="..."> elements. Premium and early-access chapters are skipped.
// Pages that ship tile data get it appended as a #fragment; the reader puts the tiles back in order.
const mangayomiSources = [{
  name: 'Asura Scans',
  id: 'raw-asurascans',
  lang: 'en',
  baseUrl: 'https://asurascans.com',
  apiUrl: 'https://api.asurascans.com/api',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: true },
}];

const PER_PAGE = 20;

class DefaultExtension extends MProvider {
  async get(url, accept) {
    const res = await new Client().get(url, { Accept: accept, Referer: `${this.source.baseUrl}/` });
    if (res.statusCode !== 200) throw new Error(`Asura Scans answered HTTP ${res.statusCode}`);
    return res.body;
  }

  browse(page, o = {}) { return this.list(page, (o.q || '').trim(), o.sort === 'latest' ? 'latest' : 'popular', o.type); }

  async list(page, search, sort, type) {
    const kind = type ? `&type=${type}` : '';
    const q = `${this.source.apiUrl}/series?offset=${((page || 1) - 1) * PER_PAGE}&limit=${PER_PAGE}&sort=${sort}&order=desc${kind}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
    const j = JSON.parse(await this.get(q, 'application/json'));
    return {
      list: (j.data || []).map((s) => ({ name: s.title, imageUrl: s.cover || '', link: s.public_url })),
      hasNextPage: !!(j.meta && j.meta.has_more),
    };
  }

  getPopular(page) { return this.list(page, '', 'popular'); }

  search(query, page) {
    const q = (query || '').trim();
    return q ? this.list(page, q, 'popular') : this.getPopular(page);
  }

  // Astro stores props as [type, value] pairs; strip that wrapper.
  unwrap(v) {
    if (Array.isArray(v)) {
      if (v.length === 0) return null;
      if (v.length === 1 && typeof v[0] === 'number') return null;
      if (v.length === 2 && typeof v[0] === 'number') return this.unwrap(v[1]);
      return v.map((x) => this.unwrap(x));
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.unwrap(x)]));
    return v;
  }

  prop(doc, ...keys) {
    for (const el of doc.select('[props]')) {
      const raw = el.attr('props');
      if (keys.every((k) => raw.includes(`"${k}"`))) {
        try { return this.unwrap(JSON.parse(raw)); } catch (e) { /* try the next island */ }
      }
    }
    return null;
  }

  isOpen(c) {
    if (c.is_premium || c.is_locked) return false;
    return !(c.early_access_until && Date.parse(c.early_access_until) > Date.now());
  }

  async getDetail(link) {
    const doc = new Document(await this.get(`${this.source.baseUrl}${link}`, 'text/html'));
    const d = this.prop(doc, 'title', 'description') || {};
    const c = this.prop(doc, 'chapters') || {};
    const chapters = (c.chapters || []).filter((x) => this.isOpen(x)).map((x) => {
      const n = String(x.number).replace(/\.0$/, '');
      return { name: `Chapter ${n}${x.title ? ` - ${x.title}` : ''}`, url: `${link}/chapter/${n}`, dateUpload: String(Date.parse(x.created_at) || 0) };
    });
    const alt = (d.alternativeTitles || '').trim();
    const text = (d.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      name: d.title || 'Untitled',
      imageUrl: d.coverUrl || '',
      author: [d.author, d.artist].filter((x, i, a) => x && a.indexOf(x) === i).join(', '),
      description: [text, alt ? `Alternative titles: ${alt}` : ''].filter(Boolean).join('\n\n'),
      genre: [d.type, ...(d.genres || []).map((g) => g.name)].filter(Boolean),
      status: 0,
      chapters,
    };
  }

  async getPageList(url) {
    const doc = new Document(await this.get(`${this.source.baseUrl}${url}`, 'text/html'));
    const p = this.prop(doc, 'pages');
    const pages = ((p && p.pages) || []).map((pg) => (pg.tiles && pg.tiles.length
      ? `${pg.url}#${JSON.stringify({ tiles: pg.tiles, tileCols: pg.tile_cols || 4, tileRows: pg.tile_rows || 5 })}`
      : pg.url));
    if (!pages.length) throw new Error('No free pages for this chapter (premium or not released yet).');
    return pages;
  }
}
