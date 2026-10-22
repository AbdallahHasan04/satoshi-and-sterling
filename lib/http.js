// `cache: 'no-store'` because some APIs (Yahoo Finance) send `max-age=300`, which would make the
// browser hand back 5-minute-old prices; freshness is managed by our own TTLs instead.
export async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
