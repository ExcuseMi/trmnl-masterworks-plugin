// node --test plugin/test ; TRANSFORM=path runs the tests against another transform (used to see them fail)
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const t = require(process.env.TRANSFORM || path.join(__dirname, '..', 'src', 'transform.js'));
const noNetwork = async (url) => { throw new Error(`test touched the network: ${url}`); }; // a test without its own fetch mock fails here, not on whatever the live data is
globalThis.fetch = noNetwork;
test.afterEach(() => { globalThis.fetch = noNetwork; });

// a shard of n works, landscape unless a work says otherwise; i = Q1.., sitelinks and score as given
function shard(works) {
  return {
    v: 1, built: '2026-11-16', n: works.length, col: ['Louvre'], mov: ['Impressionism', 'Baroque'],
    gen: ['portrait', 'landscape', 'seascape', 'cityscape', 'still life', 'religious', 'history', 'mythology', 'genre scene', 'nature', 'japanese print', 'modern', 'poster', 'other'],
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

test('screen: portrait and landscape from the device, long side across for landscape; the Frame by model or by its 2560 x 1440', () => {
  const sc = (d) => t.screenOf({ trmnl: { device: d } });
  assert.deepStrictEqual(sc({ width: 1440, height: 2560, orientation: 'portrait' }), { w: 1440, h: 2560, o: 'portrait', frame: true });
  assert.deepStrictEqual(sc({ width: 2560, height: 1440, orientation: 'portrait' }), { w: 1440, h: 2560, o: 'portrait', frame: true });
  assert.deepStrictEqual(sc({ width: 1440, height: 2560, orientation: 'landscape' }), { w: 1440, h: 2560, o: 'portrait', frame: true }); // sizes win
  assert.deepStrictEqual(sc({ width: 800, height: 480 }), { w: 800, h: 480, o: 'landscape', frame: false });
  assert.deepStrictEqual(sc({ width: 800, height: 480, model: 'frame' }), { w: 800, h: 480, o: 'landscape', frame: true });
  assert.deepStrictEqual(t.screenOf({}), { w: 800, h: 480, o: 'landscape', frame: false });
});

test('settings: label, genres (a multiple choice), period and family friendly; unknown values mean the default; Presentation, Fit and Skip portraits are gone', () => {
  const s = (c) => t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: c } } });
  const D = { fill: true, label: true, genres: [], movement: '', family_friendly: true, show_date: false, show_weather: false, show_agenda: false, weather_location: '', temperature_unit: 'c', time_format: '24h' };
  assert.deepStrictEqual(s({}), D);
  assert.deepStrictEqual(s({ label: 'false', movement: 'Baroque', genres: ['cities'], family_friendly: 'false' }),
    { ...D, label: false, genres: ['cities'], movement: 'Baroque', family_friendly: false });
  assert.deepStrictEqual(s({ label: 'x', movement: 'all', genres: 'x', family_friendly: '' }), D);
  assert.strictEqual(s({ family_friendly: false }).family_friendly, false);
  assert.strictEqual(s({ family_friendly: 'no' }).family_friendly, false);
  assert.strictEqual(s({ label: 'off' }).label, false, 'a select value of an older version');
  assert.strictEqual(s({ label: 'corner' }).label, true);
  for (const gone of ['presentation', 'fit', 'skip_portraits']) assert.strictEqual(s({ [gone]: 'full' })[gone], undefined, gone);
});

test('genres arrive as an array, a JSON string, a comma list or nothing; "all" and unknown names mean every genre', () => {
  const g = (v) => t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: { genres: v } } } }).genres;
  assert.deepStrictEqual(g(['landscapes', 'cities']), ['landscapes', 'cities']);
  assert.deepStrictEqual(g('["landscapes","cities"]'), ['landscapes', 'cities']);
  assert.deepStrictEqual(g('landscapes, portraits'), ['landscapes', 'portraits']);
  assert.deepStrictEqual(g('[]'), []);
  assert.deepStrictEqual(g(''), []);
  assert.deepStrictEqual(g(undefined), []);
  assert.deepStrictEqual(g('all'), []);
  assert.deepStrictEqual(g(['cities', 'nonsense', 'cities']), ['cities']);
  assert.deepStrictEqual(g('["cities"'), ['["cities"'].filter(() => false), 'a broken JSON string is no genre');
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

