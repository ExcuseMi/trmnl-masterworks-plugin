#!/usr/bin/env node
// Slices the data parts (data/landscape-*.json, data/portrait-*.json) into small fixtures for the plugin's specs (no
// network in tests): every Nth work, so famous and obscure, good and poor palette scores, light and dark mats are in.
//   node tools/build_works/make_fixtures.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from './shards.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEEP = 40;
const out = join(root, 'plugin', 'tests', 'fixtures');
mkdirSync(out, { recursive: true });

/** All works of an orientation, unpacked from the part files (each part has its own tables). */
function load(name) {
  const works = [];
  let meta;
  for (const f of readdirSync(join(root, 'data')).filter((x) => new RegExp(`^${name}-\\d+\\.json$`).test(x)).sort()) {
    const doc = JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
    const { v, built, palette, shard, source } = doc;
    meta = { v, built, palette, shard, source };
    for (const w of doc.w) {
      works.push({
        id: w.i, title: w.t, artist: w.a, file: w.f, w: w.w, h: w.h, sl: w.s, score: w.p, dark: w.k, year: w.y,
        coll: w.c === undefined ? undefined : doc.col[w.c], mov: w.m === undefined ? undefined : doc.mov[w.m],
        medium: w.e === undefined ? undefined : doc.med[w.e], size: w.z, dm: !!w.n, dc: !!w.q,
        genre: w.g === undefined ? undefined : doc.gen[w.g], reasons: w.u ? ['flag'] : [], yearLabel: w.yl,
      });
    }
  }
  works.sort((a, b) => b.sl - a.sl);
  return { works, meta };
}

for (const name of ['landscape', 'portrait']) {
  const { works: all, meta } = load(name);
  const step = Math.max(1, Math.floor(all.length / KEEP));
  const works = all.filter((_, i) => i % step === 0).slice(0, KEEP);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(pack(works, { ...meta, parts: 1 })));
  // one work only, for the shared base checks: they compare a light and a dark render of the same screen, and with a
  // random pick the two renders would show different pictures. Not dark, shaped like the screen, as famous as possible,
  // with a material and a size so that the whole label is drawn.
  const target = name === 'landscape' ? 1.5 : 0.7;
  const pick = (pool) => pool.sort((a, b) => Math.abs(a.w / a.h - target) - Math.abs(b.w / b.h - target) || b.sl - a.sl)[0];
  const full = (w) => w.medium && w.size && w.coll;
  writeFileSync(join(out, `one-${name}.json`), JSON.stringify(pack([pick(all.filter((w) => !w.dm && full(w) && w.dark < 0.3))], { ...meta, parts: 1 })));
  // the shapes the automatic choice is tested with: 16:9 fills the Frame; 9:16 fills the portrait Frame
  const shape = name === 'landscape' ? 16 / 9 : 9 / 16;
  const nearest = (pool) => pool.sort((a, b) => Math.abs(Math.log(a.w / a.h / shape)) - Math.abs(Math.log(b.w / b.h / shape)) || b.sl - a.sl)[0];
  writeFileSync(join(out, name === 'landscape' ? 'one-wide-landscape.json' : 'one-tall.json'), JSON.stringify(pack([nearest(all.filter((w) => !w.dm && full(w) && w.dark < 0.3 && !w.reasons.length))], { ...meta, parts: 1 })));
  if (name === 'landscape') {
    const dark = pick(all.filter((w) => w.dm && full(w)));
    writeFileSync(join(out, 'one-dark-landscape.json'), JSON.stringify(pack([dark], { ...meta, parts: 1 })));
    // two works, a light one on a white mat and a dark one on black, for the primary-and-backup specs
    writeFileSync(join(out, 'two-landscape.json'), JSON.stringify(pack([pick(all.filter((w) => !w.dm && full(w) && w.dark < 0.3)), dark], { ...meta, parts: 1 })));
  }
}
