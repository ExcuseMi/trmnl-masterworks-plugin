// Dates of a work from Wikidata's inception statements. A statement is a value with a precision (9 year, 8 decade, 7 century)
// and often "earliest" / "latest" date qualifiers: the Last Judgment is "1600" at century precision with 1536 and 1541 as the
// qualifiers, so it is 1536-41, not 1600.

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;

/** The first and last year a statement can mean. A century (precision 7, +1600) is 1501 to 1600; a decade 1500 to 1509. */
export function span(d) {
  if (d.earliest !== undefined || d.latest !== undefined) {
    const a = d.earliest ?? d.latest, b = d.latest ?? d.earliest;
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (d.precision === 7) return [d.t - 99, d.t];
  if (d.precision === 8) return [d.t, d.t + 9];
  return [d.t, d.t];
}

/** The latest year any statement allows: the date the public-domain test must use. */
export function latestYear(dates) {
  return dates.length ? Math.max(...dates.map((d) => span(d)[1])) : undefined;
}

const bc = (y) => (y < 0 ? `${-y} BC` : String(y));

/** What the label says: "1503", "1536–41", "1500s", "16th century"; { year, label }. */
export function yearInfo(dates) {
  if (!dates.length) return { year: undefined, label: '' };
  const ranked = [...dates].sort((a, b) => (b.earliest !== undefined) - (a.earliest !== undefined) || b.precision - a.precision || a.t - b.t);
  const d = ranked[0];
  const [a, b] = span(d);
  const hasQualifier = d.earliest !== undefined || d.latest !== undefined;
  if (hasQualifier && a !== b) {
    const end = String(b);
    const short = a > 0 && Math.floor(a / 100) === Math.floor(b / 100) && b - a < 100 ? end.slice(-2) : end;
    return { year: a, label: `${bc(a)}–${a > 0 ? short : bc(b)}` };
  }
  if (hasQualifier) return { year: a, label: bc(a) };
  if (d.precision >= 9) return { year: d.t, label: bc(d.t) };
  if (d.precision === 8) return { year: d.t, label: `${d.t}s` };
  if (d.precision === 7) return { year: d.t - 50, label: `${ordinal(Math.ceil(d.t / 100))} century` };
  return { year: d.t, label: `c. ${bc(d.t)}` };
}
