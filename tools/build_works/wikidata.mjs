// Wikidata through SPARQL: candidate works ranked by sitelinks, then their details in batches.
// QLever (a Wikidata mirror, fast) first, query.wikidata.org as the fallback; both get the same portable query text.
import { politeFetch } from './http.mjs';

export const ENDPOINTS = [
  { name: 'QLever', url: 'https://qlever.dev/api/wikidata', pauseMs: 1000, tries: 3 },
  { name: 'WDQS', url: 'https://query.wikidata.org/sparql', pauseMs: 2500, tries: 3 },
];
const PREFIXES = 'PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX wikibase: <http://wikiba.se/ontology#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX p: <http://www.wikidata.org/prop/> PREFIX psn: <http://www.wikidata.org/prop/statement/value-normalized/> ';

// Classes (P31 with any subclass, P279*) the works must belong to.
export const ROOT_CLASSES = {
  Q3305213: 'painting', Q11060274: 'print', Q93184: 'drawing', Q22669139: 'fresco', Q219423: 'mural',
  Q18761202: 'watercolor painting', Q18219090: 'woodcut print', Q5647631: 'handscroll', Q2188827: 'hanging scroll',
  Q282129: 'miniature', Q15727816: 'painting series', Q741226: 'byobu folding screen',
};
// Classes taken as they are, without subclasses (their subclasses include sculpture and furniture).
export const EXACT_CLASSES = { Q79218: 'triptych', Q15711026: 'altarpiece' };
export const MIN_SITELINKS = 7;

async function sparql(query) {
  let lastErr;
  for (const ep of ENDPOINTS) {
    for (let i = 1; i <= ep.tries; i++) {
      try {
        const res = await politeFetch(`${ep.url}?${new URLSearchParams({ query: PREFIXES + query })}`,
          { headers: { Accept: 'application/sparql-results+json' } }, { pauseMs: ep.pauseMs });
        return (await res.json()).results.bindings; // a truncated body (WDQS timeout) fails here and is retried
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, i * 5000));
      }
    }
    console.error(`${ep.name} failed (${String(lastErr.message).slice(0, 80)}), trying the next endpoint`);
  }
  throw lastErr;
}

const val = (b, k) => (b[k] ? b[k].value : undefined);
const qid = (uri) => (uri ? uri.slice(uri.lastIndexOf('/') + 1) : undefined);

/** [[qid, sitelinks], ...] of works with an image, at least MIN_SITELINKS sitelinks, in any of the classes. */
export async function fetchCandidates(log = () => {}) {
  const roots = Object.keys(ROOT_CLASSES).map((q) => `wd:${q}`).join(' ');
  const exact = Object.keys(EXACT_CLASSES).map((q) => `wd:${q}`).join(' ');
  const rows = await sparql(`SELECT DISTINCT ?item ?sl WHERE {
    { VALUES ?root { ${roots} } ?item wdt:P31 ?c. ?c wdt:P279* ?root. } UNION { VALUES ?c { ${exact} } ?item wdt:P31 ?c. }
    ?item wikibase:sitelinks ?sl. FILTER(?sl >= ${MIN_SITELINKS}) ?item wdt:P18 ?img. } LIMIT 50000`);
  const out = new Map(rows.map((r) => [qid(val(r, 'item')), Number(val(r, 'sl'))]));
  log(`candidates with an image and ${MIN_SITELINKS}+ sitelinks: ${out.size}`);
  return [...out.entries()];
}

export function yearOf(iso) {
  const m = /^(-?)0*(\d{1,6})-/.exec(iso || '');
  return m ? Number(m[1] + m[2]) : undefined;
}

const values = (ids) => ids.map((i) => `wd:${i}`).join(' ');
const LANGS = ['en', 'nl', 'de', 'fr', 'ja', 'mul'];
const lang = (r, k) => (r[k] && r[k]['xml:lang']) || '';

/** Labels (English first, else "mul") of entities: Map qid -> text. Entities without either have no entry. */
async function fetchNames(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await sparql(`SELECT ?e ?l WHERE { VALUES ?e { ${values(ids)} } ?e rdfs:label ?l. FILTER(LANG(?l) IN ("en","mul")) }`);
  for (const r of rows) {
    const id = qid(val(r, 'e'));
    if (!out.has(id) || lang(r, 'l') === 'en') out.set(id, val(r, 'l'));
  }
  return out;
}

