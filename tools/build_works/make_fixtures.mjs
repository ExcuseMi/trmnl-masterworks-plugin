#!/usr/bin/env node
// Slices data/landscape.json and data/portrait.json into small fixtures for the plugin's specs (no network in tests):
// every Nth work, so famous and obscure, good and poor palette scores are all in.  node tools/build_works/make_fixtures.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from './shards.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEEP = 40;
mkdirSync(join(root, 'plugin', 'tests', 'fixtures'), { recursive: true });
for (const name of ['landscape', 'portrait']) {
  const doc = JSON.parse(readFileSync(join(root, 'data', `${name}.json`), 'utf8'));
  const step = Math.max(1, Math.floor(doc.w.length / KEEP));
  const works = doc.w.filter((_, i) => i % step === 0).slice(0, KEEP).map((w) => ({
    id: w.i, title: w.t, artist: w.a, file: w.f, w: w.w, h: w.h, sl: w.s, score: w.p, year: w.y,
    coll: w.c === undefined ? undefined : doc.col[w.c], mov: w.m === undefined ? undefined : doc.mov[w.m],
  }));
  const { v, built, palette, shard, source } = doc;
  writeFileSync(join(root, 'plugin', 'tests', 'fixtures', `${name}.json`), JSON.stringify(pack(works, { v, built, palette, shard, source })));
}
