// Runs the plugin's own files in the page: plugin/src/transform.js (fetches the data shards, picks a work) and
// plugin/src/*.liquid (rendered with LiquidJS). Nothing here is a copy of plugin logic.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MWEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEVICES = {
    frame: { model: 'frame', width: 2560, height: 1440, bit_depth: 4, classes: 'screen--frame screen--md screen--color-6a' },
    x: { model: 'v2', width: 1872, height: 1404, bit_depth: 4, classes: 'screen--4bit screen--v2 screen--lg' },
    og: { model: 'og_plus', width: 800, height: 480, bit_depth: 2, classes: 'screen--2bit screen--ogv2 screen--md' }
  };

  // shared.liquid holds named {% template NAME %} blocks; {% render "NAME" %} reads them from here
  function templatesOf(shared) {
    var out = {}, re = /\{%\s*template\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endtemplate\s*%\}/g, m;
    while ((m = re.exec(shared))) out[m[1]] = m[2];
    return out;
  }

  function create(opts) {
    var Liquid = opts.Liquid, plugin = opts.plugin;   // plugin: { templates, full, transform }
    var liquid = new Liquid({
      relativeReference: false, extname: '',
      fs: { readFileSync: function () { return ''; }, existsSync: function () { return true; }, exists: function () { return Promise.resolve(true); },
        readFile: function (f) { return Promise.resolve(plugin.templates[f] || ''); }, resolve: function (r, f) { return f; }, contains: function () { return true; }, sep: '/' }
    });
    // Where Ruby's Liquid (TRMNL) and LiquidJS differ: integer division and rounding half away from zero.
    liquid.registerFilter('divided_by', function (v, d) {
      v = Number(v); d = Number(d);
      return Number.isInteger(v) && Number.isInteger(d) && d !== 0 ? Math.floor(v / d) : v / d;
    });
    liquid.registerFilter('round', function (v, digits) {
      var f = Math.pow(10, digits || 0), x = Number(v);
      return (x < 0 ? -1 : 1) * Math.round(Math.abs(x) * f) / f;
    });

    // o: { device, fields (custom field values), state ({h:[...]}), fetch }
    async function compute(o) {
      var dev = DEVICES[o.device];
      var trmnl = {
        user: { id: 1, locale: 'en-US', time_zone: 'UTC', time_zone_iana: 'UTC', utc_offset: 0 },
        device: { id: 1, friendly_id: 'ABC123', height: dev.height, width: dev.width, model: dev.model, bit_depth: dev.bit_depth, orientation: 'landscape' },
        system: { timestamp_utc: Math.floor(Date.now() / 1000) },
        plugin_settings: { instance_name: 'Masterworks', refresh_interval_minutes: 60, strategy: 'polling', dark_mode: 'no', no_screen_padding: 'yes', custom_fields_values: o.fields },
        state: o.state || {}
      };
      var mod = { exports: {} };
      var run = new Function('fetch', 'module', plugin.transform + '\n;return run;')(o.fetch, mod);
      var out = await run({ trmnl: trmnl });
      var data = Object.assign({}, out, { trmnl: Object.assign({}, trmnl, { state: out.trmnl_state }) });
      return data;
    }

    function renderView(data) { return liquid.parseAndRender(plugin.full, data); }

    function pageHtml(markup, o) {
      var dev = DEVICES[o.device], fw = o.framework;
      // Firefox crashes the tab when the Framework's dither lines (1 px by 2 px tiles in ::before/::after) are drawn inside
      // trmnl-frame; the page draws them as the average grey.
      var dither = '<script>(function(){var st=document.createElement("style");st.textContent=".mw-nd0,.mw-nd1:before,.mw-nd2:after{background-image:linear-gradient(var(--mw-nd),var(--mw-nd))!important;background-size:auto!important;background-position:0 0!important}";document.head.appendChild(st);' +
        'function run(){[].forEach.call(document.querySelectorAll("*"),function(e){["","::before","::after"].forEach(function(p,i){var c=getComputedStyle(e,p),b=c.backgroundSize;' +
        'if(!/^(\\d+(\\.\\d+)?px \\d+(\\.\\d+)?px(, )?)+$/.test(b))return;var t=b.split(", ")[0].split(" ");if(parseFloat(t[0])>4&&parseFloat(t[1])>4)return;' +
        'var m=c.backgroundImage.match(/rgba?\\([^)]*\\)/g)||[],r=0,g=0,u=0,k=0;m.forEach(function(x){var v=x.match(/[\\d.]+/g);r+=+v[0];g+=+v[1];u+=+v[2];k++});if(!k)return;' +
        'e.style.setProperty("--mw-nd","rgb("+Math.round(r/k)+","+Math.round(g/k)+","+Math.round(u/k)+")");e.classList.add("mw-nd"+i)})})}' +
        'run();setTimeout(run,300);setTimeout(run,1500)})();</script>';
      return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<link rel="stylesheet" href="https://trmnl.com/css/' + fw + '/plugins.css" /><script type="module" src="https://trmnl.com/js/' + fw + '/plugins.js"></script>' +
        '<meta name="trmnl-framework-version" content="' + fw + '" /><meta name="trmnl-framework-pinned" content="true" /></head>' +
        // the component's og window is 840x520 around an 800x480 screen: the screen fills the window (X and Frame already match theirs)
        '<style>html,body{margin:0}' + (o.device === 'og' ? '.screen,.screen .view{width:100vw!important;height:100vh!important}' : '') + '</style>' +
        '<body class="trmnl"><div class="screen ' + dev.classes + (o.device === 'x' ? '' : ' screen--1x screen--density-1x') + ' screen--fonts-trmnl' + (o.noBleed ? ' screen--no-bleed' : '') + '"><div class="view view--full">' + markup + '</div></div>' + dither + (o.extra || '') + '</body></html>';
    }
    return { compute: compute, renderView: renderView, pageHtml: pageHtml };
  }
  return { create: create, templatesOf: templatesOf, DEVICES: DEVICES };
});
