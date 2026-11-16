// Palette score: how far a work's colours are from the nearest ink of a TRMNL colour palette. No dithering here:
// TRMNL dithers on its side; this only ranks works that suit the panel's inks better.
import { execFile } from 'node:child_process';
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

/** Mean distance from every pixel of an RGB buffer (3 bytes a pixel) to its nearest ink, 0 (exact) to 1. */
export function scoreRgb(buf, inks) {
  const rgb = inks.map(hexToRgb);
  let sum = 0;
  const n = Math.floor(buf.length / 3);
  if (!n) return NaN;
  for (let i = 0; i < n; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    let best = Infinity;
    for (const [pr, pg, pb] of rgb) {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / n / MAX_DIST;
}

/** Download the small thumbnail of a Commons file and score it. Returns a number, or throws. */
export async function scoreFile(file, inks) {
  const res = await politeFetch(thumbUrl(file, SCORE_WIDTH), {}, { pauseMs: 150, tries: 4, timeoutMs: 60000 });
  const img = Buffer.from(await res.arrayBuffer());
  const child = run('convert', ['-[0]', '-colorspace', 'sRGB', '-background', 'white', '-alpha', 'remove', '-resize', '128x128>', '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 4 << 20 });
  child.child.stdin.end(img);
  const { stdout } = await child;
  return scoreRgb(stdout, inks);
}
