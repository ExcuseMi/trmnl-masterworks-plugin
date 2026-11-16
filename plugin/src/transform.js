/**
 * Masterworks: a famous public-domain artwork, a new one on every refresh.
 * Data: JSON shards per orientation (data/landscape-0.json, ...), each about 100 kB, in this plugin's own GitHub repo; a run
 * fetches one of them, chosen at random (a work lives in the part given by its Q-number).
 * Images: straight from Wikimedia Commons, as a thumbnail at the screen's width (only the standard widths exist).
 * State (kept under 1 kB, far below the 8 kB limit): { h: Q-numbers of the last HISTORY works shown }.
 * A failed fetch shows the last work again, else a clean message. Never a blank screen.
 * The plugin decides per work and per view how to show it: full screen with a corner placard when filling the view would
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
var SHARDS = { landscape: 6, portrait: 5 }; // parts per orientation in data/ (a test compares this with the files)
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
var AUTO_CROP_MAX = 0.05; // full screen when filling the view would crop less than this share of the work's area, else the gallery
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
var LABEL_MAX_SHARE = 0.4; // a label that would need more of a slot's height than this is left out (a playdate quadrant)
var LABEL_DETAIL_MIN_H = 300; // the where-it-hangs line needs a slot this high
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
  return {
    label: flag(c.label, true), // a select value from an older version ("corner", "off") is read as well
    genres: genres, movement: movement, family_friendly: flag(c.family_friendly, true),
  };
}

function cleanState(s) {
  var h = s && Array.isArray(s.h) ? s.h.filter(function (n) { return typeof n === 'number'; }) : [];
  return { h: h.slice(-HISTORY) };
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
 * The placard of a work that fills the view: Framework text classes in a plate in the picture's bottom-left corner.
 * Returns { m, w, who, detail }: m the spacing step of the margin to the picture's edges (never across an edge), w the
 * widest the plate gets, as a share of the slot's width.
 */
function plateFor(art, slotW, slotH, kind) {
  return {
    m: kind === 'big' ? 8 : slotW >= 500 ? 4 : 3, w: slotW >= 700 ? 45 : 80,
    who: whoLine(art), detail: slotH >= 240 ? detailLine(art) : '',
  };
}

/**
 * Gallery geometry of one slot: percent sizes of the picture box (the Framework has whole-percent sizes only; the pair
 * nearest the work's shape is taken and the picture covers its box, so an error of a fraction of a percent is cropped,
 * never a gap), and what the label needs. withLabel false: the picture alone, centred.
 */
function galleryFor(art, slotW, slotH, withLabel, kind, zoom) {
  var aspect = art.w / art.h, wide = aspect >= slotW / slotH;
  var widthCap = (wide ? GALLERY_WIDE_MAX : GALLERY_SHARE) * slotW;
  var heightCap = (wide ? GALLERY_SHARE : GALLERY_TALL_MAX) * slotH;
  var px = LABEL_PX[kind || 'normal'], maxLines = slotH >= 700 ? 2 : 1, hasDetail = slotH >= LABEL_DETAIL_MIN_H && !!detailLine(art);
  var lines = 1, ph = 0, pw = 0, i;
  // the room a label needs: its share of the slot, but never less than its lines at the sizes the markup uses
  zoom = zoom || 1; // the label's text is in CSS px; the slot is in reported device px, which a zoomed screen draws larger
  var floorPx = function (n) { return zoom * (n * 1.25 * px[0] + 1.3 * px[1] + (hasDetail ? 1.35 * px[2] : 0) + 6); };
  if (withLabel && floorPx(1) > LABEL_MAX_SHARE * slotH) withLabel = false; // a slot too small for a readable label
  for (i = 0; i < 3; i++) { // the title wraps by the picture's width, the picture's size leaves room for the label
    var reserve = withLabel ? Math.max(slotH * (LABEL_SHARE + (lines - 1) * LABEL_LINE_SHARE + LABEL_GAP_SHARE), floorPx(lines) + slotH * LABEL_GAP_SHARE) : 0;
    ph = Math.min(heightCap, GALLERY_USE * slotH - reserve, widthCap / aspect);
    pw = ph * aspect;
    lines = Math.min(maxLines, Math.max(1, Math.ceil(String(art.title).length * 0.5 * px[0] / Math.max(pw, 1))));
  }
  var ideal = 100 * pw / slotW, best = null, da, db;
  for (da = -1; da <= 1; da++) {
    for (db = -1; db <= 1; db++) {
      var A = Math.floor(ideal) + da, B = Math.floor(100 * (pw / aspect) / slotH) + db;
      if (A < 1 || B < 1 || A > 100 || B > 100) continue;
      var err = Math.abs((A * slotW) / (B * slotH) / aspect - 1) + 0.002 * (Math.abs(A - ideal) + Math.abs(B - 100 * (pw / aspect) / slotH));
      if (!best || err < best.err) best = { a: A, b: B, err: err };
    }
  }
  var out = { a: best.a, b: best.b, pw: Math.round(best.a * slotW / 100), ph: Math.round(best.b * slotH / 100) };
  if (withLabel) out.label = { lines: lines, who: whoLine(art), detail: hasDetail ? detailLine(art) : '' };
  return out;
}

/** The share of the work's area a cover fit into a slot of this shape cuts off. */
function cropShare(workAspect, slotAspect) {
  var r = workAspect / slotAspect;
  return 1 - Math.min(r, 1 / r);
}

