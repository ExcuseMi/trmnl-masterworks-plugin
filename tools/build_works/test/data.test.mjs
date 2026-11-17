// The committed data files: no vandalized titles reach the screen (TRMNL review 2026-11-17: Wikidata's label for
// Q311243 read "Wanderer above the Sea younes non non non ..." and portrait-3.json carried it).
import test from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../data');
const works = readdirSync(dataDir).filter((f) => /^(landscape|portrait)-\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')).w.map((w) => ({ f, ...w })));

test('every shard has works', () => assert.ok(works.length > 3000));

test('no title has a word repeated three times in a row (vandalism)', () => {
  const bad = works.filter((w) => /\b(\p{L}+)\s+\1\s+\1\b/iu.test(w.t)).map((w) => `${w.f} ${w.i} ${w.t}`);
  assert.deepStrictEqual(bad, []);
});

test('title fixes are in the data', () => {
  assert.ok(works.filter((w) => w.i === 'Q311243').every((w) => w.t === 'Wanderer above the Sea of Fog'));
});

// Round 2 review 2026-11-17: Wikidata held The Sick Child six times, Munch's Madonna four times, Water Lilies thirteen.
import { titleKey } from '../dedupe.mjs';
import { YEAR_LABEL_RE } from '../dates.mjs';

test('no two works share an artist and a normalised title', () => {
  const seen = new Map(), dup = [];
  for (const w of new Map(works.map((x) => [x.i, x])).values()) { // a near-square work is in both orientations: one work once by id first
    const k = titleKey(w.a, w.t);
    if (seen.has(k)) dup.push(`${seen.get(k)} and ${w.i}: ${w.a} / ${w.t}`); else seen.set(k, w.i);
  }
  assert.deepStrictEqual(dup, []);
});

test('every year label has a known form (no "1885s")', () => {
  const bad = works.filter((w) => w.yl && !YEAR_LABEL_RE.test(w.yl)).map((w) => `${w.i} ${w.t}: ${w.yl}`);
  assert.deepStrictEqual(bad, []);
});

test('every member of a series with its own years and technique says both (year and technique on the label)', () => {
  const members = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../series-members.json'), 'utf8'));
  const byId = new Map(works.map((w) => [w.i, w]));
  const ids = Object.values(members).flat();
  assert.ok(ids.length > 200, `${ids.length} series members`);
  const bad = ids.filter((id) => !byId.has(id) || byId.get(id).y === undefined || byId.get(id).e === undefined);
  assert.deepStrictEqual(bad, []);
});

// Owner 2026-11-17: a photo of a museum touchscreen showing a scroll reached the Frame. No gallery photos (camera file
// names) and no shape longer than MAX_ASPECT in the data; and the owner's family-friendly flags are kept.
import { GALLERY_PHOTO_RE, MAX_ASPECT } from '../commons.mjs';

test('no gallery photos and no sliver shapes in the data', () => {
  const bad = works.filter((w) => GALLERY_PHOTO_RE.test(w.f) || w.w / w.h > MAX_ASPECT || w.w / w.h < 1 / MAX_ASPECT).map((w) => `${w.f} ${w.i} ${w.t}`);
  assert.deepStrictEqual(bad, []);
});

test('reviewed family-friendly flags are in the data', () => {
  for (const id of ['Q17491284', 'Q2438357', 'Q2046100']) assert.ok(works.filter((w) => w.i === id).every((w) => w.u), id);
});

test('every work is not a PNG, or says the thumbnail step to ask for (a PNG thumbnail is a PNG, many MB: Cornard Wood loaded half-drawn)', () => {
  const bad = works.filter((w) => /\.png$/i.test(w.f) && !(w.r >= 250 && w.r <= 960)).map((w) => `${w.i} ${w.f}`);
  assert.deepStrictEqual(bad, []);
});
