// Packing: compact JSON with short keys and shared tables for collection and movement names.
export const LANDSCAPE_MIN_ASPECT = 0.9; // width / height; near-square works are in both shards
export const PORTRAIT_MAX_ASPECT = 1.1;

/** works: [{ id, title, artist, year, coll, mov, file, w, h, sl, score, dark }] -> one packed document. */
export function pack(works, meta) {
  const col = [], mov = [];
  const idx = (table, v) => {
    if (!v) return -1;
    let i = table.indexOf(v);
    if (i < 0) i = table.push(v) - 1;
    return i;
  };
  const w = works.map((x) => {
    const o = { i: x.id, t: x.title, a: x.artist, f: x.file, w: x.w, h: x.h, s: x.sl, p: x.score, k: x.dark };
    if (x.year !== undefined) o.y = x.year;
    const c = idx(col, x.coll), m = idx(mov, x.mov);
    if (c >= 0) o.c = c;
    if (m >= 0) o.m = m;
    return o;
  });
  return { ...meta, n: w.length, col, mov, w };
}

export const aspect = (x) => x.w / x.h;
export const landscapeOf = (works) => works.filter((x) => aspect(x) >= LANDSCAPE_MIN_ASPECT);
export const portraitOf = (works) => works.filter((x) => aspect(x) <= PORTRAIT_MAX_ASPECT);
