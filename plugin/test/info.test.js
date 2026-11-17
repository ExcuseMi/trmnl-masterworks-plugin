// The info strip: the day, the weather line, units, failures. node --test test
const test = require('node:test');
const assert = require('node:assert');
const t = require('../src/transform.js');

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = async (url) => { throw new Error(`test touched the network: ${url}`); }; });
globalThis.fetch = async (url) => { throw new Error(`test touched the network: ${url}`); };
test.after(() => { globalThis.fetch = realFetch; });

const day = (hours) => hours.map((_, h) => `2026-11-17T${String(h).padStart(2, '0')}:00`);
// codes: a function of the hour, 3 (overcast) elsewhere
const wx = (code, wet = {}) => ({ code, times: day(Array(24).fill(0)), codes: Array.from({ length: 24 }, (_, h) => (h in wet ? wet[h] : 3)) });
const line = (w, hour) => t.forecastLine(w, `2026-11-17T${String(hour).padStart(2, '0')}:30`);

test('forecast line: rain later today is named by when it starts', () => {
  assert.strictEqual(line(wx(3, { 11: 61, 12: 61 }), 8), 'Rain by noon');
  assert.strictEqual(line(wx(3, { 14: 63 }), 8), 'Rain this afternoon');
  assert.strictEqual(line(wx(3, { 19: 80 }), 8), 'Rain this evening');
  assert.strictEqual(line(wx(3, { 23: 65 }), 8), 'Rain tonight');
  assert.strictEqual(line(wx(3, { 9: 61 }), 8), 'Rain soon', 'the next hour or so');
});

test('forecast line: codes name the kind (drizzle, rain, snow, storm)', () => {
  assert.strictEqual(line(wx(3, { 15: 53 }), 8), 'Drizzle this afternoon');
  assert.strictEqual(line(wx(3, { 15: 82 }), 8), 'Rain this afternoon');
  assert.strictEqual(line(wx(3, { 22: 73 }), 8), 'Snow tonight');
  assert.strictEqual(line(wx(3, { 15: 95 }), 8), 'Storm this afternoon');
});

test('forecast line: it is raining now: until it stops, or all day', () => {
  assert.strictEqual(line(wx(61, { 8: 61, 9: 61, 10: 61 }), 8), 'Rain until noon');
  assert.strictEqual(line(wx(61, { 8: 61, 9: 61, 10: 61, 11: 61, 12: 61, 13: 61, 14: 61 }), 8), 'Rain until evening');
  const always = wx(63); always.codes = always.codes.map(() => 63);
  assert.strictEqual(line(always, 8), 'Rain all day');
  assert.strictEqual(line(always, 16), 'Rain this evening');
  assert.strictEqual(line(always, 20), 'Rain tonight');
});

test('forecast line: dry days, clear skies, fog; only the rest of today counts', () => {
  assert.strictEqual(line(wx(3), 8), 'Dry all day');
  assert.strictEqual(line(wx(2), 20), 'Dry tonight');
  assert.strictEqual(line(wx(0), 10), 'Sunny all day');
  assert.strictEqual(line(wx(0), 21), 'Clear tonight');
  assert.strictEqual(line(wx(45), 10), 'Fog');
  assert.strictEqual(line(wx(3, { 6: 63 }), 8), 'Dry all day', 'rain that is over does not count');
  const tomorrow = wx(3); tomorrow.times.push('2026-11-18T01:00'); tomorrow.codes.push(63);
  assert.strictEqual(line(tomorrow, 8), 'Dry all day', 'tomorrow does not count');
});

test('day: number, weekday and month in the account language and zone', () => {
  const now = Date.UTC(2026, 10, 5, 23, 30); // 5 Nov 23:30 UTC = 6 Nov in Brussels
  assert.deepStrictEqual(t.dayInfo(now, 'en', { zone: 'UTC', shift: 0 }), { day: '5', weekday: 'Thursday', month: 'November', hour: 23, iso: '2026-11-05T23:30' });
  const bxl = t.dayInfo(now, 'nl', { zone: 'Europe/Brussels', shift: 0 });
  assert.deepStrictEqual([bxl.day, bxl.weekday, bxl.month, bxl.hour], ['6', 'vrijdag', 'november', 0]);
  assert.strictEqual(t.dayInfo(now, 'xx-not-a-locale-', { zone: 'UTC', shift: 0 }).weekday, 'Thursday', 'a bad locale falls back to English');
  assert.strictEqual(t.dayInfo(now, 'en', t.userZone({ trmnl: { user: { utc_offset: 3600 } } })).day, '6', 'the UTC offset when there is no zone name');
  assert.deepStrictEqual(t.userZone({ trmnl: { user: { time_zone_iana: 'Not/AZone', utc_offset: 0 } } }), { zone: 'UTC', shift: 0 });
  assert.strictEqual(t.userLocale({ trmnl: { user: { locale: 'de_DE' } } }), 'de-DE');
  assert.strictEqual(t.userLocale({}), 'en');
});

