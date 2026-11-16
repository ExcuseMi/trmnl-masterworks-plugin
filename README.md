# Masterworks (TRMNL plugin)

A famous public-domain artwork on your TRMNL, a new one at every refresh. Made for the TRMNL Frame (2560x1440, 6-colour e-paper); works on every model, view and orientation.

## What it shows

3,838 public-domain works, about 3,440 of them with Family friendly on: paintings, prints, drawings, posters and nature illustrations.

| Genre | Works | Genre | Works |
|---|---|---|---|
| Portraits | 566 | Everyday scenes | 247 |
| Religious | 548 | Flowers and still life | 241 |
| Landscapes | 535 | Cities | 219 |
| Other | 294 | Nature illustration | 191 |
| Modern and abstract | 277 | Mythology | 154 |
| Posters and Art Nouveau | 260 | Japanese prints | 113 |
| Seas | 104 | History | 89 |

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

The plugin decides per work and per view, with no setting.

| When | Look |
|---|---|
| A fill would crop less than 5 % of the work (`AUTO_CROP_MAX`, 0.05) | Full screen, with a small placard in the picture's bottom-left corner: a solid plate, black on a dark corner and white on a light one, a thin solid edge, a margin to the picture's edges |
| Otherwise | The whole work in a gallery: a pure white or black mat (by the work's brightness), a thin bevel line in the opposite colour, the label right-aligned under the picture |

A work takes up to 80 % of the dimension that is not its limit; a panorama may take up to 92 % of the width, a tall work up to 88 % of the height, always with room for the label. The label has three lines: title, ARTIST and year, then technique and where the work hangs (the museum, not a room), for example `Oil on canvas · Rijksmuseum`. The build names the technique from Wikidata's materials (Oil on canvas, Oil on panel, Tempera on panel, Fresco, Watercolour, Gouache, Woodblock print, Etching, Engraving, Lithograph, Colour lithograph, Drawing, Pastel, Mixed media...); a material it cannot name is left out and the line shows only the place. Size stays in the data, not on the label.

## Settings

| Group | Setting | Default | Values |
|---|---|---|---|
| Display | Museum label | On | On or off |
| Selection | Family friendly | On | Leaves out works whose subject is nudity or graphic violence |
| Selection | Genres | Nothing ticked (the default mix) | A multiple choice: Landscapes and seas, Cities, Flowers and still life, Nature illustration, Japanese prints, Modern and abstract, Posters and Art Nouveau, Religious, History and mythology, Everyday scenes, Portraits. Several ticked: works of any of them, by fame. Too few works of the ticked kinds: the default mix for that refresh |
| Selection | Period | All | Ten movements, such as Renaissance, Baroque, Impressionism |

## The Frame

The Frame's screen classes are `screen screen--color-6a screen--frame screen--md screen--density-1x` with `--screen-w: 2560px`. TRMNL gives it `md`, not `lg` (a bug), and the Framework has no variant for a device class, so `lg:` prefixes never reach it. One marked branch in `plugin/src/shared.liquid` gives the Frame (`trmnl.device.model == "frame"`, or a reported side of 2200 px or more) the largest Framework text sizes. When TRMNL fixes the class, that branch becomes `lg:` prefixes. All text and layout use Framework classes: no `style=`, no `<style>`, and every text element carries its own colour class.

The picture's width is the browser's choice (`srcset` with `sizes`), so a wrongly reported device does not blur it.

## Data

| Part | What |
|---|---|
| Sources | Wikidata (works, fame, genre, subjects, dates, where they hang) and Wikimedia Commons (the images), found through QLever with query.wikidata.org as the fallback. No hosting of our own |
| Files | `data/landscape-N.json` and `data/portrait-N.json`, parts of about 100 kB; a run fetches one part, chosen at random. `data/works.json` is the whole set |
| Mirrors | The same files are asked from all of these at once (`DATA_BASES`), and the newest valid answer wins (HTML, an error status or a wrong shape is ignored): `raw.githubusercontent.com/ExcuseMi/trmnl-masterworks-plugin/main/data/`, `cdn.jsdelivr.net/gh/ExcuseMi/trmnl-masterworks-plugin@main/data/`, `excusemi.github.io/trmnl-masterworks-plugin/data/` (GitHub Pages), `cdn.statically.io/gh/ExcuseMi/trmnl-masterworks-plugin@main/data/`. With none answering, the last work is shown again, else a short message |
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
