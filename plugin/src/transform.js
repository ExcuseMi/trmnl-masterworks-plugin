/**
 * Masterworks: a famous public-domain artwork, a new one on every refresh.
 * Data: JSON shards per orientation (data/landscape-0.json, ...), each about 100 kB, in this plugin's own GitHub repo; a run
 * fetches one of them, chosen at random (a work lives in the part given by its Q-number).
 * Images: straight from Wikimedia Commons, as a thumbnail at the screen's width (only the standard widths exist).
 * State (kept under 1 kB, far below the 8 kB limit): { h: Q-numbers of the last HISTORY works shown }.
 * A failed fetch shows the last work again, else a clean message. Never a blank screen.
 * The plugin decides per work and per view how to show it: full screen (label and info off only) when filling the view would
 * crop less than AUTO_CROP_MAX of the work, otherwise the work hangs whole on a white or black mat with a museum label
 * (geo[view].mode). The label and placard text are Framework classes (title, label, size utilities, data-clamp). The Frame is
 * screen--frame screen--md at 1x like the OG and the Framework has no variant for a device class, so the transform names the
 * size tier from the reported screen size (art.kind) and the markup picks the classes.
 */

// The data is served from several mirrors of the same repository; a run asks all of them at once and uses the newest valid
// answer, so the plugin keeps working when one of them is down.
var DATA_BASES = [
  'https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data/',
  'https://cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data/',
  'https://excusemi.github.io/trmnl-masterworks-plugin/data/',
  'https://cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data/', // the form without @ answers 301
];
var MIRROR_GRACE_MS = 400; // after the first valid answer, wait this long for a newer one from another mirror
var BACKUP_TOP = 5; // the backup work is one of this many most famous candidates (likely cached at its thumbnail width)
var FETCH_MS = 3500; // the run has 5 s in all
var SHARDS = { landscape: 8, portrait: 6 }; // parts per orientation in data/ (a test compares this with the files)
var HISTORY = 50; // never one of the last HISTORY works shown
// Weight of a work = fame ^ FAME_EXP x colour factor x dark factor x shape factor. Fame is the main factor.
var FAME_EXP = 0.8; // fame = sitelink count; 0 = all alike, 1 = in proportion to fame
var COLOR_WEIGHT = 0.25; // palette distance (after TRMNL's contrast step), rescaled over the shard: the worst match is picked (1 - this) times as often. Small: the 6-colour dither copes with most colours
var DARK_FREE = 0.45; // share of near-black pixels (after TRMNL's contrast step) that costs nothing
var DARK_K = 6; // beyond DARK_FREE the weight is multiplied by exp(-DARK_K x the excess): the strong penalty, for very dark works only
var MIN_POOL = 5; // a movement with fewer works than this is ignored
// Only the Frame (model "frame", or the 2560 x 1440 it reports when no model is given) is a big canvas that TRMNL calls screen--md (a bug):
// it gets the largest Framework text sizes. Every other screen scales its Framework text by itself, and many are drawn zoomed:
// the reported size is device pixels, the CSS size is about 800 px wide on md screens (zoom = reported / 800, a guess that errs on the safe side for lg).
var CSS_BASE_PX = 800;
var STEPS = [120, 250, 500, 960, 1280, 1920, 3840]; // the thumbnail widths Wikimedia serves (Commons returns 400 for others)
var MAX_STEP = 1920; // 3840 px files are 2 to 9 MB: too heavy for a refresh
var STEP_TOLERANCE = 0.8; // the next step down is used when it holds at least this part of the width needed
var DEFAULT_W = 800, DEFAULT_H = 480;
var AUTO_CROP_MAX = 0.05; // fill off: full screen when filling the view would crop less than this share of the work's area, else the gallery
var FILL_CROP_MAX = 0.15; // fill on (the default, setting fill): the work fills its area edge to edge when that crops at most this share of it; with info on the area is the band above the strip
var ASPECT_K = 2; // shape factor exp(-ASPECT_K x |ln(work aspect / screen aspect)|): works shaped like the screen come up more often
// the genre choices of the settings and the genres (the data's own names) each one lets through
var GENRE_SETS = {
  landscapes: ['landscape', 'seascape'], cities: ['cityscape'], flowers_still_life: ['still life'], nature: ['nature'],
  japanese_prints: ['japanese print'], modern: ['modern'], posters: ['poster'], religious: ['religious'],
  history_myth: ['history', 'mythology'], everyday: ['genre scene'], portraits: ['portrait'],
};
// With no genre ticked every work is a candidate, and its weight is multiplied by its genre's: the default mix shows
// landscapes, seas, cities, nature illustration, Japanese prints, modern and abstract work and posters more often, and
// religious art, portraits, history painting and flowers and still life less often (lower, not left out). A genre not named here counts 1. Ticking genres
// switches this off: those works come up by fame alone.
var GENRE_WEIGHT = {
  landscape: 1.5, seascape: 1.5, cityscape: 1.5, nature: 1.5, 'japanese print': 1.5, modern: 1.3, poster: 1.3,
  mythology: 0.8, history: 0.5, religious: 0.5, portrait: 0.5, 'still life': 0.5,
};
var FAME_FLOOR = 10; // a work with fewer sitelinks counts as this famous: the genre tiers (landscapes, prints, posters...) hold works of 2 to 10 sitelinks
// Gallery sizes. The 0.8 share holds for the dimension that is not the work's limit; the limiting one may go further: a wide
// work (wider than its slot) up to GALLERY_WIDE_MAX of the width, a tall one up to GALLERY_TALL_MAX of the height, always with
// room for the label (picture, gap and label stay inside GALLERY_USE of the height).
var GALLERY_SHARE = 0.8;
var GALLERY_WIDE_MAX = 0.92;
var GALLERY_TALL_MAX = 0.88;
var GALLERY_USE = 0.93;
var LABEL_SHARE = 0.11; // the room the label (title line, artist line, detail line) needs, as a share of the slot's height
var LABEL_LINE_SHARE = 0.032; // every further title line
var LABEL_GAP_SHARE = 0.018;
var LABEL_PX = { big: [40, 26, 21], normal: [20, 16, 16] }; // title, artist and detail sizes the markup uses (the floor of the room a label needs, and to guess how many lines a title takes)
var LABEL_COL_MIN_PCT = 14; // label only, column layout: the column's width (% of the screen) between these
var LABEL_COL_MAX_PCT = 34;
var LABEL_MAX_SHARE = 0.4; // a label that would need more of a slot's height than this is left out (a playdate quadrant)
var LABEL_DETAIL_MIN_H = 300; // the where-it-hangs line needs a slot this high
// The info (date, weather, agenda) is one strip under the work, full width, never beside it and never cropping it: the work is scaled so the
// work and the strip fit, centred, with equal outer margins. The strip is one row on one baseline with three groups in fixed positions
// (date at the left, weather or agenda in the middle, the museum label at the right) and three text sizes (the day number, a medium one for
// the weekday, month, temperature and title, a small one for the forecast, times and the artist line). When the work is narrower than
// INFO_NARROW of the slot the groups align to the slot's margins instead of the work's edges. The sizes are tiers named by the slot: "f" is the
// Frame (2560 wide; the Frame reports screen--md, a TRMNL bug, so its Framework sizes are picked by name), "g" a portrait Frame, xl..s the
// other screens by the slot's height in CSS px. A slot too small for the smallest tier has no info.
var INFO_TIERS = [[900, 'xl'], [560, 'l'], [340, 'm'], [0, 's']];
var INFO_SIZES = { // CSS px: strip height, gap from the work to the strip's cap line, outer margin, width of the date group, of one middle group, least of the label, lift, line heights (medium, small), width of a stacked date
  // lift: CSS px under the day number, the month, the forecast and the artist line: the groups are bottom-aligned boxes whose baselines differ by their sizes' descent, so each is lifted to one baseline (measured on the Frame in the browser: num 1364, month 1363.5, forecast 1375.5, artist 1385.5 before; the others scaled)
  f: { h: 150, gap: 40, m: 60, L: 480, M: 320, R: 640, lift: [14, 17, 24, 24], lm: 64, ls: 40, Ln: 300 }, g: { h: 120, gap: 34, m: 50, L: 340, M: 220, R: 480, lift: [9, 11, 16, 16], lm: 44, ls: 30, Ln: 210 },
  xl: { h: 130, gap: 32, m: 24, L: 330, M: 240, R: 440, lift: [10, 12, 17, 17], lm: 46, ls: 32, Ln: 210 }, l: { h: 100, gap: 26, m: 22, L: 320, M: 200, R: 330, lift: [8, 10, 14, 14], lm: 40, ls: 26, Ln: 160 },
  m: { h: 80, gap: 20, m: 18, L: 215, M: 150, R: 230, lift: [7, 9, 12, 12], lm: 36, ls: 22, Ln: 110 }, s: { h: 62, gap: 16, m: 14, L: 150, M: 115, R: 170, lift: [5, 6, 8, 8], lm: 28, ls: 18, Ln: 80 },
};
var INFO_TEXT_PX = { f: [58, 32], g: [38, 26], xl: [40, 26], l: [35, 21], m: [30, 18], s: [24, 16] }; // medium and small text size in CSS px per tier: the label's width is estimated from its text
var INFO_NARROW = 0.55;
// The Frame, the X and the OG with info on (full view). The info is ONE row or ONE column, never a grid, no rules:
// BAND (landscape screen, a work 16:9 or wider): the work covers a band inside equal margins that takes all height the row leaves; the row under
// it in the band's width: the day number with the weekday over the month, then weather, events and the museum label (regular weight, the rest
// of the width, at least 40 %); all first lines on the weekday's baseline. BELOW (landscape screens, other shapes, when it gives the larger
// picture; portrait screens, works narrower than FRAME_STACK_ASPECT): the whole work, the same row under it in the work's width; the browser
// grows the work into the height the row leaves. COLUMN (landscape, other shapes): the whole work with the column to its right (date,
// weather, events at the top, the label at the bottom on the work's bottom edge); work and column one group centred. STACK (portrait screens,
// wide works): the work in the full width at the top, the column under it.
// What does not fit is dropped in the browser, never shrunk or cut (FIT_ORDER in shared.liquid): the second event, the first, the forecast
// line, the museum line, the weather, the artist line; never the day number or the label title (then the art is shown alone).
var FRAME_MARGIN_PCT = 2; // the margin round the group, % of the width (the same in px vertically)
var FRAME_BAND_CROP_MAX = 0.4; // kept for the tests' import: portrait screens never crop
var FRAME_BAND_ASPECT = 1.74; // landscape screens: works at least this wide (16:9 and wider) get the band
var FRAME_STACK_ASPECT = 1.4; // portrait screens: works at least this wide get the full-width work with the column under it
var FRAME_GAP_PCT = 2; // between the cells of a row, and between the work and the column, % of the width
var FRAME_COL_H_MAX = 92; // column layout: the work's box height at most, % of the screen's
var FRAME_COL_GUTTER = 2;
var FRAME_SHAPE_ERR = 0.012; // the work's box differs from its shape by at most this (log ratio)
// per device class: three sizes in the info (owner 2026-11-18): the day number (sized to the two primary lines beside it: its top on the
// first line's cap top, its baseline on the second's), the primary lines (weekday, month, temperature, event and painting titles) and the
// secondary lines one step below (forecast, time, place, artist and year, museum); lh the primary line height (the gap between cells is 1.5 of it); their CSS px (z: the screen's CSS scale, the X draws 1040 CSS px on 1872) for the estimates, the vertical gap between column parts (sep), the column's widest share (infow, %)
var FRAME_PROFILES = {
  f: { infow: 26, sep: 34, bandEv: 2, num: 170, words: 58, temp: 58, ev: 58, title: 58, small: 40, lh: 70,
    cls: { num: 'value--mega', words: 'value value--large', temp: 'value value--large', ev: 'value value--large', title: 'value value--large', small: 'title title--xxlarge' } },
  x: { z: 1.8, infow: 30, sep: 18, bandEv: 1, num: 74, words: 30, temp: 30, ev: 30, title: 30, small: 26, lh: 36, // one Framework step smaller than 96 / 38 / 30 (owner 2026-11-18)
    cls: { num: 'value--xlarge', words: 'label label--xxlarge', temp: 'label label--xxlarge', ev: 'label label--xxlarge', title: 'label label--xxlarge', small: 'label label--xlarge' } },
  o: { infow: 34, sep: 12, bandEv: 1, num: 58, words: 21, temp: 21, ev: 21, title: 21, small: 20, lh: 25.2, // one step smaller than 74 / 26 / 21 (owner 2026-11-18)
    cls: { num: 'value--large', words: 'label label--large', temp: 'label label--large', ev: 'label label--large', title: 'label label--large', small: 'value value--xsmall' } },
};
FRAME_PROFILES.fp = FRAME_PROFILES.f;
var FRAME_PICK_ASPECT = 2; // the shape a work is picked for on the Frame with info on: wide works (a band) and others (a column) both come up, wider ones a little more
var INFO_MIN_SLOT = 300; // CSS px: a slot lower than this, or narrower than INFO_MIN_SLOT_W, has no info
var INFO_MIN_SLOT_W = 380;
var WEATHER_MS = 1800; // one request; the whole weather step has WEATHER_DEADLINE_MS, parallel to the data fetch (the run has 5 s)
var WEATHER_DEADLINE_MS = 3200;
var VIEWS = { full: [1, 1], half_horizontal: [1, 0.5], half_vertical: [0.5, 1], quadrant: [0.5, 0.5] }; // slot size as a share of the screen

