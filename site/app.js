(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var E = window.MWEngine;
  var WOODS = ['white-oak', 'cherry', 'sapele', 'walnut'];
  var S = { device: 'frame', color: 'walnut', state: { h: [] }, engine: null, cfg: null, token: 0, lastUrl: null, markup: null, look: true, shards: {} };

  // The plugin's data shards are read from this site first (same repository, same origin), the mirrors only if that fails.
  // Sample data for the weather and the agenda (the page has no location and no calendar link). The shapes are the services' own;
  // the temperatures are Celsius and converted when the plugin asks for Fahrenheit. The clock is pinned to 8:00 UTC today.
  var SAMPLE_ICS = 'https://calendar.example.org/sample.ics';
  function sampleNow() { var d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0); }
  function sampleWeather(url) {
    var day = new Date(sampleNow()).toISOString().slice(0, 10), next = new Date(sampleNow() + 864e5).toISOString().slice(0, 10), f = /temperature_unit=fahrenheit/.test(url);
    var cv = function (c) { return f ? Math.round((c * 9 / 5 + 32) * 10) / 10 : c; }, times = [], codes = [];
    for (var h = 0; h < 24; h++) { times.push(day + 'T' + (h < 10 ? '0' : '') + h + ':00'); codes.push(h === 11 || h === 12 ? 61 : h === 13 ? 63 : 3); }
    times.push(next + 'T00:00'); codes.push(3);
    return { current: { time: day + 'T08:00', temperature_2m: cv(7.6), weather_code: 3 }, hourly: { time: times, weather_code: codes },
      daily: { time: [day, next], temperature_2m_max: [cv(11.2), cv(10)], temperature_2m_min: [cv(4.4), cv(3)] } };
  }
  var SAMPLE_CAL = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'DTSTART:20260101T103000Z', 'DTEND:20260101T110000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Bake the pies', 'LOCATION:Kitchen', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2', 'DTSTART:20260101T133000Z', 'DTEND:20260101T140000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Call with Berlin', 'LOCATION:Home office', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  function ok(body) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(body); } }); }

  function dataFetch(url, init) {
    if (url === SAMPLE_ICS) return ok(SAMPLE_CAL);
    if (/geocoding-api\.open-meteo\.com/.test(url)) return ok({ results: [{ name: 'Paris', latitude: 48.85341, longitude: 2.3488, country: 'France' }] });
    if (/api\.open-meteo\.com/.test(url)) return ok(sampleWeather(url));
    var m = /\/data\/([^/?]+)$/.exec(url);
    if (!m) return fetch(url, init);
    var name = m[1];
    if (!S.shards[name]) {
      S.shards[name] = fetch('data/' + name).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
      S.shards[name].catch(function () { delete S.shards[name]; });
    }
    return S.shards[name].then(function (t) {
      return { ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(t)); } };
    }, function () { return fetch(url, init); });
  }

  // settings.yml option "Label: value" -> [label, value]
  function opt(s) { if (s && typeof s === 'object') { var k = Object.keys(s)[0]; return [k, String(s[k])]; }   // YAML reads "Label: value" as a one-key map
    s = String(s); var i = s.lastIndexOf(': '); return i < 0 ? [s, s] : [s.slice(0, i), s.slice(i + 2)]; }

  function buildControls(settings) {
    var f = {};
    settings.custom_fields.forEach(function (c) { f[c.keyname] = c; });
    S.cfg = f;
    $('label-name').textContent = f.label.name;
    $('label').checked = f.label.default === 'true';
    ['fill', 'show_date', 'show_weather', 'show_agenda'].forEach(function (k) { $(k + '-name').textContent = f[k].name; $(k).checked = f[k].default === 'true'; });
    $('unit-name').textContent = f.temperature_unit.name;
    f.temperature_unit.options.forEach(function (o) { var p = opt(o), el = document.createElement('option'); el.value = p[1]; el.textContent = p[0]; $('temperature_unit').appendChild(el); });
    $('temperature_unit').value = String(f.temperature_unit.default);
    $('family-name').textContent = f.family_friendly.name;
    $('family_friendly').checked = f.family_friendly.default === 'true';
    $('genres-name').textContent = f.genres.name;
    $('movement-name').textContent = f.movement.name;
    f.genres.options.forEach(function (o) {
      var p = opt(o), l = document.createElement('label'), i = document.createElement('input');
      i.type = 'checkbox'; i.value = p[1]; i.addEventListener('change', function () { show(); });
      l.appendChild(i); l.appendChild(document.createTextNode(' ' + p[0])); $('genres').appendChild(l);
    });
    f.movement.options.forEach(function (o) {
      var p = opt(o), el = document.createElement('option');
      el.value = p[1]; el.textContent = p[0]; $('movement').appendChild(el);
    });
    $('movement').value = String(f.movement.default);
  }

  function fields() {
    return {
      label: String($('label').checked), fill: String($('fill').checked), show_date: String($('show_date').checked),
      show_weather: String($('show_weather').checked), show_agenda: String($('show_agenda').checked), temperature_unit: $('temperature_unit').value,
      weather_location: 'Paris', ics_url: SAMPLE_ICS, family_friendly: String($('family_friendly').checked),
      genres: [].filter.call($('genres').querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; }),
      movement: $('movement').value
    };
  }

  // as in settings.yml: fill only with nothing else on; the unit only with the weather on
  function syncVisible() {
    $('fill-row').hidden = ['label', 'show_date', 'show_weather', 'show_agenda'].some(function (k) { return $(k).checked; });
    $('unit-row').hidden = !$('show_weather').checked;
  }

  function syncButtons() {
    [].forEach.call($('device').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === S.device)); });
    [].forEach.call($('color').children, function (b) {
      // The Frame comes in TRMNL's four woods; the X and the OG in black or white.
      b.hidden = WOODS.indexOf(b.dataset.v) >= 0 ? S.device !== 'frame' : S.device === 'frame';
      b.setAttribute('aria-pressed', String(b.dataset.v === S.color));
    });
  }

  function newFrame() {   // a new element per device: the component builds its bezel once, for the model it starts with
    var fr = $('frame');
    if (fr.getAttribute('model') !== S.device) {
      var nf = document.createElement('trmnl-frame'); nf.id = 'frame'; nf.setAttribute('model', S.device);
      fr.replaceWith(nf); fr = nf;
    }
    fr.setAttribute('color', S.color);
    return fr;
  }

  function load(fr) {   // the plugin's markup in the screen document; "as on the device" adds the dither script
    var html = S.engine.pageHtml(S.markup, { device: S.device, framework: S.fw, noBleed: S.noBleed, extra: S.look && window.MWLook ? window.MWLook.script(S.device) : '' });
    S.zoom = null; $('zoom').disabled = true;
    var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    fr.setAttribute('src', url);
    if (S.lastUrl) setTimeout(function (u) { URL.revokeObjectURL(u); }.bind(null, S.lastUrl), 4000);
    S.lastUrl = url;
  }

  // keep the shown works in memory so "Next" does not repeat; the plugin's own history (transform state) does the choosing
  async function show(keepState) {
    var my = ++S.token;
    $('next').disabled = true;
    try {
      var data = await S.engine.compute({ device: S.device, fields: fields(), state: S.state, fetch: dataFetch, now: sampleNow() });
      if (my !== S.token) return;
      if (!data.art) throw new Error(data.notice || 'no artwork');
      S.state = data.trmnl_state || S.state;
      var markup = await S.engine.renderView(data);
      S.markup = markup;
      var fr = newFrame();
      load(fr);
      var a = data.art;
      var cap = $('cap'); cap.textContent = '';
      var b = document.createElement('b'); b.textContent = a.title; cap.appendChild(b);
      cap.appendChild(document.createTextNode(' ' + [a.artist, a.year].filter(Boolean).join(', ') + (a.collection ? ' - ' + a.collection : '') + ' '));
      var l = document.createElement('a'); l.href = a.link; l.textContent = 'Wikidata'; cap.appendChild(l);
      cap.dataset.id = a.id;
    } catch (e) {
      $('cap').textContent = 'Could not draw the artwork: ' + (e && e.message || e);
    } finally { if (my === S.token) $('next').disabled = false; }
  }

  function bindSeg(id, key) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      S[key] = b.dataset.v;
      var isWood = WOODS.indexOf(S.color) >= 0;
      if (S.device === 'frame' && !isWood) S.color = 'walnut';
      if (S.device !== 'frame' && isWood) S.color = 'white';
      syncButtons();
      if (key === 'color') { $('frame').setAttribute('color', S.color); return; }
      show();
    });
  }

  Promise.all([
    fetch('plugin/src/settings.yml').then(function (r) { return r.text(); }),
    fetch('plugin/src/shared.liquid').then(function (r) { return r.text(); }),
    fetch('plugin/src/full.liquid').then(function (r) { return r.text(); }),
    fetch('plugin/src/transform.js').then(function (r) { return r.text(); })
  ]).then(function (r) {
    var settings = window.jsyaml.load(r[0]);
    S.fw = String(settings.framework_version);
    S.noBleed = String(settings.no_screen_padding) === 'yes';   // TRMNL then adds screen--no-bleed
    buildControls(settings);
    S.engine = E.create({ Liquid: window.liquidjs.Liquid, plugin: { templates: E.templatesOf(r[1]), full: r[2], transform: r[3] } });
    bindSeg('device', 'device'); bindSeg('color', 'color');
    syncButtons();
    $('next').addEventListener('click', function () { show(); });
    window.addEventListener('message', function (e) {   // the screen document reports its dithered picture
      if (!e.data || !e.data.mwLook || typeof e.data.mwLook !== 'string') return;
      S.zoom = e.data; $('zoom').disabled = false;
    });
    $('zoom').addEventListener('click', function () {
      if (!S.zoom) return;
      var box = $('zoombox'), im = new Image();
      im.src = S.zoom.mwLook; im.style.cssText = 'display:block;image-rendering:pixelated;max-width:none';
      box.textContent = ''; box.appendChild(im);
      $('zoomdlg').showModal();
      box.scrollLeft = Math.max(0, (S.zoom.w - box.clientWidth) / 2); box.scrollTop = Math.max(0, (S.zoom.h - box.clientHeight) / 2);
    });
    $('zoomclose').addEventListener('click', function () { $('zoomdlg').close(); });
    $('look').addEventListener('change', function () { S.look = $('look').checked; if (S.markup) load($('frame')); });
    ['label', 'fill', 'show_date', 'show_weather', 'show_agenda', 'temperature_unit', 'family_friendly', 'movement'].forEach(function (id) { $(id).addEventListener('change', function () { syncVisible(); show(); }); });
    syncVisible();
    var go = function () { show(); };
    if (window.customElements && customElements.get('trmnl-frame')) go(); else customElements.whenDefined('trmnl-frame').then(go);
  }).catch(function (e) { $('cap').textContent = 'The page could not load its files: ' + e.message; });
})();
