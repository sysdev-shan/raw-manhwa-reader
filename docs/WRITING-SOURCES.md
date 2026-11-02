# Writing a source

A source is one `.js` file. Add it from **Browse → + Source file (.js)**; RAW works out which shape it is. To bundle one with the app instead, put it in `app/extensions/` and add it to the `BUNDLED` list in `app/sources.js` with `kind: 'raw'` (shape 1) or `kind: 'mangayomi'` (shape 2).

Every source runs in isolation and has no network of its own. It asks the app to fetch, and the app only allows the hosts the source declares. Keep to what a site serves openly: free chapters only, nothing behind a login, paywall or purchase.

RAW understands two shapes.

## 1. JSON-API source (runs in a worker)

For sites with a JSON API. There is no HTML parsing in this shape.

```js
const source = {
  id: 'example',
  name: 'Example',
  lang: 'en',
  version: '0.1.0',
  hosts: ['api.example.com'],            // the only hosts this source may reach
  filters: { sort: true, type: true },   // optional: shows Popular/Latest and Manhwa/Manhua/Manga

  async browse(page, { sort, type, q }) {          // optional, used when `filters` is set
    const j = await host.fetchJson(`https://api.example.com/list?page=${page}`);
    return { items: j.items.map(x => ({ id: x.id, title: x.title, cover: x.cover })), hasNext: j.more };
  },
  async popular(page) { /* same return shape as browse */ },
  async search(q, page) { /* same return shape as browse */ },
  async details(id)  { return { id, title, cover, author, description }; },
  async chapters(id) { return [{ id: 'c1', name: 'Chapter 1' }]; },   // oldest first
  async pages(chapterId) { return ['https://.../1.jpg', 'https://.../2.jpg']; },
};
```

`host.fetchJson(url, { headers })` and `host.fetchText(url, { headers })` are the only calls to the outside.

## 2. Mangayomi-style source (runs in the sandbox page)

For sites that need HTML parsing. The format follows Mangayomi's JavaScript sources, so many existing ones load unchanged.

```js
const mangayomiSources = [{
  name: 'Example', id: 'example', lang: 'en',
  baseUrl: 'https://example.com',   // hosts are taken from baseUrl and apiUrl
  apiUrl: '',
  version: '0.1.0',
  filters: { sort: true, type: false },   // optional
}];

class DefaultExtension extends MProvider {
  async getPopular(page) {
    const res = await new Client().get(`${this.source.baseUrl}/popular?page=${page}`);
    const doc = new Document(res.body);
    const list = doc.select('.item a').map(a => ({ name: a.text, link: a.getHref, imageUrl: a.selectFirst('img')?.getSrc }));
    return { list, hasNextPage: !!doc.selectFirst('a.next') };
  }
  async search(query, page) { /* same return shape */ }
  async getDetail(link)  { return { name, imageUrl, author, description, genre: [], chapters: [{ name, url, dateUpload }] }; }
  async getPageList(url) { return ['https://.../1.jpg']; }
  async browse(page, { sort, type, q }) { /* optional, used when `filters` is set */ }
}
```

Available inside the sandbox:

- `Client` with `get(url, headers)` and `post(url, headers, body)`; responses have `body` and `statusCode`.
- `Document` / `Element` with `select`, `selectFirst`, `attr`, `text`, `html`, `outerHtml`, `children`, `parent`, `nextElementSibling`, `getHref`, `getSrc`, and `:contains(...)` in selectors.
- `SharedPreferences` (reads the defaults from `getSourcePreferences()`).

Chapters may come newest-first; RAW reorders them. A page URL may end in `#{"tiles":[...],"tileCols":4,"tileRows":5}` when a site ships shuffled image tiles; the reader puts them back in order.

## Checking a source

Open it from Browse, then check that the list loads, a title opens, the chapter list is complete, and a chapter shows its pages. Images that a site only serves with a `Referer` header are fetched through the app automatically when a direct load fails.
