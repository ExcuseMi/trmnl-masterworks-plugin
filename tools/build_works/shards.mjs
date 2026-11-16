// Packing: compact JSON with short keys and shared tables for collection and movement names.
export const LANDSCAPE_MIN_ASPECT = 0.9; // width / height; near-square works are in both shards
export const PORTRAIT_MAX_ASPECT = 1.1;

/** works: [{ id, title, artist, year, coll, mov, medium, size, dm, file, w, h, sl, score, dark }] -> one packed document. */
export function pack(works, meta) {
  const col = [], mov = [], med = [];
  const idx = (table, v) => {
    if (!v) return -1;
    let i = table.indexOf(v);
    if (i < 0) i = table.push(v) - 1;
    return i;
  };
  const w = works.map((x) => {
    const o = { i: x.id, t: x.title, a: x.artist, f: x.file, w: x.w, h: x.h, s: x.sl, p: x.score, k: x.dark };
    if (x.size) o.z = x.size;
    if (x.dm) o.n = 1; // 1: the work hangs on a black mat (a dark work), no key: a white one
    const e = idx(med, x.medium);
    if (e >= 0) o.e = e;
    if (x.year !== undefined) o.y = x.year;
    const c = idx(col, x.coll), m = idx(mov, x.mov);
    if (c >= 0) o.c = c;
    if (m >= 0) o.m = m;
    return o;
  });
  return { ...meta, n: w.length, col, mov, med, w };
}

export const aspect = (x) => x.w / x.h;
export const landscapeOf = (works) => works.filter((x) => aspect(x) >= LANDSCAPE_MIN_ASPECT);
export const portraitOf = (works) => works.filter((x) => aspect(x) <= PORTRAIT_MAX_ASPECT);

export const SHARD_BYTES = 100000; // one fetch of a refresh stays about this big

/** Split one orientation into the fewest parts that stay near SHARD_BYTES; a work goes to part (Q-number mod parts). */
export function splitParts(works, meta) {
  const size = JSON.stringify(pack(works, meta)).length;
  const parts = Math.max(1, Math.ceil(size / SHARD_BYTES));
  return Array.from({ length: parts }, (_, k) => works.filter((x) => Number(x.id.slice(1)) % parts === k));
}
