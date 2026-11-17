// "As on the device": runs inside the plugin's screen document (the page puts its source into the document).
// Follows trmnlp 0.34.1 TRMNL::ImageQuantizer: greys (X 16, OG 4) are a Gray conversion, then Floyd-Steinberg to evenly spaced levels;
// colour panels (Frame, palette color-6a) get an HSV brightness sigmoidal-contrast 5,50% first, then Floyd-Steinberg to the palette.
// The picture is dithered at its displayed (device pixel) size; the inks are then shown the way the panel looks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MWLook = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function inScreen(cfg) {
    var PAL = cfg.palette, INK = cfg.inks, LEVELS = cfg.levels;
    var st = document.createElement('style');
    st.textContent = 'img.image-dither:not([data-mw-look]){visibility:hidden}img.image-dither[data-mw-look]{image-rendering:auto!important}';
    document.head.appendChild(st);

    function sig(x) { return 1 / (1 + Math.exp(-x)); }
    // ImageMagick -sigmoidal-contrast 5,50% on the V channel of HSV
    function contrast(d) {
      var c = 5, m = 0.5, lo = sig(-c * m), k = sig(c * (1 - m)) - lo;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, v = Math.max(r, g, b);
        if (v <= 0) continue;
        var nv = (sig(c * (v - m)) - lo) / k, f = nv / v;
        d[i] = Math.round(Math.min(1, r * f) * 255); d[i + 1] = Math.round(Math.min(1, g * f) * 255); d[i + 2] = Math.round(Math.min(1, b * f) * 255);
      }
    }
    // Floyd-Steinberg, serpentine; pal: array of [r,g,b]; out: ink colours per palette entry
    function dither(d, w, h, pal, out) {
      var n = pal.length, err = new Float32Array(w * h * 3);
      for (var i = 0, j = 0; i < d.length; i += 4, j += 3) { err[j] = d[i]; err[j + 1] = d[i + 1]; err[j + 2] = d[i + 2]; }
      for (var y = 0; y < h; y++) {
        var rev = y & 1, x0 = rev ? w - 1 : 0, dx = rev ? -1 : 1;
        for (var s = 0, x = x0; s < w; s++, x += dx) {
          var p = (y * w + x) * 3, r = err[p], g = err[p + 1], b = err[p + 2], best = 0, bd = 1e12;
          for (var k = 0; k < n; k++) {
            var q = pal[k], e0 = r - q[0], e1 = g - q[1], e2 = b - q[2], dd = e0 * e0 + e1 * e1 + e2 * e2;
            if (dd < bd) { bd = dd; best = k; }
          }
          var c = pal[best], er = r - c[0], eg = g - c[1], eb = b - c[2], o = (y * w + x) * 4, ink = out[best];
          d[o] = ink[0]; d[o + 1] = ink[1]; d[o + 2] = ink[2]; d[o + 3] = 255;
          var xn = x + dx, xp = x - dx;
          if (xn >= 0 && xn < w) { var t = p + dx * 3; err[t] += er * 7 / 16; err[t + 1] += eg * 7 / 16; err[t + 2] += eb * 7 / 16; }
          if (y + 1 < h) {
            var u = p + w * 3;
            if (xp >= 0 && xp < w) { var a = u - dx * 3; err[a] += er * 3 / 16; err[a + 1] += eg * 3 / 16; err[a + 2] += eb * 3 / 16; }
            err[u] += er * 5 / 16; err[u + 1] += eg * 5 / 16; err[u + 2] += eb * 5 / 16;
            if (xn >= 0 && xn < w) { var z = u + dx * 3; err[z] += er / 16; err[z + 1] += eg / 16; err[z + 2] += eb / 16; }
          }
        }
      }
    }
    var greyPal = null, greyOut = null;
    if (LEVELS) { greyPal = []; greyOut = []; for (var i = 0; i < LEVELS; i++) { var v = Math.round(i * 255 / (LEVELS - 1)); greyPal.push([v, v, v]); greyOut.push([v, v, v]); } }

    function process(img) {
      if (img.dataset.mwLook || img.dataset.mwBusy || !img.offsetWidth || !img.naturalWidth) return;
      img.dataset.mwBusy = '1';
      var src = img.currentSrc || img.src, fit = getComputedStyle(img).objectFit;
      var bw = img.offsetWidth, bh = img.offsetHeight;
      var fresh = new Image(); fresh.crossOrigin = 'anonymous';
      fresh.onload = function () {
        try {
          var nw = fresh.naturalWidth, nh = fresh.naturalHeight, w = bw, h = bh;
          if (fit === 'contain' || fit === 'scale-down') { var sc = Math.min(bw / nw, bh / nh); w = Math.max(1, Math.round(nw * sc)); h = Math.max(1, Math.round(nh * sc)); }
          var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          var cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingQuality = 'high';
          if (fit === 'cover') { var s2 = Math.max(bw / nw, bh / nh), sw = bw / s2, sh = bh / s2; cx.drawImage(fresh, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, w, h); }
          else cx.drawImage(fresh, 0, 0, w, h);
          var id = cx.getImageData(0, 0, w, h), d = id.data;
          if (greyPal) {
            for (var i = 0; i < d.length; i += 4) { var gy = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = gy; }
            dither(d, w, h, greyPal, greyOut);
          } else { contrast(d); dither(d, w, h, PAL, INK); }
          cx.putImageData(id, 0, 0);
          cv.toBlob(function (bl) {
            img.removeAttribute('srcset'); img.dataset.mwLook = cfg.name; img.src = URL.createObjectURL(bl);
            try { parent.postMessage({ mwLook: img.src, w: w, h: h }, '*'); } catch (e) { /* no parent */ }
          }, 'image/png');
        } catch (e) { img.dataset.mwLook = 'failed'; img.style.visibility = 'visible'; }
      };
      fresh.onerror = function () { img.dataset.mwLook = 'failed'; img.style.visibility = 'visible'; };
      fresh.src = src;
    }
    function scan() { [].forEach.call(document.querySelectorAll('img.image-dither'), function (im) { if (im.complete) process(im); else im.addEventListener('load', function () { process(im); }, { once: true }); }); }
    scan(); [200, 800, 2000, 5000].forEach(function (t) { setTimeout(scan, t); });
    addEventListener('load', scan);
  }

  var HEX = function (h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
  // TRMNL's palette color-6a and how each ink looks on a Spectra 6 panel
  var FRAME = { palette: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#000000', '#FFFFFF'].map(HEX), inks: ['#b8322c', '#3f6e4a', '#2f4f8f', '#e3c82a', '#1a1a1a', '#e8e6df'].map(HEX) };
  var CONFIG = { frame: { name: 'frame', palette: FRAME.palette, inks: FRAME.inks }, x: { name: 'x', levels: 16 }, og: { name: 'og', levels: 4 } };
  // the script the page puts into the screen document
  function script(device) { var c = CONFIG[device]; return c ? '<script>(' + inScreen.toString() + ')(' + JSON.stringify(c) + ');</script>' : ''; }
  return { script: script, CONFIG: CONFIG };
});
