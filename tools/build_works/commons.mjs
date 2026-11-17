// Wikimedia Commons: image sizes in batches of 50, thumbnail URLs, md5 path rule.
import { createHash } from 'node:crypto';
import { politeFetch } from './http.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';
export const MIN_LONG_SIDE = 1500;
export const MIN_LONG_SIDE_PRINT = 1200; // Japanese prints in a famous series: Commons holds the Edo views at 800 x 1200; shown in a gallery they are never larger than that
export const THUMB_STEPS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840]; // the only widths Commons serves
const BITMAP_MIME = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/webp']);

/** Underscore form of a file name, as Commons paths use it. */
export const fileKey = (name) => name.replace(/ /g, '_');

/** Directory part of a Commons file URL: first hex digit / first two hex digits of md5(file name with underscores). */
export function md5Path(name) {
  const h = createHash('md5').update(fileKey(name), 'utf8').digest('hex');
  return `${h[0]}/${h.slice(0, 2)}`;
}

/** TIFF files are thumbnailed as JPEG: .../File.tif/lossy-page1-120px-File.tif.jpg (the plain name gives HTTP 400). */
export const isTiff = (name) => /\.tiff?$/i.test(name);

/** PHP rawurlencode form, as Wikipedia pages carry it: encodeURIComponent plus ! ' ( ) * (the CDN already holds thumbnails under this name). */
export const rawurlencode = (f) => encodeURIComponent(f).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function thumbUrl(name, width) {
  const f = fileKey(name);
  const enc = rawurlencode(f);
  const leaf = isTiff(f) ? `lossy-page1-${width}px-${enc}.jpg` : `${width}px-${enc}`;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5Path(f)}/${enc}/${leaf}`;
}

/** Image info for up to 50 file names: Map name -> { w, h, mime } for files that exist as bitmaps. */
export async function fetchImageInfo(names) {
  const body = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'size|mime|mediatype',
    redirects: '1', titles: names.map((n) => `File:${n}`).join('|'),
  });
  const res = await politeFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, { pauseMs: 700 });
  const j = await res.json();
  const q = j.query || {};
  const alias = new Map(); // title as asked -> title in the answer
  for (const n of q.normalized || []) alias.set(n.from, n.to);
  for (const r of q.redirects || []) alias.set(r.from, r.to);
  const byTitle = new Map();
  for (const p of q.pages || []) {
    if (p.missing || !p.imageinfo || !p.imageinfo[0]) continue;
    byTitle.set(p.title, p.imageinfo[0]);
  }
  const out = new Map();
  for (const name of names) {
    let t = `File:${name}`;
    for (let i = 0; i < 3 && alias.has(t); i++) t = alias.get(t); // normalised, then redirected
    const ii = byTitle.get(t);
    if (!ii) continue;
    out.set(name, { file: t.replace(/^File:/, ''), w: ii.width, h: ii.height, mime: ii.mime, bitmap: ii.mediatype === 'BITMAP' && BITMAP_MIME.has(ii.mime) });
  }
  return out;
}

/** Keep a file only when it is a bitmap with a long side of at least MIN_LONG_SIDE. */
export function usable(info, minLongSide = MIN_LONG_SIDE) {
  return !!info && info.bitmap && Math.max(info.w, info.h) >= minLongSide;
}
