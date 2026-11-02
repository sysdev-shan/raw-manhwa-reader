// Reads a Mihon-style extension store (e.g. Keiyoushi's index.pb).
// Layout mirrors mihon/data/extension/model/NetworkExtensionStore.kt:
//   1 name, 2 badgeLabel, 3 signingKey, 4 contact{1 website, 2 discord}, 101 extensionList{1: Extension*}
//   Extension: 1 name, 2 package, 3 resources{1 apkUrl, 2 iconUrl}, 4 extensionLib, 5 versionCode,
//              6 versionName, 7 contentWarning(1 safe,2 mixed,3 nsfw), 8 sources*
//   Source: 1 id, 2 name, 3 language, 4 homeUrl
import { fetchBytes } from './net.js';

const dec = new TextDecoder();

function varint(b, p) {
  let r = 0, s = 0;
  for (;;) { const x = b[p++]; r += (x & 127) * 2 ** s; if (!(x & 128)) break; s += 7; }
  return [r, p];
}
function fields(b) {
  const out = []; let p = 0;
  while (p < b.length) {
    let tag; [tag, p] = varint(b, p);
    const f = Math.floor(tag / 8), w = tag & 7;
    if (w === 0) { let v; [v, p] = varint(b, p); out.push([f, v]); }
    else if (w === 2) { let l; [l, p] = varint(b, p); out.push([f, b.subarray(p, p + l)]); p += l; }
    else if (w === 1) p += 8;
    else if (w === 5) p += 4;
    else throw new Error('unsupported protobuf wire type');
  }
  return out;
}
const one = (fs, n) => fs.find((x) => x[0] === n)?.[1];
const str = (fs, n) => { const v = one(fs, n); return v instanceof Uint8Array ? dec.decode(v) : ''; };
const all = (fs, n) => fs.filter((x) => x[0] === n).map((x) => x[1]);

async function gunzipIfNeeded(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const WARN = { 1: 'safe', 2: 'mixed', 3: 'nsfw' };

// Mangayomi's index.json: a JSON array. sourceCodeLanguage 1 = JavaScript (runnable in RAW), 0 = Dart (not).
function mangayomiStore(indexUrl, raw) {
  const list = JSON.parse(dec.decode(raw));
  if (!Array.isArray(list) || !list.every((e) => e && 'sourceCodeUrl' in e)) {
    throw new Error('Old Tachiyomi JSON index. Use the repo\'s index.pb link instead.');
  }
  const extensions = list.filter((e) => e.isManga !== false).map((e) => ({
    name: e.name,
    pkg: String(e.id),
    apkUrl: '',
    iconUrl: e.iconUrl || '',
    lib: '',
    version: e.version || '',
    warn: e.isNsfw ? 'nsfw' : 'safe',
    lang: e.lang || 'all',
    sources: [{ id: String(e.id), name: e.name, lang: e.lang || 'all', home: e.baseUrl || '' }],
    runnable: e.sourceCodeLanguage === 1,
    codeUrl: e.sourceCodeUrl,
    baseUrl: e.baseUrl || '',
    cloudflare: !!e.hasCloudflare,
  }));
  return { url: indexUrl, kind: 'mangayomi', name: 'Mangayomi', badge: 'JS', signingKey: '', website: '', extensions };
}

export async function loadStore(indexUrl) {
  const { status, bytes } = await fetchBytes(indexUrl);
  if (status !== 200) throw new Error(`Store returned HTTP ${status}`);
  const raw = await gunzipIfNeeded(bytes);
  if (raw[0] === 0x5b) return mangayomiStore(indexUrl, raw);
  if (raw[0] === 0x7b) throw new Error('This JSON is not a store RAW understands. Use an index.pb or a Mangayomi index.json link.');
  const top = fields(raw);
  const list = one(top, 101);
  if (!(list instanceof Uint8Array)) throw new Error('No extension list in this store');
  const contact = fields(one(top, 4) ?? new Uint8Array());
  const extensions = all(fields(list), 1).map((eb) => {
    const e = fields(eb);
    const res = fields(one(e, 3) ?? new Uint8Array());
    const sources = all(e, 8).map((sb) => {
      const s = fields(sb);
      return { id: String(one(s, 1) ?? ''), name: str(s, 2), lang: str(s, 3), home: str(s, 4) };
    });
    const langs = new Set(sources.map((s) => s.lang));
    return {
      name: str(e, 1),
      pkg: str(e, 2),
      apkUrl: str(res, 1),
      iconUrl: str(res, 2),
      lib: str(e, 4),
      version: str(e, 6),
      warn: WARN[one(e, 7)] ?? 'safe',
      lang: langs.size === 1 ? [...langs][0] : 'all',
      sources,
    };
  });
  return {
    url: indexUrl,
    name: str(top, 1),
    badge: str(top, 2),
    signingKey: str(top, 3),
    website: str(contact, 1),
    extensions,
  };
}