/** "full" when a fill crops less than AUTO_CROP_MAX of the work in a slot of this shape, else "gallery". */
function modeFor(art, slotW, slotH) {
  return cropShare(art.w / art.h, slotW / slotH) < AUTO_CROP_MAX ? 'full' : 'gallery';
}

/**
 * The widths the browser may choose from (srcset, with sizes in the markup): the renderer knows its own viewport, the
 * transform only the device TRMNL reports (the first device of the playlist), so the picture's width is left to the browser.
 */
function srcsetOf(file, workWidth) {
  var out = [];
  STEPS.forEach(function (w) { if (w >= 500 && w <= MAX_STEP && w <= workWidth) out.push(thumbUrl(file, w) + ' ' + w + 'w'); });
  if (!out.length) out.push(thumbUrl(file, thumbWidth(workWidth, 1, 1, 1, 'fill')) + ' ' + thumbWidth(workWidth, 1, 1, 1, 'fill') + 'w');
  return out.join(', ');
}

function artOf(work, shard, set, scr) {
  var art = {
    id: work.i, title: work.t, artist: work.a, year: work.yl || (work.y === undefined ? '' : String(work.y)),
    collection: work.c === undefined ? '' : shard.col[work.c], movement: work.m === undefined ? '' : shard.mov[work.m],
    genre: genreOfWork(shard, work), medium: work.e === undefined || !shard.med ? '' : shard.med[work.e], size: work.z || null,
    mat: work.n ? 'black' : 'white', corner: work.q ? 'black' : 'white', kind: scr.frame ? 'big' : 'normal', zoom: scr.frame ? 1 : Math.max(1, Math.max(scr.w, scr.h) / CSS_BASE_PX), w: work.w, h: work.h, link: 'https://www.wikidata.org/wiki/' + work.i,
  };
  var geo = {}, v;
  for (v in VIEWS) {
    var sw = Math.round(scr.w * VIEWS[v][0]), sh = Math.round(scr.h * VIEWS[v][1]);
    if (modeFor(art, sw, sh) === 'gallery') geo[v] = { mode: 'gallery', fit: 'cover', gallery: galleryFor(art, sw, sh, set.label, art.kind, art.zoom), plate: null };
    else geo[v] = { mode: 'full', fit: 'cover', gallery: null, plate: set.label ? plateFor(art, sw, sh, art.kind) : null };
  }
  // the thumbnail is sized for the whole screen view (the slots need less)
  art.width = geo.full.mode === 'gallery' ? thumbWidth(work.w, work.h, geo.full.gallery.pw, geo.full.gallery.ph, 'fill') :
    thumbWidth(work.w, work.h, scr.w, scr.h, 'fill');
  art.url = thumbUrl(work.f, art.width);
  art.srcset = srcsetOf(work.f, work.w);
  return { art: art, geo: geo };
}

async function run(input) {
  var set = settingsOf(input);
  var scr = screenOf(input);
  var state = cleanState(input && input.trmnl && input.trmnl.state);
  var shard;
  try {
    shard = await fetchShard(scr.o, Math.random);
  } catch (err) {
    // Hand the state back unchanged. The work shown last stays on the screen, without a notice; else a plain message.
    var prev = input && input.trmnl && input.trmnl.previous_merge_variables;
    var out = { settings: set, trmnl_state: state };
    if (prev && prev.art && prev.art.url) { out.art = prev.art; out.geo = prev.geo; out.backup = prev.backup || null; }
    else out.notice = 'The artwork list could not be loaded. The next refresh tries again.';
    out.debug = String(err && err.message ? err.message : err);
    return out;
  }
  var chosen = pick(shard, {
    k: ASPECT_K, aspect: scr.w / scr.h, movement: set.movement, genres: set.genres, family: set.family_friendly,
  }, state.h, Math.random);
  var work = shard.w[chosen.index];
  state.h.push(qnum(work.i));
  state.h = state.h.slice(-HISTORY);
  var made = artOf(work, shard, set, scr);
  var pickCtx = { k: ASPECT_K, aspect: scr.w / scr.h, movement: set.movement, genres: set.genres, family: set.family_friendly };
  var bIdx = pickBackup(shard, pickCtx, state.h, chosen.index, Math.random);
  var backup = bIdx === null ? null : artOf(shard.w[bIdx], shard, set, scr);
  // filters_relaxed: the narrowing filters that left too few works and were dropped for this refresh
  // trmnl_state records the primary: whether its picture loaded (or the backup replaced it) is only known in the browser
  return { art: made.art, geo: made.geo, backup: backup, settings: set, filters_relaxed: chosen.relaxed, trmnl_state: state };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    run: run, md5: md5, thumbUrl: thumbUrl, thumbWidth: thumbWidth, choose: choose, weightOf: weightOf, screenOf: screenOf,
    settingsOf: settingsOf, validShard: validShard, pick: pick, pickBackup: pickBackup, DATA_BASES: DATA_BASES, cropShare: cropShare, modeFor: modeFor, flag: flag, AUTO_CROP_MAX: AUTO_CROP_MAX, galleryFor: galleryFor, plateFor: plateFor, whoLine: whoLine, detailLine: detailLine, srcsetOf: srcsetOf, artOf: artOf, HISTORY: HISTORY, SHARDS: SHARDS,
  };
}