test('weighting: a work shaped like the screen comes up more often (ASPECT_K)', () => {
  const sh = shard([{ w: 1600, h: 900 }, { w: 3000, h: 3000 }]);
  const share = (k) => {
    const rnd = seeded(5);
    let like = 0;
    for (let n = 0; n < 2000; n++) if (t.choose(sh, { ...ctx, k }, [], rnd) === 0) like++;
    return like / 2000;
  };
  assert.ok(share(2) > 0.7, 'default shape factor ' + share(2));
  assert.ok(share(0) < 0.65 && share(0) > 0.35, 'no shape factor: even ' + share(0));
  assert.ok(share(2) > share(0));
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
  assert.strictEqual(out.settings.label, true);
  assert.strictEqual(out.geo.full.mode, 'gallery'); // a 4:3 work on a 16:9 screen: a fill would crop 25 %
  assert.ok(out.geo.full.gallery.a > 0 && out.geo.full.gallery.label.who.length > 0);
  assert.deepStrictEqual(out.filters_relaxed, []);
  assert.match(out.art.url, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/File_1\.jpg\/\d+px-File_1\.jpg$/);
  assert.deepStrictEqual(out.trmnl_state, { h: [1] });
  assert.strictEqual(out.geo.full.fit, 'cover');
});

test('run: a portrait screen reads the portrait shard and decides by the portrait screen', async () => {
  let asked;
  globalThis.fetch = async (url) => { asked = url; return answer(shard([{ w: 1440, h: 2560 }]))(); };
  const NOLABEL = { label: 'false' }; // only with the label off does a work fill the screen
  const out = await t.run(input({ device: { width: 1440, height: 2560, orientation: 'portrait' }, plugin_settings: { custom_fields_values: NOLABEL } }));
  assert.match(asked, /\/data\/portrait-\d\.json$/);
  assert.strictEqual(out.geo.full.mode, 'full', 'a 9:16 work fills a 9:16 screen');
  globalThis.fetch = answer(shard([{ w: 3000, h: 2000 }]));
  assert.strictEqual((await t.run(input({ device: { width: 1440, height: 2560, orientation: 'portrait' }, plugin_settings: { custom_fields_values: NOLABEL } }))).geo.full.mode, 'gallery');
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

test('mat: a dark work hangs on black, else white; a work that fills the view (label off) has no plate and no gallery boxes; with the label on it never fills', async () => {
  globalThis.fetch = answer(shard([{ n: 1 }]));
  assert.strictEqual((await t.run(input())).art.mat, 'black');
  globalThis.fetch = answer(shard([{}]));
  assert.strictEqual((await t.run(input())).art.mat, 'white');
  globalThis.fetch = answer(shard([{ w: 1600, h: 900 }]));
  const lab = await t.run(input());
  assert.strictEqual(lab.geo.full.mode, 'gallery', 'label on: the mat and the gallery label, never full screen (no text over the art)');
  assert.strictEqual(lab.geo.full.plate, null);
  const off = await t.run(input({ plugin_settings: { custom_fields_values: { label: 'false' } } }));
  assert.ok(off.geo.full.mode === 'full' && off.geo.full.plate === null && off.geo.full.gallery === null, 'label off: the work fills the screen');
  globalThis.fetch = answer(shard([{ w: 3000, h: 4500 }]));
  const gal = await t.run(input({ plugin_settings: { custom_fields_values: { label: 'false' } } }));
  assert.strictEqual(gal.geo.full.mode, 'gallery');
  assert.strictEqual(gal.geo.full.gallery.label, undefined, 'label off: the mat without a label');
});

test('the thumbnail is sized by the picture box in the gallery, by the screen when the work fills it', async () => {
  globalThis.fetch = answer(shard([{ w: 6000, h: 4000 }]));
  const gal = await t.run(input());
  assert.strictEqual(gal.geo.full.mode, 'gallery');
  globalThis.fetch = answer(shard([{ w: 6400, h: 3600 }]));
  const full = await t.run(input({ plugin_settings: { custom_fields_values: { label: 'false' } } }));
  assert.strictEqual(full.geo.full.mode, 'full');
  assert.strictEqual(full.art.width, 1920);
  assert.ok(gal.art.width <= full.art.width);
});

test('automatic choice: full screen when a fill crops under AUTO_CROP_MAX (5 %) of the work, else gallery (16:9 Frame)', () => {
  const frame = [2560, 1440];
  const mode = (w, h, [sw, sh] = frame) => t.modeFor({ w, h }, sw, sh);
  assert.strictEqual(t.AUTO_CROP_MAX, 0.05);
  assert.strictEqual(mode(1920, 1080), 'full', 'a 16:9 work');
  assert.strictEqual(mode(3000, 2000), 'gallery', '3:2 crops 15.6 %');
  assert.strictEqual(mode(1920, 1000), 'gallery', '1.92:1 crops 7.4 %: full screen at 10 % before, gallery now');
  assert.strictEqual(mode(2000, 3000), 'gallery', 'a tall portrait on a landscape Frame');
  assert.strictEqual(mode(1440, 2560, [1440, 2560]), 'full', 'the same shape on the portrait Frame');
  // the edge: crop = 1 - work aspect / screen aspect; 0.049 is under, 0.051 over (exactly 0.05 is not under)
  const A = 16 / 9;
  assert.strictEqual(mode(100000 * A * 0.951, 100000), 'full');
  assert.strictEqual(mode(100000 * A * 0.949, 100000), 'gallery');
  assert.strictEqual(mode(100000 * A * 1.05, 100000), 'full', 'a work wider than the screen is cut at the sides: 1 - 1/1.05 = 4.8 %');
  assert.strictEqual(mode(100000 * A * 1.06, 100000), 'gallery');
  assert.strictEqual(mode(1920, 1080 * 1.06), 'gallery', '6 % taller than the screen: cut top and bottom');
  assert.ok(Math.abs(t.cropShare(1.5, 1.5)) < 1e-12);
});

test('the choice is per view: the same work fills the screen and hangs in a mat in a half slot', async () => {
  globalThis.fetch = answer(shard([{ w: 1600, h: 900 }]));
  const out = await t.run(input({ plugin_settings: { custom_fields_values: { label: 'false' } } })); // Frame 2560 x 1440, label off
  assert.strictEqual(out.geo.full.mode, 'full');
  assert.strictEqual(out.geo.half_horizontal.mode, 'gallery'); // 2560 x 720 slot, aspect 3.6
  assert.strictEqual(out.geo.quadrant.mode, 'full'); // 1280 x 720
  assert.ok(!out.geo.full.gallery && out.geo.half_horizontal.gallery && !out.geo.full.plate && !out.geo.half_horizontal.plate);
  const withLabel = await t.run(input());
  for (const v of ['full', 'half_horizontal', 'half_vertical', 'quadrant']) assert.ok(withLabel.geo[v].mode === 'gallery' && withLabel.geo[v].plate === null, `${v}: label on, no placard`);
  globalThis.fetch = answer(shard([{ w: 2000, h: 3000 }]));
  assert.strictEqual((await t.run(input())).geo.full.mode, 'gallery');
});

test('genres: any of the ticked kinds; nothing ticked is all; too few works fall back to all and say so', () => {
  const works = [
    ...Array.from({ length: 8 }, () => ({ g: 1 })), // landscape
    ...Array.from({ length: 8 }, () => ({ g: 3 })), // cityscape
    ...Array.from({ length: 8 }, () => ({ g: 0 })), // portrait
    { g: 4 }, { g: 4 }, // still life: too few
  ];
  const sh = shard(works);
  const rnd = seeded(21);
  const base = { k: 1, aspect: 16 / 9 };
  const kinds = (genres, n = 400) => {
    const seen = new Set();
    for (let i = 0; i < n; i++) seen.add(sh.w[t.pick(sh, { ...base, genres }, [], rnd).index].g);
    return [...seen].sort();
  };
  assert.deepStrictEqual(kinds(['landscapes']), [1]);
  assert.deepStrictEqual(kinds(['landscapes', 'cities']), [1, 3], 'landscapes + cities');
  assert.deepStrictEqual(kinds(['portraits']), [0], 'only Portraits shows portraits');
  assert.deepStrictEqual(kinds([]), [0, 1, 3, 4], 'nothing ticked: all');
  assert.deepStrictEqual(kinds(['landscapes', 'cities', 'flowers_still_life']), [1, 3, 4], 'a small kind rides along when the whole combination is big enough');
  assert.deepStrictEqual(t.pick(sh, { ...base, genres: ['flowers_still_life'] }, [], rnd).relaxed, ['genre'], 'too small alone');
  assert.deepStrictEqual(kinds(['flowers_still_life']), [0, 1, 3, 4], 'then all genres');
  assert.deepStrictEqual(t.pick(sh, { ...base, genres: ['landscapes', 'cities'] }, [], rnd).relaxed, []);
  // every kind but Portraits is how portraits are skipped
  assert.deepStrictEqual(kinds(['landscapes', 'cities', 'flowers_still_life', 'religious', 'history_myth', 'everyday']), [1, 3, 4]);
});

test('family friendly: flagged works are never picked, and this is never relaxed', () => {
  const sh = shard([...Array.from({ length: 6 }, () => ({ u: 1, s: 500 })), ...Array.from({ length: 3 }, () => ({ s: 5 }))]);
  const rnd = seeded(8);
  for (let n = 0; n < 300; n++) assert.ok(!sh.w[t.pick(sh, { k: 1, aspect: 1.6, family: true }, [], rnd).index].u);
  let flagged = 0;
  for (let n = 0; n < 300; n++) if (sh.w[t.pick(sh, { k: 1, aspect: 1.6, family: false }, [], rnd).index].u) flagged++;
  assert.ok(flagged > 250, 'off: the famous flagged works come up');
  const none = shard(Array.from({ length: 4 }, () => ({ u: 1 })));
  assert.ok(t.pick(none, { k: 1, aspect: 1.6, family: true }, [], rnd).index >= 0, 'never an empty screen');
});

test('run: the settings reach the picker (family friendly on by default, genres)', async () => {
  globalThis.fetch = answer(shard([{ u: 1, s: 900 }, ...Array.from({ length: 6 }, () => ({ g: 1 })), ...Array.from({ length: 6 }, () => ({ g: 0 }))]));
  for (let n = 0; n < 40; n++) {
    const out = await t.run(input());
    assert.notStrictEqual(out.art.id, 'Q1', 'the flagged famous work is left out by default');
    const por = await t.run(input({ plugin_settings: { custom_fields_values: { genres: '["portraits"]', family_friendly: 'false' } } }));
    assert.strictEqual(por.art.genre, 'portrait');
  }
  const cities = await t.run(input({ plugin_settings: { custom_fields_values: { genres: ['cities'] } } }));
  assert.deepStrictEqual(cities.filters_relaxed, ['genre']);
});

test('year label: a range or a century from the data is shown as the label says', async () => {
  globalThis.fetch = answer(shard([{ y: 1536, yl: '1536\u201341' }]));
  assert.strictEqual((await t.run(input())).art.year, '1536\u201341');
  globalThis.fetch = answer(shard([{ y: 1503 }]));
  assert.strictEqual((await t.run(input())).art.year, '1503');
});

test('default mix: with nothing ticked the genre weights favour landscapes, nature, prints and the like and lower religious art, portraits and history', () => {
  const GEN = shard([]).gen;
  const idx = (name) => GEN.indexOf(name);
  const works = [];
  for (const name of ['landscape', 'cityscape', 'still life', 'nature', 'japanese print', 'modern', 'poster', 'religious', 'portrait', 'history', 'genre scene']) {
    for (let k = 0; k < 20; k++) works.push({ g: idx(name), s: 40 });
  }
  const sh = shard(works);
  const rnd = seeded(77);
  const share = (genres) => {
    const n = {};
    for (let i = 0; i < 20000; i++) { const g = GEN[sh.w[t.pick(sh, { k: 0, aspect: 1.6, genres }, [], rnd).index].g]; n[g] = (n[g] || 0) + 1; }
    return n;
  };
  const mix = share([]);
  assert.ok(mix.landscape > mix.portrait * 2.5, `landscape ${mix.landscape} vs portrait ${mix.portrait}`);
  assert.ok(mix.religious < mix['genre scene'] * 0.6 && mix.history < mix['genre scene'] * 0.6);
  assert.ok(mix.nature > mix['genre scene'] && mix['japanese print'] > mix['genre scene'] && mix.poster > mix['genre scene']);
  // ticked genres: fame alone (equal fame, so an even split between the ticked kinds)
  const ticked = share(['portraits', 'religious']);
  assert.ok(Math.abs(ticked.portrait - ticked.religious) < 800, `ticked: ${ticked.portrait} / ${ticked.religious}`);
});

test('every genre option names genres the data has', () => {
  const have = new Set(shard([]).gen);
  const keys = ['landscapes', 'cities', 'flowers_still_life', 'nature', 'japanese_prints', 'modern', 'posters', 'religious', 'history_myth', 'everyday', 'portraits'];
  for (const key of keys) {
    const g = t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: { genres: [key] } } } }).genres;
    assert.deepStrictEqual(g, [key], key);
  }
  assert.ok(['landscape', 'seascape', 'cityscape', 'still life', 'nature', 'japanese print', 'modern', 'poster', 'religious', 'history', 'mythology', 'genre scene', 'portrait'].every((g) => have.has(g)));
});

