// One door to the network. In the app it goes through the Rust `http_fetch` command;
// in a plain browser (dev preview) it falls back to fetch().
// extra: { method, body, hosts } - hosts are the only ones redirects may follow to.
const invoke = () => window.__TAURI__?.core?.invoke;

const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const args = (url, headers, binary, extra = {}) => ({ url, headers: headers ?? null, binary, method: extra.method ?? null, body: extra.body ?? null, hosts: extra.hosts ?? null });

// -> { status, bytes: Uint8Array }
export async function fetchBytes(url, headers, extra) {
  const inv = invoke();
  if (inv) {
    const r = await inv('http_fetch', args(url, headers, true, extra));
    return { status: r.status, bytes: fromB64(r.body) };
  }
  const r = await fetch(url, { headers, method: extra?.method, body: extra?.body });
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}

export async function fetchText(url, headers, extra) {
  const inv = invoke();
  if (inv) {
    const r = await inv('http_fetch', args(url, headers, false, extra));
    return { status: r.status, text: r.body };
  }
  const r = await fetch(url, { headers, method: extra?.method, body: extra?.body });
  return { status: r.status, text: await r.text() };
}
