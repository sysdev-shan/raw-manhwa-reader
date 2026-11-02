// RAW source: Thunder Scans (en-thunderscans.com), a WordPress "MangaThemesia" site. Locked chapters are skipped.
const mangayomiSources = [{
  name: 'Thunder Scans',
  id: 'raw-thunderscans',
  lang: 'en',
  baseUrl: 'https://en-thunderscans.com',
  apiUrl: '',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: true },
}];

class DefaultExtension extends MProvider {
  async page(url) {
    const res = await new Client().get(url, { Accept: 'text/html,*/*' });
    if (res.statusCode !== 200) throw new Error(`Thunder Scans answered HTTP ${res.statusCode}`);
    return res;
  }

  list(doc) {
    const out = [];
    for (const box of doc.select('.listupd .bs .bsx, .utao .uta .imgu')) {
      const a = box.selectFirst('a');
      if (!a) continue;
      const name = box.selectFirst('.tt, h3 a')?.text || a.attr('title');
      if (name) out.push({ name, link: a.getHref, imageUrl: box.selectFirst('img')?.getSrc || '' });
    }
    return { list: out, hasNextPage: !!doc.selectFirst('div.pagination .next, div.hpage .r, a.next') };
  }

  async browse(page, o = {}) {
    if ((o.q || '').trim()) return this.search(o.q, page);
    const type = o.type ? `&type=${o.type}` : '';
    const order = o.sort === 'latest' ? 'update' : 'popular';
    return this.list(new Document((await this.page(`${this.source.baseUrl}/comics/?page=${page || 1}&order=${order}${type}`)).body));
  }

  async getPopular(page) {
    return this.list(new Document((await this.page(`${this.source.baseUrl}/comics/?page=${page || 1}&order=popular`)).body));
  }

  async search(query, page) {
    const q = (query || '').trim();
    if (!q) return this.getPopular(page);
    return this.list(new Document((await this.page(`${this.source.baseUrl}/comics/?title=${encodeURIComponent(q)}&page=${page || 1}`)).body));
  }

  async getDetail(url) {
    const doc = new Document((await this.page(url)).body);
    const info = (label) => {
      for (const row of doc.select('.imptdt, .tsinfo .imptdt')) {
        if (row.text.toLowerCase().startsWith(label)) return row.selectFirst('i, a')?.text || row.text.slice(label.length).trim();
      }
      return '';
    };
    const chapters = [];
    for (const li of doc.select('#chapterlist li, div.bxcl li, div.cl li')) {
      const href = li.selectFirst('a')?.getHref;
      if (!href) continue; // locked chapter
      const name = (li.selectFirst('.chapternum')?.text || li.selectFirst('a')?.text || '').replace(/\s+/g, ' ').trim();
      chapters.push({ name, url: href, dateUpload: String(Date.parse(li.selectFirst('.chapterdate')?.text || '') || 0) });
    }
    return {
      name: doc.selectFirst('h1.entry-title')?.text || 'Untitled',
      imageUrl: doc.selectFirst('.thumb img')?.getSrc || '',
      author: info('author'),
      description: doc.selectFirst('div.entry-content[itemprop=description], .entry-content')?.text || '',
      genre: doc.select('.mgen a').map((g) => g.text),
      status: 0,
      chapters,
    };
  }

  async getPageList(url) {
    const body = (await this.page(url)).body;
    const m = body.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
    if (!m) throw new Error('No reader data on this page (locked chapter?).');
    const images = (JSON.parse(m[1]).sources?.[0]?.images || []).filter(Boolean);
    if (!images.length) throw new Error('No images found for this chapter.');
    return images;
  }
}
