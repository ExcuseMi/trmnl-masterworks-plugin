/**
 * Masterworks: a famous public-domain artwork, a new one on every refresh.
 * Data: JSON shards per orientation (data/landscape-0.json, ...), each about 100 kB, in this plugin's own GitHub repo; a run
 * fetches one of them, chosen at random (a work lives in the part given by its Q-number).
 * Images: straight from Wikimedia Commons, as a thumbnail at the screen's width (only the standard widths exist).
 * State (kept under 1 kB, far below the 8 kB limit): { h: Q-numbers of the last HISTORY works shown }.
 * A failed fetch shows the last work again, else a clean message. Never a blank screen.
 * Two presentations: "gallery" (default: the work centred on a white or black mat with a museum label) and "full" (the work
 * fills the view, with a corner placard). The label text is drawn as SVG text in the screen's own pixels: the Frame is
 * screen--md at 1x like the OG, so no Framework text class can tell 2560 px from 800 px.
 */

var DATA_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data/';
var FETCH_MS = 3500; // the run has 5 s in all
var SHARDS = { landscape: 3, portrait: 3 }; // parts per orientation in data/ (a test compares this with the files)
var HISTORY = 50; // never one of the last HISTORY works shown
// Weight of a work = fame ^ FAME_EXP x colour factor x dark factor x shape factor. Fame is the main factor.
var FAME_EXP = 0.8; // fame = sitelink count; 0 = all alike, 1 = in proportion to fame
var COLOR_WEIGHT = 0.25; // palette distance (after TRMNL's contrast step), rescaled over the shard: the worst match is picked (1 - this) times as often. Small: the 6-colour dither copes with most colours
var DARK_FREE = 0.45; // share of near-black pixels (after TRMNL's contrast step) that costs nothing
var DARK_K = 6; // beyond DARK_FREE the weight is multiplied by exp(-DARK_K x the excess): the strong penalty, for very dark works only
var ASPECT_K_FILL = 3; // shape factor exp(-K x |ln(work aspect / screen aspect)|); "Fill" crops, so a far-off shape is a poor pick
var ASPECT_K_WHOLE = 1; // "Whole work" leaves a mat: shape matters less
var MIN_POOL = 5; // a movement with fewer works than this is ignored
var STEPS = [120, 250, 500, 960, 1280, 1920, 3840]; // the thumbnail widths Wikimedia serves (Commons returns 400 for others)
var MAX_STEP = 1920; // 3840 px files are 2 to 9 MB: too heavy for a refresh
var STEP_TOLERANCE = 0.8; // the next step down is used when it holds at least this part of the width needed
var DEFAULT_W = 800, DEFAULT_H = 480;
var BOLD = 1.2; // bold lines are this much wider than regular ones
var TEXT_FIT = 0.9; // lines are cut to this share of their box: the width table is an estimate for faces the renderer picks
var GALLERY_SHARE = 0.75; // gallery: the picture takes up to this share of the slot's width and of its height
var GALLERY_USE = 0.94; // picture, gap and label together stay inside this share of the height
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
  return o === 'portrait' ? { w: short, h: long, o: o } : { w: long, h: short, o: o };
}

function settingsOf(input) {
  var c = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  var txt = function (v) { return String(v === undefined || v === null ? '' : v).toLowerCase(); };
  // a select arrives as its value; anything unknown means the default
  var presentation = txt(c.presentation) === 'full' ? 'full' : 'gallery';
  var fit = txt(c.fit) === 'whole' ? 'whole' : 'fill'; // Full screen only
  var label = txt(c.label) === 'off' || txt(c.label) === 'false' || txt(c.label) === 'no' ? 'off' : 'corner';
  var movement = String(c.movement === undefined || c.movement === null ? '' : c.movement).trim();
  if (txt(movement) === 'all' || txt(movement) === 'any') movement = '';
  return { presentation: presentation, fit: fit, label: label, movement: movement };
}

