// Genre and family-friendliness of a work, from Wikidata labels (genre P136, instance of P31, depicts P180) and the title.
// The depicts labels are matched on the server (a regular expression in the query) so only the few that matter come back.

export const GENRES = ['portrait', 'landscape', 'seascape', 'cityscape', 'still life', 'religious', 'history', 'mythology', 'genre scene', 'nature', 'japanese print', 'modern', 'poster', 'other'];

// Not for a family screen. Nudity: a depicted nude, bathers, Venus and the other subjects painted as nudes. Violence: the
// depicted act itself (beheading, massacre, execution, martyrdom, murder, rape), battles and war.
const NUDITY = ['nud', 'naked', 'toplessness', 'breast', 'bather', 'bathing', 'odalisque', 'venus', 'aphrodite', 'leda', 'danae', 'susanna', 'bathsheba', 'hylas'];
// (the server-side regular expression is wide on purpose: the exact rules are below, in unfriendlyReasons)
const VIOLENCE = ['behead', 'decapitat', 'massacre', 'execution', 'martyr', 'murder', 'assassinat', 'slaughter', 'torture', 'flaying', 'infanticide', 'battle', 'warfare', 'holofernes', 'devour'];
// Depicted-subject hints for the genre (religious, mythology, history, still life, landscape...).
const HINTS = ['jesus', 'virgin mary', 'madonna', 'saint', 'angel', 'apostle', 'bible', 'biblical', 'crucifixion', 'nativity', 'greek mythology', 'roman mythology', 'mythology', 'still life', 'landscape', 'seascape', 'cityscape', 'portrait'];

// the depicts regular expression for the SPARQL FILTER (RE2, case-insensitive, no escapes needed)
export const DEPICTS_RE = [...NUDITY, ...VIOLENCE, ...HINTS].join('|');

// A title safety net, many languages: words that mean a nude subject or a violent act. Anchored loosely on purpose.
const TITLE_NUDITY = /\b(venus|vénus|nude|nudes|naked|nu couché|nu |desnud\w*|akt|bathers?|baigneuses?|badende\w*|bagnanti|bañistas|bagnante|odalisque|olympia|leda|dan[aë]e|susann?a|suzanne|bathsheba|bethsabée|hylas|sirens?|nymphs?(?![a-zà-ÿ])|nymphes)\b|\bnues?\b|\bfemmes? nues?\b|\bthe source\b|\bla source\b|\brape of\b|\benlèvement\b|\braub der\b|\brapto de\b|\bratto di\b/i;
const TITLE_VIOLENCE = /\b(judith|holofernes|massacres?|executions?|execution of|fusilamientos|martyrs?|martyrdom|martyre|märtyrer|beheading|beheaded|decapitat\w*|salome|saturn devouring|devouring his|flaying|slaughter\w*|murder\w*|the death of marat|the third of may|dos de mayo|tres de mayo|the rape)\b/i;

export const FAMILY_FRIENDLY_REASONS = ['nudity', 'violence'];

// Works a reviewer flagged after reading the top of the list: Wikidata has no nudity or violence tag for them. Each is a
// judgment (the owner can change it): nudes or corpses dominate the picture.
export const REVIEWED_FLAGS = {
  Q215486: 'nudity', // Vitruvian Man
  Q321303: 'nudity', // The Garden of Earthly Delights
  Q2213811: 'nudity', // The Haywain Triptych
  Q844675: 'nudity', // Sistine Chapel ceiling
  Q930535: 'nudity', // Tahitian Women on the Beach
  Q212616: 'violence', // The Raft of the Medusa (corpses, cannibalism)
  Q2293905: 'violence', // Medusa (Caravaggio, the severed head)
  // nudes in the posters and Art Nouveau tier (Wikidata has no tag on them)
  Q18331571: 'nudity', // The White and the Black (Vallotton)
  Q47528815: 'nudity', // The Kiss (Vallotton)
  Q116869771: 'nudity', // Femme nue tenant un livre (Vallotton)
  Q113553121: 'nudity', // Femme nue debout tenant sa chemise a deux mains (Vallotton)
  Q94636886: 'nudity', // Three Women and One Little Girl Playing in the Water (Vallotton)
  Q62274515: 'nudity', // Bathing on a Summer Evening (Vallotton)
  Q28002799: 'nudity', // Adam and Eve (Klimt)
  Q19883512: 'nudity', // Hope II (Klimt)
  Q17001535: 'nudity', // Death and Life (Klimt)
};
// A series flagged as a whole: Goya's Disasters of War (corpses, mutilation, executions) is graphic by its subject, not by a tag.
export const SERIES_FLAGS = { Q1200522: 'violence' };
// Last Judgments show the damned, naked, in hell
const TITLE_JUDGMENT = /\b(last judg(e)?ment|jüngste gericht|jugement dernier|giudizio universale|juicio final)\b/i;