const FRAME = [2560, 1440];
const slotsOf = ([w, h]) => [[w, h], [w, h / 2], [w / 2, h], [w / 2, h / 2]].map(([a, b]) => [Math.round(a), Math.round(b)]);

test('gallery geometry: the picture has the work\'s shape and fits; the limiting dimension may go beyond the 0.75 share; the label always has room', () => {
  for (const scr of [[2560, 1440], [1440, 2560], [1872, 1404], [800, 480], [480, 800]]) {
    for (const [sw, sh] of slotsOf(scr)) {
      for (const [w, h] of [[8000, 5400], [3000, 4500], [3000, 3000], [9000, 2000], [2000, 9000], [2000, 847]]) {
        for (const label of [true, false]) {
          const g = t.galleryFor({ ...ART, w, h }, sw, sh, label, 'big');
          const tag = `${sw}x${sh} work ${w}x${h} label ${label}`;
          assert.ok(g.a >= 1 && g.a <= 100 && g.b >= 1 && g.b <= 100, tag);
          const wide = w / h >= sw / sh;
          assert.ok(g.pw <= sw * (wide ? 0.92 : 0.8) + sw * 0.015, `${tag}: width ${g.pw}`);
          assert.ok(g.ph <= sh * (wide ? 0.8 : 0.88) + sh * 0.015, `${tag}: height ${g.ph}`);
          const shapeErr = Math.abs(g.pw / g.ph / (w / h) - 1);
          assert.ok(shapeErr < 0.12, `${tag}: shape off by ${(100 * shapeErr).toFixed(1)}%`);
          if (label && g.label) assert.ok(g.ph + sh * 0.11 + sh * 0.018 <= sh * 0.93 + sh * 0.015 + 1, `${tag}: no room for the label (${g.ph} of ${sh})`);
        }
      }
    }
  }
});

