#!/usr/bin/env node
// Builds data/works.json (+ landscape.json, portrait.json): famous public-domain artworks from Wikidata, checked
// against Commons, scored against the TRMNL colour palette. Network stages are cached in tools/build_works/.cache.
//   node tools/build_works/build.mjs [--limit 2000] [--fresh]
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_SITELINKS, ROOT_CLASSES, EXACT_CLASSES, cutoffs, fetchCandidates, fetchDetails, fetchExtra, fetchTags, fetchTierCandidates, fetchSeries, isPublicDomain, TIERS, CURATED_SERIES, SERIES_CAP, SERIES_INFO } from './wikidata.mjs';
import { dedupe, samePictureDrops, titleKey } from './dedupe.mjs';
import { PNG_STEPS as PNG_STEPS_TRY } from './commons.mjs';
import { MIN_LONG_SIDE_PRINT, fetchImageInfo, isPng, pngStepFor, preferNonPng, thumbBytes, usable } from './commons.mjs';
import { DARK_MAT_BELOW, PALETTE_ID, cornerBrightness, fetchThumb, loadPalette, meanBrightness, scoreFile } from './palette.mjs';
import { createHash } from 'node:crypto';
import { pickMovement } from './movements.mjs';
import { DEPICTS_RE, SERIES_GENRE, genreOf, is2dArtwork, isNotAPicture, unfriendlyReasons } from './classify.mjs';
import { latestYear, yearInfo } from './dates.mjs';
import { venueOf } from './names.mjs';
import { normalizeMedium } from './media.mjs';
import { loadSuspects } from './curator_safety.mjs';
import { cropFor, loadCrops } from './curator_crops.mjs';
import { loadExclusions } from './curator_exclude.mjs';
import { landscapeOf, pack, portraitOf, splitParts } from './shards.mjs';

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
// Wikidata labels with a known error; the fix belongs on Wikidata, this keeps the data set right until then
// Wikidata labels that are wrong or vandalized (Q311243 read "Wanderer above the Sea younes non non non ..." on 2026-11-17).
const TITLE_FIXES = { Q252485: 'The Great Wave off Kanagawa', Q311243: 'Wanderer above the Sea of Fog', Q3921861: 'First Abstract Watercolor' }; // the last: 'Untitled' on Wikidata, the name it is known by (and one of two Untitled by Kandinsky)
const MUST_HAVE = { Q252485: 'The Great Wave off Kanagawa', Q3565037: 'Red Fuji (Fine Wind, Clear Morning)', Q500242: 'The Creation of Adam (Sistine Chapel ceiling)', Q186953: 'The School of Athens' };
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

