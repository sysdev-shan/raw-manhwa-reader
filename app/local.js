// Local reading: CBZ/ZIP archives and image folders -> chapters of blob URLs.
// Zip support is a minimal central-directory reader (stored + deflate) to stay dependency-free.
const IMG = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);
const ext = (n) => n.slice(n.lastIndexOf('.') + 1).toLowerCase();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZip(file) {
  const buf = await file.arrayBuffer();
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const pages = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (!IMG.test(name) || name.includes('__MACOSX')) continue;
    const dataStart = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const raw = new Uint8Array(buf, dataStart, csize);
    if (method !== 0 && method !== 8) continue;
    pages.push({ name, raw, method });
  }
  pages.sort(byName);
  const out = [];
  for (const pg of pages) {
    const bytes = pg.method === 0 ? pg.raw : await inflateRaw(pg.raw);
    out.push(URL.createObjectURL(new Blob([bytes], { type: MIME[ext(pg.name)] ?? 'image/jpeg' })));
  }
  return out;
}

// files: FileList from <input multiple> or <input webkitdirectory>.
// Returns { name, chapters: [{ name, pages: [url] }] } or null.
export async function loadFiles(files) {
  const list = [...files];
  const chapters = [];
  const groups = new Map();
  for (const f of list) {
    if (/\.(cbz|zip)$/i.test(f.name)) {
      const pages = await readZip(f);
      if (pages.length) chapters.push({ name: f.name.replace(/\.[^.]+$/, ''), pages });
    } else if (IMG.test(f.name)) {
      const parts = (f.webkitRelativePath || '').split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'Pages';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(f);
    }
  }
  for (const [dir, fs] of groups) {
    fs.sort(byName);
    chapters.push({ name: dir.split('/').pop(), pages: fs.map((f) => URL.createObjectURL(f)) });
  }
  if (!chapters.length) return null;
  chapters.sort(byName);
  const first = list[0].webkitRelativePath ? list[0].webkitRelativePath.split('/')[0] : chapters[0].name;
  return { name: first, chapters };
}
