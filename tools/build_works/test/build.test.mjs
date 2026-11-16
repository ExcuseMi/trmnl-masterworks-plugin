import test from 'node:test';
import assert from 'node:assert';
import { composeMedium, cutoffs, isPublicDomain, sizeCm, yearOf } from '../wikidata.mjs';
import { md5Path, thumbUrl, usable } from '../commons.mjs';
import { hexToRgb, scoreRgb, FALLBACK_PALETTE, TRMNL_CONTRAST_ARGS } from '../palette.mjs';
import { normalizeMedium } from '../media.mjs';
import { shortCollection, venueOf } from '../names.mjs';
import { groupMovement, pickMovement } from '../movements.mjs';
import { aspect, landscapeOf, pack, portraitOf, splitParts } from '../shards.mjs';

const d = (o) => ({ rights: [], creators: [], years: [], ...o });
const cr = (...death) => ({ id: 'Q1', name: 'A', death, mov: [] });

const Y = 2026; // the build year of the examples; cut-offs: died 1955 or earlier, made 1930 or earlier

test('cut-offs follow the build year', () => {
  assert.deepStrictEqual(cutoffs(2026), { diedBy: 1955, madeBy: 1930 });
  assert.deepStrictEqual(cutoffs(2027), { diedBy: 1956, madeBy: 1931 });
});

test('public domain, US rule: American Gothic (1930, Grant Wood died 1942) passes in 2026, a 1931 work does not', () => {
  assert.ok(isPublicDomain(d({ years: [1930], creators: [cr(1942)] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1931], creators: [cr(1942)] }), Y));
  assert.ok(isPublicDomain(d({ years: [1931], creators: [cr(1942)] }), 2027), 'the same work a year later');
  assert.ok(!isPublicDomain(d({ years: [1931], rights: ['Q19652'], creators: [cr(1942)] }), Y), 'a P6216 statement does not lift the US date rule');
});

test('public domain, life rule: died 1955 or earlier in 2026; the Wikidata statement stands in for a missing death date', () => {
  assert.ok(isPublicDomain(d({ years: [1600], creators: [cr(1955)] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1600], creators: [cr(1956)] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1600], creators: [cr()] }), Y), 'no death date: not provable');
  assert.ok(isPublicDomain(d({ years: [1600], rights: ['Q19652'], creators: [cr()] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1600], creators: [cr(1700), cr(1980)] }), Y), 'every creator must qualify');
  assert.ok(!isPublicDomain(d({ years: [1600], rights: ['Q50423863'], creators: [cr(1500)] }), Y), 'a rights statement without public domain rules out');
});

test('public domain: no creator only when dated before 1850; no date only when every creator died before 1900', () => {
  assert.ok(isPublicDomain(d({ years: [1400] }), Y));
  assert.ok(!isPublicDomain(d({ years: [1900] }), Y));
  assert.ok(!isPublicDomain(d({}), Y));
  assert.ok(isPublicDomain(d({ creators: [cr(1850)] }), Y));
  assert.ok(!isPublicDomain(d({ creators: [cr(1930)] }), Y));
});

test('years parse, also negative ones', () => {
  assert.strictEqual(yearOf('1503-01-01T00:00:00Z'), 1503);
  assert.strictEqual(yearOf('-0500-01-01T00:00:00Z'), -500);
  assert.strictEqual(yearOf('nonsense'), undefined);
});

test('md5 path and thumb URL (checked on upload.wikimedia.org: Mona Lisa is e/ec)', () => {
  assert.strictEqual(md5Path('Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg'), 'e/ec');
  assert.match(thumbUrl('Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg', 120), /\/thumb\/e\/ec\/Mona_Lisa%2C_by_.*\/120px-Mona_Lisa%2C_by_/);
});

test('TIFF thumbnails use the lossy JPEG leaf; the same rule as the plugin', () => {
  assert.match(thumbUrl('A b.tif', 120), /\/A_b\.tif\/lossy-page1-120px-A_b\.tif\.jpg$/);
  assert.match(thumbUrl('A b.jpg', 120), /\/A_b\.jpg\/120px-A_b\.jpg$/);
});

