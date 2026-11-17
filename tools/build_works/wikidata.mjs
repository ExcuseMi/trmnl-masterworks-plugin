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

// The genre tiers: works beyond the fame list that belong to a kind the settings let people pick (landscapes, cityscapes, flowers
// and still life, nature illustration, Japanese prints, modern and abstract, posters and Art Nouveau), found by Wikidata's own
// genre (P136), movement (P135) or class (P31); `viaCreator` adds works whose creator belongs to the movement. Each tier is
// ranked by sitelinks and cut at `cap` after the public-domain, image and size checks, so fame still orders a tier.
const EXTRA_ROOTS = { Q178659: 'illustration', Q429785: 'poster', Q3796486: 'botanical illustration', Q3305213: 'painting' };
export const TIERS = [
  { name: 'landscapes', ids: ['Q191163', 'Q3304751'], min: 3, cap: 500 }, // landscape art, meisho-e
  { name: 'seas', ids: ['Q158607'], min: 0, cap: 320 }, // marine art
  { name: 'cityscapes', ids: ['Q1935974', 'Q166030'], min: 1, cap: 350 }, // cityscape, veduta
  { name: 'flowers and still life', ids: ['Q170571', 'Q12303833'], min: 2, cap: 300 }, // still life, floral painting
  { name: 'nature illustration', ids: ['Q3796486', 'Q10301381', 'Q8001341', 'Q484591', 'Q2302151', 'Q16875712', 'Q2566458'], min: 1, cap: 450 }, // botanical, scientific, wildlife, natural history, animal painting, animal art, bird-and-flower
  { name: 'Japanese prints', ids: ['Q185905', 'Q842183', 'Q2566458'], min: 0, cap: 120 }, // ukiyo-e, shin-hanga, bird-and-flower
  { name: 'modern and abstract', ids: ['Q128115', 'Q80113', 'Q166593', 'Q131221', 'Q191970', 'Q207445', 'Q519443', 'Q42934'], min: 1, cap: 600, viaCreator: true }, // abstract art, Expressionism, Fauvism, Futurism, Suprematism, De Stijl, Orphism, Cubism
  { name: 'posters and Art Nouveau', ids: ['Q429785', 'Q34636'], min: 1, cap: 450, viaCreator: true }, // poster, Art Nouveau
];

// Series: a work that is part of a famous series (P179) is taken by the series' fame, not its own sitelinks: the 119 prints of
// One Hundred Famous Views of Edo are each as famous as the series. Series with at least SERIES_MIN_SITELINKS sitelinks are swept
// automatically; CURATED_SERIES are ones Wikidata links by P361 or whose item has few sitelinks, with the fame they are given.
export const SERIES_MIN_SITELINKS = 8;
export const SERIES_CAP = 40; // works taken per series (the best known first), so one series does not fill a genre
export const CURATED_SERIES = {
  Q377817: { name: 'The Birds of America', fame: 27, cap: 110 },
  Q499643: { name: 'The Slav Epic', fame: 20, cap: 20 },
  Q60228610: { name: 'A Tour of the Waterfalls of the Provinces', fame: 12, cap: 12 },
  Q18822557: { name: 'Thirty-six Views of the Eiffel Tower', fame: 10, cap: 36 },
  Q243248: { name: 'The Fifty-three Stations of the Tokaido', fame: 25, cap: 70 },
  Q165190: { name: 'One Hundred Famous Views of Edo', fame: 18, cap: 125 },
  Q227494: { name: 'Thirty-six Views of Mount Fuji', fame: 44, cap: 50 },
  Q2525862: { name: 'Thirty-six Views of Mount Fuji (second item)', fame: 14, cap: 40 },
  Q6724086: { name: 'Famous Views of the 60-odd Provinces', fame: 10, cap: 70 },
};


/** [[qid, sitelinks, tier name], ...] of the genre tiers; an item keeps the first tier it is found in. */
export async function fetchTierCandidates(log = () => {}) {
  const roots = [...Object.keys(ROOT_CLASSES), ...Object.keys(EXTRA_ROOTS)].map((q) => `wd:${q}`).join(' ');
  const out = new Map();
  for (const t of TIERS) {
    const values = t.ids.map((g) => `wd:${g}`).join(' ');
    const selectors = [`?item wdt:P136|wdt:P135|wdt:P31 ?g.`];
    if (t.viaCreator) selectors.push('?item wdt:P170 ?a. ?a wdt:P135 ?g.');
    let n = 0;
    for (const sel of selectors) {
      const rows = await sparql(`SELECT DISTINCT ?item ?sl WHERE { VALUES ?g { ${values} } ${sel}
        ?item wikibase:sitelinks ?sl. FILTER(?sl >= ${t.min}) ?item wdt:P18 ?img. VALUES ?root { ${roots} } ?item wdt:P31 ?c. ?c wdt:P279* ?root. } LIMIT 20000`);
      n += rows.length;
      for (const r of rows) if (!out.has(qid(val(r, 'item')))) out.set(qid(val(r, 'item')), [Number(val(r, 'sl')), t.name]);
    }
    log(`tier ${t.name} (${t.min}+ sitelinks): ${n}`);
  }
  return [...out.entries()].map(([id, [sl, tier]]) => [id, sl, tier]);
}

