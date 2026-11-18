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

test('weather line: under the temperature, the coming rain or snow in words, a dry day with its range', () => {
  const w = t.weatherSentence;
  assert.strictEqual(w('Rain by noon', '4\u00b0', '11\u00b0'), 'Rain by noon');
  assert.strictEqual(w('Snow tonight', '-3\u00b0', '0\u00b0'), 'Snow tonight');
  assert.strictEqual(w('Rain until noon', '', ''), 'Rain until noon');
  assert.strictEqual(w('Dry all day', '4\u00b0', '11\u00b0'), 'Dry, 4\u00b0 to 11\u00b0');
  assert.strictEqual(w('Dry tonight', '4\u00b0', '11\u00b0'), 'Dry, 4\u00b0 to 11\u00b0');
  assert.strictEqual(w('Sunny all day', '4\u00b0', '11\u00b0'), 'Sunny, 4\u00b0 to 11\u00b0');
  assert.strictEqual(w('Clear tonight', '', ''), 'Clear', 'no daily range: the word alone');
  assert.strictEqual(w('Fog', '8\u00b0', '8\u00b0'), 'Fog', 'a range of one value is no range');
  assert.ok(!/[^\x20-\x7e\u00b0]/.test(w('Dry all day', '4\u00b0', '11\u00b0')), 'no icons or symbols but the degree sign');
});

test('day: number, weekday and month in the account language and zone', () => {
  const now = Date.UTC(2026, 10, 5, 23, 30); // 5 Nov 23:30 UTC = 6 Nov in Brussels
  assert.deepStrictEqual(t.dayInfo(now, 'en', { zone: 'UTC', shift: 0 }), { day: '5', weekday: 'Thursday', month: 'November', weekdayShort: 'Thu', monthShort: 'Nov', hour: 23, iso: '2026-11-05T23:30' });
  const bxl = t.dayInfo(now, 'nl', { zone: 'Europe/Brussels', shift: 0 });
  assert.deepStrictEqual([bxl.day, bxl.weekday, bxl.month, bxl.hour], ['6', 'vrijdag', 'november', 0]);
  assert.strictEqual(t.dayInfo(now, 'xx-not-a-locale-', { zone: 'UTC', shift: 0 }).weekday, 'Thursday', 'a bad locale falls back to English');
  assert.strictEqual(t.dayInfo(now, 'en', t.userZone({ trmnl: { user: { utc_offset: 3600 } } })).day, '6', 'the UTC offset when there is no zone name');
  assert.deepStrictEqual(t.userZone({ trmnl: { user: { time_zone_iana: 'Not/AZone', utc_offset: 0 } } }), { zone: 'UTC', shift: 0 });
  assert.strictEqual(t.userLocale({ trmnl: { user: { locale: 'de_DE' } } }), 'de-DE');
  assert.strictEqual(t.userLocale({}), 'en');
});

test('units: Celsius unless the setting is Fahrenheit; a saved "auto" or empty value is Celsius', () => {
  assert.strictEqual(t.unitOf({ temperature_unit: 'f' }), 'fahrenheit');
  assert.strictEqual(t.unitOf({ temperature_unit: 'c' }, 'en-US'), 'celsius');
  assert.strictEqual(t.unitOf(t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: { temperature_unit: 'auto' } } } }), 'en-US'), 'celsius', 'a saved auto, US account');
  assert.strictEqual(t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: { temperature_unit: '' } } } }).temperature_unit, 'c');
  assert.strictEqual(t.settingsOf({ trmnl: { plugin_settings: { custom_fields_values: {} } } }).temperature_unit, 'c');
});

test('location: "lat,lon" is used as given, anything else is a place name', () => {
  assert.deepStrictEqual(t.latLon('48.85, 2.35'), { lat: 48.85, lon: 2.35 });
  assert.deepStrictEqual(t.latLon('-33.9;151.2'), { lat: -33.9, lon: 151.2 });
  assert.strictEqual(t.latLon('Paris, France'), null);
  assert.strictEqual(t.latLon('95, 2'), null);
});

