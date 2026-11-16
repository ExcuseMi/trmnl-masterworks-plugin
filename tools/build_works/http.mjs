// Polite HTTP for Wikidata and Wikimedia: a descriptive User-Agent, a pause between calls, retries with backoff.
export const USER_AGENT = 'trmnl-masterworks-plugin/0.1 (https://github.com/ExcuseMi/trmnl-masterworks-plugin; dev@workstation.bettens.dev)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retries on 429 and 5xx (honours Retry-After), a timeout, and a fixed pause before every call. */
export async function politeFetch(url, opts = {}, { pauseMs = 1000, tries = 5, timeoutMs = 90000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    await sleep(pauseMs);
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
      lastErr.status = res.status;
      if (res.status !== 429 && res.status < 500) throw lastErr; // 4xx other than 429: do not retry
      const wait = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(wait * 1000, attempt * 4000));
    } catch (err) {
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      lastErr = err;
      await sleep(attempt * 4000);
    }
  }
  throw lastErr;
}