mkdirSync(cacheDir, { recursive: true });
const cachePath = (n) => join(cacheDir, n);
const readCache = (n, d) => (!FRESH && existsSync(cachePath(n)) ? JSON.parse(readFileSync(cachePath(n), 'utf8')) : d);
const writeCache = (n, v) => writeFileSync(cachePath(n), JSON.stringify(v));
const thumbPath = (file) => join(cacheDir, 'thumbs', createHash('md5').update(file).digest('hex') + '.img');
/** What genreOf needs for a work: Wikidata's labels, the work's own movements and its creators' movements. */
const genreInput = (p, title, year) => ({
  series: (seriesOf.get(p.id) || [])[0],
  title, genres: tags[p.id].genres, depicts: tags[p.id].depicts, classes: tags[p.id].classes,
  movements: p.d.mov, creatorMovements: p.d.creators.flatMap((c) => c.mov), year,
});
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// 1. candidates, ranked by sitelinks
let cand = readCache('candidates.json');
if (!cand) {
  cand = await fetchCandidates(log);
  writeCache('candidates.json', cand);
}
cand.sort((a, b) => b[1] - a[1]);
const mainTop = cand.slice(0, Math.ceil(LIMIT * OVERSHOOT));
// the genre tier: landscapes, seascapes and cityscapes beyond the fame list (their own, lower, sitelink counts)
let tierCand = readCache('tier.json');
if (!tierCand) {
  tierCand = await fetchTierCandidates(log);
  writeCache('tier.json', tierCand);
}
// only the best known of each tier are looked at further: a tier is cut at its cap after the checks drop some (OVERSHOOT_TIER)
const OVERSHOOT_TIER = 2.2;
{
  const kept = [], per = {};
  for (const row of [...tierCand].sort((a, b) => b[1] - a[1])) {
    const t = TIERS.find((x) => x.name === row[2]);
    per[row[2]] = (per[row[2]] || 0) + 1;
    if (!t || per[row[2]] <= Math.ceil(t.cap * OVERSHOOT_TIER)) kept.push(row);
  }
  tierCand = kept;
}
const mainIds = new Set(mainTop.map(([id]) => id));
// series: members of famous series are taken by the series' fame; they count against their series' cap, not a genre tier's
let seriesRows = readCache('series.json');
if (!seriesRows) {
  seriesRows = await fetchSeries(log);
  writeCache('series.json', seriesRows);
}
const seriesFame = new Map(seriesRows.map(([id, , , fame]) => [id, fame]));
const seriesOf = new Map(); // id -> [series, fame] of the most famous series the work is part of
for (const [id, , series, fame] of seriesRows) { const o = seriesOf.get(id); if (!o || fame > o[1]) seriesOf.set(id, [series, fame]); }
const tierOf = new Map(tierCand.map(([id, , t]) => [id, t]));
for (const [id, , series] of seriesRows) tierOf.set(id, `series:${series}`);
const tierCap = Object.fromEntries(TIERS.map((t) => [t.name, t.cap]));
const capOf = (name) => (name.startsWith('series:') ? (CURATED_SERIES[name.slice(7)] || {}).cap || SERIES_CAP : tierCap[name]);
const tierCount = {};
const tierTop = [...tierCand.map(([id, sl]) => [id, sl]), ...seriesRows.map(([id, sl]) => [id, sl])]
  .filter(([id], i, a) => !mainIds.has(id) && a.findIndex(([x]) => x === id) === i).sort((a, b) => b[1] - a[1]);
const top = [...mainTop, ...tierTop];
log(`candidates ${cand.length}, asking details for the top ${mainTop.length} (sitelinks down to ${mainTop.at(-1)[1]}) and ${tierTop.length} of the genre tier`);

// 2. details in batches
const details = readCache('details.json', {});
for (const batch of chunks(top.map(([id]) => id).filter((id) => !details[id]), 100)) {
  for (const d of await fetchDetails(batch)) details[d.id] = d;
  writeCache('details.json', details);
  log(`details ${Object.keys(details).length}/${top.length}`);
}

// 2b. genre, classes, location, depicted subjects and dates (precision, earliest/latest) of the same works
const tags = readCache('tags.json', {});
for (const batch of chunks(top.map(([id]) => id).filter((id) => !tags[id]), 100)) {
  for (const [id, t] of await fetchTags(batch, DEPICTS_RE)) tags[id] = t;
  writeCache('tags.json', tags);
  log(`tags ${Object.keys(tags).length}/${top.length}`);
}