test('panoramic and tall extremes use the room their shape allows (The Funeral of Patroclus 2.36:1 and Goya\'s Atropos 2.08:1, on the Frame)', () => {
  const atropos = t.galleryFor({ ...ART, w: 3051, h: 1467 }, ...FRAME, true, 'big');
  assert.ok(atropos.pw >= 0.9 * 2560, `Atropos: ${atropos.pw} of 2560`);
  const pano = t.galleryFor({ ...ART, w: 2000, h: 847 }, ...FRAME, true, 'big');
  assert.ok(pano.pw >= 0.9 * 2560 && pano.pw <= 0.935 * 2560, `a panoramic work: ${pano.pw} of 2560`);
  const tall = t.galleryFor({ ...ART, w: 1000, h: 3000 }, ...FRAME, true, 'big');
  assert.ok(tall.ph >= 0.75 * 1440, `a tall work: ${tall.ph} of 1440`);
  assert.ok(tall.ph + 1440 * 0.128 <= 1440 * 0.935, 'with the label under it');
  const normal = t.galleryFor({ ...ART, w: 3000, h: 2000 }, ...FRAME, true, 'big');
  assert.ok(normal.pw < pano.pw, 'a 3:2 work is not blown up like a panorama');
});

test('label lines: title, ARTIST in caps with the year, technique and where it hangs (no size); missing parts are left out cleanly', () => {
  const full = t.galleryFor(ART, ...FRAME, true, 'big').label;
  assert.strictEqual(full.who, 'KATSUSHIKA HOKUSAI \u00b7 1831');
  assert.strictEqual(full.detail, 'Woodblock print \u00b7 The Metropolitan Museum of Art');
  assert.ok(!/cm|25\.7/.test(JSON.stringify(full)), 'the size is not on the label');
  assert.strictEqual(t.galleryFor({ ...ART, medium: '' }, ...FRAME, true, 'big').label.detail, 'The Metropolitan Museum of Art', 'no technique: only the place');
  assert.strictEqual(t.galleryFor({ ...ART, collection: '' }, ...FRAME, true, 'big').label.detail, 'Woodblock print');
  const bare = t.galleryFor({ ...ART, medium: '', size: null, collection: '', year: '' }, ...FRAME, true, 'big').label;
  assert.strictEqual(bare.detail, '');
  assert.strictEqual(bare.who, 'KATSUSHIKA HOKUSAI');
  assert.ok(!/undefined|null|NaN|\u00b7 \u00b7/.test(bare.who + bare.detail));
  assert.strictEqual(t.galleryFor(ART, 400, 240, true, 'normal').label.detail, '', 'a small slot: no where-it-hangs line');
  assert.strictEqual(t.galleryFor(ART, ...FRAME, false, 'big').label, undefined);
  assert.strictEqual(t.whoLine({ artist: '', year: '1500' }), '1500');
  assert.strictEqual(t.galleryFor(ART, 200, 120, true, 'normal').label, undefined, 'a slot too small for a readable label has none (a playdate quadrant)');
});

