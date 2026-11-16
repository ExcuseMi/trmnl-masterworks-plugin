// node --test plugin/test ; TRANSFORM=path runs the tests against another transform (used to see them fail)
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const t = require(process.env.TRANSFORM || path.join(__dirname, '..', 'src', 'transform.js'));
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

// a shard of n works, landscape unless a work says otherwise; i = Q1.., sitelinks and score as given
function shard(works) {
  return {
    v: 1, built: '2026-11-16', n: works.length, col: ['Louvre'], mov: ['Impressionism', 'Baroque'],
    w: works.map((w, k) => ({ i: 'Q' + (k + 1), t: 'Work ' + (k + 1), a: 'Artist', f: `File ${k + 1}.jpg`, w: 4000, h: 3000, s: 20, p: 0.3, c: 0, ...w })),
  };
}
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const ctx = { fit: 'fill', aspect: 16 / 9, movement: '' };
const answer = (json, status = 200) => async () => ({ ok: status === 200, status, json: async () => json });
const input = (extra = {}) => ({
  trmnl: { device: { width: 2560, height: 1440, orientation: 'landscape' }, plugin_settings: { custom_fields_values: {} }, state: {}, ...extra },
});

test('md5 equals the crypto md5, also for non-ASCII and long names', () => {
  for (const s of ['', 'a', 'Mona_Lisa.jpg', 'Café_Terrace_at_Night_(Yorck).jpg', 'x'.repeat(200), '日本画.jpg', 'y'.repeat(55), 'y'.repeat(56), 'y'.repeat(64)]) {
    assert.strictEqual(t.md5(s), crypto.createHash('md5').update(s).digest('hex'), s);
  }
});

