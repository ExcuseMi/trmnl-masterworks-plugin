// The committed data files: no vandalized titles reach the screen (TRMNL review 2026-11-17: Wikidata's label for
// Q311243 read "Wanderer above the Sea younes non non non ..." and portrait-3.json carried it).
import test from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../../data');
const works = readdirSync(dataDir).filter((f) => /^(landscape|portrait)-\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')).w.map((w) => ({ f, ...w })));

test('every shard has works', () => assert.ok(works.length > 3000));

test('no title has a word repeated three times in a row (vandalism)', () => {
  const bad = works.filter((w) => /\b(\p{L}+)\s+\1\s+\1\b/iu.test(w.t)).map((w) => `${w.f} ${w.i} ${w.t}`);
  assert.deepStrictEqual(bad, []);
});

test('title fixes are in the data', () => {
  assert.ok(works.filter((w) => w.i === 'Q311243').every((w) => w.t === 'Wanderer above the Sea of Fog'));
});