function cleanState(s) {
  var h = s && Array.isArray(s.h) ? s.h.filter(function (n) { return typeof n === 'number'; }) : [];
  return { h: h.slice(-HISTORY) };
}

var qnum = function (id) { return Number(String(id).replace(/^Q/, '')) || 0; };

/** Weight of one work (see the constants). ctx.pMin and ctx.pMax: the shard's lowest and highest palette distance. */
function weightOf(work, ctx) {
  var fame = Math.pow(Math.max(1, work.s || 1), FAME_EXP);
  var span = ctx.pMax - ctx.pMin;
  var bad = span > 0 ? (work.p - ctx.pMin) / span : 0; // 0 = the best match of the shard, 1 = the worst
  var color = 1 - COLOR_WEIGHT * Math.min(1, Math.max(0, bad));
  var dark = Math.exp(-DARK_K * Math.max(0, (work.k || 0) - DARK_FREE));
  var k = ctx.fit === 'fill' ? ASPECT_K_FILL : ASPECT_K_WHOLE;
  var aspect = Math.exp(-k * Math.abs(Math.log((work.w / work.h) / ctx.aspect)));
  return fame * color * dark * aspect;
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

async function fetchShard(orientation, rnd) {
  var parts = SHARDS[orientation] || 1;
  var part = Math.min(parts - 1, Math.floor(rnd() * parts));
  var res = await fetch(DATA_BASE + orientation + '-' + part + '.json', { signal: AbortSignal.timeout(FETCH_MS) });
  if (!res || !res.ok) throw new Error('data HTTP ' + (res && res.status));
  var j = await res.json();
  if (!validShard(j)) throw new Error('data has an unexpected shape');
  return j;
}

// ---- label text, drawn as SVG text: sizes are the slot's own pixels ---------------------------------------------------

/**
 * Width of a text in em, from character classes. The face is whatever "serif" is on the render box: Times-like locally,
 * DejaVu Serif (about 25 % wider) in the trmnlp Docker image where the base checks found text 1 px past its box. The
 * numbers are those of the wide one, so a line is cut a little early on a narrow face and never late on a wide one.
 */
function emWidth(str, caps, italic) {
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i), code = str.charCodeAt(i);
    if (c === ' ') w += 0.32;
    else if (code > 0x2e80) w += 1;
    else if (c >= 'A' && c <= 'Z') w += 0.82;
    else if (c >= '0' && c <= '9') w += 0.64;
    else if (c >= 'a' && c <= 'z') w += caps ? 0.82 : (italic ? 0.62 : 0.6);
    else if (code > 0x7f) w += 0.62;
    else w += 0.42;
  }
  return w;
}

/** The text cut at a word, or at a letter, with an ellipsis, so that it is at most maxPx wide at this size. */
function fitText(str, size, maxPx, caps, italic) {
  str = String(str);
  if (emWidth(str, caps, italic) * size <= maxPx) return str;
  var cut = str;
  while (cut.length > 1 && emWidth(cut + '\u2026', caps, italic) * size > maxPx) cut = cut.slice(0, -1);
  return cut.replace(/[\s,;:\u00b7-]+$/, '') + '\u2026';
}

