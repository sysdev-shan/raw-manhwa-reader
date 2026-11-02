// RAW source: Elf Toon (elftoon.net, "Elf Scans"). List and search use a JSON API; details and pages come from the
// site's Next.js stream (request header "rsc: 1"). Locked (coin) chapters are skipped.
const mangayomiSources = [{
  name: 'Elf Toon',
  id: 'raw-elftoon',
  lang: 'en',
  baseUrl: 'https://elftoon.net',
  apiUrl: '',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: true },
}];

class DefaultExtension extends MProvider {
  abs(u) { return !u ? '' : /^https?:/.test(u) ? u : `${this.source.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`; }

  async json(path) {
    const res = await new Client().get(`${this.source.baseUrl}${path}`, { Accept: 'application/json, text/plain, */*', Referer: `${this.source.baseUrl}/` });
    if (res.statusCode !== 200) throw new Error(`Elf Toon answered HTTP ${res.statusCode}`);
    return JSON.parse(res.body);
  }

  // Next.js "RSC" payload: lines like  1a:{...json...}. Collect the JSON ones and search them.
  async rsc(path) {
    const res = await new Client().get(`${this.source.baseUrl}${path}`, { rsc: '1', Accept: 'text/x-component, */*', Referer: `${this.source.baseUrl}/` });
    if (res.statusCode !== 200) throw new Error(`Elf Toon answered HTTP ${res.statusCode}`);
    const objs = [];
    for (const line of res.body.split('\n')) {
      const m = line.match(/^[0-9a-f]+:([\[{].*)$/);
      if (!m) continue;
      try { objs.push(JSON.parse(m[1])); } catch (e) { /* not JSON */ }
    }
    return objs;
  }

  find(node, pred, seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (!Array.isArray(node) && pred(node)) return node;
    for (const k of Object.keys(node)) { const r = this.find(node[k], pred, seen); if (r) return r; }
    return null;
  }

  toList(j) {
    const list = (j.data || []).map((s) => ({ name: s.title, imageUrl: this.abs(s.coverImage), link: s.slug }));
    return { list, hasNextPage: !!(j.meta && j.meta.hasMore) };
  }

  async browse(page, o = {}) {
    const q = (o.q || '').trim();
    const sort = q ? '' : `&sort=${o.sort === 'latest' ? 'updated' : 'popular'}`;
    const type = o.type ? `&type=${o.type.toUpperCase()}` : '';
    return this.toList(await this.json(`/api/series?limit=24&contentMode=comics&page=${page || 1}${sort}${type}${q ? `&q=${encodeURIComponent(q)}` : ''}`));
  }

  async getPopular(page) { return this.toList(await this.json(`/api/series?sort=popular&contentMode=comics&page=${page || 1}&limit=24`)); }

  async search(query, page) {
    const q = (query || '').trim();
    if (!q) return this.getPopular(page);
    return this.toList(await this.json(`/api/series?limit=24&contentMode=comics&q=${encodeURIComponent(q)}&page=${page || 1}`));
  }

  async getDetail(slug) {
    const first = this.find(await this.rsc(`/series/comic/${slug}?sort=desc`), (o) => o.series && o.chapters);
    if (!first) throw new Error('Could not read this series.');
    let chapters = first.chapters.slice();
    for (let p = 2; p <= (first.totalPages || 1) && p <= 60; p++) {
      const d = this.find(await this.rsc(`/series/comic/${slug}?sort=desc&page=${p}`), (o) => o.series && o.chapters);
      if (d) chapters = chapters.concat(d.chapters);
    }
    const s = first.series;
    const seen = new Set();
    const open = chapters.filter((c) => !c.isLocked && !seen.has(c.number) && seen.add(c.number));
    const text = (s.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      name: s.title,
      imageUrl: this.abs(s.coverImage),
      author: (s.team && s.team.name) || '',
      description: [text, s.altTitle ? `Alternative titles: ${s.altTitle}` : ''].filter(Boolean).join('\n\n'),
      genre: [s.type, s.origin, ...(s.genres || []).map((g) => g.name || (g.genre && g.genre.slug))].filter(Boolean),
      status: 0,
      chapters: open.map((c) => {
        const n = String(c.number).replace(/\.0$/, '');
        return { name: !c.title || c.title === n ? `Chapter ${n}` : c.title, url: `${slug}/chapter/${n}`, dateUpload: String(Date.parse(c.publishedAt) || 0) };
      }),
    };
  }

  async getPageList(url) {
    const hit = this.find(await this.rsc(`/series/comic/${url}`), (o) => o.chapter && o.chapter.pages);
    const pages = ((hit && hit.chapter.pages) || []).map((p) => this.abs(p.imageUrl)).filter(Boolean);
    if (!pages.length) throw new Error('No images found (locked chapter?).');
    return pages;
  }
}