test('a long title takes more label room (two lines where the slot is high enough)', () => {
  const long = { ...ART, title: 'Portrait of a Gentleman Seated in an Armchair Holding a Letter and Wearing a Very Large Hat with a Plume' };
  assert.strictEqual(t.galleryFor(long, 1440, 2560, true, 'big').label.lines, 2);
  assert.strictEqual(t.galleryFor(ART, ...FRAME, true, 'big').label.lines, 1);
  assert.strictEqual(t.galleryFor(long, 800, 480, true, 'normal').label.lines, 1, 'a low slot: one line, the Framework clamps it');
  const tallWork = { w: 1000, h: 3000 };
  assert.ok(t.galleryFor({ ...long, ...tallWork }, 1440, 2560, true, 'big').ph < t.galleryFor({ ...long, ...tallWork, title: 'Short' }, 1440, 2560, true, 'big').ph, 'a second title line costs picture height');
});

test('text size tier: only the Frame is a big canvas (model frame, or 2560 x 1440 without a model); zoomed screens are not', async () => {
  globalThis.fetch = answer(shard([{}]));
  const kind = async (w, h) => (await t.run(input({ device: { width: w, height: h, orientation: 'landscape' } }))).art.kind;
  assert.strictEqual(await kind(2560, 1440), 'big');
  assert.strictEqual(await kind(1440, 2560), 'big');
  assert.strictEqual(await kind(1872, 1404), 'normal');
  assert.strictEqual(await kind(800, 480), 'normal');
  assert.strictEqual(await kind(1600, 2400), 'normal', 'tcl_nxtpaper_14: lg, drawn zoomed');
  assert.strictEqual(await kind(2480, 1860), 'normal', 'Kindle Scribe: not the Frame');
  const model = async (m, w, h) => (await t.run(input({ device: { width: w, height: h, model: m, orientation: 'landscape' } }))).art.kind;
  assert.strictEqual(await model('frame', 2560, 1440), 'big');
  assert.strictEqual(await model('og_png', 2560, 1440), 'normal', 'a model that is not the Frame');
});