const FORECAST = { daily: { temperature_2m_max: [11.2], temperature_2m_min: [4.4] }, current: { time: '2026-11-17T08:00', temperature_2m: 7.6, weather_code: 3 }, hourly: { time: day(Array(24).fill(0)), weather_code: Array.from({ length: 24 }, (_, h) => (h === 11 ? 61 : 3)) } };
const reply = (j) => async () => ({ ok: true, status: 200, json: async () => j });
const SET = { weather_location: 'Paris', temperature_unit: 'f' };

test('fetchWeather: a place name is geocoded once, the forecast asked in the unit, the temperature rounded', async () => {
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(url); return reply(/geocoding/.test(url) ? { results: [{ latitude: 48.85, longitude: 2.35 }] } : FORECAST)(); };
  const w = await t.fetchWeather(SET, 'en-US', { zone: 'Europe/Paris', shift: 0 }, '2026-11-17T08:00', null);
  assert.deepStrictEqual([w.temp, w.text, w.loc], ['8°', 'Rain by noon', { q: 'Paris', lat: 48.85, lon: 2.35 }]);
  assert.strictEqual(asked.length, 2);
  assert.match(asked[1], /temperature_unit=fahrenheit/);
  assert.match(asked[1], /daily=temperature_2m_max,temperature_2m_min/);
  assert.match(asked[1], /daily=temperature_2m_max,temperature_2m_min/);
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
  assert.strictEqual(out.geo.full.info, null);
});

test('run: date only needs no network and no location; weather without a location shows the date only', async () => {
  let asked = 0;
  const out = await runWith({ show_date: 'true' }, async () => { asked++; return reply(FORECAST)(); });
  assert.strictEqual(asked, 0);
  assert.ok(out.info.day && out.info.weekday && out.info.month);
  assert.strictEqual(out.info.has_weather, false);
  assert.ok(out.geo.full.info, 'the info has a place');
  const nowhere = await runWith({ show_weather: 'true' }, async () => { asked++; return reply(FORECAST)(); });
  assert.strictEqual(asked, 0, 'no location: no request');
  assert.strictEqual(nowhere.info, null, 'weather on with no location and no other part: no strip');
  const nowhere2 = await runWith({ show_weather: 'true', show_date: 'true' }, async () => { asked++; return reply(FORECAST)(); });
  assert.deepStrictEqual([nowhere2.info.has_date, nowhere2.info.has_weather], [true, false], 'the date alone');
});