test('thumb URL follows the Commons md5 rule: first hex digit / first two, underscores, percent-encoding', () => {
  const f = 'Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg';
  const g = f.replace(/ /g, '_');
  const h = crypto.createHash('md5').update(g).digest('hex');
  assert.strictEqual(
    t.thumbUrl(f, 1280),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(g)}/1280px-${encodeURIComponent(g)}`,
  );
  assert.match(t.thumbUrl(f, 1280), /\/thumb\/e\/ec\//); // checked against upload.wikimedia.org by hand
});

test('thumb URL of a TIFF is the lossy JPEG form Commons serves', () => {
  const f = 'The Kitchen Maid (Rembrandt) - Nationalmuseum - 17587.tif';
  const g = f.replace(/ /g, '_'), h = crypto.createHash('md5').update(g).digest('hex');
  assert.strictEqual(t.thumbUrl(f, 960), `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(g)}/lossy-page1-960px-${encodeURIComponent(g)}.jpg`);
  assert.match(t.thumbUrl('X.TIFF', 960), /\/lossy-page1-960px-X\.TIFF\.jpg$/);
  assert.doesNotMatch(t.thumbUrl('X.jpg', 960), /lossy/);
});

test('thumb width: only widths Commons serves, never above the file, a step down when close enough', () => {
  const STEPS = [120, 250, 500, 960, 1280, 1920, 3840];
  for (const [w, h, sw, sh, fit] of [[5000, 3000, 2560, 1440, 'fill'], [3000, 5000, 1440, 2560, 'fill'], [5000, 3000, 1872, 1404, 'whole'], [5000, 3000, 800, 480, 'fill'], [1600, 1500, 2560, 1440, 'fill']]) {
    const got = t.thumbWidth(w, h, sw, sh, fit);
    assert.ok(STEPS.includes(got), `${got} is not a standard step`);
    assert.ok(got <= w, `${got} above the file width ${w}`);
  }
  assert.strictEqual(t.thumbWidth(5000, 3000, 800, 480, 'fill'), 960);
  assert.strictEqual(t.thumbWidth(5000, 3000, 2560, 1440, 'fill'), 1920); // 1920 is 75% of 2560: close enough
  assert.strictEqual(t.thumbWidth(1600, 1500, 2560, 1440, 'fill'), 1280); // the file is 1600 wide
});

test('screen: portrait and landscape from the device, long side across for landscape', () => {
  assert.deepStrictEqual(t.screenOf({ trmnl: { device: { width: 1440, height: 2560, orientation: 'portrait' } } }), { w: 1440, h: 2560, o: 'portrait' });
  assert.deepStrictEqual(t.screenOf({ trmnl: { device: { width: 2560, height: 1440, orientation: 'portrait' } } }), { w: 1440, h: 2560, o: 'portrait' });
  assert.deepStrictEqual(t.screenOf({ trmnl: { device: { width: 1440, height: 2560, orientation: 'landscape' } } }), { w: 1440, h: 2560, o: 'portrait' }); // sizes win
  assert.deepStrictEqual(t.screenOf({ trmnl: { device: { width: 800, height: 480 } } }), { w: 800, h: 480, o: 'landscape' });
  assert.deepStrictEqual(t.screenOf({}), { w: 800, h: 480, o: 'landscape' });
});

test('settings: fit, label and movement fall back to defaults on anything unknown', () => {
  const s = (c) => t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: c } } });
  assert.deepStrictEqual(s({}), { fit: 'fill', label: 'corner', movement: '' });
  assert.deepStrictEqual(s({ fit: 'whole', label: 'off', movement: 'Baroque' }), { fit: 'whole', label: 'off', movement: 'Baroque' });
  assert.deepStrictEqual(s({ fit: 'x', label: 'x', movement: 'all' }), { fit: 'fill', label: 'corner', movement: '' });
});

test('weighting: a more famous work comes up more often', () => {
  const sh = shard([{ s: 400 }, { s: 10 }]);
  const rnd = seeded(7);
  let famous = 0;
  for (let n = 0; n < 2000; n++) if (t.choose(sh, ctx, [], rnd) === 0) famous++;
  assert.ok(famous > 1700, `famous picked ${famous} of 2000`);
});

test('weighting: a better palette score comes up a little more often (small weight)', () => {
  const sh = shard([{ p: 0.1 }, { p: 0.6 }]);
  const rnd = seeded(11);
  let good = 0;
  for (let n = 0; n < 4000; n++) if (t.choose(sh, ctx, [], rnd) === 0) good++;
  assert.ok(good / 4000 > 0.5 && good / 4000 < 0.65, `good score picked ${good} of 4000`);
});

test('weighting: a very dark work comes up far less often; a little darkness costs nothing', () => {
  const rnd = seeded(13);
  const share = (k) => {
    const sh = shard([{ k: 0.05 }, { k }]);
    let dark = 0;
    for (let n = 0; n < 4000; n++) if (t.choose(sh, ctx, [], rnd) === 1) dark++;
    return dark / 4000;
  };
  assert.ok(Math.abs(share(0.45) - 0.5) < 0.04, 'at the free share: even');
  assert.ok(share(0.9) < 0.1, 'very dark: ' + share(0.9));
});

test('weighting: fame is the main factor: a 4x more famous work beats a worse colour match', () => {
  const sh = shard([{ s: 80, p: 0.6, k: 0.1 }, { s: 20, p: 0.1, k: 0.1 }]);
  const rnd = seeded(17);
  let famous = 0;
  for (let n = 0; n < 2000; n++) if (t.choose(sh, ctx, [], rnd) === 0) famous++;
  assert.ok(famous > 1250, `famous picked ${famous} of 2000`);
});

test('weighting: a work shaped like the screen beats a far-off shape, and less so for Whole work', () => {
  const sh = shard([{ w: 1600, h: 900 }, { w: 3000, h: 3000 }]);
  const share = (fit) => {
    const rnd = seeded(5);
    let like = 0;
    for (let n = 0; n < 2000; n++) if (t.choose(sh, { ...ctx, fit }, [], rnd) === 0) like++;
    return like / 2000;
  };
  assert.ok(share('fill') > 0.8, 'fill ' + share('fill'));
  assert.ok(share('whole') < share('fill'));
});

test('no repeats: none of the history is picked while others remain', () => {
  const sh = shard(Array.from({ length: 60 }, () => ({})));
  const hist = Array.from({ length: 50 }, (_, k) => k + 1); // Q1..Q50 shown
  const rnd = seeded(3);
  for (let n = 0; n < 500; n++) assert.ok(t.choose(sh, ctx, hist, rnd) >= 50);
});

test('no repeats: a pool used up gives the work shown longest ago', () => {
  const sh = shard([{}, {}, {}]);
  assert.strictEqual(t.choose(sh, ctx, [3, 1, 2], seeded(1)), 2); // Q3 is the oldest entry
});

test('movement filter: only that movement, case-insensitive; a movement with a few works is ignored', () => {
  const works = Array.from({ length: 20 }, (_, k) => ({ m: k < 10 ? 0 : 1 }));
  works.push({ m: undefined }, { m: undefined });
  const sh = shard(works);
  const rnd = seeded(9);
  for (let n = 0; n < 300; n++) assert.ok(sh.w[t.choose(sh, { ...ctx, movement: 'baroque' }, [], rnd)].m === 1);
  const few = shard([{ m: 0 }, ...Array.from({ length: 10 }, () => ({ m: 1 }))]);
  const seen = new Set();
  for (let n = 0; n < 300; n++) seen.add(few.w[t.choose(few, { ...ctx, movement: 'Impressionism' }, [], rnd)].m);
  assert.ok(seen.has(1), 'one work is no pool: the filter is ignored');
  assert.strictEqual(t.choose(sh, { ...ctx, movement: 'No such movement' }, [], rnd) >= 0, true);
});

test('run: picks a work, builds the thumbnail URL at a standard width, saves the history', async () => {
  const sh = shard([{ y: 1503 }]);
  let asked;
  globalThis.fetch = async (url) => { asked = url; return answer(sh)(); };
  const out = await t.run(input());
  assert.match(asked, /\/data\/landscape\.json$/);
  assert.strictEqual(out.art.id, 'Q1');
  assert.strictEqual(out.art.year, '1503');
  assert.strictEqual(out.art.collection, 'Louvre');
  assert.match(out.art.url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/File_1\.jpg\/\d+px-File_1\.jpg$/);
  assert.deepStrictEqual(out.trmnl_state, { h: [1] });
  assert.strictEqual(out.art.fit, 'cover');
});

test('run: a portrait screen reads the portrait shard; Whole work contains', async () => {
  let asked;
  globalThis.fetch = async (url) => { asked = url; return answer(shard([{ w: 3000, h: 4000 }]))(); };
  const out = await t.run(input({ device: { width: 1440, height: 2560, orientation: 'portrait' }, plugin_settings: { custom_fields_values: { fit: 'whole' } } }));
  assert.match(asked, /\/data\/portrait\.json$/);
  assert.strictEqual(out.art.fit, 'contain');
});

test('run: history is capped at 50 and the state stays small', async () => {
  const hist = Array.from({ length: 80 }, (_, k) => 1000 + k);
  globalThis.fetch = answer(shard(Array.from({ length: 5 }, () => ({}))));
  const out = await t.run(input({ state: { h: hist } }));
  assert.strictEqual(out.trmnl_state.h.length, t.HISTORY);
  assert.ok(JSON.stringify(out.trmnl_state).length < 1000);
});

test('run: a failed fetch (error, 404, bad shape, timeout) hands the state back and shows a notice, never nothing', async () => {
  const state = { h: [5, 6, 7] };
  for (const f of [async () => { throw new Error('offline'); }, answer({}, 404), answer({ w: [] }), answer({ w: [{ x: 1 }], col: [], mov: [] }), async () => { throw new DOMException('timed out', 'TimeoutError'); }]) {
    globalThis.fetch = f;
    const out = await t.run(input({ state }));
    assert.deepStrictEqual(out.trmnl_state, state);
    assert.ok(out.notice && !out.art, JSON.stringify(out));
    assert.ok(out.settings);
  }
});

test('run: a failed fetch shows the work shown last, without a notice', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const art = { id: 'Q9', url: 'https://example.org/x.jpg', title: 'Old' };
  const out = await t.run(input({ previous_merge_variables: { art } }));
  assert.deepStrictEqual(out.art, art);
  assert.strictEqual(out.notice, undefined);
});

test('run: with no state at all it still works', async () => {
  globalThis.fetch = answer(shard([{}]));
  const out = await t.run({ trmnl: {} });
  assert.strictEqual(out.art.id, 'Q1');
});