/** MD5 as lowercase hex of a UTF-8 string, in plain JS: Commons paths are built from it and a sandbox may lack `crypto`. */
function md5(str) {
  var bytes = [], i;
  var s = unescape(encodeURIComponent(str));
  for (i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  var n = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var bits = n * 8;
  for (i = 0; i < 8; i++) bytes.push(i < 4 ? (bits >>> (8 * i)) & 0xff : 0);
  var K = [], R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var off = 0; off < bytes.length; off += 64) {
    var M = [];
    for (i = 0; i < 16; i++) M[i] = bytes[off + i * 4] | (bytes[off + i * 4 + 1] << 8) | (bytes[off + i * 4 + 2] << 16) | (bytes[off + i * 4 + 3] << 24);
    var A = a0, B = b0, C = c0, D = d0;
    for (i = 0; i < 64; i++) {
      var F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      var r = R[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << r) | (F >>> (32 - r)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  var hex = '';
  [a0, b0, c0, d0].forEach(function (v) {
    for (var j = 0; j < 4; j++) hex += ('0' + ((v >>> (8 * j)) & 0xff).toString(16)).slice(-2);
  });
  return hex;
}

/** The Commons thumbnail URL of a file at a width: .../thumb/<h>/<hh>/<File>/<W>px-<File>, h = md5 of the underscore name. */
function thumbUrl(file, width) {
  var f = String(file).replace(/ /g, '_');
  var h = md5(f);
  // rawurlencode form, as Wikipedia pages carry it: the CDN already holds thumbnails under this name
  var enc = encodeURIComponent(f).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  // a TIFF is thumbnailed as JPEG: .../File.tif/lossy-page1-1280px-File.tif.jpg (the plain name gives HTTP 400)
  var leaf = /\.tiff?$/i.test(f) ? 'lossy-page1-' + width + 'px-' + enc + '.jpg' : width + 'px-' + enc;
  return 'https://upload.wikimedia.org/wikipedia/commons/thumb/' + h.charAt(0) + '/' + h.slice(0, 2) + '/' + enc + '/' + leaf;
}

/** Width of the thumbnail to ask for: the smallest standard step that covers what the screen needs, never above the file. */
function thumbWidth(w, h, sw, sh, fit) {
  var a = w / h;
  var need = fit === 'fill' ? Math.max(sw, sh * a) : Math.min(sw, sh * a);
  var step = STEPS[STEPS.length - 1], i;
  for (i = 0; i < STEPS.length; i++) if (STEPS[i] >= need) { step = STEPS[i]; break; }
  var below = STEPS[Math.max(0, STEPS.indexOf(step) - 1)];
  if (step > need && below < step && below >= need * STEP_TOLERANCE) step = below;
  if (step > MAX_STEP) step = MAX_STEP;
  if (step > w) { // a file cannot be thumbnailed above its own width
    for (i = STEPS.length - 1; i >= 0; i--) if (STEPS[i] <= w) { step = STEPS[i]; break; }
  }
  return step;
}

function screenOf(input) {
  var d = (input && input.trmnl && input.trmnl.device) || {};
  var w = Number(d.width) || DEFAULT_W, h = Number(d.height) || DEFAULT_H;
  // portrait when the sizes say so or the field does (trmnlp reports 'landscape' next to portrait sizes)
  var o = h > w || d.orientation === 'portrait' ? 'portrait' : 'landscape';
  // the sizes are those of the picture area: the long side is across for landscape, down for portrait
  var long = Math.max(w, h), short = Math.min(w, h);
  var frame = d.model === 'frame' || (d.model === undefined && long === 2560 && short === 1440);
  return o === 'portrait' ? { w: short, h: long, o: o, frame: frame } : { w: long, h: short, o: o, frame: frame };
}

/** A boolean custom field arrives as true, "true", "yes", false, "false"...; missing or empty means the default. */
function flag(v, dflt) {
  var t = String(v === undefined || v === null ? '' : v).toLowerCase();
  if (t === 'true' || t === 'yes' || t === '1' || t === 'on') return true;
  if (t === 'false' || t === 'no' || t === '0' || t === 'off') return false;
  return dflt;
}

/** A multi-select arrives as an array, a JSON array in a string ('["a","b"]') or a comma list; nothing ticked is []. */
function listOf(v) {
  if (Array.isArray(v)) return v.map(String);
  var t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return [];
  if (t.charAt(0) === '[') {
    try { var a = JSON.parse(t); if (Array.isArray(a)) return a.map(String); } catch (e) { /* a plain text */ }
  }
  return t.split(/\s*,\s*/);
}

function settingsOf(input) {
  var c = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  var txt = function (v) { return String(v === undefined || v === null ? '' : v).toLowerCase(); };
  var movement = String(c.movement === undefined || c.movement === null ? '' : c.movement).trim();
  if (txt(movement) === 'all' || txt(movement) === 'any') movement = '';
  // the ticked genres that exist; none ticked (or only unknown ones, or an old "all") means every genre
  var genres = listOf(c.genres).map(function (g) { return g.toLowerCase(); }).filter(function (g, i, a) { return GENRE_SETS[g] && a.indexOf(g) === i; });
  var unit = txt(c.temperature_unit);
  return {
    fill: flag(c.fill, true), label: flag(c.label, true), // a select value from an older version ("corner", "off") is read as well
    genres: genres, movement: movement, family_friendly: flag(c.family_friendly, true),
    show_date: flag(c.show_date, false), show_weather: flag(c.show_weather, false), show_agenda: flag(c.show_agenda, false), // the info strip's three parts, each off by default
    weather_location: String(c.weather_location === undefined || c.weather_location === null ? '' : c.weather_location).trim().slice(0, 80),
    time_format: c.time_format === '12h' ? '12h' : '24h', // anything but exactly 12h (empty, unknown, not saved yet) is 24-hour
    temperature_unit: unit === 'f' ? 'f' : 'c', // anything but Fahrenheit (an old saved "auto", empty) is Celsius
  };
}

function cleanState(s) {
  var h = s && Array.isArray(s.h) ? s.h.filter(function (n) { return typeof n === 'number'; }) : [];
  var out = { h: h.slice(-HISTORY) };
  var l = s && s.loc;
  if (l && typeof l.q === 'string' && isFinite(l.lat) && isFinite(l.lon)) out.loc = { q: l.q.slice(0, 80), lat: Number(l.lat), lon: Number(l.lon) }; // the geocoded weather location, so a name is looked up once
  return out;
}

var qnum = function (id) { return Number(String(id).replace(/^Q/, '')) || 0; };

/** Weight of one work (see the constants). ctx.pMin and ctx.pMax: the shard's lowest and highest palette distance. */
function weightOf(work, ctx) {
  var fame = Math.pow(Math.max(FAME_FLOOR, work.s || 1), FAME_EXP) * (ctx.genreWeight ? (GENRE_WEIGHT[ctx.genre(work)] || 1) : 1);
  var span = ctx.pMax - ctx.pMin;
  var bad = span > 0 ? (work.p - ctx.pMin) / span : 0; // 0 = the best match of the shard, 1 = the worst
  var color = 1 - COLOR_WEIGHT * Math.min(1, Math.max(0, bad));
  var dark = Math.exp(-DARK_K * Math.max(0, (work.k || 0) - DARK_FREE));
  var k = ctx.k;
  var aspect = Math.exp(-k * Math.abs(Math.log((work.w / work.h) / ctx.aspect)));
  return fame * color * dark * aspect;
}

var genreOfWork = function (shard, work) { return shard.gen && work.g !== undefined ? shard.gen[work.g] : 'other'; };

/**
 * The work to show: { index, relaxed }. Family friendly (when asked) is never relaxed. Movement and genre
 * narrow the pool (the genres ticked in the settings, any of them); when that leaves fewer than MIN_POOL works they are
 * dropped together and `relaxed` names them.
 * rnd() is a uniform [0, 1) source, injected so tests can drive it.
 */
function candidates(shard, ctx) {
  var works = shard.w, i, relaxed = [];
  var all = [];
  for (i = 0; i < works.length; i++) if (!(ctx.family && works[i].u)) all.push(i);
  if (!all.length) for (i = 0; i < works.length; i++) all.push(i); // a shard with nothing family friendly: never an empty screen
  var pool = all;
  var mov = ctx.movement ? shard.mov.map(function (m) { return m.toLowerCase(); }).indexOf(ctx.movement.toLowerCase()) : -1;
  var allowed = [];
  (ctx.genres || []).forEach(function (key) { (GENRE_SETS[key] || []).forEach(function (g) { if (allowed.indexOf(g) < 0) allowed.push(g); }); });
  var narrowed = pool.filter(function (idx) {
    var w = works[idx];
    if (ctx.movement && mov >= 0 && w.m !== mov) return false;
    return !allowed.length || allowed.indexOf(genreOfWork(shard, w)) >= 0;
  });
  if (narrowed.length >= MIN_POOL) pool = narrowed;
  else {
    if (ctx.movement && mov >= 0) relaxed.push('movement');
    if (allowed.length) relaxed.push('genre');
  }
  return { pool: pool, relaxed: relaxed, allowed: allowed };
}

/** The pick (see candidates for the pool). */
function pick(shard, ctx, history, rnd) {
  var works = shard.w, i;
  var cand = candidates(shard, ctx), pool = cand.pool, relaxed = cand.relaxed, allowed = cand.allowed;
  var seen = {};
  history.forEach(function (n) { seen[n] = true; });
  var fresh = pool.filter(function (idx) { return !seen[qnum(works[idx].i)]; });
  if (!fresh.length) { // a small pool is used up: take the one seen longest ago
    for (i = 0; i < history.length; i++) {
      var back = pool.filter(function (idx) { return qnum(works[idx].i) === history[i]; });
      if (back.length) return { index: back[0], relaxed: relaxed };
    }
    fresh = pool;
  }
  var ps = shard.w.map(function (w) { return w.p; });
  var wctx = {
    k: ctx.k, aspect: ctx.aspect, pMin: Math.min.apply(null, ps), pMax: Math.max.apply(null, ps),
    genreWeight: !allowed.length, genre: function (w) { return genreOfWork(shard, w); },
  };
  var weights = fresh.map(function (idx) { return weightOf(works[idx], wctx); });
  var total = weights.reduce(function (a, b) { return a + b; }, 0);
  var x = rnd() * total;
  for (i = 0; i < fresh.length; i++) {
    x -= weights[i];
    if (x < 0) return { index: fresh[i], relaxed: relaxed };
  }
  return { index: fresh[fresh.length - 1], relaxed: relaxed };
}

/**
 * A backup work for when the primary's picture fails to load: one of the BACKUP_TOP most famous candidates (their thumbnails are
 * the likeliest to be cached), not the primary, not shown lately, through the same filters. null when the shard has no other.
 */
function pickBackup(shard, ctx, history, primaryIdx, rnd) {
  var pool = candidates(shard, ctx).pool, seen = {};
  history.forEach(function (n) { seen[n] = true; });
  var list = pool.filter(function (idx) { return idx !== primaryIdx && !seen[qnum(shard.w[idx].i)]; });
  if (!list.length) list = pool.filter(function (idx) { return idx !== primaryIdx; });
  if (!list.length) return null;
  list.sort(function (a, b) { return (shard.w[b].s || 0) - (shard.w[a].s || 0); });
  var top = list.slice(0, BACKUP_TOP);
  return top[Math.min(top.length - 1, Math.floor(rnd() * top.length))];
}

/** The index only (tests drive this one). */
function choose(shard, ctx, history, rnd) {
  var c = Object.assign({}, ctx);
  if (c.k === undefined) c.k = ASPECT_K;
  return pick(shard, c, history, rnd).index;
}

function validShard(j) {
  return !!j && Array.isArray(j.w) && j.w.length > 0 && Array.isArray(j.col) && Array.isArray(j.mov) &&
    typeof j.w[0].f === 'string' && j.w[0].w > 0 && j.w[0].h > 0;
}

/** One mirror's answer: valid JSON of the right shape, else an error (HTML, a 404 page, a half answer are all errors). */
async function fetchOne(base, name) {
  var res = await fetch(base + name, { signal: AbortSignal.timeout(FETCH_MS) });
  if (!res || !res.ok) throw new Error(base + ' HTTP ' + (res && res.status));
  var j = await res.json();
  if (!validShard(j)) throw new Error(base + ' has an unexpected shape');
  return j;
}

/** All mirrors at once; the first valid answer starts a short wait for a newer one, then the newest `built` wins. */
function fetchShard(orientation, rnd) {
  var parts = SHARDS[orientation] || 1;
  var name = orientation + '-' + Math.min(parts - 1, Math.floor(rnd() * parts)) + '.json';
  return new Promise(function (resolve, reject) {
    var best = null, pending = DATA_BASES.length, timer = null, done = false, errors = [];
    var finish = function () {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (best) resolve(best); else reject(new Error(errors.join('; ')));
    };
    DATA_BASES.forEach(function (base) {
      fetchOne(base, name).then(function (j) {
        if (!best || String(j.built) > String(best.built)) best = j;
        if (!timer) timer = setTimeout(finish, MIRROR_GRACE_MS);
        if (--pending === 0) finish();
      }, function (e) {
        errors.push(String(e && e.message ? e.message : e));
        if (--pending === 0) finish();
      });
    });
  });
}

// ---- label text, drawn as SVG text: sizes are the slot's own pixels ---------------------------------------------------

var cmText = function (z) {
  var n = function (v) { return String(Math.round(v * 10) / 10).replace(/\.0$/, ''); };
  return n(z[0]) + ' \u00d7 ' + n(z[1]) + ' cm';
};

/** The lines of the label: "ARTIST \u00b7 year" in capitals, then "technique \u00b7 where it hangs" (a technique the build could not name is left out). The size stays in the data, not on the label. */
function whoLine(art) {
  return String(art.artist || '').toUpperCase() + (art.year ? (art.artist ? ' \u00b7 ' : '') + art.year : '');
}
function detailLine(art) {
  return [art.medium, art.collection].filter(Boolean).join(' \u00b7 ');
}

/**
 * Gallery geometry of one slot: percent sizes of the picture box (the Framework has whole-percent sizes only; the pair
 * nearest the work's shape is taken and the picture covers its box, so an error of a fraction of a percent is cropped,
 * never a gap), and what the label needs. withLabel false: the picture alone, centred.
 */
function galleryFor(art, slotW, slotH, withLabel, kind, zoom, pctH, opts) {
  opts = opts || {};
  pctH = pctH || slotH; // the percent classes are of the whole slot; with info the picture's room (slotW, slotH) is part of it
  var pctW = opts.pctW || slotW, extra = opts.reserve || 0; // extra: px the info block below takes
  var aspect = art.w / art.h, wide = aspect >= slotW / slotH;
  var widthCap = (opts.share || (wide ? GALLERY_WIDE_MAX : GALLERY_SHARE)) * slotW; // opts.share: a region already apart from its info may be filled further
  var heightCap = (wide ? GALLERY_SHARE : GALLERY_TALL_MAX) * slotH;
  var px = opts.px || LABEL_PX[kind || 'normal'], maxLines = slotH >= 700 ? 2 : 1, hasDetail = slotH >= LABEL_DETAIL_MIN_H && !!detailLine(art);
  var lines = 1, ph = 0, pw = 0, i;
  // the room a label needs: its share of the slot, but never less than its lines at the sizes the markup uses
  zoom = zoom || 1; // the label's text is in CSS px; the slot is in reported device px, which a zoomed screen draws larger
  // an lg screen (art.lg: not the Frame, short side over 500 px) lets its title, artist and detail lines take 2 lines (data-clamp-lg), so a label that wraps
  // there needs more room; the picture's CSS width is guessed at 85 % (the zoom is one number for both axes, a device may differ)
  var lg = !!art.lg, whoLen = String(whoLine(art)).length, detLen = hasDetail ? detailLine(art).length : 0;
  var wrap = function (len, size, pwDev, most) { return Math.min(most, Math.max(1, Math.ceil(len * 0.5 * size / Math.max(0.85 * pwDev / zoom, 1)))); };
  var floorPx = function (n, pwDev) {
    var t = lg ? wrap(String(art.title).length, px[0], pwDev, 2) : n, who = lg ? wrap(whoLen, px[1], pwDev, 2) : 1, det = hasDetail ? (lg ? wrap(detLen, px[2], pwDev, 2) : 1) : 0;
    return zoom * (t * 1.25 * px[0] + who * 1.3 * px[1] + det * 1.35 * px[2] + 6);
  };
  if (withLabel && floorPx(1, slotW) > LABEL_MAX_SHARE * slotH) withLabel = false; // a slot too small for a readable label
  for (i = 0; i < 3; i++) { // the title wraps by the picture's width, the picture's size leaves room for the label
    var reserve = withLabel ? Math.max(slotH * (LABEL_SHARE + (lines - 1) * LABEL_LINE_SHARE + LABEL_GAP_SHARE), floorPx(lines, pw || widthCap) + slotH * LABEL_GAP_SHARE) : 0;
    ph = Math.min(heightCap, GALLERY_USE * slotH - reserve - extra, widthCap / aspect);
    ph = Math.max(ph, 0.05 * slotH); // never a picture of no size (a block that takes the whole slot)
    pw = ph * aspect;
    lines = Math.min(maxLines, Math.max(1, Math.ceil(String(art.title).length * 0.5 * px[0] / Math.max(pw, 1))));
  }
  var ideal = 100 * pw / pctW, best = null, da, db;
  for (da = -1; da <= 1; da++) {
    for (db = -1; db <= 1; db++) {
      var A = Math.floor(ideal) + da, B = Math.floor(100 * (pw / aspect) / pctH) + db;
      if (A < 1 || B < 1 || A > 100 || B > 100) continue;
      var err = Math.abs((A * pctW) / (B * pctH) / aspect - 1) + 0.002 * (Math.abs(A - ideal) + Math.abs(B - 100 * (pw / aspect) / pctH));
      if (!best || err < best.err) best = { a: A, b: B, err: err };
    }
  }
  var out = { a: best.a, b: best.b, pw: Math.round(best.a * pctW / 100), ph: Math.round(best.b * pctH / 100) };
  if (withLabel) out.label = { lines: lines, who: whoLine(art), detail: hasDetail ? detailLine(art) : '' };
  return out;
}

/** The share of the work's area a cover fit into a slot of this shape cuts off. */
function cropShare(workAspect, slotAspect) {
  var r = workAspect / slotAspect;
  return 1 - Math.min(r, 1 / r);
}

/** "full" when a fill crops at most FILL_CROP_MAX (fill on) or less than AUTO_CROP_MAX (fill off) of the work in a slot of this shape, else "gallery". */
function modeFor(art, slotW, slotH, fill) {
  var c = cropShare(art.w / art.h, slotW / slotH);
  return (fill ? c <= FILL_CROP_MAX : c < AUTO_CROP_MAX) ? 'full' : 'gallery';
}

/** The largest standard thumbnail width that is at most cap. */
function capStep(cap) {
  var i, best = STEPS[0];
  for (i = 0; i < STEPS.length; i++) if (STEPS[i] <= cap) best = STEPS[i];
  return best;
}

/**
 * The widths the browser may choose from (srcset, with sizes in the markup): the renderer knows its own viewport, the
 * transform only the device TRMNL reports (the first device of the playlist), so the picture's width is left to the browser.
 */
function srcsetOf(file, workWidth, cap) {
  var out = [], top = Math.min(MAX_STEP, cap || MAX_STEP); // cap: a PNG-only work (work.r) asks for no more than its step
  STEPS.forEach(function (w) { if (w >= 500 && w <= top && w <= workWidth) out.push(thumbUrl(file, w) + ' ' + w + 'w'); });
  if (!out.length) {
    var one = Math.min(thumbWidth(workWidth, 1, 1, 1, 'fill'), capStep(top));
    out.push(thumbUrl(file, one) + ' ' + one + 'w');
  }
  return out.join(', ');
}

// ---- the info strip: the day and the weather ----------------------------------------------------------------------------
// TRMNL gives a plugin the account's language (trmnl.user.locale) and time zone (time_zone_iana, utc_offset) but no location and no unit:
// the weather location is a setting (a place name, looked up once with Open-Meteo's geocoder and kept in the state, or "lat,lon"),
// the unit follows the language's region unless the setting says. The forecast line is in English.

function userLocale(input) {
  var l = input && input.trmnl && input.trmnl.user && input.trmnl.user.locale;
  if (!l) return 'en';
  try { new Intl.DateTimeFormat(String(l).replace('_', '-')); return String(l).replace('_', '-'); } catch (e) { return 'en'; }
}

/** The account's zone: the IANA name, else the UTC offset, else UTC. { zone: IANA name for Intl, shift: ms added to the time first }. */
function userZone(input) {
  var u = (input && input.trmnl && input.trmnl.user) || {};
  if (u.time_zone_iana) {
    try { new Intl.DateTimeFormat('en', { timeZone: u.time_zone_iana }); return { zone: u.time_zone_iana, shift: 0 }; } catch (e) { /* an unknown name: the offset */ }
  }
  return { zone: 'UTC', shift: (Number(u.utc_offset) || 0) * 1000 };
}

/** The day as the strip shows it, in the account's language and zone: { day: "5", weekday: "Thursday", month: "November", hour, iso: "2026-11-05T14:00" }. */
function dayInfo(nowMs, locale, z) {
  var t = new Date(nowMs + z.shift);
  var fmt = function (loc, o) { o.timeZone = z.zone; try { return new Intl.DateTimeFormat(loc, o).format(t); } catch (e) { return new Intl.DateTimeFormat('en', o).format(t); } };
  var p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: z.zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(t).forEach(function (x) { p[x.type] = x.value; });
  return {
    day: String(Number(p.day)), weekday: fmt(locale, { weekday: 'long' }), month: fmt(locale, { month: 'long' }),
    weekdayShort: fmt(locale, { weekday: 'short' }), monthShort: fmt(locale, { month: 'short' }), // for a work too narrow for the long names
    hour: Number(p.hour), iso: p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute,
  };
}

var unitOf = function (set) { return set.temperature_unit === 'f' ? 'fahrenheit' : 'celsius'; };

/** "lat,lon" -> { lat, lon }, else null. */
function latLon(text) {
  var m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(text || ''));
  if (!m) return null;
  var lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: lat, lon: lon } : null;
}

var WET_KINDS = { Drizzle: [51, 53, 55, 56, 57], Rain: [61, 63, 65, 66, 67, 80, 81, 82], Snow: [71, 73, 75, 77, 85, 86], Storm: [95, 96, 99] };
function wetKind(code) {
  for (var k in WET_KINDS) if (WET_KINDS[k].indexOf(code) >= 0) return k;
  return null;
}

/**
 * The one short line under the temperature. w = { code: the weather code now, times: hourly local "YYYY-MM-DDTHH:00", codes: hourly
 * weather codes }; nowIso the local time now. Looks from this hour to the end of the day: "Rain by noon", "Snow tonight", "Rain until
 * noon" (it is raining and stops), "Dry all day". English.
 */
function forecastLine(w, nowIso) {
  var day = nowIso.slice(0, 10), hour = Number(nowIso.slice(11, 13)), now = nowIso.slice(0, 13) + ':00', i0 = -1, i;
  for (i = 0; i < w.times.length; i++) if (w.times[i] >= now && w.times[i].slice(0, 10) === day) { i0 = i; break; }
  var hours = [];
  if (i0 >= 0) for (i = i0; i < w.times.length && w.times[i].slice(0, 10) === day; i++) hours.push({ h: Number(w.times[i].slice(11, 13)), kind: wetKind(w.codes[i]) });
  var cur = wetKind(w.code);
  var first = hours.filter(function (x) { return x.kind; })[0];
  var word = function (h) { return h <= 12 ? 'by noon' : h <= 17 ? 'this afternoon' : h <= 21 ? 'this evening' : 'tonight'; };
  if (cur) {
    var clear = hours.filter(function (x) { return !x.kind; })[0];
    if (!clear) return cur + (hour < 15 ? ' all day' : hour < 18 ? ' this evening' : ' tonight');
    return cur + (clear.h <= 12 ? ' until noon' : clear.h <= 18 ? ' until evening' : ' until late');
  }
  if (first) return first.kind + (first.h <= hour + 1 ? ' soon' : ' ' + word(first.h));
  if (w.code === 45 || w.code === 48) return 'Fog';
  var night = hour >= 18 || hour < 6;
  if (w.code === 0 || w.code === 1) return night ? 'Clear tonight' : 'Sunny all day';
  return hour >= 17 || hour < 6 ? 'Dry tonight' : 'Dry all day';
}

/**
 * The line under the temperature: "Rain by noon" when rain or snow is coming, "Dry, 4\u00b0 to 11\u00b0" when not. line: forecastLine's words;
 * lo, hi today's lowest and highest (without them, or when equal, the word stands alone).
 */
function weatherSentence(line, lo, hi) {
  var dry = /^(Dry|Sunny|Clear|Fog)( all day| tonight)?$/.exec(line);
  if (dry) return dry[1] + (lo && hi && lo !== hi ? ', ' + lo + ' to ' + hi : '');
  return line;
}

/** Resolves to the value of p, or null after ms (and on a rejection): the weather never holds the run up and never throws. */
function withDeadline(p, ms) {
  return new Promise(function (resolve) {
    var t = setTimeout(function () { resolve(null); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function () { clearTimeout(t); resolve(null); });
  });
}

async function getJson(url) {
  var res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_MS) });
  if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
  return res.json();
}

