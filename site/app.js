(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var E = window.MWEngine;
  var WOODS = ['white-oak', 'cherry', 'sapele', 'walnut'];
  var S = { device: 'frame', color: 'white-oak', state: { h: [] }, engine: null, cfg: null, token: 0, lastUrl: null, shards: {} };

  // The plugin's data shards are read from this site first (same repository, same origin), the mirrors only if that fails.
  function dataFetch(url, init) {
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
      label: String($('label').checked), family_friendly: String($('family_friendly').checked),
      genres: [].filter.call($('genres').querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; }),
      movement: $('movement').value
    };
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

  // keep the shown works in memory so "Next" does not repeat; the plugin's own history (transform state) does the choosing
  async function show(keepState) {
    var my = ++S.token;
    $('next').disabled = true;
    try {
      var data = await S.engine.compute({ device: S.device, fields: fields(), state: S.state, fetch: dataFetch });
      if (my !== S.token) return;
      if (!data.art) throw new Error(data.notice || 'no artwork');
      S.state = data.trmnl_state || S.state;
      var markup = await S.engine.renderView(data);
      var html = S.engine.pageHtml(markup, { device: S.device, framework: S.fw });
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      var fr = newFrame();
      fr.setAttribute('src', url);
      if (S.lastUrl) setTimeout(function (u) { URL.revokeObjectURL(u); }.bind(null, S.lastUrl), 4000);
      S.lastUrl = url;
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
      if (S.device === 'frame' && !isWood) S.color = 'white-oak';
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
    buildControls(settings);
    S.engine = E.create({ Liquid: window.liquidjs.Liquid, plugin: { templates: E.templatesOf(r[1]), full: r[2], transform: r[3] } });
    bindSeg('device', 'device'); bindSeg('color', 'color');
    syncButtons();
    $('next').addEventListener('click', function () { show(); });
    ['label', 'family_friendly', 'movement'].forEach(function (id) { $(id).addEventListener('change', function () { show(); }); });
    var go = function () { show(); };
    if (window.customElements && customElements.get('trmnl-frame')) go(); else customElements.whenDefined('trmnl-frame').then(go);
  }).catch(function (e) { $('cap').textContent = 'The page could not load its files: ' + e.message; });
})();