// 3. rights, label, image; then Commons size checks
const stats = { noLabel: 0, noImage: 0, not2d: 0, notPublicDomain: 0, commons: 0, dupe: 0 };
const picked = [];
for (const [id, sl] of top) {
  const d = details[id];
  const title = d.labels.en || d.labels.mul || d.labels.nl || d.labels.de || d.labels.fr || d.labels.ja;
  if (!title) { stats.noLabel++; continue; }
  if (!d.files.length) { stats.noImage++; continue; }
  const tg = tags[id];
  if (!is2dArtwork(tg.classes)) { stats.not2d++; continue; }
  // the public-domain test uses the latest year a date allows (a century is its last year, a range its end)
  if (tg.dates.length) d.years = [latestYear(tg.dates)];
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
let mainCount = 0;
// a woodblock print of a Japanese series may be 1200 px on its long side (that is what Commons holds), every other work 1500
const imageOf = (p) => {
  const jpSeries = SERIES_GENRE[(seriesOf.get(p.id) || [])[0]] === 'japanese print';
  const ok = p.d.files.slice(0, 3).filter((n) => usable(infoCache[n], jpSeries ? MIN_LONG_SIDE_PRINT : undefined, n));
  return preferNonPng(ok); // a JPEG, TIFF or WebP file is far lighter than a PNG of the same picture (see commons.mjs)
};
const titleOf = (p) => TITLE_FIXES[p.id] || p.title;
// Review 2026-11-19 (every creator's birth year against the work's year): Wikidata named an actor born in 1992 as the painter of the
// Kandinsky, a man born in 1976 as the painter of Goya's Boys with Mastiffs; five inception dates are a typo, the year of the event or zero
const ARTIST_FIXES = { Q3921861: 'Wassily Kandinsky', Q6043547: 'Francisco Goya' };
const YEAR_FIXES = { Q11092366: { year: 1739, label: '1739' }, Q1450935: { year: 1516, label: '1516–17' }, Q29328965: { year: 1836, label: '1836' }, Q21614085: { year: undefined, label: '' }, Q111417085: { year: undefined, label: '' } };
const yearOfWork = (p) => YEAR_FIXES[p.id] || { year: yearInfo(tags[p.id].dates).year ?? (p.d.years.length ? Math.min(...p.d.years) : undefined), label: yearInfo(tags[p.id].dates).label };
const artistOf = (p) => ARTIST_FIXES[p.id] || p.d.creators.slice(0, 2).map((c) => c.name).filter((n) => n && !/^Q\d+$/.test(n)).join(', ') || 'Unknown artist';
const curatorSuspects = loadSuspects();
const curatorCrops = loadCrops();
const reasonsOf = (p) => unfriendlyReasons({ id: p.id, series: (seriesOf.get(p.id) || [])[0], title: titleOf(p), genres: tags[p.id].genres, depicts: tags[p.id].depicts, genre: genreOf(genreInput(p, titleOf(p), yearInfo(tags[p.id].dates).year)) });
// one work once: the most famous version of an artist + title is kept, with the flags of all its versions
const once = dedupe(picked.filter((p) => imageOf(p)).map((p) => ({
  id: p.id, key: titleKey(artistOf(p), titleOf(p)), fame: Math.max(p.sl, seriesFame.get(p.id) || 0), must: p.id in MUST_HAVE,
  pixels: infoCache[imageOf(p)].w * infoCache[imageOf(p)].h, reasons: reasonsOf(p),
})));
for (const p of picked) {
  if (imageOf(p) && !once.keep.has(p.id)) { stats.sameWork = (stats.sameWork || 0) + 1; continue; }
  const isMain = mainIds.has(p.id);
  if (isMain && mainCount >= LIMIT) continue; // the fame list is cut at LIMIT; each genre tier has its own list, cut at its cap
  if (!isMain && (tierCount[tierOf.get(p.id)] || 0) >= capOf(tierOf.get(p.id))) continue;
  const file = imageOf(p);
  if (!file) { stats.commons++; continue; }
  const info = infoCache[file];
  if (seenFile.has(info.file)) { stats.dupe++; continue; }
  seenFile.add(info.file);
  if (isMain) mainCount++;
  else tierCount[tierOf.get(p.id)] = (tierCount[tierOf.get(p.id)] || 0) + 1;
  const title = titleOf(p), artist = artistOf(p);
  works.push({
    id: p.id, title, artist, sl: p.sl, file: info.file, w: info.w, h: info.h,
    crop: cropFor(curatorCrops, p.id, info.file) || undefined, // a scanner bed or paper margin round the work is not shown
    year: yearOfWork(p).year, yearLabel: yearOfWork(p).label,
    genre: genreOf(genreInput(p, title, yearInfo(tags[p.id].dates).year)),
    reasons: [...(once.reasons.get(p.id) || []), ...(curatorSuspects[p.id] ? [`curator ${curatorSuspects[p.id]}`] : [])], // the curator's safety suspects are flagged too (owner 2026-11-18)
    locations: tags[p.id].locations, collections: p.d.coll,
    coll: venueOf({ collections: p.d.coll, locations: tags[p.id].locations }), mov: pickMovement(p.d.mov) || pickMovement(p.d.creators.flatMap((c) => c.mov)),
  });
}
// Owner 2026-11-18, after the list is cut (so no work the curator has not judged moves in): the curator's sure quality
// exclusions, what is no picture (map, plan, banknote, ostracon, object) and the lesser of two same-picture works leave
const curatorOut = loadExclusions(), gone = { quality: [], notAPicture: [], samePicture: [] };
const kept1 = works.filter((w) => { if (curatorOut[w.id]) { gone.quality.push(w.id); return false; } if (isNotAPicture(tags[w.id].classes)) { gone.notAPicture.push(w.id); return false; } return true; });
const samePic = samePictureDrops(JSON.parse(readFileSync(join(here, 'curator-pairs.json'), 'utf8')), kept1);
gone.samePicture = [...samePic];
works.splice(0, works.length, ...kept1.filter((w) => !samePic.has(w.id)));
log(`left out by the curator rules: ${Object.entries(gone).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
writeCache('left-out.json', gone);
// a member of a famous series is as famous as the series (its own sitelinks when higher)
let boosted = 0;
for (const w of works) { const f = seriesFame.get(w.id); if (f && f > w.sl) { w.sl = f; boosted++; } }
const seriesWorks = Object.entries(tierCount).filter(([k]) => k.startsWith('series:')).reduce((n, [, v]) => n + v, 0);
log(`works ${works.length} (fame list ${mainCount}, genre tiers ${JSON.stringify(Object.fromEntries(Object.entries(tierCount).filter(([k]) => !k.startsWith('series:'))))}, series members ${seriesWorks}, fame taken from a series ${boosted})`, stats);

// build check: the famous five
const missing = Object.entries(MUST_HAVE).filter(([id]) => !works.some((w) => w.id === id));
for (const [id, label] of missing) {
  const d = details[id];
  const where = !cand.some(([c]) => c === id) ? 'not a candidate (class, image or sitelinks)' : !d ? 'beyond the top for details' :
    !d.files.length ? 'no image' : !isPublicDomain(d, BUILD_YEAR) ? 'not public domain by the rule' : 'dropped by Commons size or the limit';
  log(`MISSING ${id} ${label}: ${where}`);
}
if (missing.length) { log('build check failed: a must-have work is missing; nothing written'); process.exit(1); }

// 3b. what a museum label adds (material and size from Wikidata)
const extra = readCache('extra.json', {});
for (const batch of chunks(works.map((w) => w.id).filter((id) => !extra[id]), 100)) {
  for (const [id, e] of await fetchExtra(batch)) extra[id] = e;
  writeCache('extra.json', extra);
  log(`extra ${Object.keys(extra).length}/${works.length}`);
}
for (const w of works) Object.assign(w, { rawMedium: (extra[w.id] || {}).medium, medium: normalizeMedium((extra[w.id] || {}).medium) || undefined, size: (extra[w.id] || {}).size });
// a member of a series that Wikidata gives no date or technique says the series' (the Frame label shows year and technique)
const seriesMembers = {};
for (const w of works) {
  const [sr] = seriesOf.get(w.id) || [];
  const info = SERIES_INFO[sr];
  if (!info || !info.artist.test(w.artist)) continue;
  (seriesMembers[sr] = seriesMembers[sr] || []).push(w.id);
  if (!w.yearLabel) { w.year = info.year; w.yearLabel = info.label; }
  if (!w.medium) w.medium = info.medium;
}
log(`with a technique: ${works.filter((w) => w.medium).length} of ${works.length} (raw material text on ${works.filter((w) => w.rawMedium).length}), with a size: ${works.filter((w) => w.size).length}`);
writeCache('media-map.json', works.filter((w) => w.rawMedium).map((w) => [w.rawMedium, w.medium || '']));

// 4. palette score: download the small thumbnails once (kept in the cache), then score them locally
const inks = await loadPalette();
log(`palette ${PALETTE_ID}`, inks.join(' '));
const thumbDir = join(cacheDir, 'thumbs');
mkdirSync(thumbDir, { recursive: true });
const failed = new Set();
for (let round = 1; round <= 3; round++) { // a round: three workers; what Commons refused (429) is tried again in the next round, slower
  const todo = works.filter((w) => !existsSync(thumbPath(w.file)));
  if (!todo.length) break;
  if (round > 1) { log(`round ${round}: ${todo.length} thumbnails left, waiting`); await new Promise((r) => setTimeout(r, 60000)); }
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: round === 1 ? 3 : 1 }, async () => {
    while (next < todo.length) {
      const w = todo[next++];
      try { await fetchThumb(w.file, thumbDir); } catch (e) { failed.add(w.file); if (round === 3) log('no thumbnail', w.file, e.message); }
      if (++done % 100 === 0) log(`thumbnails ${done}/${todo.length}`);
    }
  }));
}
const final = [];
for (const w of works) {
  if (!existsSync(thumbPath(w.file))) continue;
  const s = await scoreFile(thumbPath(w.file), inks);
  const bright = await meanBrightness(thumbPath(w.file));
  final.push({ ...w, score: Math.round(s.error * 1000) / 1000, dark: Math.round(s.dark * 100) / 100, dm: bright < DARK_MAT_BELOW, dc: (await cornerBrightness(thumbPath(w.file))) < DARK_MAT_BELOW });
}
log(`scored ${final.length}, dropped without a thumbnail: ${works.length - final.length}`);
// a work whose only usable file is a PNG asks for a small thumbnail step: measure the byte size of its thumbnails (cached) and keep the widest within the budget
const pngBytes = readCache('png-bytes.json', {});
const pngWorks = final.filter((w) => isPng(w.file));
for (const w of pngWorks) {
  for (const step of PNG_STEPS_TRY) {
    const key = `${w.file}|${step}`;
    if (step <= w.w && pngBytes[key] === undefined) pngBytes[key] = (await thumbBytes(w.file, step)) ?? null;
  }
  writeCache('png-bytes.json', pngBytes);
  const bySteps = Object.fromEntries(PNG_STEPS_TRY.map((st) => [st, pngBytes[`${w.file}|${st}`] ?? undefined]));
  w.pngStep = pngStepFor(bySteps, w.w);
}
log(`PNG works: ${pngWorks.length}; steps ${JSON.stringify(pngWorks.reduce((m, w) => ((m[w.pngStep] = (m[w.pngStep] || 0) + 1), m), {}))}`);
// build check: a work lost here is lost for a reason worth a look (the 16 TIFF files once were, silently); more than 1 % stops the build
const lost = works.length - final.length;
const lostMust = Object.keys(MUST_HAVE).filter((id) => !final.some((w) => w.id === id));
if (lost > works.length * 0.01 || lostMust.length) { log(`build check failed: ${lost} works without a thumbnail (limit 1 %), must-have lost: ${lostMust.join(' ') || 'none'}; nothing written`); process.exit(1); }

// 5. write
// what the review needs: why each work got its genre and flag (kept in the cache, not in the data)
writeCache('classification.json', Object.fromEntries(final.map((w) => [w.id, { title: w.title, sl: w.sl, genre: w.genre, reasons: w.reasons, genres: tags[w.id].genres, depicts: tags[w.id].depicts, classes: tags[w.id].classes, locations: w.locations, collections: w.collections, yearLabel: w.yearLabel }])));
const minSitelinks = Math.min(...final.map((w) => w.sl));
const meta = { v: 1, built: new Date().toISOString().slice(0, 10), palette: PALETTE_ID, source: 'Wikidata + Wikimedia Commons', min_sitelinks: minSitelinks, died_by: cutoffs(BUILD_YEAR).diedBy, made_by: cutoffs(BUILD_YEAR).madeBy };
mkdirSync(join(root, 'data'), { recursive: true });
const out = (name, ws, extraMeta = {}) => writeFileSync(join(root, 'data', name), JSON.stringify(pack(ws, { ...meta, ...extraMeta })));
for (const f of readdirSync(join(root, 'data'))) if (/^(landscape|portrait)(-\d+)?\.json$/.test(f)) rmSync(join(root, 'data', f)); // old shard files
const finalIds = new Set(final.map((w) => w.id));
// which works are members of a series with its own years and technique (a test checks that each says both)
writeFileSync(join(root, 'tools', 'build_works', 'series-members.json'), JSON.stringify(Object.fromEntries(Object.entries(seriesMembers).map(([k, v]) => [k, v.filter((id) => finalIds.has(id)).sort()])), null, 1) + '\n');
out('works.json', final, { shard: 'all' });
for (const [name, ws] of [['landscape', landscapeOf(final)], ['portrait', portraitOf(final)]]) {
  const parts = splitParts(ws, meta);
  parts.forEach((part, k) => out(`${name}-${k}.json`, part, { shard: name, part: k, parts: parts.length }));
  log(`${name}: ${ws.length} works in ${parts.length} parts of ${parts.map((p) => p.length).join(', ')}`);
}
log(`classes: ${[...Object.values(ROOT_CLASSES), ...Object.values(EXACT_CLASSES)].join(', ')}; sitelinks from ${MIN_SITELINKS}; lowest in the data set ${minSitelinks}; done`);