test('thumb URL: apostrophe and parentheses in rawurlencode form', () => {
  assert.match(thumbUrl("Tiziano's Venere (1538).jpg", 120), /\/Tiziano%27s_Venere_%281538%29\.jpg\/120px-Tiziano%27s_Venere_%281538%29\.jpg$/);
});

test('usable: bitmaps with a long side of 1500 px or more', () => {
  assert.ok(usable({ bitmap: true, w: 1500, h: 900 }));
  assert.ok(!usable({ bitmap: true, w: 1499, h: 900 }));
  assert.ok(!usable({ bitmap: false, w: 5000, h: 5000 }));
  assert.ok(!usable(undefined));
});

test('palette score: 0 for an exact ink, grows with distance, 1 at most; near-black share counted', () => {
  assert.strictEqual(scoreRgb(Buffer.from([255, 0, 0, 0, 0, 0]), FALLBACK_PALETTE).error, 0);
  const grey = scoreRgb(Buffer.from([128, 128, 128]), FALLBACK_PALETTE).error;
  const pink = scoreRgb(Buffer.from([255, 150, 150]), FALLBACK_PALETTE).error;
  assert.ok(grey > 0.1 && grey < 0.5, String(grey));
  assert.ok(pink > 0 && pink < grey + 0.2);
  assert.ok(Number.isNaN(scoreRgb(Buffer.alloc(0), FALLBACK_PALETTE).error));
  assert.deepStrictEqual(hexToRgb('#FFFF00'), [255, 255, 0]);
  // 3 of 4 pixels have V < 0.2 (max channel below 51)
  assert.strictEqual(scoreRgb(Buffer.from([10, 10, 10, 50, 0, 0, 0, 40, 0, 200, 200, 200]), FALLBACK_PALETTE).dark, 0.75);
  assert.strictEqual(scoreRgb(Buffer.from([51, 0, 0]), FALLBACK_PALETTE).dark, 0, 'V = 0.2 is not below it');
});

test('the TRMNL contrast step is the one trmnlp applies (HSV brightness, sigmoidal 5,50%)', () => {
  assert.deepStrictEqual(TRMNL_CONTRAST_ARGS.join(' '), '-colorspace HSV -channel B -sigmoidal-contrast 5,50% +channel -colorspace sRGB');
});

test('shards: aspect ranges overlap near square; pack shares collection and movement tables', () => {
  const ws = [
    { id: 'Q1', title: 'wide', artist: 'a', file: 'a.jpg', w: 3000, h: 2000, sl: 10, score: 0.2, dark: 0.1, coll: 'Louvre', mov: 'Baroque', year: 1600 },
    { id: 'Q2', title: 'tall', artist: 'b', file: 'b.jpg', w: 2000, h: 3000, sl: 9, score: 0.3, coll: 'Louvre' },
    { id: 'Q3', title: 'square', artist: 'c', file: 'c.jpg', w: 2000, h: 2000, sl: 8, score: 0.4, mov: 'Baroque' },
  ];
  assert.deepStrictEqual(landscapeOf(ws).map((x) => x.id), ['Q1', 'Q3']);
  assert.deepStrictEqual(portraitOf(ws).map((x) => x.id), ['Q2', 'Q3']);
  assert.ok(aspect(ws[0]) > 1);
  const p = pack(ws, { v: 1 });
  assert.deepStrictEqual(p.col, ['Louvre']);
  assert.deepStrictEqual(p.mov, ['Baroque']);
  assert.strictEqual(p.n, 3);
  assert.deepStrictEqual(p.w[0], { i: 'Q1', t: 'wide', a: 'a', f: 'a.jpg', w: 3000, h: 2000, s: 10, p: 0.2, k: 0.1, y: 1600, c: 0, m: 0 });
  assert.strictEqual(p.w[1].m, undefined);
});