/** { temp: "8°", text: "Rain by noon", loc } or null on any failure or without a location. loc: the place found (kept in the state). */
async function fetchWeather(set, locale, z, nowIso, saved) {
  if (!set.weather_location) return null;
  var loc = latLon(set.weather_location);
  if (loc) loc = { q: set.weather_location, lat: loc.lat, lon: loc.lon };
  else if (saved && saved.q === set.weather_location) loc = saved;
  else {
    var g = await getJson('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(set.weather_location) + '&count=1&language=en&format=json');
    var r = g && g.results && g.results[0];
    if (!r || !isFinite(r.latitude) || !isFinite(r.longitude)) return null;
    loc = { q: set.weather_location, lat: Number(r.latitude), lon: Number(r.longitude) };
  }
  var j = await getJson('https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
    '&current=temperature_2m,weather_code&hourly=weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=' + encodeURIComponent(z.zone === 'UTC' && z.shift ? 'auto' : z.zone) +
    '&temperature_unit=' + unitOf(set, locale));
  var t = j && j.current && j.current.temperature_2m, h = j && j.hourly;
  if (typeof t !== 'number' || !isFinite(t) || !h || !Array.isArray(h.time) || !Array.isArray(h.weather_code)) return null;
  // the forecast's own clock is the place's: the hours are compared with the place's now (current.time), not the account's
  var placeNow = j.current.time && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(j.current.time) ? j.current.time : nowIso;
  var deg = function (v) { return typeof v === 'number' && isFinite(v) ? Math.round(v) + '\u00b0' : ''; };
  var d = j.daily || {};
  var line = forecastLine({ code: j.current.weather_code, times: h.time, codes: h.weather_code }, placeNow);
  return { temp: deg(t), text: weatherSentence(line, deg((d.temperature_2m_min || [])[0]), deg((d.temperature_2m_max || [])[0])), loc: loc };
}

// ---- the agenda: an ICS calendar link -----------------------------------------------------------------------------------
// The link is a secret (a private calendar address): it is read from the settings only here, never put in the merge variables, the
// state, an error message or a log. Limits: ICS_MS for the request, ICS_MAX_BYTES read (a calendar of years of history can be many
// MB; the run has 128 MB and 5 s, and the parse below is linear, so 2 MB is a generous year of events); too big, too slow or not a
// calendar gives no agenda and the rest of the strip stays. Only today and tomorrow are expanded.

var ICS_MS = 2500;
var ICS_MAX_BYTES = 2000000;
var ICS_DEADLINE_MS = 3200;
var AGENDA_ITEMS = 2;
var AGENDA_TOMORROW_FROM = 18; // from this hour the agenda shows tomorrow's events (when there are any)
var RECUR_LOOP_CAP = 6000; // periods looked at per rule
var WINDOWS_ZONES = { // what Outlook writes as TZID: the common ones
  'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Bucharest', 'FLE Standard Time': 'Europe/Kiev', 'Russian Standard Time': 'Europe/Moscow',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage', 'US Mountain Standard Time': 'America/Phoenix', 'Atlantic Standard Time': 'America/Halifax', 'E. South America Standard Time': 'America/Sao_Paulo',
  'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai', 'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'New Zealand Standard Time': 'Pacific/Auckland', 'UTC': 'UTC', 'Singapore Standard Time': 'Asia/Singapore',
  'Arab Standard Time': 'Asia/Riyadh', 'Israel Standard Time': 'Asia/Jerusalem', 'South Africa Standard Time': 'Africa/Johannesburg', 'Turkey Standard Time': 'Europe/Istanbul',
};

/** The https link of the setting (webcal:// and http:// are upgraded), or '' (empty or not a link). */
function icsUrl(input) {
  var c = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  var u = String(c.ics_url === undefined || c.ics_url === null ? '' : c.ics_url).trim();
  u = u.replace(/^webcal:\/\//i, 'https://').replace(/^http:\/\//i, 'https://');
  return /^https:\/\/[^\s]+$/i.test(u) && u.length <= 2000 ? u : '';
}

var zoneFormatters = {};
function zoneFmt(zone) {
  if (!zoneFormatters[zone]) zoneFormatters[zone] = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  return zoneFormatters[zone];
}
/** The zone's offset from UTC at an instant, in ms. */
function offsetAt(ms, zone) {
  var p = {};
  zoneFmt(zone).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = Number(x.value); });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** The instant of a wall-clock time in a zone (a time that does not exist on a DST day moves forward, a repeated one is the first). */
function wallToEpoch(y, mo, d, h, mi, sec, zone) {
  var guess = Date.UTC(y, mo - 1, d, h, mi, sec), off = offsetAt(guess, zone), e = guess - off, off2 = offsetAt(e, zone);
  if (off2 !== off) e = guess - off2;
  return e;
}
function validZone(name) {
  if (!name) return null;
  var n = String(name).replace(/^"|"$/g, '').replace(/^\//, '');
  if (WINDOWS_ZONES[n]) n = WINDOWS_ZONES[n];
  try { zoneFmt(n); return n; } catch (e) { return null; }
}

/** Unfolded lines: a line starting with a space or a tab continues the one before. */
function icsLines(text) { return String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/); }

/** "NAME;P=V;P2=V2:value" -> { name, params, value } (a ":" inside a quoted parameter does not end the parameters). */
function icsProp(line) {
  var q = false, i, colon = -1;
  for (i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (ch === '"') q = !q;
    else if (ch === ':' && !q) { colon = i; break; }
  }
  if (colon < 0) return null;
  var head = line.slice(0, colon).split(';'), params = {};
  head.slice(1).forEach(function (kv) { var e = kv.indexOf('='); if (e > 0) params[kv.slice(0, e).toUpperCase()] = kv.slice(e + 1).replace(/^"|"$/g, ''); });
  return { name: head[0].toUpperCase(), params: params, value: line.slice(colon + 1) };
}
var icsText = function (v) { return String(v || '').replace(/\\([nN,;\\])/g, function (m, c) { return c === 'n' || c === 'N' ? ' ' : c; }).replace(/\s+/g, ' ').trim(); };

/** { events: [{ props: { NAME: [prop, ...] } }] }: the VEVENTs (alarms inside them skipped). */
function icsEvents(text) {
  var events = [], cur = null, alarm = 0;
  icsLines(text).forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = {}; alarm = 0; return; }
    if (!cur) return;
    if (line === 'END:VEVENT') { events.push(cur); cur = null; return; }
    if (/^BEGIN:VALARM/i.test(line)) { alarm++; return; }
    if (/^END:VALARM/i.test(line)) { alarm--; return; }
    if (alarm > 0) return;
    var p = icsProp(line);
    if (p) (cur[p.name] = cur[p.name] || []).push(p);
  });
  return events;
}

