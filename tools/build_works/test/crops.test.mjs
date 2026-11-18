// The curator's crops on their way into the data: index export -> snapshot -> the work's x key.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTo, boxOf, cropFor, crops, loadCrops, CROP_UNIT } from '../curator_crops.mjs';
import { pack } from '../shards.mjs';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

test('a box in 1/10000 of the picture; a missing, whole or impossible box is no crop', () => {
  assert.deepStrictEqual(boxOf([0.0137, 0.0313, 0.9682, 0.9375]), [137, 313, 9682, 9375]);
  for (const c of [undefined, null, [0, 0, 1, 1], [0, 0, 1], [0.1, 0, 0.95, 1], [0, 0.2, 1, 0.9], [-0.01, 0, 0.9, 0.9], [0, 0, 0.4, 1], [0, 0, 1, 0.4], ['0', 0, 0.9, 0.9], [0, 0, NaN, 0.9]]) {
    assert.strictEqual(boxOf(c), null, JSON.stringify(c));
  }
});

test('the snapshot keeps the file the box was measured on; another file of the same work gets no crop', () => {
  const snap = crops([{ qid: 'Q2', src_file: 'B.jpg', cur: { cropf: [0, 0.05, 1, 0.9] } }, { qid: 'Q1', src_file: 'A.jpg', cur: { cropf: [0.02, 0, 0.96, 1] } },
    { qid: 'Q3', src_file: 'C.jpg', cur: {} }, { qid: 'Q4', src_file: 'D.jpg' }, { qid: 'Q5', src_file: 'E.jpg', cur: { cropf: null } }]);
  assert.deepStrictEqual(snap, { Q1: ['A.jpg', 200, 0, 9600, 10000], Q2: ['B.jpg', 0, 500, 10000, 9000] });
  assert.deepStrictEqual(Object.keys(snap), ['Q1', 'Q2']);
  assert.deepStrictEqual(cropFor(snap, 'Q1', 'A.jpg'), [200, 0, 9600, 10000]);
  assert.strictEqual(cropFor(snap, 'Q1', 'A (another scan).jpg'), null);
  assert.strictEqual(cropFor(snap, 'Q9', 'A.jpg'), null);
  assert.strictEqual(cropFor({ Q1: ['A.jpg', 0, 0, 20000, 100] }, 'Q1', 'A.jpg'), null, 'a broken snapshot row');
});

test('the packed work carries the box as x, a work without one has no key', () => {
  const base = { title: 't', artist: 'a', w: 2, h: 1, sl: 1, score: 0.1, dark: 0 };
  const p = pack([{ ...base, id: 'Q1', file: 'A.jpg', crop: [200, 0, 9600, 10000] }, { ...base, id: 'Q2', file: 'B.jpg' }], { v: 1 });
  assert.deepStrictEqual(p.w[0].x, [200, 0, 9600, 10000]);
  assert.ok(!('x' in p.w[1]));
  const doc = { w: [{ i: 'Q1', f: 'A.jpg', x: [1, 1, 9000, 9000] }, { i: 'Q2', f: 'B.jpg', x: [1, 1, 9000, 9000] }, { i: 'Q3', f: 'other.jpg' }] };
  assert.strictEqual(applyTo(doc, { Q1: ['A.jpg', 200, 0, 9600, 10000], Q3: ['C.jpg', 0, 0, 9000, 9000] }), 1);
  assert.deepStrictEqual(doc.w, [{ i: 'Q1', f: 'A.jpg', x: [200, 0, 9600, 10000] }, { i: 'Q2', f: 'B.jpg' }, { i: 'Q3', f: 'other.jpg' }]);
});

// The Great Wave (Q252485, LCCN scan): white scanner bed on all four sides. On the OG the print began 9 px inside its box.
test('the data: every work the snapshot has a box for carries exactly that box, no other work carries one; the Great Wave is cropped on four sides', () => {
  const snap = loadCrops();
  assert.ok(Object.keys(snap).length > 100, `${Object.keys(snap).length} crops`);
  const bad = [];
  let wave = 0;
  for (const f of readdirSync(dataDir).filter((n) => n.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
    for (const w of doc.w || []) {
      const want = cropFor(snap, w.i, w.f);
      if (JSON.stringify(w.x || null) !== JSON.stringify(want)) bad.push(`${f} ${w.i}`);
      if (w.i === 'Q252485') {
        wave++;
        const [x, y, cw, ch] = w.x || [0, 0, CROP_UNIT, CROP_UNIT];
        assert.ok(x >= 100 && y >= 250 && CROP_UNIT - x - cw >= 150 && CROP_UNIT - y - ch >= 250, `${f}: ${JSON.stringify(w.x)}`);
      }
    }
  }
  assert.deepStrictEqual(bad.slice(0, 10), []);
  assert.ok(wave >= 2, 'the Great Wave is in the data');
});