test('thumbnail: the requested width is at least 0.8 x the displayed width (up to the 1920 cap and the file\'s own width)', async () => {
  for (const scr of [[2560, 1440], [1440, 2560], [1872, 1404], [800, 480]]) {
    for (const [w, h] of [[2000, 847], [3000, 2000], [1600, 900], [2000, 3000], [9000, 2000], [1500, 1500], [4000, 3000]]) {
      globalThis.fetch = answer(shard([{ w, h }]));
      const out = await t.run(input({ device: { width: scr[0], height: scr[1], orientation: scr[0] >= scr[1] ? 'landscape' : 'portrait' } }));
      const g = out.geo.full;
      const shown = g.mode === 'gallery' ? g.gallery.pw : scr[0];
      const fileStep = [120, 250, 500, 960, 1280, 1920].filter((x) => x <= w).pop();
      const need = Math.min(0.8 * shown, 1920, fileStep);
      assert.ok(out.art.width >= need, `${scr} work ${w}x${h}: asked ${out.art.width}, shown ${shown}`);
      assert.ok([120, 250, 500, 960, 1280, 1920].includes(out.art.width));
    }
  }
});

test('srcset: the standard widths up to 1920 and the file\'s own width, so the browser chooses by its real viewport', () => {
  const set = (f, w) => t.srcsetOf(f, w).split(', ').map((x) => Number(x.split(' ').pop().replace('w', '')));
  assert.deepStrictEqual(set('A.jpg', 5000), [500, 960, 1280, 1920]);
  assert.deepStrictEqual(set('A.jpg', 2000), [500, 960, 1280, 1920]);
  assert.deepStrictEqual(set('A.jpg', 1500), [500, 960, 1280]);
  assert.ok(set('A.jpg', 600).length >= 1);
  assert.ok(t.srcsetOf('A b\'s (c).jpg', 5000).split(', ').every((x) => /^https:\/\/upload\.wikimedia\.org\/.+ \d+w$/.test(x) && !/[,]\S*\s\d+w$/.test(x.replace(/ \d+w$/, '')) ));
});

// ---- mirrors ---------------------------------------------------------------------------------------------------------------
const byHost = (table) => async (url) => {
  const host = Object.keys(table).find((h) => url.includes(h));
  const v = host === undefined ? new Error('no route') : table[host];
  if (v instanceof Error) throw v;
  if (typeof v === 'string') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }, text: async () => v };
  return v;
};
const BASES = ['raw.githubusercontent.com', 'cdn.jsdelivr.net', 'excusemi.github.io', 'cdn.statically.io'];

test('mirrors: the four are listed, the repository path is the same on each', () => {
  assert.strictEqual(t.DATA_BASES.length, 4);
  for (const host of BASES) assert.ok(t.DATA_BASES.some((b) => b.includes(host)), host);
  assert.ok(t.DATA_BASES.every((b) => /^https:\/\/.+\/data\/$/.test(b)));
  assert.ok(!t.DATA_BASES.some((b) => /statically\.io\/gh\/ExcuseMi\/trmnl-masterworks-plugin\/main/.test(b)), 'the form without @ answers 301');
});

test('mirrors: all are asked at once', async () => {
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(url); return answer(shard([{}]))(); };
  await t.run(input());
  assert.strictEqual(asked.length, 4);
  for (const host of BASES) assert.ok(asked.some((u) => u.includes(host)), host);
  assert.strictEqual(new Set(asked.map((u) => u.split('/').pop())).size, 1, 'the same part on each');
});

test('mirrors: raw down, jsDelivr answers: the work comes from jsDelivr', async () => {
  const good = shard([{ t: 'From jsDelivr' }]);
  globalThis.fetch = byHost({ 'raw.githubusercontent.com': new Error('ECONNRESET'), 'cdn.jsdelivr.net': answer(good)(), 'excusemi.github.io': new Error('404'), 'cdn.statically.io': new Error('x') });
  globalThis.fetch = (f => async (u) => { const r = await f(u); return typeof r.then === 'function' ? r : r; })(byHost({ 'raw.githubusercontent.com': new Error('ECONNRESET'), 'cdn.jsdelivr.net': { ok: true, status: 200, json: async () => good }, 'excusemi.github.io': new Error('404'), 'cdn.statically.io': new Error('x') }));
  const out = await t.run(input());
  assert.strictEqual(out.art.title, 'From jsDelivr');
  assert.ok(!out.notice);
});

