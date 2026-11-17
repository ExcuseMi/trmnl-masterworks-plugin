# Masterworks (TRMNL plugin)

A famous public-domain artwork on your TRMNL, a new one at every refresh. Made for the TRMNL Frame (2560x1440, 6-colour e-paper); works on every model, view and orientation.

[Live demo](https://excusemi.github.io/trmnl-masterworks-plugin/)

## What it shows

5,000+ public-domain works: paintings, prints, drawings, posters and nature illustrations.

| Genre | Works | Genre | Works |
|---|---|---|---|
| Landscapes | 588 | Everyday scenes | 270 |
| Portraits | 570 | Flowers and still life | 236 |
| Religious | 576 | Mythology | 156 |
| Cities | 414 | Posters and Art Nouveau | 292 |
| Modern and abstract | 433 | Nature illustration | 301 |
| Other | 386 | Japanese prints | 330 |
| Seas | 364 | History | 94 |

## How a work is picked

Random and weighted; the weight is the product of the rows below. The constants are named at the top of `plugin/src/transform.js`.

| Factor | Rule |
|---|---|
| Fame | `max(sitelinks, 10)^0.8`: the number of Wikipedia languages that have an article on the work |
| Genre | Only when no genre is ticked (the default mix): landscapes, seas, cities, nature illustration and Japanese prints 1.5, modern and abstract and posters 1.3, mythology 0.8, flowers and still life, religious, portraits and history 0.5, everyday scenes and other 1 |
| Colour | The worst match to the Frame's six inks is picked 0.75 times as often as the best |
| Dark | Above 45 % near-black pixels (after TRMNL's contrast step) the weight falls as `exp(-6 x excess)` |
| Shape | `exp(-2 x |ln(work aspect / screen aspect)|)`: works shaped like the screen come up more often |
| Repeats | The last 50 works shown are never repeated (their Q-numbers sit in `trmnl_state`, about 400 bytes) |

## How a work is shown

The plugin decides per work and per view; its one display setting is Fill the screen.

| When | Look |
|---|---|
| Label and info off, a fill crops at most 15 % of the work (`FILL_CROP_MAX`; fill off: less than 5 %, `AUTO_CROP_MAX`) | Full screen, nothing over the art |
| Museum label on (no info) | The whole work in a gallery: a pure white or black mat (by the work's brightness), no outline, the label right-aligned under the picture; a view too small for the label has none. Never full screen, never a placard over the art |
| Info on, Frame landscape | A band for works 16:9 and wider (`FRAME_BAND_CROP_MAX`): the work covers the band, the strip in its width: day number, then equal columns with a rule on top (weather, up to two events, the label in regular weight). Any other shape: the whole work with a column on its right (a wall label): date, weather, events at the top, the label at the bottom on the work's bottom edge; work and column are one centred group |
| Info on, other screens | The X, the OG and the Frame in portrait keep the strip (below) |

No outline is drawn around a work on its mat. A work may carry a curator's keyline flag in the data: `lw` = 1 draws a fine line on a white mat, `lb` = 1 on a black one (none by default, never around a work that fills the screen).

A work takes up to 80 % of the dimension that is not its limit; a panorama may take up to 92 % of the width, a tall work up to 88 % of the height, always with room for the label. The label has three lines: title, ARTIST and year, then technique and where the work hangs (the museum, not a room), for example `Oil on canvas · Rijksmuseum`. The build names the technique from Wikidata's materials (Oil on canvas, Oil on panel, Tempera on panel, Fresco, Watercolour, Gouache, Woodblock print, Etching, Engraving, Lithograph, Colour lithograph, Drawing, Pastel, Mixed media...); a material it cannot name is left out and the line shows only the place. Size stays in the data, not on the label.

## Settings

| Group | Setting | Default | Values |
|---|---|---|---|
| (none) | Fill the screen | On | Appears only with the label, the date, the weather and the agenda all off. On: a work whose fill crops at most 15 % (`FILL_CROP_MAX`) fills the screen edge to edge; the rest hang on the mat. Off: only under 5 % (`AUTO_CROP_MAX`) fills |
| (none) | Museum label | On | On or off; on hides Fill the screen |
| Selection | Family friendly | On | Leaves out works whose subject is nudity or graphic violence |
| Selection | Genres | Nothing ticked (the default mix) | A multiple choice: Landscapes and seas, Cities, Flowers and still life, Nature illustration, Japanese prints, Modern and abstract, Posters and Art Nouveau, Religious, History and mythology, Everyday scenes, Portraits. Several ticked: works of any of them, by fame. Too few works of the ticked kinds: the default mix for that refresh |
| Selection | Period | All | Ten movements, such as Renaissance, Baroque, Impressionism |
| Info | Show the date, Show the weather, Show the agenda | Off, off, off | Three independent toggles; the info appears when any part has something to show; each one on hides Fill the screen |
| Info | Weather location, Temperature unit | Empty, Auto | Appear only with Show the weather on. A place name or `lat, lon` (TRMNL does not share a location); Auto is Fahrenheit for a US account language |
| Info | Calendar (ICS link) | Empty | Appears only with Show the agenda on. A private ICS address; a secret: never shown, logged or put in the output |

## The info (date, weather, agenda)

Three toggles, each off by default; any combination lays out only what is on and has something to show (nothing relevant, nothing shown). With any of them on the work hangs on its mat, scaled so it and one strip fit (never cropped, never a placard over it), centred, with equal outer margins; the strip runs under it on one baseline, no hairlines, no headings, three text sizes (the day number, a medium size, a small size).

| Group | Content |
|---|---|
| Left | The day number, then weekday over month (account language and zone, `trmnl.user`) |
| Middle | The weather: temperature over a short forecast (Open-Meteo, no key, English). The agenda replaces it: up to two events, time over text (tomorrow's carry the weekday: "Wed 9:00 AM"; all-day events "All day"; the account language's clock); with both on, the weather and the next single event |
| Right | The museum label: title over "ARTIST . year . museum" (the technique is left out when the info is on) |

The groups stand on the work's edges (when it is at least 55 % of the slot wide and all groups fit there), else on the slot's margins. A group that is off leaves its place empty: nothing re-centres. The museum label goes first when the strip is too narrow, then the text size drops a tier.

| Rule | Detail |
|---|---|
| The Frame has its own path | `trmnl.device.model == "frame"` (or the 2560 x 1440 it reports) takes tier `f` (landscape) or `g` (portrait): Framework sizes by name (day number `value--xxxlarge`, medium `value--large`, small `label--xxlarge`), no outline around the work (the mat alone frames it), a 60 px margin. Every other screen keeps the breakpoint tiers (`INFO_TIERS`); `tests/golden_spec.rb` holds their renders |
| Text sizes | Tiers xl, l, m, s are named by the slot's height in CSS px; `INFO_SIZES` has the strip height, gap, margin and the widths of the groups per tier. A slot lower than 300 CSS px has no info |
| No location from TRMNL | `trmnl.user` has a language, a time zone and an offset, no coordinates: the weather location is a setting, looked up once and kept in the state |
| Weather and calendar are best effort | One request each, run while the data is fetched, a 3.2 s deadline; a failure leaves that part out and never shows an error |
| Calendar size | At most 2 MB is read (a calendar with years of history may be larger: no agenda). Recurring events are expanded for today and tomorrow only: DAILY, WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (also 1MO, -1FR), BYMONTHDAY, BYMONTH; EXDATE, RECURRENCE-ID and STATUS:CANCELLED are honoured. Outlook's Windows time zone names are mapped for the common zones |

## The Frame

The Frame's screen classes are `screen screen--color-6a screen--frame screen--md screen--density-1x` with `--screen-w: 2560px`. TRMNL gives it `md`, not `lg` (a bug), and the Framework has no variant for a device class, so `lg:` prefixes never reach it. One marked branch in `plugin/src/shared.liquid` gives the Frame (`trmnl.device.model == "frame"`, or a reported side of 2200 px or more) the largest Framework text sizes. When TRMNL fixes the class, that branch becomes `lg:` prefixes. All text and layout use Framework classes: no `style=`, no `<style>`, and every text element carries its own colour class.

The picture's width is the browser's choice (`srcset` with `sizes`), so a wrongly reported device does not blur it.

## Data

| Part | What |
|---|---|
| Sources | Wikidata (works, fame, genre, subjects, dates, where they hang) and Wikimedia Commons (the images), found through QLever with query.wikidata.org as the fallback. No hosting of our own |
| Files | `data/landscape-N.json` and `data/portrait-N.json`, parts of about 100 kB; a run fetches one part, chosen at random. `data/works.json` is the whole set |
| Mirrors | The same files are asked from all of these at once (`DATA_BASES`), and the newest valid answer wins (HTML, an error status or a wrong shape is ignored): `raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data/`, `cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data/`, `excusemi.github.io/trmnl-masterworks-plugin/data/` (GitHub Pages), `cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data/`. With none answering, the last work is shown again, else a short message |
| Series | A work that is part of a famous series (Wikidata `part of the series`, or a short curated list) is as famous as the series: Edo, Tokaido and Fuji prints, Birds of America, Monet's Water Lilies and Haystacks and Rouen Cathedral. The series fixes the genre of its members (`SERIES_GENRE`) and, when Wikidata gives a member no date or technique, says the series' (`SERIES_INFO`: Tokaido 1833–34, Edo 1856–59, Fuji 1830–32, Birds of America 1827–38). A swept series gives at most 25 works; the Japanese and Audubon series, whose members all have their own titles, more. One work is kept once: the most famous version of an artist and normalised title, with the flags of all its versions (`dedupe.mjs`). A series print needs 1200 px on its long side (800 x 1200 is what Commons holds), any other work 1500 px |
| Public domain | The creator died at least 70 full years before the build year AND the work is at least 96 years old (EU and US rules; both cut-offs are computed from the build date, 1955 and 1930 in 2026). A date uses the latest year it allows. Wikidata's own public-domain statement never lifts the date rule |
| Images | A bitmap on Commons with a long side of at least 1500 px; thumbnails at 500, 960, 1280 and 1920 px |
| Updates | A monthly GitHub Action (`.github/workflows/build-data.yml`) rebuilds and commits the data |

## Known limits

| Limit | Detail |
|---|---|
| First thumbnails can be slow | An uncached 1920 px thumbnail is generated on first request. If the picture fails (an error event), a backup work swaps in: a second, famous work with its own label, look and mat, hidden until needed and not fetched until then. A request that hangs without an error is not caught, and the screenshot may be taken before the swap; the state records the primary |
| Family friendly is careful, not perfect | It uses Wikidata's subjects, the titles in several languages and a short reviewed list |
| xteink_x3 | The shared base check fails there: the model's screen CSS is 800 px wide inside a 792 px window, so any full-bleed layout overflows |

## Development

```
node tools/build_works/build.mjs                   # builds data/ (Node 22+, ImageMagick)
node --test plugin/test tools/build_works/test     # picker, geometry, build helpers (no network)
cd plugin && trmnlp lint && trmnlp test            # renders every view on several devices, mocked data
~/workspace/trmnl-plugin-checks/bin/check .        # the shared base checks
cd plugin && trmnlp push                           # to TRMNL
```

## Licence

Code: MIT (`LICENSE`). The artworks are in the public domain; a faithful photograph of a two-dimensional public-domain work adds no new copyright (Commons: PD-Art). Each file's page on Commons has the details.
