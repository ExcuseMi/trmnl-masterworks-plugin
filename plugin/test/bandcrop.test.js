import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const t = createRequire(import.meta.url)('../src/transform.js');

// a band covers its box: it is only taken when it crops at most FILL_CROP_MAX of the work (Boudin, 2.23:1, was cut 23 % on the X)
const SCREENS = { f: [2560, 1440], x: [1872, 1404], o: [800, 480] };
const SET = { strip: true, blocks: { date: true, weather: true, agenda: true, events: 2, n: 3 }, label: true };
const dir = new URL('../../data/', import.meta.url);
const works = readdirSync(dir).filter((f) => /^landscape-\d+\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).w);

test('no band plan on the X, the OG or the Frame crops more than 15 % of any work', () => {
  const bad = [];
  for (const w of works) {
    if (w.w / w.h < 16 / 9) continue;
    for (const [key, [sw, sh]] of Object.entries(SCREENS)) {
      const p = t.framePlan({ w: w.w, h: w.h, kind: 'big', title: 't', artist: 'a', collection: 'c' }, sw, sh, SET, key);
      if (p.layout !== 'band') continue;
      const c = 1 - Math.min(1, (w.w / w.h) / ((p.artw * sw) / (p.arth * sh)), ((p.artw * sw) / (p.arth * sh)) / (w.w / w.h));
      if (c > 0.15 + 1e-9) bad.push(`${w.i} ${key} ${(100 * c).toFixed(0)}%`);
    }
  }
  assert.deepStrictEqual(bad.slice(0, 10), [], `${bad.length} bands crop too much`);
});
