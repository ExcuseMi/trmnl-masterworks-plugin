import test from 'node:test';
import assert from 'node:assert';
import { cutoffs, isPublicDomain, yearOf } from '../wikidata.mjs';
import { md5Path, thumbUrl, usable } from '../commons.mjs';
import { hexToRgb, scoreRgb, FALLBACK_PALETTE } from '../palette.mjs';
import { aspect, landscapeOf, pack, portraitOf } from '../shards.mjs';

const d = (o) => ({ rights: [], creators: [], years: [], ...o });
const cr = (...death) => ({ id: 'Q1', name: 'A', death, mov: [] });

const Y = 2026; // the build year of the examples; cut-offs: died 1955 or earlier, made 1930 or earlier

test('cut-offs follow the build year', () => {
  assert.deepStrictEqual(cutoffs(2026), { diedBy: 1955, madeBy: 1930 });
  assert.deepStrictEqual(cutoffs(2027), { diedBy: 1956, madeBy: 1931 });
});

test('public domain, US rule: American Gothic (1930, Grant Wood died 1942) passes in 2026, a 1931 work does not', () => {
  assert.ok(isPublicDomain(d({ years: [1930], creators: [cr(1942)] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1931], creators: [cr(1942)] }), Y));
  assert.ok(isPublicDomain(d({ years: [1931], creators: [cr(1942)] }), 2027), 'the same work a year later');
  assert.ok(!isPublicDomain(d({ years: [1931], rights: ['Q19652'], creators: [cr(1942)] }), Y), 'a P6216 statement does not lift the US date rule');
});

test('public domain, life rule: died 1955 or earlier in 2026; the Wikidata statement stands in for a missing death date', () => {
  assert.ok(isPublicDomain(d({ years: [1600], creators: [cr(1955)] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1600], creators: [cr(1956)] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1600], creators: [cr()] }), Y), 'no death date: not provable');
  assert.ok(isPublicDomain(d({ years: [1600], rights: ['Q19652'], creators: [cr()] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1600], creators: [cr(1700), cr(1980)] }), Y), 'every creator must qualify');
  assert.ok(!isPublicDomain(d({ years: [1600], rights: ['Q50423863'], creators: [cr(1500)] }), Y), 'a rights statement without public domain rules out');
});

test('public domain: no creator only when dated before 1850; no date only when every creator died before 1900', () => {
  assert.ok(isPublicDomain(d({ years: [1400] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1900] }), Y));
  assert.ok(!isPublicDomain(d({}), Y));
  assert.ok(isPublicDomain(d({ creators: [cr(1850)] }), Y));
  assert.ok(!isPublicDomain(d({ creators: [cr(1930)] }), Y));
});

test('years parse, also negative ones', () => {
  assert.strictEqual(yearOf('1503-01-01T00:00:00Z'), 1503);
  assert.strictEqual(yearOf('-0500-01-01T00:00:00Z'), -500);
  assert.strictEqual(yearOf('nonsense'), undefined);
});

test('md5 path and thumb URL (checked on upload.wikimedia.org: Mona Lisa is e/ec)', () => {
  assert.strictEqual(md5Path('Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg'), 'e/ec');
  assert.match(thumbUrl('Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg', 120), /\/thumb\/e\/ec\/Mona_Lisa%2C_by_.*\/120px-Mona_Lisa%2C_by_/);
});

test('usable: bitmaps with a long side of 1500 px or more', () => {
  assert.ok(usable({ bitmap: true, w: 1500, h: 900 }));
  assert.ok(!usable({ bitmap: true, w: 1499, h: 900 }));
  assert.ok(!usable({ bitmap: false, w: 5000, h: 5000 }));
  assert.ok(!usable(undefined));
});

test('palette score: 0 for an exact ink, grows with distance, 1 at most', () => {
  assert.strictEqual(scoreRgb(Buffer.from([255, 0, 0, 0, 0, 0]), FALLBACK_PALETTE), 0);
  const grey = scoreRgb(Buffer.from([128, 128, 128]), FALLBACK_PALETTE);
  const pink = scoreRgb(Buffer.from([255, 150, 150]), FALLBACK_PALETTE);
  assert.ok(grey > 0.1 && grey < 0.5, String(grey));
  assert.ok(pink > 0 && pink < grey + 0.2);
  assert.ok(Number.isNaN(scoreRgb(Buffer.alloc(0), FALLBACK_PALETTE)));
  assert.deepStrictEqual(hexToRgb('#FFFF00'), [255, 255, 0]);
});

test('shards: aspect ranges overlap near square; pack shares collection and movement tables', () => {
  const ws = [
    { id: 'Q1', title: 'wide', artist: 'a', file: 'a.jpg', w: 3000, h: 2000, sl: 10, score: 0.2, coll: 'Louvre', mov: 'Baroque', year: 1600 },
    { id: 'Q2', title: 'tall', artist: 'b', file: 'b.jpg', w: 2000, h: 3000, sl: 9, score: 0.3, coll: 'Louvre' },
    { id: 'Q3', title: 'square', artist: 'c', file: 'c.jpg', w: 2000, h: 2000, sl: 8, score: 0.4, mov: 'Baroque' },
  ];
  assert.deepStrictEqual(landscapeOf(ws).map((x) => x.id), ['Q1', 'Q3']);
  assert.deepStrictEqual(portraitOf(ws).map((x) => x.id), ['Q2', 'Q3']);
  assert.ok(aspect(ws[0]) > 1);
  const p = pack(ws, { v: 1 });
  assert.deepStrictEqual(p.col, ['Louvre']);
  assert.deepStrictEqual(p.mov, ['Baroque']);
  assert.strictEqual(p.n, 3);
  assert.deepStrictEqual(p.w[0], { i: 'Q1', t: 'wide', a: 'a', f: 'a.jpg', w: 3000, h: 2000, s: 10, p: 0.2, y: 1600, c: 0, m: 0 });
  assert.strictEqual(p.w[1].m, undefined);
});