/**
 * [[qid, ownSitelinks, seriesId, seriesFame], ...]: the 2D works with an image that are part of a famous series. Fame is the
 * series' sitelinks (or the curated number); a work in several series keeps the highest.
 */
export async function fetchSeries(log = () => {}) {
  const roots = [...Object.keys(ROOT_CLASSES), ...Object.keys(EXTRA_ROOTS)].map((q) => `wd:${q}`).join(' ');
  const out = new Map();
  const add = (id, own, series, fame) => { const o = out.get(id); if (!o || fame > o[3]) out.set(id, [id, own, series, fame]); };
  const rows = await sparql(`SELECT DISTINCT ?item ?sl ?series ?ssl WHERE { ?item wdt:P179 ?series. ?series wikibase:sitelinks ?ssl. FILTER(?ssl >= ${SERIES_MIN_SITELINKS})
    ?item wikibase:sitelinks ?sl. ?item wdt:P18 ?img. VALUES ?root { ${roots} } ?item wdt:P31 ?c. ?c wdt:P279* ?root. } LIMIT 50000`);
  for (const r of rows) add(qid(val(r, 'item')), Number(val(r, 'sl')), qid(val(r, 'series')), Number(val(r, 'ssl')));
  log(`series swept by P179 (${SERIES_MIN_SITELINKS}+ sitelinks): ${rows.length} rows`);
  const ids = Object.keys(CURATED_SERIES).map((q) => `wd:${q}`).join(' ');
  const rows2 = await sparql(`SELECT DISTINCT ?item ?sl ?series WHERE { VALUES ?series { ${ids} } ?item wdt:P179|wdt:P361 ?series. ?item wikibase:sitelinks ?sl. ?item wdt:P18 ?img.
    VALUES ?root { ${roots} } ?item wdt:P31 ?c. ?c wdt:P279* ?root. } LIMIT 50000`);
  for (const r of rows2) add(qid(val(r, 'item')), Number(val(r, 'sl')), qid(val(r, 'series')), CURATED_SERIES[qid(val(r, 'series'))].fame);
  log(`curated series: ${rows2.length} rows`);
  return [...out.values()];
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

/**
 * Genre (P136), classes (P31), where it hangs (P276), what it depicts (P180; only the labels that match depictsRe) and the
 * dates (P571 with precision and the earliest/latest date qualifiers) of a batch. Plain one-pattern queries, as above.
 * Returns Map qid -> { genres, classes, depicts, locations, dates: [{ t, precision, earliest, latest }] }.
 */
export async function fetchTags(ids, depictsRe) {
  const out = new Map(ids.map((id) => [id, { genres: [], classes: [], depicts: [], locations: [], dates: [] }]));
  const V = `VALUES ?item { ${values(ids)} }`;
  const each = (rows, fn) => rows.forEach((r) => { const o = out.get(qid(val(r, 'item'))); if (o) fn(o, r); });
  each(await sparql(`SELECT ?item ?l WHERE { ${V} ?item wdt:P136 ?g. ?g rdfs:label ?l. FILTER(LANG(?l) = "en") }`), (o, r) => o.genres.push(val(r, 'l')));
  each(await sparql(`SELECT ?item ?l WHERE { ${V} ?item wdt:P31 ?g. ?g rdfs:label ?l. FILTER(LANG(?l) = "en") }`), (o, r) => o.classes.push(val(r, 'l')));
  each(await sparql(`SELECT ?item ?l WHERE { ${V} ?item wdt:P276 ?g. ?g rdfs:label ?l. FILTER(LANG(?l) = "en") }`), (o, r) => o.locations.push(val(r, 'l')));
  each(await sparql(`SELECT ?item ?l WHERE { ${V} ?item wdt:P180 ?g. ?g rdfs:label ?l. FILTER(LANG(?l) = "en") FILTER(REGEX(?l, "${depictsRe}", "i")) }`), (o, r) => o.depicts.push(val(r, 'l')));
  const PV = 'PREFIX psv: <http://www.wikidata.org/prop/statement/value/> PREFIX pq: <http://www.wikidata.org/prop/qualifier/> ';
  each(await sparql(`${PV} SELECT ?item ?t ?pr ?e ?l WHERE { ${V} ?item p:P571 ?st. ?st psv:P571 ?v. ?v wikibase:timeValue ?t; wikibase:timePrecision ?pr.
    OPTIONAL { ?st pq:P1319 ?e } OPTIONAL { ?st pq:P1326 ?l } }`), (o, r) => {
    const d = { t: yearOf(val(r, 't')), precision: Number(val(r, 'pr')), earliest: yearOf(val(r, 'e')), latest: yearOf(val(r, 'l')) };
    if (!o.dates.some((x) => JSON.stringify(x) === JSON.stringify(d))) o.dates.push(d);
  });
  for (const o of out.values()) for (const k of ['genres', 'classes', 'locations', 'depicts']) o[k] = [...new Set(o[k])];
  return out;
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