test('run: weather on, the temperature and the line are in the merge variables and the location in the state', async () => {
  const out = await runWith({ show_weather: 'true', weather_location: '48.85, 2.35' }, reply(FORECAST));
  assert.deepStrictEqual([out.info.temp, out.info.weather, out.info.has_weather, out.info.has_date], ['8\u00b0', 'Rain by noon', true, false]);
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

test('run: with info on the work hangs on its mat, no placard, no label under it: the label joins the info', async () => {
  const out = await runWith({ show_date: 'true' }, reply(FORECAST));
  const inf = out.geo.full.info;
  assert.ok(inf, 'the info has a place');
  assert.ok(['below', 'side'].includes(inf.place) || inf.layout, 'a strip under or beside the work, or the Frame layout');
  assert.ok(['gallery', 'frame'].includes(out.geo.full.mode));
  assert.strictEqual(out.geo.full.plate, null);
  assert.ok(!out.geo.full.gallery || !out.geo.full.gallery.label, 'no label under the picture');
  assert.ok(inf.label && inf.who.length > 0, 'the label text is in the info block');
  const off = await runWith({}, reply(FORECAST));
  assert.strictEqual(off.geo.full.info, null);
  assert.strictEqual(off.info, null);
});

// where the info goes: one strip under the work, for every shape of work and every screen
const SHAPES = { 'very wide panorama': 2.5, wide: 1.8, 'the screen\'s own shape': 16 / 9, '4:3': 4 / 3, square: 1, '3:4': 3 / 4, tall: 0.6, 'very tall scroll': 0.35 };
const SCREENS = { 'Frame landscape': [2560, 1440, 1, 'big', false], 'Frame portrait': [1440, 2560, 1, 'big', false], X: [1872, 1404, 1872 / 800, 'normal', true], OG: [800, 480, 1, 'normal', false], 'joan (lg, 600 x 800)': [600, 800, 1, 'normal', true] };
const ALL = { strip: true, blocks: { date: true, weather: true, agenda: false, events: 0, n: 2 }, label: true };

test('shape table: every shape on every screen hangs whole on its mat with one strip under it, centred, inside the margins', () => {
  for (const [sname, [sw, sh, zoom, kind, lg]] of Object.entries(SCREENS)) {
    for (const [name, aspect] of Object.entries(SHAPES)) {
      const art = { w: Math.round(aspect * 1000), h: 1000, kind, lg, title: 'A title', artist: 'Artist', medium: 'Oil on canvas', collection: 'Museum' };
      const inf = t.infoPlace(art, sw, sh, zoom, ALL);
      const where = `${name} on ${sname}`;
      if (!inf) { // only a work too narrow for even the date in short names (64 CSS px of a scroll on the OG): no strip, the work keeps its label
        assert.ok(aspect * 0.88 * sh / zoom < 150, `${where}: no strip only for a work narrower than 150 CSS px`);
        continue;
      }
      assert.strictEqual(inf.place, 'below', `${where}: the strip is under the work, never beside it`);
      const g = inf.gallery, z = t.INFO_SIZES[inf.tier];
      assert.ok(Math.abs(g.pw / g.ph / aspect - 1) < 0.04, `${where}: no crop (box ${g.pw} x ${g.ph} is not ${aspect.toFixed(2)})`);
      assert.ok(g.ph + (inf.h + z.gap) * zoom <= sh * 0.93 + 0.012 * sh + 2, `${where}: the work and the strip (${inf.arrange}, ${inf.h}) fit the slot with a margin`);
      assert.ok(g.pw <= sw - 2 * z.m * zoom + 0.012 * sw, `${where}: inside the side margins`);
      assert.ok(Math.abs(inf.stripw - g.a) <= 1, `${where}: the strip stands on the work's edges, always (${inf.stripw} vs ${g.a})`);
      assert.ok(['row', 'wrap', 'stackMid', 'stackAll', 'dateStack', 'dateOnly'].includes(inf.arrange));
    }
  }
  const frame = t.infoPlace({ w: 1800, h: 1000, kind: 'big', title: 't', artist: 'a' }, 2560, 1440, 1, ALL);
  assert.strictEqual(frame.tier, 'f');
  assert.ok(frame.gallery.ph <= 1152 && frame.gallery.ph >= 1000, `the Frame's work is up to about 1150 px high: ${frame.gallery.ph}`);
  assert.strictEqual(t.infoPlace({ w: 1800, h: 1000, kind: 'big', title: 't', artist: 'a' }, 1440, 2560, 1, ALL).tier, 'g', 'a portrait Frame');
});

test('info place: a work that would fill the screen goes on the mat, scaled down for the strip; nothing is cropped', () => {
  const art = { w: 1600, h: 900, kind: 'big', title: 't', artist: 'a' };
  const bare = t.galleryFor(art, 2560, 1440, false, 'big', 1);
  const inf = t.infoPlace(art, 2560, 1440, 1, ALL);
  assert.ok(inf.gallery.pw * inf.gallery.ph <= bare.pw * bare.ph, 'no larger than without info');
  assert.ok(Math.abs(inf.gallery.pw / inf.gallery.ph / (16 / 9) - 1) < 0.04, 'the whole work');
  assert.strictEqual(t.infoPlace(art, 2560, 1440, 1, { ...ALL, strip: false }), null);
});

test('info place: a slot too small has no strip; the museum label goes when there is no room, the date and weather stay', () => {
  assert.strictEqual(t.infoPlace({ w: 3, h: 2, kind: 'normal', title: 't' }, 400, 240, 1, ALL), null, 'an OG quadrant');
  assert.strictEqual(t.infoPlace({ w: 3, h: 2, kind: 'normal', title: 't' }, 200, 400, 1, ALL), null, 'too narrow');
  const art = { w: 1800, h: 1000, kind: 'big', title: 't', artist: 'a' };
  assert.strictEqual(t.infoPlace(art, 2560, 1440, 1, ALL).label, true);
  assert.strictEqual(t.infoPlace(art, 2560, 1440, 1, { ...ALL, label: false }).label, false, 'label off');
  const small = t.infoPlace({ w: 1, h: 1, kind: 'normal', title: 't', artist: 'a' }, 480, 800, 1, { ...ALL, blocks: { date: true, weather: true, agenda: true, events: 1, n: 3 } });
  assert.ok(small, 'even the smallest screen gets its strip');
});

test('info place: the groups keep their places when one is off (the strip does not depend on which are on)', () => {
  const art = { w: 1800, h: 1000, kind: 'big', title: 't', artist: 'a' };
  const a = t.infoPlace(art, 2560, 1440, 1, { ...ALL, blocks: { date: true, weather: true, agenda: false, events: 0, n: 2 } });
  const b = t.infoPlace(art, 2560, 1440, 1, { ...ALL, blocks: { date: false, weather: true, agenda: false, events: 0, n: 1 } });
  assert.deepStrictEqual([a.lw, a.mw, a.stripw, a.tier], [b.lw, b.mw, b.stripw, b.tier], 'the left slot keeps its width: the weather stays in the middle');
});

test('agenda: tomorrow\'s events say so in the time (weekday short), no heading, no venue shown; weather and agenda: the next single event', async () => {
  const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'DTSTART;TZID=Europe/Brussels:20261118T083000', 'DTEND;TZID=Europe/Brussels:20261118T090000', 'SUMMARY:Early', 'LOCATION:Room 1', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => text });
  const a = await t.fetchAgenda('https://calendar.example.org/x.ics', 'en', { zone: 'Europe/Brussels', shift: 0 }, Date.parse('2026-11-17T19:00:00+01:00'), { iso: '2026-11-17T19:00', hour: 19 });
  assert.strictEqual(a.day, 'tomorrow');
  assert.strictEqual(a.items[0].time, 'Wed 8:30 AM');
});