test('mirrors: a mirror that answers HTML is ignored, the others are used', async () => {
  const good = shard([{ t: 'From raw' }]);
  globalThis.fetch = byHost({ 'raw.githubusercontent.com': { ok: true, status: 200, json: async () => good }, 'cdn.jsdelivr.net': '<!DOCTYPE html><html>Not found</html>', 'excusemi.github.io': '<html>404</html>', 'cdn.statically.io': '<html>x</html>' });
  assert.strictEqual((await t.run(input())).art.title, 'From raw');
  // HTML, a 200 with a wrong shape and a 500: nothing valid anywhere is a clean failure
  globalThis.fetch = byHost({ 'raw.githubusercontent.com': '<html>', 'cdn.jsdelivr.net': { ok: true, status: 200, json: async () => ({ hello: 1 }) }, 'excusemi.github.io': { ok: false, status: 500, json: async () => ({}) }, 'cdn.statically.io': new Error('x') });
  const out = await t.run(input());
  assert.ok(out.notice && !out.art);
});

test('mirrors: all down: the work shown last again, else a clean message, the state untouched', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const art = { id: 'Q9', url: 'https://example.org/x.jpg', title: 'Old' };
  const kept = await t.run(input({ previous_merge_variables: { art, geo: { full: { mode: 'full' } } }, state: { h: [5] } }));
  assert.deepStrictEqual(kept.art, art);
  assert.deepStrictEqual(kept.trmnl_state, { h: [5] });
  const none = await t.run(input({ state: { h: [5] } }));
  assert.ok(none.notice && !none.art);
});

test('mirrors: the newest shard wins when two answer, a stale one is fine alone', async () => {
  const old = { ...shard([{ t: 'Old data' }]), built: '2026-10-01' };
  const fresh = { ...shard([{ t: 'New data' }]), built: '2026-11-16' };
  globalThis.fetch = byHost({ 'raw.githubusercontent.com': { ok: true, status: 200, json: async () => old }, 'cdn.jsdelivr.net': { ok: true, status: 200, json: async () => fresh }, 'excusemi.github.io': new Error('x'), 'cdn.statically.io': new Error('x') });
  assert.strictEqual((await t.run(input())).art.title, 'New data');
  globalThis.fetch = byHost({ 'raw.githubusercontent.com': { ok: true, status: 200, json: async () => old }, 'cdn.jsdelivr.net': new Error('x'), 'excusemi.github.io': new Error('x'), 'cdn.statically.io': new Error('x') });
  assert.strictEqual((await t.run(input())).art.title, 'Old data');
});

test('mirrors: a mirror that answers with an error status is ignored even if its body parses as a shard', async () => {
  const good = shard([{ t: 'Fine' }]), stale = shard([{ t: 'From an error page' }]);
  globalThis.fetch = byHost({ 'raw.githubusercontent.com': { ok: false, status: 404, json: async () => stale }, 'cdn.jsdelivr.net': { ok: true, status: 200, json: async () => good }, 'excusemi.github.io': new Error('x'), 'cdn.statically.io': new Error('x') });
  assert.strictEqual((await t.run(input())).art.title, 'Fine');
});

test('mirrors: a slow mirror does not hold the run: the first valid answer plus the grace is enough', async () => {
  const good = shard([{ t: 'Quick' }]);
  globalThis.fetch = (url) => (url.includes('raw.githubusercontent.com')
    ? Promise.resolve({ ok: true, status: 200, json: async () => good })
    : new Promise(() => {})); // the others never answer
  const started = Date.now();
  const out = await t.run(input());
  assert.strictEqual(out.art.title, 'Quick');
  assert.ok(Date.now() - started < 1500, 'waited ' + (Date.now() - started) + ' ms');
});

// ---- backup work -------------------------------------------------------------------------------------------------------------
test('backup: a famous work, not the primary, not in the history, through the same filters; its own presentation and mat', async () => {
  const works = [{ s: 20 }, { s: 300, n: 1 }, { s: 250 }, { s: 200, u: 1 }, { s: 150 }, { s: 120 }, { s: 90 }, { s: 60 }, { s: 5 }];
  const sh = shard(works);
  const rnd = seeded(3);
  for (let n = 0; n < 300; n++) {
    const b = t.pickBackup(sh, { k: 1, aspect: 1.6, family: true }, [qnumOf(2)], 0, rnd);
    assert.notStrictEqual(b, 0, 'not the primary');
    assert.notStrictEqual(b, 2, 'not in the history');
    assert.notStrictEqual(b, 3, 'the family filter holds');
    assert.ok(sh.w[b].s >= 60, 'one of the 5 most famous eligible: ' + sh.w[b].s);
  }
  assert.strictEqual(t.pickBackup(shard([{}]), { k: 1, aspect: 1.6 }, [], 0, rnd), null, 'a shard of one work has no backup');
});
const qnumOf = (idx) => idx + 1; // Q1.. in shard()