/** A DTSTART / DTEND / EXDATE / RECURRENCE-ID value: { allDay, y, mo, d, h, mi, s, utc, zone }; zone is the IANA name the wall time is in. */
function icsTime(prop, userZoneName) {
  var v = prop.value.trim(), m;
  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    m = /^(\d{4})(\d\d)(\d\d)$/.exec(v);
    return m ? { allDay: true, y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0, zone: userZoneName } : null;
  }
  m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)?(Z?)$/.exec(v);
  if (!m) return null;
  var utc = m[7] === 'Z';
  return { allDay: false, y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0), utc: utc, zone: utc ? 'UTC' : validZone(prop.params.TZID) || userZoneName };
}
var dayNumber = function (y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d) / 864e5); };
function civilOf(dayN) { var t = new Date(dayN * 864e5); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() }; }
var DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value) {
  var r = { freq: '', interval: 1, count: 0, until: '', byday: [], bymonthday: [], bymonth: [], wkst: 1 };
  String(value).split(';').forEach(function (kv) {
    var e = kv.indexOf('='), k = kv.slice(0, e).toUpperCase(), v = kv.slice(e + 1);
    if (k === 'FREQ') r.freq = v.toUpperCase();
    else if (k === 'INTERVAL') r.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === 'COUNT') r.count = Math.max(0, parseInt(v, 10) || 0);
    else if (k === 'UNTIL') r.until = v;
    else if (k === 'BYDAY') r.byday = v.split(',').map(function (x) { var m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim()); return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: DAY_CODES[m[2].toUpperCase()] } : null; }).filter(Boolean);
    else if (k === 'BYMONTHDAY') r.bymonthday = v.split(',').map(Number).filter(function (n) { return n && Math.abs(n) <= 31; });
    else if (k === 'BYMONTH') r.bymonth = v.split(',').map(Number).filter(function (n) { return n >= 1 && n <= 12; });
    else if (k === 'WKST') r.wkst = DAY_CODES[v.toUpperCase()] === undefined ? 1 : DAY_CODES[v.toUpperCase()];
  });
  return ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].indexOf(r.freq) >= 0 ? r : null;
}

