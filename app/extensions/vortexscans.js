// RAW source: Vortex Scans (vortexscans.org, JSON API at api.vortexscans.org). Locked and paid chapters are skipped.
const mangayomiSources = [{
  name: 'Vortex Scans',
  id: 'raw-vortexscans',
  lang: 'en',
  baseUrl: 'https://vortexscans.org',
  apiUrl: 'https://api.vortexscans.org',
  version: '0.1.0',
  isNsfw: false,
  filters: { sort: true, type: true },
}];

const PER_PAGE = 18;

class DefaultExtension extends MProvider {
  async api(path) {
    const res = await new Client().get(`${this.source.apiUrl}${path}`, {
      Accept: 'application/json, text/plain, */*',
      Referer: `${this.source.baseUrl}/`,
    });
    if (res.statusCode !== 200) throw new Error(`Vortex Scans answered HTTP ${res.statusCode}`);
    return JSON.parse(res.body);
  }

  browse(page, o = {}) {
    const term = (o.q || '').trim();
    return this.query(page, term, o.sort === 'latest' || term ? 'lastChapterAddedAt' : 'totalViews', o.type);
  }

  async query(page, term, orderBy, type) {
    const kind = type ? `&seriesType=${type.toUpperCase()}` : '';
    const q = `/api/query?page=${page || 1}&perPage=${PER_PAGE}&searchTerm=${encodeURIComponent(term)}&orderBy=${orderBy}&orderDirection=desc${kind}`;
    const j = await this.api(q);
    const list = (j.posts || []).filter((p) => !p.isNovel).map((p) => ({ name: p.postTitle, imageUrl: p.featuredImage || '', link: `${p.slug}#${p.id}` }));
    return { list, hasNextPage: (j.totalCount || 0) > (page || 1) * PER_PAGE };
  }

  getPopular(page) { return this.query(page, '', 'totalViews'); }

  search(query, page) {
    const q = (query || '').trim();
    return q ? this.query(page, q, 'lastChapterAddedAt') : this.getPopular(page);
  }

  async getDetail(link) {
    const [slug, id] = link.split('#');
    const detail = await this.api(`/api/post?postSlug=${encodeURIComponent(slug)}`);
    const post = detail.post || {};
    if (post.isNovel) throw new Error('This is a novel; RAW only reads comics.');
    let chapters = post.chapters || [];
    // the series endpoint can omit chapters; the chapters endpoint always lists them
    if (!chapters.length || (detail.totalChapterCount || 0) > chapters.length) {
      const c = await this.api(`/api/chapters?postId=${id || post.id}`);
      chapters = (c.post && c.post.chapters) || chapters;
    }
    const open = chapters.filter((c) => !c.isLocked && !c.isPermanentlyLocked && !c.isShortLinkLocked && c.isAccessible !== false && !(c.price > 0 && !c.isAccessible));
    const text = (post.postContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const alt = (post.alternativeTitles || '').trim();
    return {
      name: post.postTitle || 'Untitled',
      imageUrl: post.featuredImage || '',
      author: [post.author, post.artist].filter(Boolean).join(', '),
      description: [text, alt ? `Alternative titles: ${alt}` : ''].filter(Boolean).join('\n\n'),
      genre: [post.seriesType, ...(post.genres || []).map((g) => g.name || (g.genre && g.genre.name))].filter(Boolean),
      status: 0,
      chapters: open.map((c) => ({
        name: `Chapter ${c.number}${c.title ? ` - ${c.title}` : ''}`,
        url: String(c.id),
        dateUpload: String(Date.parse(c.createdAt) || 0),
      })),
    };
  }

  async getPageList(chapterId) {
    const j = await this.api(`/api/chapter?chapterId=${chapterId}`);
    const c = j.chapter || {};
    if (c.isShortLinkLocked) throw new Error('Chapter locked (short link).');
    if (c.isLockedByCoins) throw new Error('Chapter locked (coins required).');
    if (c.isPermanentlyLocked) throw new Error('Chapter permanently locked.');
    const images = (c.images || []).slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)).map((i) => String(i.url).replace(/ /g, '%20'));
    if (!images.length) throw new Error('No images found for this chapter.');
    return images;
  }
}
