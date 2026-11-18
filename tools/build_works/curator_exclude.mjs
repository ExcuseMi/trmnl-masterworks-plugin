// The curator's sure quality exclusions (trmnl-masterworks-server, CLIP pass): a museum photograph of the work, a chart or
// label instead of the picture, or a blur below the threshold. Owner 2026-11-18: they leave the data set; the doubtful ones
// (`doubt` has "quality") stay. A crop the curator proposes is not applied: the data has no crop field yet.
// Refresh: node tools/build_works/curator_exclude.mjs ../trmnl-masterworks-server/index/index-export.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), 'curator-exclude.json');

/** The index export rows -> { qid: reason }, sorted by qid. */
export function exclusions(rows) {
  const out = {};
  for (const r of [...rows].sort((a, b) => (a.qid < b.qid ? -1 : 1))) if (r.cur && r.cur.exclude) out[r.qid] = r.cur.exclude;
  return out;
}

export const loadExclusions = (path = SNAPSHOT) => JSON.parse(readFileSync(path, 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = exclusions(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  writeFileSync(SNAPSHOT, JSON.stringify(s) + '\n');
  console.error(`${Object.keys(s).length} exclusions written to ${SNAPSHOT}`);
}
