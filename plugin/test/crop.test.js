// node --test plugin/test/crop.test.js ; TRANSFORM=path runs the tests against another transform (used to see them fail)
// A work with the curator's crop (a scanner bed or a pale paper margin round the print: The Great Wave on the OG showed the
// print 9 px inside its box, so the text beside it looked misplaced) is planned and drawn on the print alone.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const t = require(process.env.TRANSFORM || path.join(__dirname, '..', 'src', 'transform.js'));
const WAVE = { i: 'Q252485', t: 'The Great Wave off Kanagawa', a: 'Katsushika Hokusai', f: 'Wave.jpg', w: 8561, h: 6037, s: 63, p: 0.2, k: 0.1 };
const BOX = [137, 313, 9682, 9375]; // the curator's box of the archived scan: 1.4 % left, 3.1 % top, 1.8 % right, 3.1 % bottom are scanner bed
const shard = { v: 1, n: 1, col: [], mov: [], gen: ['other'], w: [] };
const set = t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: { label: 'true', show_date: 'true' } } } });
const og = t.screenOf({ trmnl: { device: { width: 800, height: 480, model: 'og_plus' } } });
// what the markup hides on one axis, in percent of the box: the picture is 100 + e wide, centred, pushed by the spacers
const hidden = (p) => [(p.e + p.z - p.a) / 2, (p.e + p.a - p.z) / 2];

test('the Great Wave: the work is planned on the print, not on the scan', () => {
  const whole = t.artOf(WAVE, shard, set, og).art, cut = t.artOf({ ...WAVE, x: BOX }, shard, set, og).art;
  assert.strictEqual(whole.crop, undefined);
  assert.strictEqual(whole.w, 8561);
  assert.deepStrictEqual(cut.crop, { ew: 4, eh: 7, l: 0, r: 0, t: 0, b: 0, kw: 104, kh: 107 });
  assert.ok(Math.abs(cut.w - 8561 / 1.04) < 1e-6 && Math.abs(cut.h - 6037 / 1.07) < 1e-6, `${cut.w} x ${cut.h}`);
  assert.ok(cut.w / cut.h > whole.w / whole.h, 'the print is wider than the scan: its margins are larger above and below');
});

test('every margin is hidden, and at most two percent of the box more than the margins', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let k = 0; k < 4000; k++) {
    const before = rnd() < 0.3 ? 0 : rnd() * 0.25, after = rnd() < 0.3 ? 0 : rnd() * 0.25, len = 1 - before - after;
    const p = t.cropAxis(before, after, len), [hb, ha] = hidden(p), wb = 100 * before / len, wa = 100 * after / len;
    const msg = `${before} ${after} -> ${JSON.stringify(p)}`;
    assert.ok(Number.isInteger(p.e) && Number.isInteger(p.a) && Number.isInteger(p.z) && p.e >= 0 && p.e <= 100 && p.a >= 0 && p.a <= 100 && p.z >= 0 && p.z <= 100, 'whole percents a class can hold: ' + msg);
    assert.ok(hb >= wb - 0.15 && ha >= wa - 0.15, 'more than a sliver (0.15 % of the box, CROP_SLIVER) of margin shows: ' + msg);
    assert.ok(hb >= 0 && ha >= 0 && p.e - (wb + wa) < 2, 'too much of the print is hidden: ' + msg);
  }
});

test('a margin on one side only is hidden on that side', () => {
  const p = t.cropAxis(0.05, 0, 0.95), [hb, ha] = hidden(p);
  assert.ok(hb >= 5.26 && ha <= 0.75, JSON.stringify(p));
  assert.deepStrictEqual(t.cropAxis(0, 0, 1), { e: 0, a: 0, z: 0 });
});

test('a box that is missing, broken or out of bounds leaves the work whole', () => {
  for (const x of [undefined, null, [], [0, 0, 10000], [0, 0, 10000, 10000], [-1, 0, 9000, 9000], [0, 0, 4000, 9000], [0, 0, 9000, 4000], [2000, 0, 9000, 9000], [0, 2000, 9000, 9000],
    ['0', '0', '9000', '9000'], [0, 0, NaN, 9000], [0, 0, Infinity, 9000], 'abcd', { 0: 1 }]) {
    assert.strictEqual(t.cropPlan({ x }), null, JSON.stringify(x));
    const art = t.artOf({ ...WAVE, x }, shard, set, og).art;
    assert.ok(art.crop === undefined && art.w === 8561 && art.h === 6037, JSON.stringify(x));
  }
});

test('a cropped work asks for a thumbnail wide enough for the whole scan it is cut from', () => {
  const big = { ...WAVE, x: [2000, 0, 6000, 10000] }; // 40 % of the width is margin
  const frame = t.screenOf({ trmnl: { device: { width: 2560, height: 1440, model: 'frame' } } });
  const a = t.artOf({ ...WAVE, w: 6037, h: 6037 }, shard, set, frame).art, b = t.artOf({ ...big, w: 10062, h: 6037 }, shard, set, frame).art;
  assert.ok(b.width > a.width, `${b.width} > ${a.width}`);
});
