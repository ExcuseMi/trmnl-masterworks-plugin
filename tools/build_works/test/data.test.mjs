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

// Review 2026-11-19: found in the live data by asking Wikidata for every creator's death year. The data holds no death years, so
// the works found are named here; the rule that let them in is fixed in isPublicDomain (build.test.mjs).
test('no work whose creator died after the cut-off is in the data', () => {
  const notFree = { Q21711833: 'Marc Chagall, died 1985', Q43485263: 'Georgina de Albuquerque, died 1962', Q131675026: 'Frederick Strothmann, died 1958' };
  assert.deepStrictEqual(works.filter((w) => notFree[w.i]).map((w) => `${w.f} ${w.i} ${w.a}: ${notFree[w.i]}`), []);
});

test('artist fixes are in the data (Wikidata named an actor born in 1992 as the painter of a Kandinsky of 1910)', () => {
  assert.deepStrictEqual([...new Set(works.filter((w) => w.i === 'Q3921861').map((w) => `${w.a}: ${w.t}`))], ['Wassily Kandinsky: First Abstract Watercolor']);
});

test('label fixes are in the data: a painter born after the work, a year that is a typo, the year of the event or zero', () => {
  const label = (id) => [...new Set(works.filter((w) => w.i === id).map((w) => `${w.a}, ${w.yl || (w.y === undefined ? 'no year' : w.y)}`))].join(' / ');
  assert.deepStrictEqual(['Q6043547', 'Q11092366', 'Q1450935', 'Q29328965', 'Q21614085', 'Q111417085'].map(label),
    ['Francisco Goya, 1786', 'François Boucher, 1739', 'Raphael, 1516–17', 'Eugène Delacroix, 1836', 'Jan van Amstel, no year', 'Unknown artist, no year']);
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

// Owner 2026-11-19 (was 2026-11-18, error on the side of caution: every suspect hidden, which hid 30 % of the works and 113 of the
// 300 most famous): only sure cases hide a work. The curator's flag does, its doubt does not, and family-review.json (decisions made
// by looking at each picture: the 300 most famous hidden works, all hidden works of the 1,000 most famous, every work only the
// curator flagged) is applied last. Q19967004 (Schiele, The Embrace) showed with Family friendly on once: it stays hidden.
import { suspects, suspectOf, loadSuspects, loadReview, familyReasons } from '../curator_safety.mjs';

const unique = [...new Map(works.map((w) => [w.i, w])).values()];
const famous = (n) => [...unique].sort((a, b) => b.s - a.s || Number(a.i.slice(1)) - Number(b.i.slice(1))).slice(0, n);

test('family flags follow the rule: a curator flag hides unless the review says show; a review decision always holds', () => {
  const sus = loadSuspects(), review = loadReview();
  assert.ok(Object.keys(sus).length > 1200 && Object.keys(review).length > 500, `${Object.keys(sus).length} suspects, ${Object.keys(review).length} reviewed`);
  assert.deepStrictEqual(unique.filter((w) => sus[w.i] === 'flag' && review[w.i] !== 'show' && !w.u).map((w) => w.i), [], 'flagged by the curator, not cleared by a look: hidden');
  assert.deepStrictEqual(unique.filter((w) => review[w.i] === 'show' && w.u).map((w) => `${w.i} ${w.t}`), [], 'looked at and cleared: shown');
  assert.deepStrictEqual(unique.filter((w) => review[w.i] === 'hide' && !w.u).map((w) => `${w.i} ${w.t}`), [], 'looked at and kept: hidden');
  assert.deepStrictEqual(Object.values(review).filter((v) => v !== 'show' && v !== 'hide'), []);
  assert.ok(works.filter((w) => w.i === 'Q19967004').every((w) => w.u) && review.Q19967004 === 'hide');
});

test('the famous works show with Family friendly on: of the 300 most famous exactly the 23 looked at and kept are hidden, none on a curator doubt', () => {
  const review = loadReview(), hidden = famous(300).filter((w) => w.u);
  assert.deepStrictEqual(hidden.filter((w) => review[w.i] !== 'hide').map((w) => `${w.i} ${w.t}`), [], 'a famous work is hidden only by a decision made on its picture');
  assert.strictEqual(hidden.length, FAMOUS_HIDDEN, `${hidden.length} of the 300 most famous are hidden`);
  const shown = (t) => unique.filter((w) => w.t === t && !w.u).length > 0;
  for (const t of ['The Scream', 'The Night Watch', 'The Creation of Adam', 'The Kiss', 'The Birth of Venus', 'The Raft of the Medusa', 'The Third of May 1808']) assert.ok(shown(t), t);
  const share = unique.filter((w) => w.u).length / unique.length;
  assert.ok(share < 0.15, `${(100 * share).toFixed(1)} % of all works are hidden (was 30 %)`);
});
const FAMOUS_HIDDEN = 23; // decided 2026-11-19 by looking at each of the 72 the rule still hid (113 before); change only with family-review.json

test('the family rule: a curator flag counts, a doubt does not; the review is applied last', () => {
  assert.strictEqual(suspectOf({ flag: 'nudity', doubt: [] }), 'flag');
  assert.strictEqual(suspectOf({ flag: null, doubt: ['genre', 'safety'] }), 'doubt');
  assert.strictEqual(suspectOf({ flag: null, doubt: ['quality'] }), null);
  assert.strictEqual(suspectOf({ flag: null, doubt: [] }), null);
  assert.strictEqual(suspectOf(undefined), null);
  assert.deepStrictEqual(suspects([{ qid: 'Q2', cur: { flag: 'violence', doubt: [] } }, { qid: 'Q1', cur: { flag: null, doubt: [] } }]), { Q2: 'flag' });
  assert.deepStrictEqual(familyReasons([], 'doubt'), [], 'a doubt alone hides nothing');
  assert.deepStrictEqual(familyReasons([], 'flag'), ['curator flag']);
  assert.deepStrictEqual(familyReasons(['nudity'], 'doubt'), ['nudity'], 'the data\'s own reason stands');
  assert.deepStrictEqual(familyReasons(['nudity'], 'flag', 'show'), [], 'looked at and cleared');
  assert.deepStrictEqual(familyReasons([], undefined, 'hide'), ['review'], 'looked at and kept');
  assert.deepStrictEqual(familyReasons(undefined, undefined, undefined), []);
});

// Owner 2026-11-18, generic rules for old and new works: the curator's sure quality exclusions, what is no picture, and
// the same picture twice leave the data; every work in the data was judged by the curator (a rebuild must not pull in an
// unjudged work from the overshoot).
import { exclusions, loadExclusions, isSure } from '../curator_exclude.mjs';
import { isNotAPicture } from '../classify.mjs';
import { SAME_PICTURE, samePictureDrops } from '../dedupe.mjs';

test('no work the curator surely excludes is in the data (museum photo or chart or label, above the thresholds)', () => {
  const ex = loadExclusions();
  assert.ok(!isSure('museum photo 0.63; chart/label 0.67') && isSure('museum photo 0.70') && isSure('chart/label 0.96') && !isSure('chart/label 0.89') && !isSure('blur 38'));
  assert.ok(Object.keys(ex).length > 20, `${Object.keys(ex).length} exclusions`);
  assert.deepStrictEqual(works.filter((w) => ex[w.i]).map((w) => `${w.i} ${ex[w.i]}`), []);
});

test('the exclusion rule takes the sure set only, not the doubtful', () => {
  assert.deepStrictEqual(exclusions([{ qid: 'Q2', cur: { exclude: 'museum photo 0.80', doubt: [] } }, { qid: 'Q4', cur: { exclude: 'museum photo 0.60; chart/label 0.9', doubt: [] } }, { qid: 'Q5', cur: { exclude: 'blur 38', doubt: [] } }, { qid: 'Q1', cur: { exclude: null, doubt: ['quality'] } }, { qid: 'Q3' }]), { Q2: 'museum photo 0.80' });
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
