// Movement and period labels from Wikidata are many and uneven ("High Renaissance", "Italian Renaissance", "Early
// Netherlandish painting"). The settings filter needs a few broad groups, so known labels are folded into them here;
// a label no rule knows stays as it is.
const RULES = [
  [/dutch golden age/i, 'Dutch Golden Age'],
  [/baroque|caravagg/i, 'Baroque'],
  [/post-?impressionism|neo-?impressionism|pointillism/i, 'Post-Impressionism'],
  [/impressionism/i, 'Impressionism'],
  [/mannerism/i, 'Mannerism'],
  [/renaissance|early netherlandish|quattrocento|cinquecento/i, 'Renaissance'],
  [/rococo/i, 'Rococo'],
  [/neoclassic/i, 'Neoclassicism'],
  [/romanticism/i, 'Romanticism'],
  [/realism|barbizon|hudson river/i, 'Realism'],
  [/symbolism/i, 'Symbolism'],
  [/pre-raphaelite/i, 'Pre-Raphaelite'],
  [/ukiyo-?e|woodblock printing in japan|nishiki-?e/i, 'Ukiyo-e'],
  [/art nouveau|jugendstil/i, 'Art Nouveau'],
  [/expressionism/i, 'Expressionism'],
];

export function groupMovement(label) {
  for (const [re, group] of RULES) if (re.test(label)) return group;
  return undefined;
}

/** The first label that folds into a group, else the first label, else undefined. */
export function pickMovement(labels) {
  for (const l of labels) { const g = groupMovement(l); if (g) return g; }
  return labels[0];
}