/** One batch of qids: labels, image, year, rights, creators (with death year), collection, movement. Simple queries
 * only (one pattern each, no OPTIONAL label joins): those are the ones both endpoints answer fast. */
export async function fetchDetails(ids) {
  const info = new Map(ids.map((id) => [id, { id, labels: {}, files: [], years: [], rights: [], creators: [], coll: [], mov: [] }]));
  const eachRow = (rows, fn) => rows.forEach((r) => { const it = info.get(qid(val(r, 'item'))); if (it) fn(it, r); });
  eachRow(await sparql(`SELECT ?item ?label WHERE { VALUES ?item { ${values(ids)} } ?item rdfs:label ?label. FILTER(LANG(?label) IN ("${LANGS.join('","')}")) }`),
    (it, r) => { it.labels[lang(r, 'label')] = val(r, 'label'); });
  eachRow(await sparql(`SELECT ?item ?img ?inc ?pd WHERE { VALUES ?item { ${values(ids)} }
    OPTIONAL { ?item wdt:P18 ?img } OPTIONAL { ?item wdt:P571 ?inc } OPTIONAL { ?item wdt:P6216 ?pd } }`), (it, r) => {
    if (val(r, 'img')) it.files.push(decodeURIComponent(val(r, 'img').replace(/^.*Special:FilePath\//, '')));
    if (val(r, 'inc')) it.years.push(yearOf(val(r, 'inc')));
    if (val(r, 'pd')) it.rights.push(qid(val(r, 'pd')));
  });
  const ref = new Set(); // entities whose names are needed
  eachRow(await sparql(`SELECT ?item ?cr ?death ?crMov WHERE { VALUES ?item { ${values(ids)} }
    ?item wdt:P170 ?cr. OPTIONAL { ?cr wdt:P570 ?death } OPTIONAL { ?cr wdt:P135 ?crMov } }`), (it, r) => {
    const id = qid(val(r, 'cr'));
    let c = it.creators.find((x) => x.id === id);
    if (!c) it.creators.push((c = { id, death: [], mov: [] }));
    if (val(r, 'death')) c.death.push(yearOf(val(r, 'death')));
    if (val(r, 'crMov')) c.mov.push(qid(val(r, 'crMov')));
    ref.add(id);
    if (val(r, 'crMov')) ref.add(qid(val(r, 'crMov')));
  });
  eachRow(await sparql(`SELECT ?item ?coll ?mov WHERE { VALUES ?item { ${values(ids)} } OPTIONAL { ?item wdt:P195 ?coll } OPTIONAL { ?item wdt:P135 ?mov } }`), (it, r) => {
    if (val(r, 'coll')) { it.coll.push(qid(val(r, 'coll'))); ref.add(qid(val(r, 'coll'))); }
    if (val(r, 'mov')) { it.mov.push(qid(val(r, 'mov'))); ref.add(qid(val(r, 'mov'))); }
  });
  const names = await fetchNames([...ref]);
  const named = (list) => [...new Set(list.map((q) => names.get(q)).filter(Boolean))];
  for (const it of info.values()) {
    for (const k of ['files', 'years', 'rights']) it[k] = [...new Set(it[k])];
    it.coll = named(it.coll);
    it.mov = named(it.mov);
    for (const c of it.creators) {
      c.death = [...new Set(c.death)];
      c.name = names.get(c.id);
      c.mov = named(c.mov);
    }
  }
  return [...info.values()];
}

// What a museum label adds: the material (P186) and the size (P2048 height, P2049 width; the normalised value is in metres).
const SUPPORTS = /canvas|panel|wood|paper|copper|silk|parchment|vellum|linen|poplar|oak|board|cardboard|plaster|stone|wall|ivory|cloth|plate/i;
const MAX_CM = 5000; // a painting 50 m wide is a data error here

/** "oil paint" + "canvas" -> "Oil on canvas"; one material alone stays as it is; at most two of each kind. */
export function composeMedium(labels) {
  const ls = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  if (!ls.length) return undefined;
  const supports = ls.filter((l) => SUPPORTS.test(l)).slice(0, 2);
  const paints = ls.filter((l) => !SUPPORTS.test(l)).map((l) => l.replace(/\s+paint$/i, '')).slice(0, 2);
  const text = paints.length && supports.length ? `${paints.join(' and ')} on ${supports.join(' and ')}` : [...paints, ...supports].join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Height and width in cm, both or neither: [h, w], one decimal. */
export function sizeCm(heights, widths) {
  const ok = (m) => Number.isFinite(m) && m > 0 && m * 100 <= MAX_CM;
  const h = heights.find(ok), w = widths.find(ok);
  if (h === undefined || w === undefined) return undefined;
  const cm = (m) => Math.round(m * 1000) / 10;
  return [cm(h), cm(w)];
}

/** Map qid -> { medium, size } for a batch of works (what is missing is simply absent). */
export async function fetchExtra(ids) {
  const out = new Map(ids.map((id) => [id, { media: [], h: [], w: [] }]));
  const rows = await sparql(`SELECT ?item ?m ?h ?w WHERE { VALUES ?item { ${values(ids)} }
    OPTIONAL { ?item wdt:P186 ?m } OPTIONAL { ?item p:P2048/psn:P2048/wikibase:quantityAmount ?h } OPTIONAL { ?item p:P2049/psn:P2049/wikibase:quantityAmount ?w } }`);
  const mediaIds = new Set();
  for (const r of rows) {
    const o = out.get(qid(val(r, 'item')));
    if (!o) continue;
    if (val(r, 'm')) { o.media.push(qid(val(r, 'm'))); mediaIds.add(qid(val(r, 'm'))); }
    if (val(r, 'h')) o.h.push(Number(val(r, 'h')));
    if (val(r, 'w')) o.w.push(Number(val(r, 'w')));
  }
  const names = await fetchNames([...mediaIds]);
  const res = new Map();
  for (const [id, o] of out) {
    res.set(id, { medium: composeMedium([...new Set(o.media)].map((m) => names.get(m)).filter(Boolean)), size: sizeCm(o.h, o.w) });
  }
  return res;
}

export const PUBLIC_DOMAIN = 'Q19652'; // P6216 copyright status: public domain

/**
 * The public-domain rule, with its cut-offs computed from the build year.
 *   EU/life rule: a creator died at least 70 full years before 1 January of the build year, so death year <= year - 71.
 *   US rule: a work published in year Y is public domain from 1 January of Y + 96, so work year <= year - 96.
 * (2026: died 1955 or earlier, made 1930 or earlier; American Gothic, 1930, passes, a 1931 work does not.)
 * A work must pass the US rule on its date, and the life rule by its creators' death years or by Wikidata's own
 * "public domain" statement (P6216). A rights statement without "public domain" among its values rules a work out.
 * No creator named: only when dated before ANONYMOUS_BEFORE. No date: only when every creator died before UNDATED_DIED_BEFORE.
 */
export const ANONYMOUS_BEFORE = 1850;
export const UNDATED_DIED_BEFORE = 1900;
export const cutoffs = (buildYear) => ({ diedBy: buildYear - 71, madeBy: buildYear - 96 });

export function isPublicDomain(d, buildYear = new Date().getUTCFullYear()) {
  const { diedBy, madeBy } = cutoffs(buildYear);
  const year = d.years.length ? Math.min(...d.years) : undefined;
  const deaths = d.creators.map((c) => (c.death.length ? Math.max(...c.death) : undefined));
  if (d.rights.length && !d.rights.includes(PUBLIC_DOMAIN)) return false;
  if (year !== undefined ? year > madeBy : !(deaths.length && deaths.every((x) => x !== undefined && x < UNDATED_DIED_BEFORE))) return false;
  if (d.rights.includes(PUBLIC_DOMAIN)) return true;
  if (!d.creators.length) return year !== undefined && year < ANONYMOUS_BEFORE;
  return deaths.every((x) => x !== undefined && x <= diedBy);
}
