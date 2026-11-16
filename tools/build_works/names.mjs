// Collection names for a museum label: Wikidata gives "Department of Paintings of the Louvre" where a label says "Louvre".
export function shortCollection(name) {
  if (!name) return name;
  const short = name.replace(/^Department of [^,]+? (?:of|at|in) (?:the )?/i, '').trim();
  return short.length >= 3 ? short.charAt(0).toUpperCase() + short.slice(1) : name;
}

const ROOMLIKE = /\b(rooms?|halls?|salle|sala|saal|bedroom|floors?|wings?|cabinet|gallery of honou?r|galleries|chamber|corridor|stairs?|vestibule)\b|^room\b|\d{2,}/i;
const INSTITUTION = /museum|musée|museo|museu|rijks|gallery|galleria|galerie|kunst|palace|palazzo|church|chapel|cathedral|basilica|abbey|library|institute|collection|louvre|prado|uffizi|hermitage|getty|orsay|tate|accademia|académie|academy|mauritshuis|belvedere|pinakothek|national/i;

/**
 * Where the work hangs, for the label: the place (P276) when it is an institution and not a room, preferring one that is also
 * a collection of the work; the owning collection otherwise. A room-like place with several collections means the last
 * collection (the host after the owner: The Night Watch is owned by the Amsterdam Museum and hangs in the Rijksmuseum).
 */
export function venueOf({ collections = [], locations = [] }) {
  const colls = collections.map(shortCollection);
  const places = locations.filter((l) => !ROOMLIKE.test(l) && INSTITUTION.test(l)).map(shortCollection);
  const shared = places.find((p) => colls.includes(p));
  if (shared) return shared;
  if (colls.length && !places.length && locations.some((l) => ROOMLIKE.test(l)) && colls.length > 1) return colls[colls.length - 1];
  if (colls.length) return places.find((p) => colls.some((c) => p.includes(c) || c.includes(p))) || (places.length && !colls.length ? places[0] : colls[0]);
  return places[0];
}