const has = (labels, re) => labels.some((l) => re.test(l));

// Depicted-subject labels that mean a nude or a bather. "nudity" alone is Wikidata's weak tag (a putto, the infant Jesus, a
// background figure): it counts unless the work is also religious by its subjects.
const STRONG_NUDITY = /\b(nudes?|naked|toplessness|topless|bathers?|odalisques?|aphrodite|leda|dan[aë]e|susanna|bathsheba|hylas|female nude|male nude)\b|\bbreasts?\b|\bnude swimming\b/i;
const WEAK_NUDITY = /\bnudity\b/i;
const RELIGIOUS_SUBJECT = /\b(jesus|virgin mary|madonna|saint|angels?|apostles?|bible|biblical|nativity|holy family|magi|crucifixion)\b/i;
const NOT_THE_GODDESS = /dimples of venus|venus effect|venus flytrap|transit of venus|\bplanet\b/i;
const VIOLENCE_SUBJECT = /\b(behead\w*|decapitat\w*|massacres?|execution\w*|executioner|martyr\w*|murder\w*|assassinat\w*|slaughter\w*|tortur\w*|flaying|infanticide|battles?|warfare|holofernes|devour\w*)\b/i;

/** Reasons a work is not family friendly: [] when none. genre: the work's genre (a depicted "Venus" in a landscape is a planet). */
export function unfriendlyReasons({ id = '', title = '', genres = [], depicts = [], genre = '', series }) {
  const out = [];
  if (series && SERIES_FLAGS[series]) out.push(SERIES_FLAGS[series]);
  if (REVIEWED_FLAGS[id]) out.push(REVIEWED_FLAGS[id]);
  const subjects = depicts.filter((d) => !NOT_THE_GODDESS.test(d));
  // "Venus" alone is the goddess or the planet (a night sky): a landscape means the planet; any other label with Venus is the goddess
  const venus = subjects.some((d) => (/^venus$/i.test(d) ? !['landscape', 'cityscape', 'seascape'].includes(genre) : /\bvenus\b/i.test(d)));
  const strong = has(subjects, STRONG_NUDITY) || venus || has(genres, /\b(nude|nudity|odalisque)\b/i) || TITLE_NUDITY.test(title);
  const weak = has(subjects, WEAK_NUDITY) && !has(depicts, RELIGIOUS_SUBJECT) && genre !== 'religious';
  if ((strong || weak || TITLE_JUDGMENT.test(title)) && !out.includes('nudity')) out.push('nudity');
  if (has(subjects, VIOLENCE_SUBJECT) || has(genres, /battle|war art|martyr/i) || TITLE_VIOLENCE.test(title)) out.push('violence');
  return out;
}

// A series fixes the genre of its members: the Edo and Tokaido prints are Japanese prints, the plates of The Birds of America are
// nature illustration, Monet's series are landscapes and cityscapes (their titles say little: "Waterloo Bridge, London, at Dusk").
export const SERIES_GENRE = {
  Q165190: 'japanese print', Q243248: 'japanese print', Q227494: 'japanese print', Q2525862: 'japanese print', Q6724086: 'japanese print',
  Q60228610: 'japanese print', Q340790: 'japanese print', Q2944321: 'japanese print', Q3235562: 'japanese print',
  Q377817: 'nature', Q1423459: 'nature',
  Q1189907: 'landscape', Q557000: 'landscape', Q733458: 'landscape', Q3494409: 'landscape', Q7087213: 'landscape', Q2335084: 'landscape',
  Q637414: 'cityscape', Q468623: 'cityscape', Q3795196: 'cityscape', Q5074352: 'cityscape', Q49985736: 'cityscape', Q18822557: 'cityscape',
};

const RE_POSTER = /\bposters?\b/i, RE_ART_NOUVEAU = /art nouveau|jugendstil|secession|modernisme|liberty style/i;
const RE_JAPANESE = /ukiyo-?e|shin-?hanga|kach[o\u014d]-?e|woodblock print|nishiki-?e|meisho|bird-and-flower painting|sosaku-?hanga/i;
const RE_NATURE = /botanical|scientific illustration|natural history|wildlife art|animal (painting|art)|ornitholog|zoolog|herbal|flora\b|bird illustration/i;
const RE_MODERN = /cubis|abstract|fauv|expressionis|de stijl|suprematis|futuris|orphis|constructivis|vorticis|rayonis/i;
const RE_MODERN_BY_CREATOR = /cubis|abstract art|abstract|fauv|de stijl|suprematis|futuris|orphis|constructivis/i;

