import test from 'node:test';
import assert from 'node:assert';
import { GENRES, REVIEWED_FLAGS, genreOf, is2dArtwork, unfriendlyReasons } from '../classify.mjs';
import { latestYear, span, yearInfo } from '../dates.mjs';
import { isPublicDomain } from '../wikidata.mjs';

const reasons = (title, extra = {}) => unfriendlyReasons({ title, ...extra });

test('genres: portrait, landscape, seascape, cityscape, still life, religious, history, mythology, genre scene, other', () => {
  assert.deepStrictEqual(GENRES, ['portrait', 'landscape', 'seascape', 'cityscape', 'still life', 'religious', 'history', 'mythology', 'genre scene', 'nature', 'japanese print', 'modern', 'poster', 'other']);
  assert.strictEqual(genreOf({ title: 'Mona Lisa', genres: ['portrait'] }), 'portrait');
  assert.strictEqual(genreOf({ title: 'Self-Portrait with Fur-Trimmed Robe' }), 'portrait');
  assert.strictEqual(genreOf({ title: 'Wheat Field with Cypresses', genres: ['landscape art'] }), 'landscape');
  assert.strictEqual(genreOf({ title: 'The Fighting Temeraire', genres: ['marine art'] }), 'seascape');
  assert.strictEqual(genreOf({ title: 'View of Delft', genres: ['cityscape'] }), 'cityscape');
  assert.strictEqual(genreOf({ title: 'Still Life with Apples', genres: [] }), 'still life');
  assert.strictEqual(genreOf({ title: 'The Last Supper', genres: ['religious art'] }), 'religious');
  assert.strictEqual(genreOf({ title: 'Madonna of the Goldfinch' }), 'religious');
  assert.strictEqual(genreOf({ title: 'The Coronation of Napoleon', genres: ['history painting'] }), 'history');
  assert.strictEqual(genreOf({ title: 'Diana and Actaeon', genres: ['mythological painting'] }), 'mythology');
  assert.strictEqual(genreOf({ title: 'The Card Players', genres: ['genre art'] }), 'genre scene');
  assert.strictEqual(genreOf({ title: 'Composition VIII' }), 'other');
  assert.ok(GENRES.includes(genreOf({ title: '' })));
});

test('genres of the tiers: poster, Japanese print, nature illustration, modern and abstract, flowers and still life', () => {
  assert.strictEqual(genreOf({ title: 'Moulin Rouge: La Goulue', classes: ['poster'] }), 'poster');
  assert.strictEqual(genreOf({ title: 'Salome', movements: ['Art Nouveau'] }), 'poster');
  assert.strictEqual(genreOf({ title: 'The Kiss', creatorMovements: ['Art Nouveau'], year: 1908 }), 'poster', 'a creator of Art Nouveau, from 1890 on');
  assert.strictEqual(genreOf({ title: 'Fine Wind, Clear Morning', classes: ['woodblock print'], genres: ['meisho-e'] }), 'japanese print', 'a print before a landscape');
  assert.strictEqual(genreOf({ title: 'Kingfisher', genres: ['bird-and-flower painting'] }), 'japanese print');
  assert.strictEqual(genreOf({ title: 'Young Hare', genres: ['animal painting'] }), 'nature');
  assert.strictEqual(genreOf({ title: 'Cactus', classes: ['botanical illustration'] }), 'nature');
  assert.strictEqual(genreOf({ title: 'Composition VII', movements: ['abstract art'] }), 'modern');
  assert.strictEqual(genreOf({ title: 'Dance', movements: ['Fauvism'] }), 'modern');
  assert.strictEqual(genreOf({ title: 'Black Square', creatorMovements: ['Suprematism'], year: 1915 }), 'modern', 'by the creator, from 1900');
  assert.notStrictEqual(genreOf({ title: 'The Large Bathers', creatorMovements: ['Cubism'], year: 1898 }), 'modern', 'Cezanne is listed under Cubism');
  assert.notStrictEqual(genreOf({ title: 'Saturn Devouring His Son', creatorMovements: ['Expressionism'], year: 1820 }), 'modern');
  assert.notStrictEqual(genreOf({ title: 'Starry Night', creatorMovements: ['Expressionism', 'Post-impressionism'], year: 1889 }), 'modern');
  assert.strictEqual(genreOf({ title: 'Sunflowers' }), 'still life');
  assert.strictEqual(genreOf({ title: 'Vase of Flowers', genres: ['floral painting'] }), 'still life');
  assert.notStrictEqual(genreOf({ title: 'View of Arles, Flowering Orchards' }), 'still life', 'flowering is not a flower piece');
});

