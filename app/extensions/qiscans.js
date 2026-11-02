// RAW source: Qi Scans (JSON API at api.qimanga.com). Chapters that need a purchase are skipped.
const mangayomiSources = [{
  name: 'Qi Scans',
  id: 'raw-qiscans',
  lang: 'en',
  baseUrl: 'https://qimanga.com',
  apiUrl: 'https://api.qimanga.com/api/v1',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: true },
}];

class DefaultExtension extends MProvider {
  async api(path) {
    const res = await new Client().get(`${this.source.apiUrl}${path}`, {
      Accept: 'application/json, text/plain, */*',
      Referer: `${this.source.baseUrl}/`,
    });
    if (res.statusCode !== 200) throw new Error(`Qi Scans answered HTTP ${res.statusCode}`);
    return JSON.parse(res.body);
  }

  toList(j) {
    const list = (j.data || []).filter((s) => s.type !== 'NOVEL').map((s) => ({ name: s.title, imageUrl: s.cover || '', link: s.slug }));
    return { list, hasNextPage: (j.current || 1) < (j.totalPages || 1) };
  }

  async browse(page, o = {}) {
    if ((o.q || '').trim()) return this.search(o.q, page);
    const type = o.type ? `&type=${o.type.toUpperCase()}` : '';
    return this.toList(await this.api(`/series?page=${page || 1}&perPage=20&sort=${o.sort === 'latest' ? 'latest' : 'popular'}${type}`));
  }

  async getPopular(page) {
    return this.toList(await this.api(`/series?page=${page || 1}&perPage=20&sort=popular`));
  }

  async search(query, page) {
    const q = (query || '').trim();
    if (!q) return this.getPopular(page);
    return this.toList(await this.api(`/series/search?page=${page || 1}&perPage=20&q=${encodeURIComponent(q)}`));
  }

  chapterName(c) {
    const num = c.number == null ? '' : (Number.isInteger(c.number) ? String(c.number) : String(c.number));
    const title = (c.title || '').trim();
    if (!num) return title || 'Chapter';
    if (!title || title === num) return `Chapter ${num}`;
    if (title.includes(num) && /^(chapter|ch\.?|episode|ep\.?)/i.test(title)) return title;
    return `Chapter ${num} - ${title}`;
  }

  async getDetail(slug) {
    const s = await this.api(`/series/${slug}`);
    const chapters = [];
    let page = 1, total = 1;
    do {
      const j = await this.api(`/series/${slug}/chapters?page=${page}&perPage=100&sort=desc`);
      total = j.totalPages || 1;
      for (const c of j.data || []) {
        if (c.requiresPurchase) continue; // paid chapters are not touched
        chapters.push({ name: this.chapterName(c), url: `series/${slug}/chapters/${c.slug}`, dateUpload: String(Date.parse(c.createdAt) || 0) });
      }
      page++;
    } while (page <= total && page <= 50);
    return {
      name: s.title,
      imageUrl: s.cover || '',
      author: (s.author || '').trim(),
      description: [s.description ? s.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '', s.alternativeTitles ? `Alternative titles: ${s.alternativeTitles}` : ''].filter(Boolean).join('\n\n'),
      genre: (s.genres || []).map((g) => g.name),
      status: 0,
      chapters,
    };
  }

  async getPageList(url) {
    const d = await this.api(`/${url}`);
    if (d.requiresPurchase) throw new Error('This chapter needs to be purchased on the site.');
    const images = (d.images || []).map((i) => i.url).filter(Boolean);
    if (!images.length) throw new Error('No images found for this chapter.');
    return images;
  }
}
