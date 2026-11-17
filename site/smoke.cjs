// Smoke test for the demo page. Usage: node site/smoke.cjs [url] [--shots=/dir]
// Needs Playwright (PLAYWRIGHT=/path/to/playwright) and the network (frame, Framework CSS, Commons pictures).
// Checks: the page loads; an artwork draws inside the Frame, X and OG; Next gives a different work; no console errors;
// no horizontal scroll at 390 px; the page's options equal plugin/src/settings.yml.
const path = require('path'), fs = require('fs'), http = require('http'), cp = require('child_process');
const root = path.join(__dirname, '..');
const pwPath = process.env.PLAYWRIGHT || ['/home/dev/workspace/hamley-life/node_modules/playwright', 'playwright'].find((p) => { try { require.resolve(p); return true; } catch (e) { return false; } });
const pw = require(pwPath);
const args = process.argv.slice(2);
const shots = (args.find((a) => a.startsWith('--shots=')) || '').slice(8);
const given = args.find((a) => /^https?:/.test(a));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.yml': 'text/plain', '.liquid': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  const srv = http.createServer((q, r) => {
    const p = q.url.split('?')[0];
    const f = path.join(root, p === '/' ? 'index.html' : p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

// the artwork inside the frame: the screen document with a loaded picture
async function artOf(page) {
  for (let i = 0; i < 60; i++) {
    for (const f of page.frames()) {
      try {
        const r = await f.evaluate(() => {
          const im = document.querySelector('.screen img');
          return im ? { ok: im.complete && im.naturalWidth > 0, src: im.currentSrc || im.src } : null;
        });
        if (r && r.ok) return r.src;
      } catch (e) { /* frame gone */ }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

(async () => {
  const fails = [];
  const s = given ? null : await serve();
  const base = given || s.url;
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) fails.push('console.error: ' + m.text().slice(0, 160)); });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#genres input') && document.querySelector('#cap').dataset.id, null, { timeout: 30000 }).catch(() => fails.push('page did not draw a first artwork'));

  // options come from settings.yml
  // settings.yml is read line by line (no YAML library needed): the "  - Label: value" lines under a field's options:
  const lines = fs.readFileSync(path.join(root, 'plugin/src/settings.yml'), 'utf8').split('\n');
  const optionsOf = (key) => {
    const out = []; let on = false, inField = false;
    for (const l of lines) {
      if (/^- keyname: /.test(l)) { inField = l.trim() === '- keyname: ' + key; on = false; continue; }
      if (!inField) continue;
      if (/^  options:/.test(l)) { on = true; continue; }
      if (on) { if (/^  - /.test(l)) out.push(l.slice(4)); else break; }
    }
    return out;
  };
  const f = { genres: { options: optionsOf('genres') }, movement: { options: optionsOf('movement') } };
  if (f.genres.options.length < 5 || f.movement.options.length < 5) fails.push('smoke could not read the options from settings.yml');
  const vals = (o) => o.map((x) => x.slice(x.lastIndexOf(': ') + 2));
  const pageGenres = await page.$$eval('#genres input', (e) => e.map((x) => x.value));
  const pageMov = await page.$$eval('#movement option', (e) => e.map((x) => x.value));
  if (JSON.stringify(pageGenres) !== JSON.stringify(vals(f.genres.options))) fails.push('genres differ from settings.yml');
  if (JSON.stringify(pageMov) !== JSON.stringify(vals(f.movement.options))) fails.push('periods differ from settings.yml');

  const seen = new Set();
  for (const dev of ['frame', 'x', 'og']) {
    await page.click(`#device button[data-v="${dev}"]`);
    const src = await artOf(page);
    const id = await page.$eval('#cap', (c) => c.dataset.id);
    if (!src) { fails.push(dev + ': no picture drawn in the frame'); continue; }
    const model = await page.$eval('#frame', (e) => e.getAttribute('model'));
    if (model !== dev) fails.push(dev + ': frame model is ' + model);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'wide-' + dev + '.png'), fullPage: true }); }
    seen.add(id);
    console.log(dev + ' ok ' + id);
  }
  // Next gives a different work, five times in a row, none repeated
  const ids = [];
  await page.click('#device button[data-v="frame"]');
  await artOf(page);
  for (let i = 0; i < 5; i++) {
    const before = await page.$eval('#cap', (c) => c.dataset.id);
    await page.waitForSelector('#next:not([disabled])');
    await page.click('#next');
    await page.waitForFunction((b) => document.querySelector('#cap').dataset.id !== b, before, { timeout: 20000 }).catch(() => fails.push('Next did not change the work'));
    const after = await page.$eval('#cap', (c) => c.dataset.id);
    if (ids.includes(after) || after === before) fails.push('Next repeated ' + after);
    ids.push(after);
    if (!(await artOf(page))) fails.push('no picture after Next ' + i);
  }
  // walnut colour and a genre filter still draw
  await page.click('#color button[data-v="walnut"]');
  await page.check('#genres input[value="japanese_prints"]');
  await page.waitForTimeout(500);
  if (!(await artOf(page))) fails.push('no picture with Japanese prints ticked');

  // phone width: no horizontal scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) fails.push('horizontal scroll at 390 px: ' + over + ' px');
  if (shots) await page.screenshot({ path: path.join(shots, 'phone-frame.png'), fullPage: true });
  await page.uncheck('#genres input[value="japanese_prints"]');
  await page.click('#device button[data-v="og"]');
  await artOf(page);
  if (shots) await page.screenshot({ path: path.join(shots, 'phone-og.png'), fullPage: true });

  await browser.close();
  if (s) s.srv.close();
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('smoke ok');
})();
