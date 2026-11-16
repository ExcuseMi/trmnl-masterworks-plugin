#!/usr/bin/env node
// Builds data/works.json (+ landscape.json, portrait.json): famous public-domain artworks from Wikidata, checked
// against Commons, scored against the TRMNL colour palette. Network stages are cached in tools/build_works/.cache.
//   node tools/build_works/build.mjs [--limit 2000] [--fresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_SITELINKS, ROOT_CLASSES, EXACT_CLASSES, cutoffs, fetchCandidates, fetchDetails, isPublicDomain } from './wikidata.mjs';
import { fetchImageInfo, usable } from './commons.mjs';
import { PALETTE_ID, loadPalette, scoreFile } from './palette.mjs';
import { landscapeOf, pack, portraitOf } from './shards.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cacheDir = join(here, '.cache');
const args = process.argv.slice(2);
const argVal = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LIMIT = Number(argVal('--limit', 2000));
const OVERSHOOT = 1.5; // ask Wikidata for this many times LIMIT: rights, image and size checks drop a good part
const FRESH = args.includes('--fresh');
const BUILD_YEAR = new Date().getUTCFullYear();
// the work list must hold these (the gap report's five): the build stops, and writes nothing, when one is missing
const MUST_HAVE = { Q252485: 'The Great Wave off Kanagawa', Q3565037: 'Red Fuji (Fine Wind, Clear Morning)', Q500242: 'The Creation of Adam (Sistine Chapel ceiling)', Q186953: 'The School of Athens', Q714802: 'Along the River During the Qingming Festival' };
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

mkdirSync(cacheDir, { recursive: true });
const cachePath = (n) => join(cacheDir, n);
const readCache = (n, d) => (!FRESH && existsSync(cachePath(n)) ? JSON.parse(readFileSync(cachePath(n), 'utf8')) : d);
const writeCache = (n, v) => writeFileSync(cachePath(n), JSON.stringify(v));
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// 1. candidates, ranked by sitelinks
let cand = readCache('candidates.json');
if (!cand) {
  cand = await fetchCandidates(log);
  writeCache('candidates.json', cand);
}
cand.sort((a, b) => b[1] - a[1]);
const top = cand.slice(0, Math.ceil(LIMIT * OVERSHOOT));
log(`candidates ${cand.length}, asking details for the top ${top.length} (sitelinks down to ${top.at(-1)[1]})`);

// 2. details in batches
const details = readCache('details.json', {});
for (const batch of chunks(top.map(([id]) => id).filter((id) => !details[id]), 100)) {
  for (const d of await fetchDetails(batch)) details[d.id] = d;
  writeCache('details.json', details);
  log(`details ${Object.keys(details).length}/${top.length}`);
}

// 3. rights, label, image; then Commons size checks
const stats = { noLabel: 0, noImage: 0, notPublicDomain: 0, commons: 0, dupe: 0 };
const picked = [];
for (const [id, sl] of top) {
  const d = details[id];
  const title = d.labels.en || d.labels.mul || d.labels.nl || d.labels.de || d.labels.fr || d.labels.ja;
  if (!title) { stats.noLabel++; continue; }
  if (!d.files.length) { stats.noImage++; continue; }
  if (!isPublicDomain(d, BUILD_YEAR)) { stats.notPublicDomain++; continue; }
  picked.push({ id, sl, d, title });
}
log('after rights/image/label', picked.length, stats);

const infoCache = readCache('commons.json', {});
const names = [...new Set(picked.flatMap((p) => p.d.files.slice(0, 3)))].filter((n) => !(n in infoCache));
for (const batch of chunks(names, 50)) {
  const got = await fetchImageInfo(batch);
  for (const n of batch) infoCache[n] = got.get(n) || null;
  writeCache('commons.json', infoCache);
  log(`commons ${Object.keys(infoCache).length}`);
}

const seenFile = new Set();
const works = [];
for (const p of picked) {
  const file = p.d.files.slice(0, 3).find((n) => usable(infoCache[n]));
  if (!file) { stats.commons++; continue; }
  const info = infoCache[file];
  if (seenFile.has(info.file)) { stats.dupe++; continue; }
  seenFile.add(info.file);
  const artist = p.d.creators.slice(0, 2).map((c) => c.name).filter((n) => n && !/^Q\d+$/.test(n)).join(', ') || 'Unknown artist';
  works.push({
    id: p.id, title: p.title, artist, sl: p.sl, file: info.file, w: info.w, h: info.h,
    year: p.d.years.length ? Math.min(...p.d.years) : undefined,
    coll: p.d.coll[0], mov: p.d.mov[0] || p.d.creators.flatMap((c) => c.mov)[0],
  });
  if (works.length >= LIMIT) break;
}
log(`works ${works.length}`, stats);

// build check: the famous five
const missing = Object.entries(MUST_HAVE).filter(([id]) => !works.some((w) => w.id === id));
for (const [id, label] of missing) {
  const d = details[id];
  const where = !cand.some(([c]) => c === id) ? 'not a candidate (class, image or sitelinks)' : !d ? 'beyond the top for details' :
    !d.files.length ? 'no image' : !isPublicDomain(d, BUILD_YEAR) ? 'not public domain by the rule' : 'dropped by Commons size or the limit';
  log(`MISSING ${id} ${label}: ${where}`);
}
if (missing.length) { log('build check failed: a must-have work is missing; nothing written'); process.exit(1); }

// 4. palette score from a small thumbnail
const inks = await loadPalette();
log(`palette ${PALETTE_ID}`, inks.join(' '));
const scores = readCache('scores.json', {});
const todo = works.filter((w) => scores[w.file] == null); // also the ones that failed before (429 from Commons)
let next = 0, done = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < todo.length) {
    const w = todo[next++];
    try { scores[w.file] = Math.round((await scoreFile(w.file, inks)) * 1000) / 1000; } catch (e) { scores[w.file] = null; log('no score', w.file, e.message); }
    if (++done % 50 === 0) { writeCache('scores.json', scores); log(`scores ${done}/${todo.length}`); }
  }
}));
writeCache('scores.json', scores);
const final = works.filter((w) => scores[w.file] != null).map((w) => ({ ...w, score: scores[w.file] }));
log(`dropped without a score: ${works.length - final.length}`);

// 5. write
const minSitelinks = Math.min(...final.map((w) => w.sl));
const meta = { v: 1, built: new Date().toISOString().slice(0, 10), palette: PALETTE_ID, source: 'Wikidata + Wikimedia Commons', min_sitelinks: minSitelinks, died_by: cutoffs(BUILD_YEAR).diedBy, made_by: cutoffs(BUILD_YEAR).madeBy };
mkdirSync(join(root, 'data'), { recursive: true });
const out = (name, ws) => writeFileSync(join(root, 'data', name), JSON.stringify(pack(ws, { ...meta, shard: name.replace('.json', '') })));
out('works.json', final);
out('landscape.json', landscapeOf(final));
out('portrait.json', portraitOf(final));
log(`classes: ${[...Object.values(ROOT_CLASSES), ...Object.values(EXACT_CLASSES)].join(', ')}; sitelinks from ${MIN_SITELINKS}; lowest in the data set ${minSitelinks}; done`);