test('movements fold into broad groups; the first mappable label wins; unknown labels stay', () => {
  assert.strictEqual(groupMovement('High Renaissance'), 'Renaissance');
  assert.strictEqual(groupMovement('Early Netherlandish painting'), 'Renaissance');
  assert.strictEqual(groupMovement('Flemish Baroque painting'), 'Baroque');
  assert.strictEqual(groupMovement('Dutch Golden Age painting'), 'Dutch Golden Age');
  assert.strictEqual(groupMovement('Post-impressionism'), 'Post-Impressionism');
  assert.strictEqual(groupMovement('Impressionism'), 'Impressionism');
  assert.strictEqual(groupMovement('Hudson River school'), 'Realism');
  assert.strictEqual(pickMovement(['woodblock printing in Japan', 'Japonisme']), 'Ukiyo-e');
  assert.strictEqual(pickMovement(['Japonisme', 'ukiyo-e']), 'Ukiyo-e');
  assert.strictEqual(pickMovement(['Kasei culture']), 'Kasei culture');
  assert.strictEqual(pickMovement([]), undefined);
});

test('museum label: material and size', () => {
  assert.strictEqual(composeMedium(['oil paint', 'canvas']), 'Oil on canvas');
  assert.strictEqual(composeMedium(['tempera', 'poplar panel', 'gold leaf']), 'Tempera and gold leaf on poplar panel');
  assert.strictEqual(composeMedium(['woodblock print']), 'Woodblock print');
  assert.strictEqual(composeMedium([]), undefined);
  assert.deepStrictEqual(sizeCm([0.794], [0.534]), [79.4, 53.4]);
  assert.deepStrictEqual(sizeCm([0.26], [0.38]), [26, 38]);
  assert.strictEqual(sizeCm([0.7], []), undefined, 'both or neither');
  assert.strictEqual(sizeCm([900], [1]), undefined, 'a 90 km painting is a data error');
});

test('parts: each stays near the byte limit; a work goes to Q-number mod parts; nothing lost or doubled', () => {
  const big = Array.from({ length: 1600 }, (_, k) => ({ id: 'Q' + (k + 1), title: 'Work number ' + k, artist: 'An Artist', file: `Some long file name for work ${k}.jpg`, w: 3000, h: 2000, sl: 10, score: 0.2, dark: 0.1 }));
  const parts = splitParts(big, { v: 1 });
  assert.ok(parts.length >= 2);
  for (const part of parts) assert.ok(JSON.stringify(pack(part, { v: 1 })).length < 110000);
  assert.strictEqual(parts.flat().length, 1600);
  parts.forEach((part, k) => part.forEach((x) => assert.strictEqual(Number(x.id.slice(1)) % parts.length, k)));
  assert.strictEqual(splitParts(big.slice(0, 20), { v: 1 }).length, 1);
});

test('pack: material table, size, dark-mat flag', () => {
  const p = pack([{ id: 'Q1', title: 't', artist: 'a', file: 'f.jpg', w: 2, h: 1, sl: 1, score: 0.1, dark: 0, medium: 'Oil on canvas', size: [77, 53], dm: true }, { id: 'Q2', title: 't', artist: 'a', file: 'g.jpg', w: 2, h: 1, sl: 1, score: 0.1, dark: 0 }], { v: 1 });
  assert.deepStrictEqual(p.med, ['Oil on canvas']);
  assert.deepStrictEqual([p.w[0].e, p.w[0].z, p.w[0].n], [0, [77, 53], 1]);
  assert.deepStrictEqual([p.w[1].e, p.w[1].z, p.w[1].n], [undefined, undefined, undefined]);
});

test('collection names: department prefixes are dropped, real museum names stay', () => {
  assert.strictEqual(shortCollection('Department of Paintings of the Louvre'), 'Louvre');
  assert.strictEqual(shortCollection('Department of Prints and Drawings at the British Museum'), 'British Museum');
  assert.strictEqual(shortCollection('The Metropolitan Museum of Art'), 'The Metropolitan Museum of Art');
  assert.strictEqual(shortCollection('Museum of Fine Arts, Boston'), 'Museum of Fine Arts, Boston');
  assert.strictEqual(shortCollection(undefined), undefined);
});

