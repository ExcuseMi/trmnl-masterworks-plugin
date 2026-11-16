/**
 * Masterworks: a famous public-domain artwork, a new one on every refresh.
 * Data: a JSON shard per orientation (data/landscape.json, data/portrait.json) in this plugin's own GitHub repo.
 * Images: straight from Wikimedia Commons, as a thumbnail at the screen's width (only the standard widths exist).
 * State (kept under 1 kB, far below the 8 kB limit): { h: Q-numbers of the last HISTORY works shown }.
 * One fetch of 150 kB or so; a failed fetch shows the last work again, else a clean message. Never a blank screen.
 */

var DATA_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data/';
var FETCH_MS = 3500; // the run has 5 s in all
var HISTORY = 50; // never one of the last HISTORY works shown
// tunable weights of a work: fame ^ FAME_EXP, (1 - colour error) ^ COLOR_EXP, exp(-ASPECT_K * |ln(work aspect / screen aspect)|)
var FAME_EXP = 0.6; // fame = sitelink count; 0 = all alike, 1 = in proportion to fame
var COLOR_EXP = 3; // palette score, rescaled over the shard; higher favours the works that suit the inks
var ASPECT_K_FILL = 3; // "Fill" crops, so a far-off shape is a poor pick
var ASPECT_K_WHOLE = 1; // "Whole work" leaves a mat: shape matters less
var MIN_POOL = 5; // a movement with fewer works than this is ignored
var STEPS = [120, 250, 500, 960, 1280, 1920, 3840]; // the thumbnail widths Wikimedia serves (Commons returns 400 for others)
var MAX_STEP = 3840;
var STEP_TOLERANCE = 0.7; // the next step down is used when it holds at least this part of the width the screen needs
var DEFAULT_W = 800, DEFAULT_H = 480;

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
  var enc = encodeURIComponent(f);
  return 'https://upload.wikimedia.org/wikipedia/commons/thumb/' + h.charAt(0) + '/' + h.slice(0, 2) + '/' + enc + '/' + width + 'px-' + enc;
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
  var o = d.orientation === 'portrait' || d.orientation === 'landscape' ? d.orientation : (h > w ? 'portrait' : 'landscape');
  // the sizes are those of the picture area: the long side is across for landscape, down for portrait
  var long = Math.max(w, h), short = Math.min(w, h);
  return o === 'portrait' ? { w: short, h: long, o: o } : { w: long, h: short, o: o };
}

function settingsOf(input) {
  var c = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  var txt = function (v) { return String(v === undefined || v === null ? '' : v).toLowerCase(); };
  // a select arrives as its value; anything unknown means the default
  var fit = txt(c.fit) === 'whole' ? 'whole' : 'fill';
  var label = txt(c.label) === 'off' || txt(c.label) === 'false' || txt(c.label) === 'no' ? 'off' : 'corner';
  var movement = String(c.movement === undefined || c.movement === null ? '' : c.movement).trim();
  if (txt(movement) === 'all' || txt(movement) === 'any') movement = '';
  return { fit: fit, label: label, movement: movement };
}

function cleanState(s) {
  var h = s && Array.isArray(s.h) ? s.h.filter(function (n) { return typeof n === 'number'; }) : [];
  return { h: h.slice(-HISTORY) };
}

var qnum = function (id) { return Number(String(id).replace(/^Q/, '')) || 0; };

/** Weight of one work: famous, suits the inks, and shaped like the screen. rangeP = [min, max] of the shard's scores. */
function weightOf(work, ctx) {
  var fame = Math.pow(Math.max(1, work.s || 1), FAME_EXP);
  var span = ctx.pMax - ctx.pMin;
  var bad = span > 0 ? (work.p - ctx.pMin) / span : 0; // 0 = best score of the shard, 1 = worst
  var color = Math.pow(Math.max(0.02, 1 - bad), COLOR_EXP);
  var k = ctx.fit === 'fill' ? ASPECT_K_FILL : ASPECT_K_WHOLE;
  var aspect = Math.exp(-k * Math.abs(Math.log((work.w / work.h) / ctx.aspect)));
  return fame * color * aspect;
}

