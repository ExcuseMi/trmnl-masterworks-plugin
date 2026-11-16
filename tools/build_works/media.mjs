// A short, readable technique for the museum label from Wikidata's materials ("oil paint", "poplar panel", "gold leaf" arrive
// as a composed text such as "Oil on poplar panel"). Messy or unknown values give '' and the label shows only the place.

const TEXTILE = /canvas|linen|hessian|burlap|jute|cloth|textile/;
const WOOD = /panel|wood|poplar|oak|\bboard\b|plank|walnut|lime/;

/** The normalised technique, or '' when the text is not one we can name with confidence. */
export function normalizeMedium(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return '';
  if (/colou?r lithograph|chromolithograph/.test(s)) return 'Colour lithograph';
  if (/lithograph/.test(s)) return 'Lithograph';
  if (/woodblock|woodcut|nishiki-?e|ukiyo/.test(s)) return 'Woodblock print';
  if (/etching|aquatint/.test(s)) return 'Etching';
  if (/engraving|drypoint|mezzotint|burin/.test(s)) return 'Engraving';
  if (/fresco|secco/.test(s)) return 'Fresco';
  if (/gouache|body ?colou?r/.test(s)) return 'Gouache';
  if (/watercolou?r/.test(s)) return 'Watercolour';
  if (/pastel/.test(s)) return 'Pastel';
  if (/tempera/.test(s)) return WOOD.test(s) || /gesso/.test(s) ? 'Tempera on panel' : 'Tempera';
  if (/acrylic/.test(s)) return 'Acrylic';
  if (/\boil\b/.test(s)) {
    if (TEXTILE.test(s)) return 'Oil on canvas';
    if (WOOD.test(s)) return 'Oil on panel';
    if (/copper/.test(s)) return 'Oil on copper';
    if (/paper|cardboard/.test(s)) return 'Oil on paper';
    return 'Oil painting';
  }
  if (/mixed media|collage/.test(s)) return 'Mixed media';
  if (/\bink\b/.test(s) && /silk/.test(s)) return 'Ink on silk';
  if (/\b(ink|graphite|chalk|charcoal|pencil|crayon|sanguine|pen)\b/.test(s)) return 'Drawing';
  return '';
}