test('a series fixes the genre of its members', () => {
  assert.strictEqual(genreOf({ title: 'Hamamatsu', classes: ['woodcut print'], series: 'Q243248' }), 'japanese print');
  assert.strictEqual(genreOf({ title: 'Wild Turkey', classes: ['engraving'], series: 'Q377817' }), 'nature');
  assert.strictEqual(genreOf({ title: 'Waterloo Bridge, London, at Dusk', classes: ['painting'], series: 'Q3795196' }), 'cityscape');
  assert.strictEqual(genreOf({ title: 'The Water Lily Pond', classes: ['painting'], series: 'Q1189907' }), 'landscape');
  assert.notStrictEqual(genreOf({ title: 'A woodcut', classes: ['woodcut print'] }), 'japanese print', 'a western woodcut without a series is not');
  assert.strictEqual(genreOf({ title: 'Unknown series', classes: ['painting'], series: 'Q999' }), 'other');
});

test('family friendly: nudity and graphic violence from Wikidata subjects and from titles in several languages', () => {
  assert.deepStrictEqual(reasons('The Birth of Venus', { depicts: ['Venus', 'nudity'] }), ['nudity']);
  assert.deepStrictEqual(reasons('Les Grandes Baigneuses'), ['nudity']);
  assert.deepStrictEqual(reasons('La maja desnuda'), ['nudity']);
  assert.deepStrictEqual(reasons('Olympia'), ['nudity']);
  assert.deepStrictEqual(reasons('Die Badende'), ['nudity']);
  assert.deepStrictEqual(reasons('Judith Beheading Holofernes'), ['violence']);
  assert.deepStrictEqual(reasons('The Third of May 1808', { depicts: ['execution by firing squad'] }), ['violence']);
  assert.deepStrictEqual(reasons('Saturn Devouring His Son'), ['violence']);
  assert.deepStrictEqual(reasons('The Massacre at Chios', { depicts: ['nudity', 'massacre'] }), ['nudity', 'violence']);
  assert.deepStrictEqual(reasons('The Beheading of Saint John the Baptist'), ['violence']);
  assert.deepStrictEqual(reasons('Martyrdom of Saint Sebastian'), ['violence']);
  assert.deepStrictEqual(reasons('Le Massacre des Innocents'), ['violence']);
  assert.deepStrictEqual(reasons('Susanna and the Elders'), ['nudity']);
  assert.deepStrictEqual(reasons('Femme nue tenant un livre'), ['nudity']);
  assert.deepStrictEqual(reasons('La Nue au bain'), ['nudity']);
  assert.deepStrictEqual(unfriendlyReasons({ id: 'Q18331571', title: 'The White and the Black' }), ['nudity'], 'reviewed: a Vallotton nude with no tag');
  assert.deepStrictEqual(reasons('Nuevo Mundo'), [], 'nue is a word, not a part of a word')
  assert.deepStrictEqual(reasons('The Rape of the Sabine Women'), ['nudity', 'violence']);
});

test('family friendly: the words inside other words do not count (drapery, grape), nor a planet, nor Wikidata\'s weak nudity tag on a religious picture', () => {
  assert.deepStrictEqual(reasons('The Milkmaid', { depicts: ['drapery'] }), []);
  assert.deepStrictEqual(reasons('Luncheon of the Boating Party', { depicts: ['grape'] }), []);
  assert.deepStrictEqual(reasons('The White House at Night', { depicts: ['Venus'], genre: 'landscape' }), [], 'Venus in a night sky is the planet');
  assert.deepStrictEqual(reasons('Rokeby', { depicts: ['dimples of Venus'] }), [], 'an anatomy feature');
  assert.deepStrictEqual(reasons('Madonna Litta', { depicts: ['nudity', 'Virgin Mary'], genre: 'religious' }), [], 'the infant Jesus');
  assert.deepStrictEqual(reasons('Madonna Litta', { depicts: ['breastfeeding'] }), []);
  assert.deepStrictEqual(reasons('A Sunday Afternoon', { depicts: ['bathing'] }), []);
  assert.deepStrictEqual(reasons('The Anatomy Lesson', { depicts: ['nudity'] }), ['nudity'], 'the weak tag still counts on a non-religious work');
  assert.deepStrictEqual(reasons('The Fortress', { depicts: ['embattled hill', 'unmurdered'] }), [], 'a word that merely contains a violent one');
  assert.deepStrictEqual(reasons('Sunflowers'), []);
  assert.deepStrictEqual(reasons('Irises'), []);
});

