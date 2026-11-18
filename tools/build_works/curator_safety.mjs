// The curator's safety suspects (trmnl-masterworks-server, CLIP pass): a work it flagged, or found borderline, gets the family flag.
// Owner 2026-11-18: error on the side of caution. The snapshot is made from the server's index-export.json, whose `cur`
// already has the owner's overrides.json applied last (an override that clears flag and doubt un-flags the work).
// Refresh: node tools/build_works/curator_safety.mjs ../trmnl-masterworks-server/index/index-export.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), 'curator-safety.json');

/** 'flag' (curator proposes nudity or violence), 'doubt' (safety borderline) or null, from one work's curator result. */
export const suspectOf = (cur) => (!cur ? null : cur.flag ? 'flag' : (cur.doubt || []).includes('safety') ? 'doubt' : null);

/** The index export rows -> { qid: 'flag' | 'doubt' }, sorted by qid. */
export function suspects(rows) {
  const out = {};
  for (const r of [...rows].sort((a, b) => (a.qid < b.qid ? -1 : 1))) { const s = suspectOf(r.cur); if (s) out[r.qid] = s; }
  return out;
}

export const loadSuspects = (path = SNAPSHOT) => JSON.parse(readFileSync(path, 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = suspects(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  writeFileSync(SNAPSHOT, JSON.stringify(s) + '\n');
  console.error(`${Object.keys(s).length} suspects written to ${SNAPSHOT}`);
}