test('run: the model has a primary and a backup, each with its own art, geometry and mat; the state records the primary only', async () => {
  globalThis.fetch = answer(shard([{ w: 3000, h: 2000, s: 10, n: 1 }, { w: 1600, h: 900, s: 400 }, { w: 2000, h: 3000, s: 300 }]));
  for (let n = 0; n < 20; n++) {
    const out = await t.run(input());
    assert.ok(out.backup && out.backup.art && out.backup.geo, 'a backup');
    assert.notStrictEqual(out.backup.art.id, out.art.id);
    assert.ok(out.backup.geo.full.mode && out.backup.art.mat && out.backup.art.url);
    assert.deepStrictEqual(out.trmnl_state.h, [Number(out.art.id.slice(1))], 'the primary is recorded: the browser decides which one shows');
  }
  globalThis.fetch = answer(shard([{}]));
  assert.strictEqual((await t.run(input())).backup, null);
});

test('run: a failed fetch keeps the previous primary and backup', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const art = { id: 'Q9', url: 'https://example.org/x.jpg', title: 'Old' }, backup = { art: { id: 'Q8', url: 'https://example.org/y.jpg' }, geo: {} };
  const out = await t.run(input({ previous_merge_variables: { art, geo: {}, backup } }));
  assert.deepStrictEqual(out.backup, backup);
});

test('zoomed screens: the label\'s share of a slot is judged in CSS px (generic_16_9 reports 1920 x 1080 and draws 800 x 480 zoomed 2.4)', async () => {
  const art = { ...ART, w: 3000, h: 2000 };
  // half_horizontal slot 1920 x 540 reported = 800 x 225 CSS: a 3-line label needs a third of it
  const zoomed = t.galleryFor(art, 1920, 540, true, 'normal', 2.4);
  const plain = t.galleryFor(art, 1920, 540, true, 'normal', 1);
  assert.ok(zoomed.ph < plain.ph, `zoomed ${zoomed.ph} < plain ${plain.ph}`);
  assert.ok(zoomed.ph + 2.4 * (1.25 * 20 + 1.3 * 16 + 1.35 * 16) <= 540 * 0.93 + 8, 'the zoomed label fits under the picture');
  assert.strictEqual(t.galleryFor(art, 480, 288, true, 'normal', 2.4).label, undefined, 'a quadrant of a zoomed screen too small for a label');
  globalThis.fetch = answer(shard([{}])); // never the network: the live data has other part counts than this checkout
  const art2 = (await t.run(input({ device: { width: 1920, height: 1080, orientation: 'landscape' } }))).art;
  assert.strictEqual(art2.zoom, 2.4);
  assert.strictEqual((await t.run(input({ device: { width: 2560, height: 1440, orientation: 'landscape' } }))).art.zoom, 1);
});

test('a PNG-only work asks for its small thumbnail step, never a wider one (Cornard Wood loaded half-drawn: its 1920 px PNG is 5 MB)', async () => {
  const sizes = async (extra) => {
    globalThis.fetch = answer(shard([{ w: 3336, h: 2648, f: 'Cornard Wood.png', ...extra }]));
    const out = await t.run(input({ device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' } }));
    const widths = out.art.srcset.split(', ').map((x) => Number(x.split(' ')[1].replace('w', '')));
    return { url: out.art.url, width: out.art.width, max: Math.max(...widths) };
  };
  const plain = await sizes({});
  assert.ok(plain.max >= 1280, 'a normal work offers the wide steps');
  const png = await sizes({ r: 960 });
  assert.ok(png.width <= 960 && png.max <= 960, `the width ${png.width}, srcset up to ${png.max}`);
  assert.match(png.url, /\/960px-/);
  const tiny = await sizes({ r: 250 });
  assert.ok(tiny.width <= 250 && tiny.max <= 250, 'the step the build chose, however small');
});

test('art carries everything the markup needs (a comment inside the art literal once swallowed half of it: no kind, size or zoom, a full-bleed render)', async () => {
  globalThis.fetch = answer(shard([{ w: 3000, h: 2000 }]));
  const out = await t.run(input({ device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' } }));
  for (const k of ['id', 'title', 'artist', 'mat', 'corner', 'kind', 'lg', 'zoom', 'w', 'h', 'width', 'url', 'srcset', 'line']) assert.notStrictEqual(out.art[k], undefined, k);
  assert.strictEqual(out.art.kind, 'big');
  assert.ok(out.geo.full.gallery || out.geo.full.mode === 'full');
});

test('keyline: a fine line around the work on its mat only when the work carries the flag for that mat (lw white, lb black); none by default', async () => {
  const line = async (extra) => {
    globalThis.fetch = answer(shard([{ w: 3000, h: 2000, ...extra }]));
    return (await t.run(input({}))).art.line;
  };
  assert.strictEqual(await line({}), false, 'no key: no line');
  assert.strictEqual(await line({ lw: 1 }), true, 'a white mat with lw');
  assert.strictEqual(await line({ lb: 1 }), false, 'a white mat with only lb: none');
  assert.strictEqual(await line({ n: 1 }), false, 'a black mat without lb');
  assert.strictEqual(await line({ n: 1, lw: 1 }), false, 'a black mat with only lw: none');
  assert.strictEqual(await line({ n: 1, lb: 1 }), true, 'a black mat with lb');
  assert.strictEqual(await line({ lw: 0 }), false);
});