/** Index of the work to show. rnd() is a uniform [0, 1) source, injected so tests can drive it. */
function choose(shard, ctx, history, rnd) {
  var works = shard.w, i;
  var pool = [];
  var mov = ctx.movement ? shard.mov.map(function (m) { return m.toLowerCase(); }).indexOf(ctx.movement.toLowerCase()) : -1;
  if (mov >= 0) {
    for (i = 0; i < works.length; i++) if (works[i].m === mov) pool.push(i);
    if (pool.length < MIN_POOL) pool = []; // too few to rotate through: ignore the filter
  }
  if (!pool.length) for (i = 0; i < works.length; i++) pool.push(i);
  var seen = {};
  history.forEach(function (n) { seen[n] = true; });
  var fresh = pool.filter(function (idx) { return !seen[qnum(works[idx].i)]; });
  if (!fresh.length) { // a small pool is used up: take the one seen longest ago
    for (i = 0; i < history.length; i++) {
      var back = pool.filter(function (idx) { return qnum(works[idx].i) === history[i]; });
      if (back.length) return back[0];
    }
    fresh = pool;
  }
  var ps = shard.w.map(function (w) { return w.p; });
  ctx = { fit: ctx.fit, aspect: ctx.aspect, pMin: Math.min.apply(null, ps), pMax: Math.max.apply(null, ps) };
  var weights = fresh.map(function (idx) { return weightOf(works[idx], ctx); });
  var total = weights.reduce(function (a, b) { return a + b; }, 0);
  var x = rnd() * total;
  for (i = 0; i < fresh.length; i++) {
    x -= weights[i];
    if (x < 0) return fresh[i];
  }
  return fresh[fresh.length - 1];
}

function validShard(j) {
  return !!j && Array.isArray(j.w) && j.w.length > 0 && Array.isArray(j.col) && Array.isArray(j.mov) &&
    typeof j.w[0].f === 'string' && j.w[0].w > 0 && j.w[0].h > 0;
}

async function fetchShard(orientation) {
  var res = await fetch(DATA_BASE + orientation + '.json', { signal: AbortSignal.timeout(FETCH_MS) });
  if (!res || !res.ok) throw new Error('data HTTP ' + (res && res.status));
  var j = await res.json();
  if (!validShard(j)) throw new Error('data has an unexpected shape');
  return j;
}

function artOf(work, shard, set, scr) {
  var width = thumbWidth(work.w, work.h, scr.w, scr.h, set.fit);
  return {
    id: work.i, title: work.t, artist: work.a, year: work.y === undefined ? '' : String(work.y),
    collection: work.c === undefined ? '' : shard.col[work.c], movement: work.m === undefined ? '' : shard.mov[work.m],
    url: thumbUrl(work.f, width), width: width, link: 'https://www.wikidata.org/wiki/' + work.i,
    // how it sits: a work of the screen's shape is flush with both edges, other shapes are cropped (Fill) or matted (Whole)
    fit: set.fit === 'fill' ? 'cover' : 'contain',
  };
}

async function run(input) {
  var set = settingsOf(input);
  var scr = screenOf(input);
  var state = cleanState(input && input.trmnl && input.trmnl.state);
  var shard;
  try {
    shard = await fetchShard(scr.o);
  } catch (err) {
    // Hand the state back unchanged. The work shown last stays on the screen, without a notice; else a plain message.
    var prev = input && input.trmnl && input.trmnl.previous_merge_variables;
    var out = { settings: set, trmnl_state: state };
    if (prev && prev.art && prev.art.url) out.art = prev.art;
    else out.notice = 'The artwork list could not be loaded. The next refresh tries again.';
    out.debug = String(err && err.message ? err.message : err);
    return out;
  }
  var idx = choose(shard, { fit: set.fit, aspect: scr.w / scr.h, movement: set.movement }, state.h, Math.random);
  var work = shard.w[idx];
  state.h.push(qnum(work.i));
  state.h = state.h.slice(-HISTORY);
  return { art: artOf(work, shard, set, scr), settings: set, trmnl_state: state };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { run: run, md5: md5, thumbUrl: thumbUrl, thumbWidth: thumbWidth, choose: choose, weightOf: weightOf, screenOf: screenOf, settingsOf: settingsOf, validShard: validShard, HISTORY: HISTORY };
}
