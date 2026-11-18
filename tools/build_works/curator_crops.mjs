// The curator's crops (trmnl-masterworks-server, curator/pixels.py crop_box): a scanner bed, a mount or a pale paper margin
// round the work. The plugin shows only the box. The snapshot is made from the server's index-export.json (`cur.cropf`:
// x, y, w, h as shares of the archived picture, which is the Commons file scaled).
// Refresh: node tools/build_works/curator_crops.mjs ../trmnl-masterworks-server/index/index-export.json
// Put the snapshot into the built shards without a rebuild: node tools/build_works/curator_crops.mjs --apply
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT = join(here, 'curator-crops.json');
export const CROP_UNIT = 10000; // the box is written in 1/10000 of the picture's width and height
export const CROP_MIN_SIDE = 0.5; // a box under half of a side is a wrong measure, not a margin (the curator trims 25 % a side at most)

/** [x, y, w, h] in 1/CROP_UNIT from the curator's shares, or null when the box is missing, whole or out of bounds. */
export function boxOf(cropf) {
  if (!Array.isArray(cropf) || cropf.length !== 4 || !cropf.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [x, y, w, h] = cropf.map((v) => Math.round(v * CROP_UNIT));
  if (x < 0 || y < 0 || w < CROP_MIN_SIDE * CROP_UNIT || h < CROP_MIN_SIDE * CROP_UNIT || x + w > CROP_UNIT || y + h > CROP_UNIT) return null;
  return w === CROP_UNIT && h === CROP_UNIT ? null : [x, y, w, h];
}

/** The index export rows -> { qid: [file, x, y, w, h] }, sorted by qid; the file is the Commons file the box was measured on. */
export function crops(rows) {
  const out = {};
  for (const r of [...rows].sort((a, b) => (a.qid < b.qid ? -1 : 1))) {
    const b = boxOf(r.cur && r.cur.cropf);
    if (b && r.src_file) out[r.qid] = [r.src_file, ...b];
  }
  return out;
}

/** The box of one work, only when the data shows the file the curator measured (another scan has other margins). */
export function cropFor(snapshot, id, file) {
  const c = snapshot[id];
  if (!c || c[0] !== file) return null;
  const b = c.slice(1);
  return boxOf(b.map((v) => v / CROP_UNIT)) ? b : null;
}

export const loadCrops = (path = SNAPSHOT) => JSON.parse(readFileSync(path, 'utf8'));

/** Sets or removes the crop key (x) of every work of one packed shard; returns how many works carry one. */
export function applyTo(doc, snapshot) {
  let n = 0;
  for (const w of doc.w) {
    const b = cropFor(snapshot, w.i, w.f);
    if (b) { w.x = b; n++; } else delete w.x;
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--apply') {
    const dir = join(here, '..', '..', 'data'), snap = loadCrops();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (!Array.isArray(doc.w)) continue;
      const n = applyTo(doc, snap);
      writeFileSync(join(dir, f), JSON.stringify(doc));
      console.error(`${f}: ${n} crops`);
    }
  } else {
    const s = crops(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    writeFileSync(SNAPSHOT, JSON.stringify(s) + '\n');
    console.error(`${Object.keys(s).length} crops written to ${SNAPSHOT}`);
  }
}