/** Words onto at most maxLines lines of maxPx; what does not fit ends the last line with an ellipsis. */
function wrapText(str, size, maxPx, maxLines, caps, italic) {
  var words = String(str).split(/\s+/), lines = [], cur = '', i;
  for (i = 0; i < words.length; i++) {
    var next = cur ? cur + ' ' + words[i] : words[i];
    if (!cur || emWidth(next, caps, italic) * size <= maxPx) cur = next;
    else { lines.push(cur); cur = words[i]; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines = lines.slice(0, maxLines - 1).concat(lines.slice(maxLines - 1).join(' '));
  return lines.map(function (l) { return fitText(l, size, maxPx, caps, italic); });
}

var cmText = function (z) {
  var n = function (v) { return String(Math.round(v * 10) / 10).replace(/\.0$/, ''); };
  return n(z[0]) + ' \u00d7 ' + n(z[1]) + ' cm';
};

/** Type sizes (px) for a slot of this height. */
function sizesFor(slotH) {
  var title = Math.max(14, Math.round(slotH / 40));
  return { title: title, artist: Math.max(11, Math.round(title * 0.72)), detail: Math.max(10, Math.round(title * 0.6)) };
}

/** The museum label under the picture: right-aligned lines in an svg of width pw. Returns { vw, vh, lines }. */
function galleryLabel(art, slotH, pw) {
  var z = sizesFor(slotH), lines = [], y = 0, i;
  var pad = Math.round(z.title * 0.35);
  // right edge of the text: a face without a real italic is slanted by the renderer, and the slant reaches past the advance
  // (the base checks measured 0.55 em in the Docker image), so the italic title ends a little early and the rest 2 px
  var inset = 3, tin = Math.round(z.title * 0.3);
  var titleLines = wrapText(art.title, z.title, (pw - tin) * TEXT_FIT, slotH >= 700 ? 2 : 1, false, true);
  y = pad;
  for (i = 0; i < titleLines.length; i++) { y += Math.round(z.title * 1.1); lines.push({ x: pw - tin, y: y, s: z.title, a: 'end', fs: 'italic', fw: 'normal', t: titleLines[i] }); y += Math.round(z.title * 0.15); }
  var who = String(art.artist || '').toUpperCase() + (art.year ? ' \u00b7 ' + art.year : '');
  if (art.artist || art.year) { y += Math.round(z.artist * 1.35); lines.push({ x: pw - inset, y: y, s: z.artist, a: 'end', fs: 'normal', fw: 'normal', t: fitText(who, z.artist, (pw - inset) * TEXT_FIT, true, false) }); }
  var parts = [art.medium, art.size ? cmText(art.size) : '', art.collection].filter(Boolean);
  if (parts.length && slotH >= 400) {
    // the collection, then the material, give way when the line is too wide; a cut-off word is the last resort
    var detail = parts.join(' \u00b7 ');
    while (parts.length > 1 && emWidth(detail, false, false) * z.detail > (pw - inset) * TEXT_FIT) {
      parts = parts.slice(0, -1);
      detail = parts.join(' \u00b7 ');
    }
    y += Math.round(z.detail * 1.55);
    lines.push({ x: pw - inset, y: y, s: z.detail, a: 'end', fs: 'normal', fw: 'normal', t: fitText(detail, z.detail, (pw - inset) * TEXT_FIT, false, false) });
  }
  return { vw: Math.round(pw), vh: y + Math.round(z.detail * 0.5), lines: lines };
}

/** The corner placard of Full screen: left-aligned lines inside a plate. Returns { vw, vh, lines }. */
function plateLabel(art, slotW, slotH) {
  var z = sizesFor(slotH), pad = Math.round(z.title * 0.45), maxW = (Math.round(slotW * 0.6) - 2 * pad) * TEXT_FIT;
  var lines = [], y = pad, i;
  var titleLines = wrapText(art.title, z.title, maxW / BOLD, 2, false, false); // the title is bold
  for (i = 0; i < titleLines.length; i++) { y += Math.round(z.title * 1.15); lines.push({ x: pad, y: y, s: z.title, a: 'start', fs: 'normal', fw: 'bold', t: titleLines[i] }); }
  var who = (art.artist || '') + (art.year ? ', ' + art.year : '');
  if (who) { y += Math.round(z.artist * 1.4); lines.push({ x: pad, y: y, s: z.artist, a: 'start', fs: 'normal', fw: 'normal', t: fitText(who, z.artist, maxW, false, false) }); }
  if (art.collection && slotH >= 240) { y += Math.round(z.artist * 1.35); lines.push({ x: pad, y: y, s: z.artist, a: 'start', fs: 'normal', fw: 'normal', t: fitText(art.collection, z.artist, maxW, false, false) }); }
  var widest = 0;
  lines.forEach(function (l) { widest = Math.max(widest, emWidth(l.t, false, false) * l.s * (l.fw === 'bold' ? BOLD : 1)); });
  var vw = Math.min(Math.round(slotW * 0.6), Math.round(widest + 2 * pad));
  return { vw: vw, vh: y + pad, lines: lines, pct: Math.min(60, Math.ceil(100 * vw / slotW)) };
}

/**
 * Gallery geometry of one slot: percent sizes of the picture box (the Framework has whole-percent sizes only; the pair
 * nearest the work's shape is taken and the picture covers its box, so an error of a fraction of a percent is cropped,
 * never a gap), and the label. withLabel false: the picture alone, centred.
 */
function galleryFor(art, slotW, slotH, withLabel) {
  var aspect = art.w / art.h;
  var pw = Math.min(GALLERY_SHARE * slotW, GALLERY_SHARE * slotH * aspect), label = null, i;
  for (i = 0; i < 3; i++) { // the label wraps by the picture's width, the picture's size leaves room for the label
    label = withLabel ? galleryLabel(art, slotH, pw) : null;
    var gap = withLabel ? Math.round(slotH * 0.018) : 0;
    var phMax = Math.min(GALLERY_SHARE * slotH, GALLERY_USE * slotH - (label ? label.vh + gap : 0));
    pw = Math.min(GALLERY_SHARE * slotW, phMax * aspect);
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
  if (withLabel) out.label = galleryLabel(art, slotH, out.pw);
  return out;
}

function artOf(work, shard, set, scr) {
  var art = {
    id: work.i, title: work.t, artist: work.a, year: work.y === undefined ? '' : String(work.y),
    collection: work.c === undefined ? '' : shard.col[work.c], movement: work.m === undefined ? '' : shard.mov[work.m],
    medium: work.e === undefined || !shard.med ? '' : shard.med[work.e], size: work.z || null,
    mat: work.n ? 'black' : 'white', w: work.w, h: work.h, link: 'https://www.wikidata.org/wiki/' + work.i,
  };
  var geo = {}, v;
  if (set.presentation === 'gallery') {
    for (v in VIEWS) geo[v] = galleryFor(art, Math.round(scr.w * VIEWS[v][0]), Math.round(scr.h * VIEWS[v][1]), set.label !== 'off');
    art.width = thumbWidth(work.w, work.h, geo.full.pw, geo.full.ph, 'fill');
    art.fit = 'cover';
  } else {
    for (v in VIEWS) geo[v] = set.label === 'off' ? null : plateLabel(art, Math.round(scr.w * VIEWS[v][0]), Math.round(scr.h * VIEWS[v][1]));
    art.width = thumbWidth(work.w, work.h, scr.w, scr.h, set.fit);
    art.fit = set.fit === 'fill' ? 'cover' : 'contain';
  }
  art.url = thumbUrl(work.f, art.width);
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
    if (prev && prev.art && prev.art.url) { out.art = prev.art; out.geo = prev.geo; }
    else out.notice = 'The artwork list could not be loaded. The next refresh tries again.';
    out.debug = String(err && err.message ? err.message : err);
    return out;
  }
  var idx = choose(shard, { fit: set.presentation === 'full' ? set.fit : 'fill', aspect: scr.w / scr.h, movement: set.movement }, state.h, Math.random);
  var work = shard.w[idx];
  state.h.push(qnum(work.i));
  state.h = state.h.slice(-HISTORY);
  var made = artOf(work, shard, set, scr);
  return { art: made.art, geo: made.geo, settings: set, trmnl_state: state };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    run: run, md5: md5, thumbUrl: thumbUrl, thumbWidth: thumbWidth, choose: choose, weightOf: weightOf, screenOf: screenOf,
    settingsOf: settingsOf, validShard: validShard, galleryFor: galleryFor, plateLabel: plateLabel, fitText: fitText, wrapText: wrapText,
    emWidth: emWidth, artOf: artOf, HISTORY: HISTORY, SHARDS: SHARDS,
  };
}