// fill on / off x info on / off
const cropOf = (aspect, w, h) => 1 - Math.min(aspect / (w / h), (w / h) / aspect);

test('fill on, info off: a work whose fill crops at most 15 % fills the screen edge to edge; fill off: only under 5 %', () => {
  assert.strictEqual(t.FILL_CROP_MAX, 0.15);
  assert.strictEqual(t.modeFor({ w: 1600, h: 900 }, 2560, 1440, true), 'full');
  assert.strictEqual(t.modeFor({ w: 3, h: 2 }, 2560, 1440, true), 'gallery', '3:2 on a 16:9 screen crops 15.6 %');
  assert.strictEqual(t.modeFor({ w: 2000, h: 1000 }, 2560, 1440, true), 'full', '2:1 crops 11 %');
});

test('fill on, info off, in a run: the works that crop up to 15 % fill; fill off keeps the 5 % rule', async () => {
  const geoOf = async (fields, w, h) => {
    globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => ({ ...shardJson, w: [{ ...shardJson.w[0], w, h }] }) });
    return (await t.run({ trmnl: { device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' }, plugin_settings: { custom_fields_values: { label: 'false', ...fields } }, state: {} } })).geo.full; // the label off: only then does a work fill the screen
  };
  const wide = await geoOf({}, 1800, 1000); // 16:9 is 1.78, this 1.8: nearly the screen
  assert.strictEqual(wide.mode, 'full');
  const near = await geoOf({}, 2000, 1000); // 2:1 crops 11 %
  assert.strictEqual(near.mode, 'full', 'fill on (the default)');
  assert.strictEqual((await geoOf({ fill: 'false' }, 2000, 1000)).mode, 'gallery', 'fill off: the 5 % rule');
  assert.strictEqual((await geoOf({ fill: 'false' }, 1800, 1000)).mode, 'full', 'fill off: under 5 % still fills');
});

test('fill on, info on: the work fills the band above the strip when that crops at most 15 %, else it hangs whole on its mat; fill off: always on the mat', () => {
  const ON = { ...ALL, fill: true }, OFF = { ...ALL, fill: false };
  const frame = (aspect, set) => t.infoPlace({ w: Math.round(aspect * 1000), h: 1000, kind: 'big', title: 't', artist: 'a', collection: 'c' }, 2560, 1440, 1, set);
  const z = t.INFO_SIZES.f, bandH = 1440 - (z.gap + z.h + z.m);
  for (const [name, aspect] of Object.entries(SHAPES)) {
    const on = frame(aspect, ON), off = frame(aspect, OFF);
    assert.strictEqual(on.fill, cropOf(aspect, 2560, bandH) <= 0.15, `${name}: fills the band exactly when that crops at most 15 % (${cropOf(aspect, 2560, bandH).toFixed(3)})`);
    assert.strictEqual(off.fill, false, `${name}: fill off never fills with the info on`);
    if (on.fill) {
      assert.ok(Math.abs(on.band - Math.round(100 * bandH / 1440)) <= 1, `${name}: the band above the strip`);
      assert.strictEqual(on.stripw, Math.round(100 * (2560 - 2 * z.m) / 2560), `${name}: the strip's text stands on the margins`);
      assert.ok(on.label, `${name}: the museum label is in the strip, no placard over the art`);
    }
  }
  assert.strictEqual(frame(2.2, ON).fill, true, 'a 2.2:1 work fills the band of the Frame');
});

test('fill on, info on, in a run: the work fills the band edge to edge, no placard; the thumbnail is sized for the band', async () => {
  globalThis.fetch = async (url) => (/open-meteo/.test(url) ? reply(FORECAST)() : reply({ ...shardJson, w: [{ ...shardJson.w[0], w: 2200, h: 1000 }] })());
  const out = await t.run({ trmnl: { device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' }, user: { locale: 'en', time_zone_iana: 'UTC' }, plugin_settings: { custom_fields_values: { show_date: 'true' } }, state: {} } });
  assert.strictEqual(out.geo.full.mode, 'frame', 'the Frame landscape: band (2.2:1)');
  assert.strictEqual(out.geo.full.info.layout, 'band');
  assert.strictEqual(out.geo.full.plate, null);
  assert.ok(out.geo.full.info.label);
});
async function runWith2(fields) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ...shardJson, w: [{ ...shardJson.w[0], w: 2200, h: 1000 }] }) });
  return t.run({ trmnl: { device: { width: 2560, height: 1440, model: 'frame', orientation: 'landscape' }, user: { locale: 'en', time_zone_iana: 'UTC' }, plugin_settings: { custom_fields_values: fields }, state: {} } });
}