/** The days (day numbers) of one month that a rule's BYDAY / BYMONTHDAY pick: "1MO" the first Monday, "-1FR" the last Friday. */
function monthDays(r, y, mo, startDom) {
  var first = dayNumber(y, mo, 1), len = civilOf(dayNumber(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1) - 1).d, out = [], i;
  if (r.bymonthday.length) r.bymonthday.forEach(function (n) { var d = n > 0 ? n : len + n + 1; if (d >= 1 && d <= len) out.push(first + d - 1); });
  else if (r.byday.length) {
    r.byday.forEach(function (b) {
      var days = [];
      for (i = 0; i < len; i++) if (civilOf(first + i).wd === b.wd) days.push(first + i);
      if (!b.n) out = out.concat(days);
      else { var d = b.n > 0 ? days[b.n - 1] : days[days.length + b.n]; if (d !== undefined) out.push(d); }
    });
  } else if (startDom <= len) out.push(first + startDom - 1);
  return out.sort(function (a, b) { return a - b; });
}

/**
 * The days an RRULE gives from the start day on, those within [fromDay, toDay]. A rule with COUNT is counted from its first day; one
 * without jumps near the window. Wall-clock days: the time of day is the caller's (so a DST change keeps "09:00 on Mondays").
 */
function ruleDays(r, startDay, fromDay, toDay, untilDay) {
  var st = civilOf(startDay), out = [], n = 0, k, i, per = r.freq === 'DAILY' ? 1 : r.freq === 'WEEKLY' ? 7 : r.freq === 'MONTHLY' ? 28 : 365;
  var k0 = r.count ? 0 : Math.max(0, Math.floor((fromDay - startDay) / (per * r.interval)) - 2);
  for (k = k0; k < k0 + RECUR_LOOP_CAP; k++) {
    var days = [], ps;
    if (r.freq === 'DAILY') { days = [startDay + k * r.interval]; ps = days[0]; }
    else if (r.freq === 'WEEKLY') {
      ps = startDay - ((st.wd - r.wkst + 7) % 7) + 7 * r.interval * k;
      (r.byday.length ? r.byday.map(function (b) { return b.wd; }) : [st.wd]).forEach(function (wd) { days.push(ps + ((wd - r.wkst + 7) % 7)); });
      days.sort(function (a, b) { return a - b; });
    } else if (r.freq === 'MONTHLY') {
      var m0 = st.y * 12 + (st.mo - 1) + k * r.interval;
      ps = dayNumber(Math.floor(m0 / 12), (m0 % 12) + 1, 1);
      if (!r.bymonth.length || r.bymonth.indexOf((m0 % 12) + 1) >= 0) days = monthDays(r, Math.floor(m0 / 12), (m0 % 12) + 1, st.d);
    } else {
      var y = st.y + k * r.interval;
      ps = dayNumber(y, 1, 1);
      (r.bymonth.length ? r.bymonth : [st.mo]).forEach(function (mo) { days = days.concat(monthDays(r, y, mo, st.d)); });
      days.sort(function (a, b) { return a - b; });
    }
    if (ps > toDay + 1 && days.every(function (d) { return d > toDay; })) break;
    for (i = 0; i < days.length; i++) {
      var d = days[i];
      if (d < startDay) continue;
      if (untilDay !== null && d > untilDay) return out;
      n++;
      if (d >= fromDay && d <= toDay) out.push(d);
      if (r.count && n >= r.count) return out;
    }
  }
  return out;
}

/** "P1DT2H30M" / "PT45M" / "P1W" -> ms, or 0. */
function icsDuration(v) {
  var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (((+m[2] || 0) * 7 + (+m[3] || 0)) * 864e5 + (+m[4] || 0) * 36e5 + (+m[5] || 0) * 6e4 + (+m[6] || 0) * 1e3);
}

/**
 * The occurrences that touch the days [firstDay, lastDay] (day numbers in the account's zone): [{ allDay, start, end (instants) or
 * startDay, endDay (exclusive), title, location }]. Cancelled events are skipped, EXDATEs removed, RECURRENCE-ID overrides replace the
 * occurrence they name.
 */