/**
 * One of GENRES. Order: poster, Japanese print, nature illustration, modern and abstract (the work's own movement, or its
 * creator's when that is plainly modern: Expressionism counts for a creator only from 1905 on, Van Gogh is listed under it),
 * then portrait, still life, sea, city, landscape, religious, mythology, history, everyday.
 */
export function genreOf({ title = '', genres = [], depicts = [], classes = [], movements = [], creatorMovements = [], year, series }) {
  if (series && SERIES_GENRE[series]) return SERIES_GENRE[series];
  const g = genres.join(' | '), d = depicts.join(' | '), k = classes.join(' | '), m = movements.join(' | '), cm = creatorMovements.join(' | ');
  if (RE_POSTER.test(k + ' | ' + g) || RE_ART_NOUVEAU.test(m)) return 'poster';
  if (RE_JAPANESE.test(g + ' | ' + k + ' | ' + m)) return 'japanese print';
  if (RE_NATURE.test(g + ' | ' + k)) return 'nature';
  // the creator's movements are broad (Cezanne is listed under Cubism, Goya under Expressionism): only for a work made from 1900 on
  const late = year !== undefined && year >= 1900;
  if (RE_MODERN.test(m + ' | ' + g) || (late && RE_MODERN_BY_CREATOR.test(cm)) || (/expressionis/i.test(cm) && year !== undefined && year >= 1905)) return 'modern';
  if (RE_ART_NOUVEAU.test(cm) && year !== undefined && year >= 1890) return 'poster';
  if (/portrait/i.test(g) || /\b(self-?portrait|portrait of|portrait|autoportrait|bildnis|ritratto|retrato)\b/i.test(title) || /portrait/i.test(classes.join(' '))) return 'portrait';
  if (/still life|vanitas|nature morte|stilleben|floral painting/i.test(g) || /\b(flowers?|bouquet|floral|fleurs|blumen|sunflowers|still life|still-life|vanitas|nature morte|stilleben)\b/i.test(title) || /still life/i.test(d)) return 'still life';
  if (/marine|seascape|sea painting/i.test(g) || /\b(seascape|marine|sea|ships?|storm at sea|harbou?r)\b/i.test(title)) return 'seascape';
  if (/cityscape|veduta|urban|townscape|vedute/i.test(g) || /\b(view of|veduta|cityscape|street|rooftops|bridge)\b/i.test(title) && /landscape|cityscape|veduta/i.test(g + d)) return 'cityscape';
  if (/landscape|meisho/i.test(g) || /\b(landscape|paysage|landschaft|paesaggio|paisaje)\b/i.test(title) || /landscape/i.test(d)) return 'landscape';
  if (/religious|christian|biblical|history of religion|icon|altarpiece|nativity|crucifixion|saint|madonna|annunciation|last judgment|last supper|adoration|pietà|holy/i.test(g) || /jesus|virgin mary|madonna|saint|angel|apostle|bible|biblical|crucifixion|nativity/i.test(d) ||
      /\b(madonna|christ|jesus|saint|st\.|virgin|annunciation|nativity|crucifixion|resurrection|last supper|last judgment|adoration|pietà|holy family|magi|baptism|deposition|ascension|assumption|lamentation|altarpiece|john the baptist|mary)\b/i.test(title)) return 'religious';
  if (/mytholog/i.test(g) || /mytholog/i.test(d) || /\b(venus|apollo|diana|zeus|jupiter|juno|hercules|prometheus|bacchus|minerva|orpheus|narcissus|icarus|perseus|medusa|cupid|psyche|europa|danae|leda|saturn|achilles|ulysses|odysseus|aeneas|triumph of)\b/i.test(title)) return 'mythology';
  if (/history painting|historical|battle|war art/i.test(g) || /battle|warfare|coronation/i.test(d) || /\b(battle|coronation|siege|surrender|revolution|execution|death of|oath|crossing|landing|liberty|napoleon|king|queen|emperor)\b/i.test(title)) return 'history';
  if (/genre (painting|art|scene)|everyday|tavern|peasant/i.test(g) || /\b(peasants?|tavern|market|dance|dancing|concert|card players|kitchen|family|lesson|interior|reader|reading|breakfast|dinner|harvest|festival|wedding|party)\b/i.test(title)) return 'genre scene';
  return 'other';
}

const NOT_2D = /petroglyph|rock (art|carving|engraving)|sculpt|relief|statue|installation|ceramic|vase|furniture|jewel/i;

/** Wikidata items of a 2D artwork only: no petroglyph, sculpture, relief... among the classes the item is an instance of. */
export function is2dArtwork(classes) {
  return !classes.some((c) => NOT_2D.test(c));
}