// the Frame (landscape) layouts: band for 16:9 and wider, else the whole work with a column on its right
const FRAME_SET = { strip: true, blocks: { date: true, weather: true, agenda: true, events: 2, n: 3 }, label: true };
const framePlan = (aspect, set = FRAME_SET) => t.framePlan({ w: Math.round(aspect * 1000), h: 1000, kind: 'big', title: 't', artist: 'a', collection: 'c' }, 2560, 1440, set);

test('Frame: a band for 16:9 and wider, the column layout for every other shape', () => {
  for (const a of [2.5, 2, 16 / 9]) assert.strictEqual(framePlan(a).layout, 'band', `${a}`);
  for (const a of [1.5, 4 / 3, 1]) assert.strictEqual(framePlan(a).layout, 'column', `${a}`);
  for (const a of [3 / 4, 0.6, 0.4]) assert.strictEqual(framePlan(a).layout, 'split', `${a}`); // tall: the split costs no image size
});

test('Frame split: not on the X or the OG', () => {
  for (const key of ['x', 'o']) for (const a of [1, 3 / 4, 0.4]) assert.notStrictEqual(t.framePlan({ w: Math.round(a * 1000), h: 1000, kind: 'big', title: 't', artist: 'a', collection: 'c' }, 1872, 1404, FRAME_SET, key).layout, 'split', `${key} ${a}`);
});