function icsOccurrences(text, zoneName, firstDay, lastDay) {
  var events = icsEvents(text), out = [], masters = [], overrides = {};
  var one = function (ev, name) { return (ev[name] || [])[0]; };
  var cancelled = function (ev) { var s = one(ev, 'STATUS'); return !!s && /^CANCELLED$/i.test(s.value.trim()); };
  var dayStartAt = function (dayN) { var c = civilOf(dayN); return wallToEpoch(c.y, c.mo, c.d, 0, 0, 0, zoneName); };
  var winStart = dayStartAt(firstDay), winEnd = dayStartAt(lastDay + 1);
  var key = function (t) { return t.allDay ? 'd' + dayNumber(t.y, t.mo, t.d) : 't' + wallToEpoch(t.y, t.mo, t.d, t.h, t.mi, t.s, t.zone); };
  var shape = function (ev, startT, startKey) { // one occurrence from its start (a time, or a day number for an all-day event)
    var endT = one(ev, 'DTEND') && icsTime(one(ev, 'DTEND'), zoneName), dur = one(ev, 'DURATION') ? icsDuration(one(ev, 'DURATION').value) : null;
    var o = { title: icsText((one(ev, 'SUMMARY') || {}).value), location: icsText((one(ev, 'LOCATION') || {}).value) };
    if (startT.allDay) {
      var span = endT && endT.allDay ? Math.max(1, dayNumber(endT.y, endT.mo, endT.d) - dayNumber(startT.y, startT.mo, startT.d)) : dur ? Math.max(1, Math.round(dur / 864e5)) : 1;
      o.allDay = true; o.startDay = startKey; o.endDay = startKey + span;
    } else {
      var s0 = wallToEpoch(startT.y, startT.mo, startT.d, startT.h, startT.mi, startT.s, startT.zone);
      var len = endT && !endT.allDay ? wallToEpoch(endT.y, endT.mo, endT.d, endT.h, endT.mi, endT.s, endT.zone) - s0 : dur !== null ? dur : 0;
      o.allDay = false; o.start = startKey === undefined ? s0 : startKey; o.end = o.start + Math.max(0, len);
    }
    return o;
  };
  events.forEach(function (ev) {
    var ds = one(ev, 'DTSTART'), uid = (one(ev, 'UID') || {}).value;
    if (!ds || !icsTime(ds, zoneName)) return;
    var rid = one(ev, 'RECURRENCE-ID');
    if (rid && icsTime(rid, zoneName)) {
      var rt = icsTime(rid, zoneName);
      (overrides[uid] = overrides[uid] || {})[key(rt)] = true;
      if (!cancelled(ev)) masters.push({ ev: ev, single: true });
    } else if (!cancelled(ev)) masters.push({ ev: ev, uid: uid });
  });
  masters.forEach(function (m) {
    var ev = m.ev, st = icsTime(one(ev, 'DTSTART'), zoneName), rr = one(ev, 'RRULE'), rule = rr && !m.single ? parseRule(rr.value) : null;
    if (!rule) {
      var o = st.allDay ? shape(ev, st, dayNumber(st.y, st.mo, st.d)) : shape(ev, st);
      out.push(o);
      return;
    }
    var ex = {};
    (ev.EXDATE || []).forEach(function (p) { p.value.split(',').forEach(function (v) { var t = icsTime({ value: v, params: p.params }, zoneName); if (t) ex[key(t)] = true; }); });
    var ov = overrides[m.uid] || {};
    var untilT = rule.until ? icsTime({ value: rule.until, params: {} }, zoneName) : null;
    var untilDay = untilT ? dayNumber(untilT.y, untilT.mo, untilT.d) : null;
    var untilEpoch = untilT && !untilT.allDay ? wallToEpoch(untilT.y, untilT.mo, untilT.d, untilT.h, untilT.mi, untilT.s, untilT.zone) : null;
    var startDay = dayNumber(st.y, st.mo, st.d);
    ruleDays(rule, startDay, firstDay - 3, lastDay + 1, untilDay).forEach(function (dn) {
      var c = civilOf(dn), occ = { allDay: st.allDay, y: c.y, mo: c.mo, d: c.d, h: st.h, mi: st.mi, s: st.s, zone: st.zone };
      var k = key(occ);
      if (ex[k] || ov[k]) return;
      if (st.allDay) out.push(shape(ev, st, dn));
      else {
        var at = wallToEpoch(c.y, c.mo, c.d, st.h, st.mi, st.s, st.zone);
        if (untilEpoch !== null && at > untilEpoch) return;
        out.push(shape(ev, st, at));
      }
    });
  });
  return out.filter(function (o) {
    if (!o.title && !o.location) return false;
    if (o.allDay) return o.startDay <= lastDay && o.endDay > firstDay;
    return o.end > o.start ? o.start < winEnd && o.end > winStart : o.start >= winStart && o.start < winEnd;
  }).map(function (o) { o.zoneDayStart = winStart; return o; });
}

/** The next AGENDA_ITEMS events to show: today's that are not over, from AGENDA_TOMORROW_FROM (or when none is left) tomorrow's. { day, items } or null. */
function pickAgenda(text, userZ, nowMs, local, timeFmt) {
  var zoneName = userZ.zone, today = dayNumber(+local.iso.slice(0, 4), +local.iso.slice(5, 7), +local.iso.slice(8, 10));
  var occ = icsOccurrences(text, zoneName, today, today + 1), dayStart = function (dn) { var c = civilOf(dn); return wallToEpoch(c.y, c.mo, c.d, 0, 0, 0, zoneName); };
  var onDay = function (dn) {
    var a = dayStart(dn), b = dayStart(dn + 1);
    return occ.filter(function (o) { return o.allDay ? o.startDay <= dn && o.endDay > dn : (o.end > o.start ? o.start < b && o.end > a : o.start >= a && o.start < b); })
      .sort(function (x, y) { return (x.allDay ? 0 : 1) - (y.allDay ? 0 : 1) || (x.start || 0) - (y.start || 0); });
  };
  var todays = onDay(today).filter(function (o) { return o.allDay || o.end > nowMs || (o.end === o.start && o.start >= nowMs); }), tomorrows = onDay(today + 1);
  var useTomorrow = tomorrows.length && (local.hour >= AGENDA_TOMORROW_FROM || !todays.length);
  var list = useTomorrow ? tomorrows : todays;
  return {
    day: useTomorrow ? 'tomorrow' : 'today',
    items: list.slice(0, AGENDA_ITEMS).map(function (o) { return { time: o.allDay ? 'All day' : timeFmt(o.start), title: o.title.slice(0, 80), loc: o.location.slice(0, 60) }; }),
  };
}

/** The ICS text of a link, read up to ICS_MAX_BYTES (more: null); null on any failure. Nothing of the link is kept or reported. */
async function fetchIcs(url) {
  var res = await fetch(url, { signal: AbortSignal.timeout(ICS_MS), headers: { Accept: 'text/calendar, text/plain, */*' } });
  if (!res || !res.ok) return null;
  var text = '';
  if (res.body && typeof res.body.getReader === 'function') {
    var reader = res.body.getReader(), dec = new TextDecoder(), got = 0;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      got += chunk.value.length;
      if (got > ICS_MAX_BYTES) { try { await reader.cancel(); } catch (e) { /* closed */ } return null; }
      text += dec.decode(chunk.value, { stream: true });
    }
  } else {
    text = await res.text();
    if (text.length > ICS_MAX_BYTES) return null;
  }
  return /BEGIN:VCALENDAR/i.test(text) ? text : null;
}

/** { day, label, items } for the strip, or null (no link, a failure, too big): never throws. */
async function fetchAgenda(url, locale, userZ, nowMs, local, timeFormat) {
  if (!url) return null;
  var text = await fetchIcs(url);
  if (!text) return null;
  var h24 = timeFormat !== '12h'; // the time_format setting decides, not the account language: 09:00 or 9:00 AM; anything but exactly 12h is 24-hour
  var tf = new Intl.DateTimeFormat(locale, { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: h24 ? 'h23' : 'h12', timeZone: userZ.zone });
  var a = pickAgenda(text, userZ, nowMs, local, function (ms) { return tf.format(new Date(ms)); });
  if (!a.items.length) return null; // nothing relevant, nothing shown
  var label = '';
  if (a.day === 'tomorrow') { // tomorrow's events say so in their time: "Wed 9:00 AM" (the weekday, short, in the account's language)
    var tm = new Date(Date.UTC(+local.iso.slice(0, 4), +local.iso.slice(5, 7) - 1, +local.iso.slice(8, 10) + 1, 12));
    var wd = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(tm);
    a.items.forEach(function (it) { it.time = wd + ' ' + it.time; });
    try { label = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(1, 'day'); } catch (e) { label = 'tomorrow'; }
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }
  return { day: a.day, label: label, items: a.items };
}

/** The whole-percent box { w: cqw, h: cqh } of the largest size within the limits whose shape is nearest the work's. */
function frameBox(aspect, sw, sh, wMax, hMax) {
  var h, w, best = null;
  for (h = hMax; h >= 10 && !best; h--) {
    for (w = wMax; w >= 10 && !best; w--) {
      if (Math.abs(Math.log((w * sw) / (h * sh) / aspect)) <= FRAME_SHAPE_ERR) best = { w: w, h: h };
    }
  }
  if (!best) { // no pair that close: the largest box of the work's shape that fits
    h = Math.min(hMax, Math.floor(wMax * sw / sh / aspect)); best = { w: Math.min(wMax, Math.round(h * sh * aspect / sw)), h: h };
  }
  return best;
}

/** The profile key of a screen with the whole-view frame layouts, or null (the others keep their strip). */
function frameProfileOf(scr) {
  var long = Math.max(scr.w, scr.h), short = Math.min(scr.w, scr.h);
  if (scr.frame) return scr.h > scr.w ? 'fp' : 'f';
  if (long === 1872 && short === 1404) return 'x';
  if (long === 800 && short === 480) return 'o';
  return null;
}

