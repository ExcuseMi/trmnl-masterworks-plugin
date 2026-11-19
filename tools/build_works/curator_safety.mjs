// The curator's safety suspects (trmnl-masterworks-server, CLIP pass). Owner 2026-11-19: only the sure cases hide a work. A work the
// curator flagged gets the family flag; one it found borderline ('doubt') does not (the doubt group hid The Night Watch and The
// Creation of Adam). family-review.json holds the decisions made by looking at the picture and is applied last: 'show' clears the
// flag whatever the data or the curator say, 'hide' sets it. A work stays hidden only when it is clearly not family friendly
// (explicit nudity or gore). Was, owner 2026-11-18: error on the side of caution. The snapshot is made from the server's index-export.json, whose `cur`
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

export const REVIEW = join(dirname(fileURLToPath(import.meta.url)), 'family-review.json');
export const loadReview = (path = REVIEW) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Why a work is not family friendly (none: it shows with Family friendly on). dataReasons: from Wikidata's subjects and the titles;
 * suspect: the curator's 'flag' or 'doubt'; review: 'show', 'hide' or nothing (family-review.json).
 */
export function familyReasons(dataReasons, suspect, review) {
  if (review === 'show') return [];
  const r = [...(dataReasons || []), ...(suspect === 'flag' ? ['curator flag'] : [])];
  return review === 'hide' && !r.length ? ['review'] : r;
}
