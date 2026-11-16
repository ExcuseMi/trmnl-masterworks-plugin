// Palette score: how far a work's colours are, after TRMNL's contrast step, from the nearest ink of a TRMNL colour
// palette, and how much of it is near-black. No dithering here: TRMNL dithers on its side; this only ranks works.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { politeFetch } from './http.mjs';
import { thumbUrl } from './commons.mjs';

const run = promisify(execFile);
export const PALETTE_ID = 'color-6a';
// TRMNL's /api/palettes entry for color-6a (checked against the live list at build time)
export const FALLBACK_PALETTE = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#000000', '#FFFFFF'];
export const SCORE_WIDTH = 120; // a standard Commons thumbnail step, about the 128 px asked for
const MAX_DIST = Math.sqrt(3 * 255 * 255);

export async function loadPalette(id = PALETTE_ID) {
  try {
    const res = await politeFetch('https://trmnl.com/api/palettes', {}, { pauseMs: 0, tries: 2, timeoutMs: 15000 });
    const p = (await res.json()).data.find((x) => x.id === id);
    if (p && p.colors && p.colors.length) return p.colors;
  } catch { /* use the constant */ }
  return FALLBACK_PALETTE;
}

export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * What a colour panel does to a picture before it maps pixels to its inks (trmnlp's ImageQuantizer, as TRMNL does it when a
 * page asks for image-dither): a sigmoidal contrast of 5,50% on the HSV brightness channel. Dark pictures lose their
 * shadow detail there, so the score is taken on the picture after this step.
 */
export const TRMNL_CONTRAST_ARGS = ['-colorspace', 'HSV', '-channel', 'B', '-sigmoidal-contrast', '5,50%', '+channel', '-colorspace', 'sRGB'];
export const DARK_V = 0.2; // a pixel below this brightness (V of HSV, 0 to 1) after the contrast step counts as near-black

/** From an RGB buffer (3 bytes a pixel): mean distance to the nearest ink, 0 (exact) to 1, and the share of near-black pixels. */
export function scoreRgb(buf, inks) {
  const rgb = inks.map(hexToRgb);
  let sum = 0, dark = 0;
  const n = Math.floor(buf.length / 3);
  if (!n) return { error: NaN, dark: NaN };
  for (let i = 0; i < n; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    if (Math.max(r, g, b) / 255 < DARK_V) dark++;
    let best = Infinity;
    for (const [pr, pg, pb] of rgb) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return { error: sum / n / MAX_DIST, dark: dark / n };
}

/** Download the small Commons thumbnail of a file into the cache (once); returns its path. Throws when Commons refuses. */
export async function fetchThumb(file, dir) {
  const path = join(dir, createHash('md5').update(file).digest('hex') + '.img');
  if (existsSync(path)) return path;
  const res = await politeFetch(thumbUrl(file, SCORE_WIDTH), {}, { pauseMs: 250, tries: 6, timeoutMs: 60000 });
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/** Score a cached thumbnail: the picture after TRMNL's contrast step, to the nearest ink, plus its near-black share. */
export async function scoreFile(path, inks) {
  const { stdout } = await run('convert', [path + '[0]', '-colorspace', 'sRGB', '-background', 'white', '-alpha', 'remove', '-resize', '128x128>', ...TRMNL_CONTRAST_ARGS, '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 4 << 20 });
  return scoreRgb(stdout, inks);
}
