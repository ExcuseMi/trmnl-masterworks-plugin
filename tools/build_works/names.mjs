// Collection names for a museum label: Wikidata gives "Department of Paintings of the Louvre" where a label says "Louvre".
export function shortCollection(name) {
  if (!name) return name;
  const short = name.replace(/^Department of [^,]+? (?:of|at|in) (?:the )?/i, '').trim();
  return short.length >= 3 ? short.charAt(0).toUpperCase() + short.slice(1) : name;
}