test('units: Fahrenheit for a US account language unless the setting says', () => {
  const u = (set, loc) => t.unitOf({ temperature_unit: 'auto', ...set }, loc);
  assert.strictEqual(u({}, 'en-US'), 'fahrenheit');
  assert.strictEqual(u({}, 'en-GB'), 'celsius');
  assert.strictEqual(u({}, 'en'), 'celsius');
  assert.strictEqual(u({ temperature_unit: 'c' }, 'en-US'), 'celsius');
  assert.strictEqual(u({ temperature_unit: 'f' }, 'nl'), 'fahrenheit');
});

test('location: "lat,lon" is used as given, anything else is a place name', () => {
  assert.deepStrictEqual(t.latLon('48.85, 2.35'), { lat: 48.85, lon: 2.35 });
  assert.deepStrictEqual(t.latLon('-33.9;151.2'), { lat: -33.9, lon: 151.2 });
  assert.strictEqual(t.latLon('Paris, France'), null);
  assert.strictEqual(t.latLon('95, 2'), null);
});

const FORECAST = { current: { time: '2026-11-17T08:00', temperature_2m: 7.6, weather_code: 3 }, hourly: { time: day(Array(24).fill(0)), weather_code: Array.from({ length: 24 }, (_, h) => (h === 11 ? 61 : 3)) } };
const reply = (j) => async () => ({ ok: true, status: 200, json: async () => j });
const SET = { weather_location: 'Paris', temperature_unit: 'auto' };

test('fetchWeather: a place name is geocoded once, the forecast asked in the unit, the temperature rounded', async () => {
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(url); return reply(/geocoding/.test(url) ? { results: [{ latitude: 48.85, longitude: 2.35 }] } : FORECAST)(); };
  const w = await t.fetchWeather(SET, 'en-US', { zone: 'Europe/Paris', shift: 0 }, '2026-11-17T08:00', null);
  assert.deepStrictEqual([w.temp, w.line, w.loc], ['8°', 'Rain by noon', { q: 'Paris', lat: 48.85, lon: 2.35 }]);
  assert.strictEqual(asked.length, 2);
  assert.match(asked[1], /temperature_unit=fahrenheit/);
  assert.match(asked[1], /latitude=48.85&longitude=2.35/);
  assert.match(asked[1], /timezone=Europe%2FParis/);
  asked.length = 0;
  await t.fetchWeather(SET, 'en', { zone: 'UTC', shift: 0 }, '2026-11-17T08:00', w.loc);
  assert.strictEqual(asked.length, 1, 'a saved location is not looked up again');
});

test('fetchWeather: no location, an unknown place, a bad answer: null (the date shows alone)', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return reply({})(); };
  assert.strictEqual(await t.fetchWeather({ ...SET, weather_location: '' }, 'en', { zone: 'UTC', shift: 0 }, '2026-11-17T08:00', null), null);
  assert.strictEqual(n, 0, 'nothing is fetched without a location');
  assert.strictEqual(await t.fetchWeather(SET, 'en', { zone: 'UTC', shift: 0 }, '2026-11-17T08:00', null), null, 'the geocoder found nothing');
  globalThis.fetch = reply({ current: {}, hourly: {} });
  assert.strictEqual(await t.fetchWeather({ ...SET, weather_location: '1,2' }, 'en', { zone: 'UTC', shift: 0 }, '2026-11-17T08:00', null), null, 'the forecast has the wrong shape');
});