test('Frame band: equal margins on three sides, the strip as wide as the band, no columns or rules in the plan (one row)', () => {
  const p = framePlan(2);
  assert.strictEqual(p.bandPx[0], 2560 - 2 * 51.2);
  assert.strictEqual(p.margin, 51);
  assert.strictEqual(p.events, 2);
  assert.strictEqual(p.cols, undefined, 'the plan has no grid of columns');
});

test('Frame column: the whole work in a whole-percent box of its own shape, the group inside the screen and centred by its boxes', () => {
  for (const a of [1.5, 4 / 3, 1, 3 / 4, 0.4]) {
    const p = framePlan(a), shape = (p.artw * 2560) / (p.arth * 1440);
    assert.ok(Math.abs(Math.log(shape / a)) < 0.03, `${a}: the box has the work's shape (${shape.toFixed(3)})`);
    assert.ok(p.artw + p.gap + p.infow <= 100 - 2 * 2, `${a}: the group leaves margins`);
    assert.ok(p.arth <= 92 && p.arth >= 10);
  }
  const sq = framePlan(1), wide = framePlan(1.5);
  assert.ok(sq.arth >= 80, 'as large as the screen allows');
  assert.ok(wide.artw === 100 - 2 * 2 - wide.gap - wide.infow || wide.arth === 92, 'one of the limits is reached');
});

test('Frame: at most two agenda events are ever kept', () => {
  assert.strictEqual(t.AGENDA_ITEMS, 2);
});

// label only (no date, weather or agenda) on the Frame, X and OG: the label in a column to the right of a near-square work, below a wide one
test('label only: a near-square work gets the label in a column on its right, a 16:9 work keeps it below', () => {
  const geoOf = (aspect, w, h, key) => {
    const art = { w: Math.round(aspect * 1000), h: 1000, title: 'Landscape with the Port', artist: 'Claude Lorrain', year: '1639', collection: 'Louvre', medium: 'Oil', kind: key === 'f' ? 'big' : 'normal' };
    return t.labelColumn(art, w, h, key, t.galleryFor(art, w, h, true, art.kind, 1));
  };
  for (const [key, w, h] of [['f', 2560, 1440], ['o', 800, 480]]) {
    assert.ok(geoOf(1.27, w, h, key), `${key}: 1.27:1 goes to a column`);
    assert.ok(geoOf(1, w, h, key), `${key}: square goes to a column`);
    assert.strictEqual(geoOf(16 / 9, w, h, key), null, `${key}: 16:9 stays below`);
    assert.strictEqual(geoOf(2.5, w, h, key), null, `${key}: a panorama stays below`);
  }
  const col = geoOf(1.27, 2560, 1440, 'f'), art = { w: 1270, h: 1000, title: 't', artist: 'a', year: '1', collection: 'c', kind: 'big' };
  assert.ok(col.pw > t.galleryFor(art, 2560, 1440, true, 'big', 1).pw, 'the whole work is larger than with the label below');
});
