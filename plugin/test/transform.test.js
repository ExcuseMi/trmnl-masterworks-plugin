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
const raw = (f) => encodeURIComponent(f).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
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

test('thumb URL: rawurlencode form, as Wikipedia pages carry it (apostrophe and parentheses encoded)', () => {
  assert.match(t.thumbUrl("Tiziano's Venere (1538).jpg", 960), /\/Tiziano%27s_Venere_%281538%29\.jpg\/960px-Tiziano%27s_Venere_%281538%29\.jpg$/);
});

test('thumb URL of a TIFF is the lossy JPEG form Commons serves', () => {
  const f = 'The Kitchen Maid (Rembrandt) - Nationalmuseum - 17587.tif';
  const g = f.replace(/ /g, '_'), h = crypto.createHash('md5').update(g).digest('hex');
  assert.strictEqual(t.thumbUrl(f, 960), `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${raw(g)}/lossy-page1-960px-${raw(g)}.jpg`);
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
  assert.strictEqual(t.thumbWidth(5000, 3000, 2560, 1440, 'fill'), 1920); // 3840 would be asked for: capped at 1920
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
  assert.deepStrictEqual(s({}), { presentation: 'gallery', fit: 'fill', label: 'corner', movement: '' });
  assert.deepStrictEqual(s({ presentation: 'full', fit: 'whole', label: 'off', movement: 'Baroque' }), { presentation: 'full', fit: 'whole', label: 'off', movement: 'Baroque' });
  assert.deepStrictEqual(s({ presentation: 'x', fit: 'x', label: 'x', movement: 'all' }), { presentation: 'gallery', fit: 'fill', label: 'corner', movement: '' });
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
  assert.match(asked, /\/data\/landscape-\d\.json$/);
  assert.strictEqual(out.art.id, 'Q1');
  assert.strictEqual(out.art.year, '1503');
  assert.strictEqual(out.art.collection, 'Louvre');
  assert.strictEqual(out.settings.presentation, 'gallery');
  assert.ok(out.geo.full.a > 0 && out.geo.full.label.lines.length >= 2);
  assert.match(out.art.url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/File_1\.jpg\/\d+px-File_1\.jpg$/);
  assert.deepStrictEqual(out.trmnl_state, { h: [1] });
  assert.strictEqual(out.art.fit, 'cover');
});

test('run: a portrait screen reads the portrait shard; Full screen with Whole work contains', async () => {
  let asked;
  globalThis.fetch = async (url) => { asked = url; return answer(shard([{ w: 3000, h: 4000 }]))(); };
  const out = await t.run(input({ device: { width: 1440, height: 2560, orientation: 'portrait' }, plugin_settings: { custom_fields_values: { presentation: 'full', fit: 'whole' } } }));
  assert.match(asked, /\/data\/portrait-\d\.json$/);
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

const fs = require('node:fs');
test('SHARDS equals the part files in data/ (a stale constant would fetch a part that is not there, or never fetch one)', () => {
  const dir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dir)) return;
  for (const o of ['landscape', 'portrait']) {
    const files = fs.readdirSync(dir).filter((f) => new RegExp(`^${o}-\\d+\\.json$`).test(f));
    assert.strictEqual(files.length, t.SHARDS[o], `${o}: ${files.join(', ')}`);
    for (const f of files) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.ok(t.validShard(doc), f);
      assert.strictEqual(doc.parts, t.SHARDS[o], f);
      assert.ok(fs.statSync(path.join(dir, f)).size < 120000, `${f} is ${fs.statSync(path.join(dir, f)).size} bytes`);
    }
  }
});

const ART = { title: 'The Great Wave off Kanagawa', artist: 'Katsushika Hokusai', year: '1831', medium: 'Woodblock print', size: [25.7, 37.9], collection: 'The Metropolitan Museum of Art', w: 8000, h: 5400 };