// run(): the whole thing on a one-work shard
const fs = require('node:fs');
const path = require('node:path');
const shardJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/one-landscape.json'), 'utf8'));
const runWith = async (fields, wxFetch) => {
  globalThis.fetch = async (url) => (/open-meteo/.test(url) ? wxFetch(url) : reply(shardJson)());
  return t.run({ trmnl: { device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' }, user: { locale: 'en', time_zone_iana: 'UTC' }, plugin_settings: { custom_fields_values: fields }, state: {} } });
};

test('run: all three parts off: no info and no strip (the label stays under the picture)', async () => {
  const out = await runWith({}, reply(FORECAST));
  assert.strictEqual(out.info, null);
  assert.strictEqual(out.geo.full.strip, null);
});

test('run: date only needs no network and no location; weather without a location shows the date only', async () => {
  let asked = 0;
  const out = await runWith({ show_date: 'true' }, async () => { asked++; return reply(FORECAST)(); });
  assert.strictEqual(asked, 0);
  assert.ok(out.info.day && out.info.weekday && out.info.month);
  assert.strictEqual(out.info.has_weather, false);
  assert.ok(out.geo.full.strip, 'the strip is there');
  const nowhere = await runWith({ show_weather: 'true' }, async () => { asked++; return reply(FORECAST)(); });
  assert.strictEqual(asked, 0, 'no location: no request');
  assert.strictEqual(nowhere.info, null, 'weather on with no location and no other part: no strip');
  const nowhere2 = await runWith({ show_weather: 'true', show_date: 'true' }, async () => { asked++; return reply(FORECAST)(); });
  assert.deepStrictEqual([nowhere2.info.has_date, nowhere2.info.has_weather], [true, false], 'the date alone');
});

test('run: weather on, the temperature and the line are in the merge variables and the location in the state', async () => {
  const out = await runWith({ show_weather: 'true', weather_location: '48.85, 2.35' }, reply(FORECAST));
  assert.deepStrictEqual([out.info.temp, out.info.forecast, out.info.has_weather, out.info.has_date], ['8\u00b0', 'Rain by noon', true, false]);
  assert.deepStrictEqual(out.trmnl_state.loc, { q: '48.85, 2.35', lat: 48.85, lon: 2.35 });
});

test('run: a weather request that fails, is refused or hangs never breaks the screen: date only', async () => {
  for (const f of [async () => { throw new Error('offline'); }, async () => ({ ok: false, status: 503 }), () => new Promise(() => {})]) {
    const t0 = Date.now();
    const out = await runWith({ show_weather: 'true', show_date: 'true', weather_location: '1,2' }, f);
    assert.strictEqual(out.info.has_weather, false);
    assert.strictEqual(out.info.has_date, true);
    assert.ok(out.art.url, 'the work is shown');
    assert.ok(Date.now() - t0 < 4500, 'the deadline holds');
  }
});

test('run: with the strip, the work is picked and fitted for the band above it, the label moves into the strip', async () => {
  const out = await runWith({ show_date: 'true' }, reply(FORECAST));
  const st = out.geo.full.strip;
  assert.strictEqual(st.pct + st.band, 100);
  assert.ok(st.pct >= 25 && st.pct <= 30, `the Frame landscape strip is about a quarter: ${st.pct}`);
  assert.strictEqual(st.who.length > 0, true, 'the label text is in the strip');
  assert.strictEqual(out.geo.full.plate, null);
  assert.ok(!out.geo.full.gallery || !out.geo.full.gallery.label, 'no label under the picture');
  // the band is wider than the screen: a 16:9 work that filled the screen no longer does
  const band = t.stripFor({ o: 'landscape' }, 2560, 1440, 1, { strip: true, blocks: { date: true, n: 1 }, label: true });
  assert.ok(2560 / (1440 * band.band / 100) > 16 / 9);
});

test('stripFor: scales by view; a slot with no room has no strip', () => {
  const D = { date: true, weather: false, agenda: false, n: 1 };
  const s = (o, w, h, z, set = {}) => t.stripFor({ o }, w, h, z, { strip: true, blocks: D, label: true, ...set });
  assert.strictEqual(s('landscape', 2560, 1440, 1, { strip: false }), null);
  assert.strictEqual(s('landscape', 2560, 1440, 1).tier, 'xl');
  assert.strictEqual(s('landscape', 800, 480, 1).tier, 'm');
  assert.ok(s('portrait', 1440, 2560, 1).pct < s('landscape', 2560, 1440, 1).pct, 'portrait: a lower share');
  assert.strictEqual(s('landscape', 400, 240, 1).pct, 38, 'a small quadrant gets the minimum height');
  assert.strictEqual(s('landscape', 200, 100, 1), null, 'too small');
  assert.strictEqual(s('landscape', 400, 480, 1).label, false, 'a narrow slot: no room for the label');
  assert.strictEqual(s('landscape', 2560, 1440, 1, { label: false }).label, false);
});
