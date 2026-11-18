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
  for (const id of ['Q17491284', 'Q2438357', 'Q2046100', 'Q18891424', 'Q11873950', 'Q9199625']) assert.ok(works.filter((w) => w.i === id).every((w) => w.u), id);
});

test('every work is not a PNG, or says the thumbnail step to ask for (a PNG thumbnail is a PNG, many MB: Cornard Wood loaded half-drawn)', () => {
  const bad = works.filter((w) => /\.png$/i.test(w.f) && !(w.r >= 250 && w.r <= 960)).map((w) => `${w.i} ${w.f}`);
  assert.deepStrictEqual(bad, []);
});

// Owner 2026-11-18, error on the side of caution: every work the curator flagged or found borderline on safety has the
// family flag (the snapshot is made from the server's index export, overrides applied). Q19967004 (Schiele, The Embrace)
// showed with Family friendly on.
import { suspects, suspectOf, loadSuspects } from '../curator_safety.mjs';

test('every curator safety suspect has the family flag, and Q19967004 too', () => {
  const sus = loadSuspects(), ids = new Set(works.map((w) => w.i));
  assert.ok(Object.keys(sus).length > 1200, `${Object.keys(sus).length} suspects`);
  const bad = Object.keys(sus).filter((q) => ids.has(q) && !works.filter((w) => w.i === q).every((w) => w.u));
  assert.deepStrictEqual(bad, []);
  assert.ok(works.filter((w) => w.i === 'Q19967004').every((w) => w.u));
  assert.ok(sus.Q19967004, 'the curator flagged it');
});

test('the suspect rule: a flag or a safety doubt, nothing else; an override that clears both un-flags', () => {
  assert.strictEqual(suspectOf({ flag: 'nudity', doubt: [] }), 'flag');
  assert.strictEqual(suspectOf({ flag: null, doubt: ['genre', 'safety'] }), 'doubt');
  assert.strictEqual(suspectOf({ flag: null, doubt: ['quality'] }), null);
  assert.strictEqual(suspectOf({ flag: null, doubt: [] }), null);
  assert.strictEqual(suspectOf(undefined), null);
  assert.deepStrictEqual(suspects([{ qid: 'Q2', cur: { flag: 'violence', doubt: [] } }, { qid: 'Q1', cur: { flag: null, doubt: [] } }]), { Q2: 'flag' });
});

// Owner 2026-11-18, generic rules for old and new works: the curator's sure quality exclusions, what is no picture, and
// the same picture twice leave the data; every work in the data was judged by the curator (a rebuild must not pull in an
// unjudged work from the overshoot).
import { exclusions, loadExclusions, scoreOf } from '../curator_exclude.mjs';
import { isNotAPicture } from '../classify.mjs';
import { SAME_PICTURE, samePictureDrops } from '../dedupe.mjs';

test('no work the curator surely excludes is in the data (museum photo or chart or label, score 0.70 or more)', () => {
  const ex = loadExclusions();
  assert.strictEqual(scoreOf('museum photo 0.63; chart/label 0.67'), 0.67);
  assert.ok(Object.keys(ex).length > 50, `${Object.keys(ex).length} exclusions`);
  assert.deepStrictEqual(works.filter((w) => ex[w.i]).map((w) => `${w.i} ${ex[w.i]}`), []);
});

test('the exclusion rule takes the sure set only, not the doubtful', () => {
  assert.deepStrictEqual(exclusions([{ qid: 'Q2', cur: { exclude: 'chart/label 0.80', doubt: [] } }, { qid: 'Q4', cur: { exclude: 'museum photo 0.60', doubt: [] } }, { qid: 'Q5', cur: { exclude: 'blur 38', doubt: [] } }, { qid: 'Q1', cur: { exclude: null, doubt: ['quality'] } }, { qid: 'Q3' }]), { Q2: 'chart/label 0.80' });
});

test('maps, plans, banknotes, ostraca and objects are no pictures; paintings and prints stay', () => {
  for (const c of [['print', 'map'], ['plan', 'manuscript'], ['banknote'], ['ostracon', 'drawing'], ['engraving', 'lacquerware'], ['Fabergé egg', 'triptych']]) assert.ok(isNotAPicture(c), c.join());
  for (const c of [['painting'], ['woodcut print', 'series of prints'], ['drawing'], ['fresco', 'tomb'], ['painting', 'mummy']]) assert.ok(!isNotAPicture(c), c.join());
});

test('an identical or same-picture pair keeps one work (more sitelinks); the painter\'s own versions stay', () => {
  const w = [{ id: 'Q1', sl: 10 }, { id: 'Q2', sl: 50 }, { id: 'Q3', sl: 5 }, { id: 'Q4', sl: 5 }];
  assert.deepStrictEqual([...samePictureDrops([['Q1', 'Q2', 1], ['Q3', 'Q4', 0.97], ['Q1', 'Q9', 1]], w)], ['Q1']);
  assert.ok(SAME_PICTURE > 0.98 && SAME_PICTURE < 1);
});

test('the same picture is in the data once (curator pairs)', () => {
  const ids = new Set(works.map((w) => w.i));
  const both = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../curator-pairs.json'), 'utf8')).filter(([a, b, c]) => c >= SAME_PICTURE && ids.has(a) && ids.has(b));
  assert.deepStrictEqual(both, []);
});
