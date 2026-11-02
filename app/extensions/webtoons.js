// RAW's own Webtoons source (Originals, English). Written for RAW's Mangayomi-compatible runtime.
// The phone site loads its episode list with JavaScript, so this reads the desktop list pages, 10 episodes each.
const mangayomiSources = [{
  name: 'Webtoons (RAW)',
  id: 'raw-webtoons',
  lang: 'en',
  baseUrl: 'https://www.webtoons.com',
  apiUrl: '',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: false },
}];

class DefaultExtension extends MProvider {
  async page(url) {
    const res = await new Client().get(url);
    if (res.statusCode !== 200) throw new Error(`Webtoons answered HTTP ${res.statusCode}`);
    return new Document(res.body);
  }

  titles(doc) {
    const out = [];
    for (const a of doc.select('ul.webtoon_list li a, div.webtoon_list_wrap li a, ul.card_lst li a')) {
      const name = a.selectFirst('strong.title, .subj')?.text || '';
      const link = a.getHref;
      if (name && link) out.push({ name, link, imageUrl: a.selectFirst('img')?.getSrc || '' });
    }
    return out;
  }

  async browse(page, o = {}) {
    if ((o.q || '').trim()) return this.search(o.q, page);
    const suffix = o.sort === 'latest' ? '?sortOrder=UPDATE' : '';
    return { list: this.titles(await this.page(`${this.source.baseUrl}/en/originals${suffix}`)), hasNextPage: false };
  }

  async getPopular() {
    return { list: this.titles(await this.page(`${this.source.baseUrl}/en/originals`)), hasNextPage: false };
  }

  async search(query, page) {
    const q = (query || '').trim();
    if (!q) return this.getPopular();
    const list = this.titles(await this.page(`${this.source.baseUrl}/en/search/originals?keyword=${encodeURIComponent(q)}&page=${page || 1}`));
    return { list, hasNextPage: list.length > 0 };
  }

  episodes(doc) {
    const out = [];
    for (const li of doc.select('ul#_listUl li[id^=episode_]')) {
      const a = li.selectFirst('a');
      if (!a) continue;
      const subj = (li.selectFirst('span.subj span, .subj')?.text || '').replace(/UP$/, '').trim();
      const date = Date.parse(li.selectFirst('span.date')?.text || '');
      out.push({ name: subj || li.id.replace('episode_', 'Episode '), url: a.getHref, dateUpload: String(date || 0), no: Number(li.id.replace('episode_', '')) || 0 });
    }
    return out;
  }

  async getDetail(url) {
    const first = await this.page(url);
    const name = first.selectFirst('h1.subj, .detail_header h1')?.text || 'Untitled';
    const author = (first.selectFirst('div.author_area')?.text || '').replace(/author info/gi, '').trim();
    const description = first.selectFirst('p.summary')?.text || '';
    const imageUrl = first.selectFirst('span.thmb img, .detail_body img')?.getSrc || '';
    const genre = first.select('p.genre, h2.genre').map((g) => g.text);

    // page 1 is already loaded; walk the rest until a page adds nothing new
    const seen = new Set();
    const chapters = [];
    const take = (list) => { let added = 0; for (const e of list) { if (!seen.has(e.no)) { seen.add(e.no); chapters.push(e); added++; } } return added; };
    take(this.episodes(first));
    const sep = url.includes('?') ? '&' : '?';
    for (let p = 2; p <= 150; p += 4) {
      const batch = await Promise.all([0, 1, 2, 3].map((i) => this.page(`${url}${sep}page=${p + i}`).then((d) => this.episodes(d)).catch(() => [])));
      let added = 0;
      for (const list of batch) added += take(list);
      if (!added) break;
    }
    chapters.sort((a, b) => b.no - a.no); // newest first, like other sources
    return { name, link: url, imageUrl, author, description, genre, status: 0, chapters: chapters.map(({ name: n, url: u, dateUpload }) => ({ name: n, url: u, dateUpload })) };
  }

  async getPageList(url) {
    const doc = await this.page(url);
    return doc.select('div#_imageList img').map((i) => i.attr('data-url')).filter(Boolean);
  }
}