test('family friendly: reviewed flags and every Last Judgment', () => {
  assert.deepStrictEqual(unfriendlyReasons({ id: 'Q215486', title: 'Vitruvian Man' }), ['nudity']);
  assert.deepStrictEqual(unfriendlyReasons({ id: 'Q212616', title: 'The Raft of the Medusa' }), ['violence']);
  assert.ok(Object.keys(REVIEWED_FLAGS).length >= 5);
  assert.deepStrictEqual(reasons('The Last Judgment'), ['nudity']);
  assert.deepStrictEqual(reasons('Das Jüngste Gericht'), ['nudity']);
});

test('only 2D artworks: no petroglyph, sculpture, relief', () => {
  assert.ok(!is2dArtwork(['petroglyph']));
  assert.ok(!is2dArtwork(['relief']));
  assert.ok(!is2dArtwork(['painting', 'sculpture']));
  assert.ok(!is2dArtwork(['rock art']));
  assert.ok(is2dArtwork(['painting']));
  assert.ok(is2dArtwork(['fresco', 'woodblock print']));
  assert.ok(is2dArtwork([]));
});

test('dates: a statement with earliest/latest qualifiers beats a century value (the Last Judgment is 1536-41, not 1600)', () => {
  const lastJudgment = [{ t: 1600, precision: 7, earliest: 1536, latest: 1541 }];
  assert.deepStrictEqual(yearInfo(lastJudgment), { year: 1536, label: '1536–41' });
  assert.deepStrictEqual(span(lastJudgment[0]), [1536, 1541]);
  assert.strictEqual(yearInfo([{ t: 1642, precision: 9 }]).label, '1642');
  assert.strictEqual(yearInfo([{ t: 1503, precision: 8, earliest: 1503, latest: 1506 }]).label, '1503–06');
  assert.strictEqual(yearInfo([{ t: 1500, precision: 7 }]).label, '15th century');
  assert.strictEqual(yearInfo([{ t: 1450, precision: 8 }]).label, '1450s');
  assert.strictEqual(yearInfo([{ t: 1467, precision: 9 }, { t: 1469, precision: 9 }]).label, '1467');
  assert.strictEqual(yearInfo([{ t: -500, precision: 9 }]).label, '500 BC');
  assert.deepStrictEqual(yearInfo([]), { year: undefined, label: '' });
  assert.strictEqual(yearInfo([{ t: 1799, precision: 7, earliest: 1790, latest: 1810 }]).label, '1790–1810', 'across a century: the full end year');
});

test('dates: the public-domain year is the latest a date allows (a century is its last year)', () => {
  assert.strictEqual(latestYear([{ t: 1600, precision: 7, earliest: 1536, latest: 1541 }]), 1541);
  assert.strictEqual(latestYear([{ t: 1900, precision: 7 }]), 1900);
  assert.strictEqual(latestYear([{ t: 1930, precision: 8 }]), 1939);
  assert.strictEqual(latestYear([]), undefined);
  const d = (years) => ({ rights: [], years, creators: [{ id: 'Q1', name: 'A', death: [1942], mov: [] }] });
  assert.ok(isPublicDomain(d([latestYear([{ t: 1930, precision: 9 }])]), 2026), '1930 passes in 2026');
  assert.ok(!isPublicDomain(d([latestYear([{ t: 1930, precision: 8 }])]), 2026), 'the 1930s decade ends in 1939: not provably public domain');
  assert.ok(!isPublicDomain(d([latestYear([{ t: 2000, precision: 7 }])]), 2026), 'a 20th-century work');
});