/** The layout of the info on a Frame, X or OG screen (see FRAME_ constants): { layout: "band" | "below" | "column" | "stack", ... }. The sizes are a first plan; the browser measures, drops and grows. */
function framePlan(art, sw, sh, set, key) {
  key = key || 'f';
  var P = FRAME_PROFILES[key], b = set.blocks, aspect = art.w / art.h, label = !!set.label, events = b.agenda ? Math.min(b.events, AGENDA_ITEMS) : 0;
  var z = P.z || 1, cw = sw / z, ch = sh / z, portrait = sh > sw, m = Math.min(128, Math.round(cw * FRAME_MARGIN_PCT / 100)), bandW = 100 - 2 * FRAME_MARGIN_PCT, ln = function (n) { return n * 1.25; };
  var evB = Math.min(events, P.bandEv), hasW = b.weather, out;
  // the row's height: the date, or the tallest cell (the label: two title lines, artist, museum)
  var rowH = Math.max(b.date ? Math.max(P.num * 1.05, 2 * ln(P.words)) : 0, label ? 2 * ln(P.title) + 2 * ln(P.small) : 0, evB ? 2 * ln(P.small) + ln(P.ev) : 0, hasW ? ln(P.temp) + ln(P.small) : 0);
  var restPct = Math.floor(100 * (ch - 3 * m - rowH) / ch);
  var base = { frame: true, tier: key, fit: 'cover', cls: P.cls, label: label, who: whoLine(art).replace(/ \u00b7 /g, '\u00a0\u00b7\u00a0'), coll: art.collection || '', fill: false,
    margin: m, numgap: Math.round(P.words * 0.4), gappx: Math.round(1.5 * P.lh), gap: FRAME_GAP_PCT, sepv: P.sep, bandw: bandW, aspect: Math.round(aspect * 10000) / 10000, portrait: portrait };
  var put = function (o) { for (var k in base) o[k] = base[k]; return o; };
  // the band covers its box: only when that crops at most FILL_CROP_MAX of the work, else the whole work (row under it, or column)
  if (!portrait && aspect >= FRAME_BAND_ASPECT && cropShare(aspect, (bandW * sw) / (restPct * sh)) <= FILL_CROP_MAX) {
    out = { layout: 'band', artw: bandW, arth: restPct, events: evB };
  } else if (portrait && aspect >= FRAME_STACK_ASPECT) {
    var full = frameBox(aspect, sw, sh, bandW, 60);
    out = { layout: 'stack', artw: full.w, arth: full.h, events: events };
  } else {
    var below = frameBox(aspect, sw, sh, bandW, restPct), box = portrait ? null : frameBox(aspect, sw, sh, 100 - 2 * FRAME_MARGIN_PCT - FRAME_COL_GUTTER - P.infow, FRAME_COL_H_MAX);
    // the title on two lines needs this much width (cqw); the work may give up width to the column only down to the width the row-under layout gives it (the floor, owner 2026-11-18)
    var titleW = 0.275 * P.title * String(art.title).length / cw * 100, colRoom = 100 - 2 * FRAME_MARGIN_PCT - FRAME_COL_GUTTER - below.w;
    if (box && titleW > colRoom) box = null; // a title too long for a column at the floor: the row under the work, the title wraps in the full width
    var best = box && box.w * box.h >= below.w * below.h ? box : below;
    if (box && box.w * box.h >= below.w * below.h) out = { layout: 'column', artw: box.w, arth: box.h, infow: P.infow, gap: FRAME_COL_GUTTER, events: events };
    else out = { layout: 'below', artw: below.w, arth: below.h, rowpct: below.w >= 60 ? below.w : bandW, events: evB };
  }
  out = put(out);
  out.gap = out.layout === 'column' ? FRAME_COL_GUTTER : FRAME_GAP_PCT;
  out.floorw = out.layout === 'column' ? below.w : 0; // the narrowest the work may get when the column widens for a long title
  out.bandPx = [sw * out.artw / 100, sh * out.arth / 100];
  return out;
}

/**
 * The info strip of one view slot, or null (none on, or no room): { place: "below", tier, gallery, stripw, lw, mw, midcols, label, who, detail, gap }.
 * set.strip says whether a part is on and has content, set.blocks which ({ date, weather, agenda, events: how many agenda items }).
 */
function infoPlace(art, sw, sh, zoom, set) {
  if (!set.strip) return null;
  var hc = sh / zoom, wc = sw / zoom, b = set.blocks;
  if (hc < INFO_MIN_SLOT || wc < INFO_MIN_SLOT_W) return null;
  var order = INFO_TIERS.map(function (t) { return t[1]; }), start = 0;
  INFO_TIERS.some(function (t, i) { if (hc >= t[0]) { start = i; return true; } return false; });
  if (art.kind === 'big') { order = [wc >= 2000 ? 'f' : 'g']; start = 0; } // the Frame's own path
  // an lg screen's CSS canvas can be smaller than the reported size over zoom (a joan is 480 x 800 CSS px for 600 x 800 or 758 x 1024 reported): widths are judged at 85 % there
  var xScreen = Math.abs(sw / sh - 4 / 3) < 0.01 || Math.abs(sw / sh - 3 / 4) < 0.01, cw = art.lg && !xScreen ? 0.85 : 1; // the X's CSS canvas is exactly 800 x 600
  var midCols = (b.weather ? 1 : 0) + (b.agenda ? b.events : 0);
  var plan = function (tier, force, noLabelOk) {
    var z = INFO_SIZES[tier], mPx = z.m * zoom, label = !!set.label, tp = INFO_TEXT_PX[tier];
    // the label's width from its text (title at the medium size, ARTIST . year . museum at the small), at least z.R; two lines each need about half
    var whoText = whoLine(art) + (art.collection ? ' \u00b7 ' + art.collection : '');
    var Rn = Math.max(z.R, 0.5 * tp[0] * String(art.title).length, 0.52 * tp[1] * whoText.length), R2 = Math.max(z.R * 0.55, Rn * 0.55);
    // fill on: when filling the band above the strip (the slot less the strip, its gap and the margin under it) crops at most FILL_CROP_MAX, the work fills it edge to edge
    var bandH = sh - (z.gap + z.h + z.m) * zoom, fill = !!set.fill && bandH > 0.4 * sh && cropShare(art.w / art.h, sw / bandH) <= FILL_CROP_MAX;
    var line = z.lm + z.ls, mids = midCols > 0, labelH = 2 * line;
    // the strip's arrangements, in order: one row; the label wrapped to two lines each; the weather (agenda) under the date; everything stacked, left-aligned, at the work's width; the date stacked too.
    // The strip stands on the work's edges (never wider than the work): the first arrangement that fits the width the work has at its own height wins.
    var arr = [
      { name: 'row', h: z.h, need: z.L + midCols * z.M + (label ? Rn : 0) },
      { name: 'wrap', h: Math.max(z.h, labelH), need: z.L + midCols * z.M + (label ? R2 : 0), wrap: true },
    ];
    if (mids) arr.push({ name: 'stackMid', h: Math.max(z.h + line, labelH), need: Math.max(z.L, z.M * midCols > 0 ? z.M : 0) + (label ? z.R * 0.55 : 0), wrap: true });
    arr.push({ name: 'stackAll', h: z.h + (mids ? line : 0) + (label ? labelH : 0), need: Math.max(z.L, mids ? z.M : 0, label ? z.R * 0.55 : 0), wrap: true });
    arr.push({ name: 'dateStack', h: z.h * 1.7 + (mids ? line : 0) + (label ? labelH : 0), need: Math.max(z.Ln, mids ? z.M * 0.7 : 0, label ? z.R * 0.55 : 0), wrap: true, dateStack: true });
    arr.push({ name: 'dateOnly', h: z.h * 1.7, need: z.Ln * 0.6, wrap: true, dateStack: true, only: true }); // a very narrow work: the date alone, in short names
    var k, pick = null, g = null;
    for (k = 0; k < arr.length && !pick; k++) {
      var a = arr[k];
      g = galleryFor(art, sw, sh, false, art.kind, zoom, sh, { reserve: (a.h * 1.15 + z.gap) * zoom, share: (sw - 2 * mPx) / sw });
      if (fill) { pick = arr[0]; g = galleryFor(art, sw, sh, false, art.kind, zoom, sh, { reserve: (z.h + z.gap) * zoom, share: (sw - 2 * mPx) / sw }); break; } // filling the width: the margins give a whole row
      if (g.pw / zoom * cw >= a.need) pick = a;
    }
    if (!pick) return null; // not even the date alone fits the work's width: no strip (the work keeps its museum label under it)
    if (pick.only) { label = false; }
    var stripPx = fill ? sw - 2 * mPx : g.pw, room = stripPx / zoom * cw;
    if (fill && label && room < arr[0].need) { if (!noLabelOk) return null; label = false; }
    if (!fill && label && !noLabelOk && pick === arr[arr.length - 1] && g.pw / zoom * cw < pick.need) return null; // try a smaller text tier before giving up the label
    return {
      place: 'below', arrange: pick.name, tier: tier, gallery: g, stripw: Math.round(100 * stripPx / sw), lw: Math.round(100 * z.L * zoom / sw), mw: Math.round(100 * z.M * zoom / sw),
      midcols: pick.only ? 0 : midCols, label: label, who: '', detail: '', gap: z.gap, h: Math.round(pick.h * 1.15), // the heights are estimates: 15 % over
      rule: 0, wrap: !!pick.wrap, dateStack: !!pick.dateStack, short: !!pick.only,
      margin: z.m, lift: z.lift, fill: fill, band: fill ? Math.round(100 * bandH / sh) : 0, // fill: the work's band above the strip, in percent of the slot's height
    };
  };
  var i, out = null;
  for (i = start; i < order.length && !out; i++) out = plan(order[i], false, false); // the text size drops a tier until the strip fits, with the museum label
  for (i = start; i < order.length && !out; i++) out = plan(order[i], i === order.length - 1, true); // else the museum label is left out, else the smallest as it is
  return out;
}

/**
 * Label only (no date, weather or agenda): the label in a column to the right of the whole work, its last line level with the work's bottom,
 * when that leaves a larger work than the label below it (near-square and tall works); wide works keep the label below. null: keep below.
 * g is the below geometry; the column reuses the info column's width of the profile and its gutter and margins.
 */
function labelColumn(art, sw, sh, key, g) {
  if (!g.label || sh > sw) return null;
  // the column is as wide as its text needs: the artist and detail lines whole, the title on one or two lines (the browser then narrows it to the real text, see fit in shared.liquid)
  var px = g.px || LABEL_PX[art.kind || 'normal'], z = art.zoom || 1, ch = function (n, size) { return n * 0.5 * size * z * 1.1; };
  var need = Math.max(ch(String(g.label.who).length, px[1]), ch(String(g.label.detail).length, px[2]), ch(String(art.title).length, px[0]) / 2);
  var colw = Math.min(LABEL_COL_MAX_PCT, Math.max(LABEL_COL_MIN_PCT, Math.ceil(100 * need / sw)));
  var box = frameBox(art.w / art.h, sw, sh, 100 - 2 * FRAME_MARGIN_PCT - FRAME_COL_GUTTER - colw, FRAME_COL_H_MAX);
  if ((box.w * sw / 100) * (box.h * sh / 100) <= g.pw * g.ph * 1.05) return null; // below stays unless the column clearly gives the larger work
  return { a: box.w, b: box.h, pw: Math.round(box.w * sw / 100), ph: Math.round(box.h * sh / 100), label: g.label, col: { w: colw, gap: FRAME_COL_GUTTER } };
}