test('where it hangs: the institution of P276 (not a room), else the collection; the host after the owner', () => {
  const v = (collections, locations = []) => venueOf({ collections, locations });
  assert.strictEqual(v(['Department of Paintings of the Louvre'], ['Salle des \u00c9tats, Louvre']), 'Louvre', 'a room: the collection');
  assert.strictEqual(v(['Department of Paintings of the Louvre'], ['Room 700']), 'Louvre');
  assert.strictEqual(v(['Amsterdam Museum', 'Rijksmuseum'], ['Nightwatch hall']), 'Rijksmuseum', 'The Night Watch');
  assert.strictEqual(v(['Rijksmuseum'], ['Gallery of Honour']), 'Rijksmuseum');
  assert.strictEqual(v(["Gallerie dell'Accademia"], ['Venice']), "Gallerie dell'Accademia", 'a city is not a venue');
  assert.strictEqual(v(['Vatican Museums', 'Sistine Chapel'], ['Vatican City', 'Sistine Chapel']), 'Sistine Chapel');
  assert.strictEqual(v(["Mus\u00e9e d'Orsay"], ['Luxembourg Museum', "Mus\u00e9e d'Orsay", 'Galerie nationale du Jeu de Paume']), "Mus\u00e9e d'Orsay", 'a place that is also a collection wins');
  assert.strictEqual(v([], ['Sompo Museum of Art', 'private collection']), 'Sompo Museum of Art', 'no collection: the first institution');
  assert.strictEqual(v([], []), undefined);
  assert.strictEqual(v(['Uffizi Gallery'], ['Bedroom of Lorenzo il Magnifico of Palazzo Medici', 'Uffizi Gallery']), 'Uffizi Gallery');
});

test('technique for the label: a short readable form, unknown or messy left out', () => {
  const n = normalizeMedium;
  assert.strictEqual(n('Oil on canvas'), 'Oil on canvas');
  assert.strictEqual(n('Oil, hessian'), 'Oil on canvas');
  assert.strictEqual(n('Oil on poplar panel'), 'Oil on panel');
  assert.strictEqual(n('Oil on oak panel'), 'Oil on panel');
  assert.strictEqual(n('Oil on copper'), 'Oil on copper');
  assert.strictEqual(n('Oil on cardboard'), 'Oil on paper', 'cardboard is not a board of wood');
  assert.strictEqual(n('Oil on board'), 'Oil on panel');
  assert.strictEqual(n('Oil'), 'Oil painting');
  assert.strictEqual(n('Tempera, gesso'), 'Tempera on panel');
  assert.strictEqual(n('Tempera and gold leaf on poplar panel'), 'Tempera on panel');
  assert.strictEqual(n('Fresco'), 'Fresco');
  assert.strictEqual(n('Watercolor on paper'), 'Watercolour');
  assert.strictEqual(n('Gouache on paper'), 'Gouache');
  assert.strictEqual(n('Woodblock print'), 'Woodblock print');
  assert.strictEqual(n('Colour woodblock print'), 'Woodblock print');
  assert.strictEqual(n('Etching'), 'Etching');
  assert.strictEqual(n('Engraving'), 'Engraving');
  assert.strictEqual(n('Lithograph on paper'), 'Lithograph');
  assert.strictEqual(n('Colour lithograph'), 'Colour lithograph');
  assert.strictEqual(n('Chromolithograph'), 'Colour lithograph');
  assert.strictEqual(n('Pastel on paper'), 'Pastel');
  assert.strictEqual(n('Pen and ink on paper'), 'Drawing');
  assert.strictEqual(n('Mixed media on canvas'), 'Mixed media');
  assert.strictEqual(n('Prussian blue on paper'), '', 'a pigment alone is not a technique');
  assert.strictEqual(n('Hessian'), '');
  assert.strictEqual(n(''), '');
  assert.strictEqual(n(undefined), '');
});