test('gallery geometry: the picture box has the work\'s shape, fits the share, leaves room for the label, all slots and shapes', () => {
  for (const [sw, sh] of [[2560, 1440], [1440, 2560], [1872, 1404], [800, 480], [800, 240], [400, 480], [400, 240]]) {
    for (const [w, h] of [[8000, 5400], [3000, 4500], [3000, 3000], [9000, 2000], [2000, 9000]]) {
      for (const label of [true, false]) {
        const g = t.galleryFor({ ...ART, w, h }, sw, sh, label);
        const tag = `${sw}x${sh} work ${w}x${h} label ${label}`;
        assert.ok(g.a >= 1 && g.a <= 100 && g.b >= 1 && g.b <= 100, tag);
        assert.ok(g.pw <= sw * 0.75 + sw * 0.015 && g.ph <= sh * 0.75 + sh * 0.015, `${tag}: ${g.pw}x${g.ph}`);
        const shapeErr = Math.abs(g.pw / g.ph / (w / h) - 1);
        assert.ok(shapeErr < 0.06, `${tag}: shape off by ${(100 * shapeErr).toFixed(1)}%`);
        if (label) {
          const top = (sh - (g.ph + Math.round(sh * 0.018) + g.label.vh)) / 2;
          assert.ok(top >= -1, `${tag}: the picture and label are taller than the slot (${top})`);
          for (const l of g.label.lines) assert.ok(t.emWidth(l.t, /^[A-Z\s\u00b7\d]+$/.test(l.t), l.fs === 'italic') * l.s <= g.label.vw * 1.02, `${tag}: "${l.t}" is wider than the label`);
        }
      }
    }
  }
});

test('gallery label: lines are right-aligned at the picture edge; missing parts are left out cleanly', () => {
  const g = t.galleryFor({ ...ART, medium: '', size: null, collection: '' }, 2560, 1440, true);
  assert.deepStrictEqual(g.label.lines.map((l) => l.a), ['end', 'end']);
  assert.ok(g.label.lines.every((l) => l.x === g.label.vw));
  assert.ok(!g.label.lines.some((l) => /undefined|null|NaN|\u00b7 \u00b7/.test(l.t)));
  const full = t.galleryFor(ART, 2560, 1440, true);
  assert.match(full.label.lines[2].t, /^Woodblock print \u00b7 25\.7 \u00d7 37\.9 cm \u00b7 /);
  assert.match(full.label.lines[1].t, /^KATSUSHIKA HOKUSAI \u00b7 1831$/);
  assert.strictEqual(t.galleryFor(ART, 400, 240, true).label.lines.length, 2, 'a small slot: no detail line');
  assert.strictEqual(t.galleryFor(ART, 2560, 1440, false).label, undefined);
});

test('gallery detail line: the collection is dropped before a word is cut off', () => {
  const art = { ...ART, collection: 'The Collection of the Very Long Named Imperial and Royal Museum of Fine Arts and Antiquities and Natural History of the Whole Realm' };
  const g = t.galleryFor(art, 2560, 1440, true);
  const detail = g.label.lines[g.label.lines.length - 1].t;
  assert.ok(!detail.endsWith('\u2026'), detail);
  assert.match(detail, /^Woodblock print \u00b7 25\.7 \u00d7 37\.9 cm$/);
});

test('label text never leaves its box: long titles wrap or end in an ellipsis', () => {
  const long = 'Portrait of a Gentleman Seated in an Armchair Holding a Letter and Wearing a Very Large Hat with a Plume';
  assert.ok(t.fitText(long, 36, 600, false, true).endsWith('\u2026'));
  assert.ok(t.emWidth(t.fitText(long, 36, 600, false, true), false, true) * 36 <= 600);
  const lines = t.wrapText(long, 36, 800, 2, false, true);
  assert.strictEqual(lines.length, 2);
  lines.forEach((l) => assert.ok(t.emWidth(l, false, true) * 36 <= 800));
  assert.strictEqual(t.fitText('Short', 36, 600), 'Short');
  const plate = t.plateLabel({ ...ART, title: long }, 400, 240);
  plate.lines.forEach((l) => assert.ok(t.emWidth(l.t, false, false) * l.s * (l.fw === 'bold' ? 1.07 : 1) <= plate.vw));
});

test('mat: a dark work hangs on black, else white; Full screen has the plate model and no gallery boxes', async () => {
  globalThis.fetch = answer(shard([{ n: 1 }]));
  assert.strictEqual((await t.run(input())).art.mat, 'black');
  globalThis.fetch = answer(shard([{}]));
  assert.strictEqual((await t.run(input())).art.mat, 'white');
  const full = await t.run(input({ plugin_settings: { custom_fields_values: { presentation: 'full' } } }));
  assert.ok(full.geo.full.lines.length >= 2 && full.geo.full.pct > 0 && full.geo.full.pct <= 60);
  const off = await t.run(input({ plugin_settings: { custom_fields_values: { presentation: 'full', label: 'off' } } }));
  assert.strictEqual(off.geo.full, null);
});

test('gallery thumbnail is sized by the picture box, not the screen', async () => {
  globalThis.fetch = answer(shard([{ w: 6000, h: 4000 }]));
  const gal = await t.run(input());
  const full = await t.run(input({ plugin_settings: { custom_fields_values: { presentation: 'full' } } }));
  assert.ok(gal.art.width <= full.art.width);
  assert.strictEqual(gal.art.width, 1920);
});