function artOf(work, shard, set, scr) {
  var art = {
    id: work.i, title: work.t, artist: work.a, year: work.yl || (work.y === undefined ? '' : String(work.y)),
    collection: work.c === undefined ? '' : shard.col[work.c], movement: work.m === undefined ? '' : shard.mov[work.m],
    genre: genreOfWork(shard, work), medium: work.e === undefined || !shard.med ? '' : shard.med[work.e], size: work.z || null,
    mat: work.n ? 'black' : 'white', line: work.n ? work.lb === 1 : work.lw === 1, /* a fine keyline around the work on its mat only when the curator's flag for that mat (lw white, lb black) is 1 */ corner: work.q ? 'black' : 'white', kind: scr.frame ? 'big' : 'normal', lg: !scr.frame && Math.min(scr.w, scr.h) > 500, zoom: scr.frame ? 1 : Math.max(1, Math.max(scr.w, scr.h) / CSS_BASE_PX), w: work.w, h: work.h, link: 'https://www.wikidata.org/wiki/' + work.i,
  };
  var geo = {}, v;
  for (v in VIEWS) {
    var sw = Math.round(scr.w * VIEWS[v][0]), sh = Math.round(scr.h * VIEWS[v][1]);
    var fkey = v === 'full' && set.strip ? frameProfileOf(scr) : null, framed = !!fkey;
    var inf = framed ? framePlan(art, sw, sh, set, fkey) : infoPlace(art, sw, sh, art.zoom, set);
    if (framed) geo[v] = { mode: 'frame', fit: 'cover', gallery: null, plate: null, info: inf };
    else if (inf) { // info on: the work always hangs on its mat (no placard over the art), the info beside it or below
      if (inf.label) { inf.who = whoLine(art) + (art.collection ? ' \u00b7 ' + art.collection : ''); inf.detail = ''; } // the technique is left out when info is on
      geo[v] = inf.fill ? { mode: 'full', fit: 'cover', gallery: null, plate: null, info: inf } : { mode: 'gallery', fit: 'cover', gallery: inf.gallery, plate: null, info: inf };
    } else if (set.label && v === 'full' && frameProfileOf(scr)) { // label only on the Frame, X or OG: below the work or in a column to its right, whichever leaves the larger whole work
      var lp = FRAME_PROFILES[frameProfileOf(scr)], lpx = [lp.title, lp.small, lp.small]; // the label's sizes are the ones of the label in the info layouts (owner 2026-11-18)
      var lg0 = galleryFor(art, sw, sh, true, art.kind, art.zoom, undefined, { px: lpx });
      lg0.px = lpx;
      var lgal = labelColumn(art, sw, sh, frameProfileOf(scr), lg0) || lg0;
      lgal.cls = lp.cls;
      geo[v] = { mode: 'gallery', fit: 'cover', gallery: lgal, plate: null, info: null };
    } else if (set.label || modeFor(art, sw, sh, set.fill) === 'gallery') geo[v] = { mode: 'gallery', fit: 'cover', gallery: galleryFor(art, sw, sh, set.label, art.kind, art.zoom), plate: null, info: null }; // the label on: always the mat and the label as a gallery label (a slot too small for it has none); text never lies over the art
    else geo[v] = { mode: 'full', fit: 'cover', gallery: null, plate: null, info: null }; // label off, no info: the work fills the view when that crops little
  }
  // the thumbnail is sized for the whole screen view (the slots need less)
  var fullInf = geo.full.info, bandFull = fullInf && fullInf.fill ? scr.h * fullInf.band / 100 : scr.h;
  art.width = geo.full.mode === 'frame' ? thumbWidth(work.w, work.h, fullInf.bandPx[0], fullInf.bandPx[1], 'fill') : geo.full.mode === 'gallery' ? thumbWidth(work.w, work.h, geo.full.gallery.pw, geo.full.gallery.ph, 'fill') :
    thumbWidth(work.w, work.h, scr.w, bandFull, 'fill');
  if (work.r && art.width > work.r) art.width = capStep(work.r); // a PNG-only work: its thumbnail is a PNG, many MB at the wide steps (the build measured and set r)
  art.url = thumbUrl(work.f, art.width);
  art.srcset = srcsetOf(work.f, work.w, work.r);
  return { art: art, geo: geo };
}

/** What the strip shows: { info, layout }. info null when no part has content; layout the settings plus { strip, blocks }. */
async function infoOf(set, local, wxP, agP, state, scr) {
  var wx = await wxP, ag = await agP;
  if (wx) state.loc = wx.loc;
  if (ag && wx && !frameProfileOf(scr)) ag = { day: ag.day, label: ag.label, items: ag.items.slice(0, 1) }; // weather and agenda: the weather, then the next single event
  var blocks = { date: set.show_date, weather: !!wx, agenda: !!ag, events: ag ? ag.items.length : 0 };
  blocks.n = (blocks.date ? 1 : 0) + (blocks.weather ? 1 : 0) + (blocks.agenda ? 1 : 0);
  var info = blocks.n ? {
    has_date: blocks.date, day: local.day, weekday: local.weekday, month: local.month, weekday_short: local.weekdayShort, month_short: local.monthShort,
    has_weather: blocks.weather, temp: wx ? wx.temp : '', weather: wx ? wx.text : '', has_agenda: blocks.agenda, agenda: ag,
  } : null;
  return { info: info, layout: Object.assign({}, set, { strip: blocks.n > 0, blocks: blocks }) };
}

async function run(input) {
  var set = settingsOf(input), set0 = set;
  var scr = screenOf(input);
  var state = cleanState(input && input.trmnl && input.trmnl.state);
  var locale = userLocale(input), zone = userZone(input), nowMs = Date.now(), local = dayInfo(nowMs, locale, zone), url = set.show_agenda ? icsUrl(input) : '';
  // the weather and the agenda are asked while the data is fetched; a failure, a missing location or link, or the deadline leave them out
  var wxP = set.show_weather ? withDeadline(fetchWeather(set, locale, zone, local.iso, state.loc), WEATHER_DEADLINE_MS) : Promise.resolve(null);
  var agP = url ? withDeadline(fetchAgenda(url, locale, zone, nowMs, local, set.time_format), ICS_DEADLINE_MS) : Promise.resolve(null);
  var shard;
  try {
    shard = await fetchShard(scr.o, Math.random);
  } catch (err) {
    // Hand the state back unchanged. The work shown last stays on the screen, without a notice; else a plain message.
    var prev = input && input.trmnl && input.trmnl.previous_merge_variables;
    var made0 = await infoOf(set, local, wxP, agP, state, scr);
    var out = { settings: set0, trmnl_state: state, info: made0.info };
    if (prev && prev.art && prev.art.url) { out.art = prev.art; out.geo = prev.geo; out.backup = prev.backup || null; }
    else out.notice = 'The artwork list could not be loaded. The next refresh tries again.';
    out.debug = String(err && err.message ? err.message : err);
    return out;
  }
  var made1 = await infoOf(set, local, wxP, agP, state, scr), info = made1.info;
  set = made1.layout; // the settings and what the strip has (also in the merge variables: no link in it, see icsUrl)
  // with fill on the work is picked for the shape it fills: the screen, or the band above the strip
  var pickAspect = scr.w / scr.h;
  if (frameProfileOf(scr) && scr.o === 'landscape' && set.strip) pickAspect = FRAME_PICK_ASPECT;
  else if (set.fill && set.strip) {
    var z0 = scr.frame ? 1 : Math.max(1, Math.max(scr.w, scr.h) / CSS_BASE_PX), tz = scr.frame ? (scr.w >= 2000 ? 'f' : 'g') : (scr.h / z0 >= 900 ? 'xl' : scr.h / z0 >= 560 ? 'l' : scr.h / z0 >= 340 ? 'm' : 's'), zz = INFO_SIZES[tz];
    if (scr.h / z0 >= INFO_MIN_SLOT && scr.w / z0 >= INFO_MIN_SLOT_W) pickAspect = scr.w / (scr.h - (zz.gap + zz.h + zz.m) * z0);
  }
  var chosen = pick(shard, {
    k: ASPECT_K, aspect: pickAspect, movement: set.movement, genres: set.genres, family: set.family_friendly,
  }, state.h, Math.random);
  var work = shard.w[chosen.index];
  state.h.push(qnum(work.i));
  state.h = state.h.slice(-HISTORY);
  var made = artOf(work, shard, set, scr);
  var pickCtx = { k: ASPECT_K, aspect: pickAspect, movement: set.movement, genres: set.genres, family: set.family_friendly };
  var bIdx = pickBackup(shard, pickCtx, state.h, chosen.index, Math.random);
  var backup = bIdx === null ? null : artOf(shard.w[bIdx], shard, set, scr);
  // filters_relaxed: the narrowing filters that left too few works and were dropped for this refresh
  // trmnl_state records the primary: whether its picture loaded (or the backup replaced it) is only known in the browser
  return { art: made.art, geo: made.geo, backup: backup, info: info, settings: set0, filters_relaxed: chosen.relaxed, trmnl_state: state };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    run: run, labelColumn: labelColumn, md5: md5, thumbUrl: thumbUrl, thumbWidth: thumbWidth, choose: choose, weightOf: weightOf, screenOf: screenOf,
    settingsOf: settingsOf, framePlan: framePlan, frameBox: frameBox, frameProfileOf: frameProfileOf, FRAME_BAND_CROP_MAX: FRAME_BAND_CROP_MAX, AGENDA_ITEMS: AGENDA_ITEMS, FILL_CROP_MAX: FILL_CROP_MAX, icsOccurrences: icsOccurrences, pickAgenda: pickAgenda, fetchAgenda: fetchAgenda, icsUrl: icsUrl, dayNumber: dayNumber, wallToEpoch: wallToEpoch, forecastLine: forecastLine, dayInfo: dayInfo, infoPlace: infoPlace, weatherSentence: weatherSentence, INFO_SIZES: INFO_SIZES, INFO_NARROW: INFO_NARROW, fetchWeather: fetchWeather, latLon: latLon, userZone: userZone, userLocale: userLocale, unitOf: unitOf, validShard: validShard, pick: pick, pickBackup: pickBackup, DATA_BASES: DATA_BASES, cropShare: cropShare, modeFor: modeFor, flag: flag, AUTO_CROP_MAX: AUTO_CROP_MAX, galleryFor: galleryFor, whoLine: whoLine, detailLine: detailLine, srcsetOf: srcsetOf, artOf: artOf, HISTORY: HISTORY, SHARDS: SHARDS,
  };
}
