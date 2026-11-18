// One work once. Wikidata holds the same painting several times (the six versions of The Sick Child, four Madonnas, thirteen
// Water Lilies with the same title): the Frame would show "the same work" again. One work is kept per artist and normalised
// title, the most famous, and a flag (nudity, violence) of any version stays on the one kept.

/** artist + title, lower case, no accents, no brackets, no punctuation, no leading article. */
export function titleKey(artist, title) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿]+/g, ' ').trim().replace(/^(the|a|an|le|la|les|il|el|der|die|das) /, '');
  return `${norm(artist)}|${norm(title)}`;
}

/**
 * items: [{ id, key, fame, pixels, must, reasons }]. Returns { keep: Set of ids, reasons: Map id -> union of the group's reasons }.
 * The most famous version is kept (a must-have first, then more pixels, then the lower Q number).
 */
export function dedupe(items) {
  const groups = new Map();
  for (const it of items) groups.set(it.key, [...(groups.get(it.key) || []), it]);
  const keep = new Set(), reasons = new Map();
  for (const g of groups.values()) {
    g.sort((a, b) => (b.must ? 1 : 0) - (a.must ? 1 : 0) || b.fame - a.fame || b.pixels - a.pixels || Number(a.id.slice(1)) - Number(b.id.slice(1)));
    keep.add(g[0].id);
    reasons.set(g[0].id, [...new Set(g.flatMap((x) => x.reasons || []))]);
  }
  return { keep, reasons };
}

export const SAME_PICTURE = 0.985; // curator cosine: the painter's own versions of a subject sit at 0.95 to 0.98 and stay (owner 2026-11-18)

/**
 * pairs: [[a, b, cosine]] from the curator (curator_pairs.py); works: [{ id, sl }]. The id of the lesser work of each
 * same-picture pair that has both in `works` (more sitelinks stays, then the lower Q number); a chain drops all but one.
 */
export function samePictureDrops(pairs, works) {
  const by = new Map(works.map((w) => [w.id, w])), drop = new Set();
  const better = (a, b) => b.sl - a.sl || Number(a.id.slice(1)) - Number(b.id.slice(1));
  for (const [x, y, cos] of [...pairs].sort((p, q) => q[2] - p[2])) {
    if (cos < SAME_PICTURE || !by.has(x) || !by.has(y) || drop.has(x) || drop.has(y)) continue;
    drop.add(better(by.get(x), by.get(y)) <= 0 ? y : x);
  }
  return drop;
}
