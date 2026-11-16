# Masterworks (TRMNL plugin)

A famous public-domain artwork on your TRMNL, a new one at every refresh, filling the screen. Made for the TRMNL Frame (2560x1440, 6-colour e-paper); works on every model, view and orientation.

| Part | What |
|---|---|
| `data/*.json` | Several thousand public-domain works: the 2,000 best known (paintings, drawings, prints, ranked by Wikidata sitelinks) and genre tiers beyond them (landscapes and seas, cityscapes, flowers and still life, nature illustration, Japanese prints, modern and abstract art, posters and Art Nouveau). Each work has a palette score, material, size, genre, a mat flag and a family-friendly flag. `landscape-N.json` and `portrait-N.json` (parts of about 100 kB, a work in part Q-number mod parts) are what the plugin fetches, one part per refresh; `works.json` is the whole set |
| `tools/build_works/` | Builds the data: Wikidata SPARQL (QLever first), Commons image info, colour score. `node tools/build_works/build.mjs` (Node 22+, ImageMagick `convert`); monthly by `.github/workflows/build-data.yml` |
| `plugin/` | The TRMNL plugin (serverless `transform.js`, Liquid markup, `trmnlp test` specs) |

## Settings

| Group | Setting | Values |
|---|---|---|
| Display | Museum label | On (default) or off |
| Selection | Family friendly | On (default): leaves out works whose subject is nudity or graphic violence |
| Selection | Genres | A multiple choice: Landscapes and seas, Cities, Flowers and still life, Nature illustration, Japanese prints, Modern and abstract, Posters and Art Nouveau, Religious, History and mythology, Everyday scenes, Portraits. Nothing ticked: the default mix. Several ticked: works of any of them, by fame. Too few works of the ticked kinds: the default mix for that refresh (`filters_relaxed` in the model says so) |
| Selection | Period | All, or one of ten movements |

There is no Presentation or Fit setting and no Skip portraits (tick every genre but Portraits instead): the plugin decides per work and per screen.

## How a work is shown

Per work and per view (`geo[view].mode`): when filling the view would crop less than `AUTO_CROP_MAX` (10 %) of the work's area it fills the view, with a small placard in the picture's bottom-left corner (italic title, ARTIST and year in caps, the collection; a plain solid plate, black on a dark corner and white on a light one, with a thin solid edge and a margin to the picture's edges). Otherwise the work hangs whole in the gallery: centred in about 75 % of the width and height on a pure white or black mat (by the work's brightness), a thin bevel line in the opposite colour, a museum label right-aligned under it (title in italic, ARTIST and year, then material, size in cm and where it hangs; missing parts are left out). The same serif is used in both.

Label text is SVG text in the screen's own pixels (the transform computes sizes and cuts long lines): the Frame is `screen--md` at 1x like the OG, so no Framework text class can size type for 2560 px. No `style=` anywhere. A failed picture still leaves the mat and the label (or the placard) on screen.

## How a work is picked

Random, weighted. Weight = `max(sitelinks, 10)^0.8` (fame, the main factor) x genre weight x colour factor (the worst palette match is picked 0.75 times as often as the best) x dark factor (`exp(-6 x (near-black share - 0.45))`, only for very dark works) x a shape factor (`exp(-2 x |ln(work aspect / screen aspect)|)`). The last 50 works shown are never repeated (their Q-numbers sit in `trmnl_state`, about 400 bytes). The constants are named at the top of `plugin/src/transform.js`.

The genre weight applies only to the default mix (no genre ticked), `GENRE_WEIGHT`: landscape, seascape, cityscape, nature illustration and Japanese print 1.5, modern and abstract and poster 1.3, mythology 0.8, history, religious, portrait and flowers and still life 0.5, everyday scenes and other 1. So the default mix shows landscapes, seas, cities, nature illustration, Japanese prints, modern art and posters more often, and flowers and still life, religious art, portraits and history painting less often (lower, not left out). Ticking genres switches the weights off: those works come up by fame alone. The shares of 10,000 simulated default picks are in the commit message of the data round.

The image is a Wikimedia Commons thumbnail at the picture's width. Commons serves only the widths 120, 250, 500, 960, 1280, 1920 and 3840; the plugin asks for the smallest that covers the picture (a step down when it holds 80 % of the width needed), never above 1920 (3840 px files are 2 to 9 MB). The URL is in the form Wikipedia pages use (`'`, `(` and `)` percent-encoded), TIFF files as `lossy-page1-...px-File.tif.jpg`. TRMNL does the dithering; the plugin only marks the image `image-dither`.

## Data rules

- Candidates: the fame list is the items with an image (P18) and at least 7 sitelinks of a class that is painting, print, drawing, fresco, mural, watercolor painting, woodcut print, handscroll, hanging scroll, miniature, painting series or byobu (with subclasses), or exactly a triptych or altarpiece. The tiers take items of those classes (plus illustration, poster, botanical illustration) with a Wikidata genre (P136), movement (P135) or class (P31) of the kind, or whose creator belongs to a modern movement or Art Nouveau, ranked by sitelinks and cut at a cap per tier. QLever (a Wikidata mirror) first, query.wikidata.org as the fallback.
- Only 2D artworks: no petroglyph, sculpture, relief, ceramic, furniture among the classes of the item.
- Build check: the build stops and writes nothing when one of these is missing: Great Wave, Red Fuji, Creation of Adam, School of Athens, Along the River During the Qingming Festival.
- Commons: file exists, is a bitmap, long side at least 1500 px.
- Public domain, as constants computed from the build year (2026): the creator died at least 70 full years before the build year (died 1955 or earlier) AND the work is dated, at the latest the date allows, at least 96 years before it (1930 or earlier; US). American Gothic (1930) is in; a 1931 work is not. Wikidata's own "public domain" statement (P6216) stands in for a missing death date, never for the work's date; a rights statement without public domain rules a work out; no creator named: only when dated before 1850.
- Dates: Wikidata's inception statement has a precision and often "earliest" and "latest" qualifiers. The Last Judgment is "1600" at century precision with 1536 and 1541 as qualifiers, so the label says 1536-41; a century says "16th century". The public-domain test uses the latest year a date allows.
- Where it hangs: the place (P276) when it is an institution and not a room, preferring one that is also a collection; otherwise the owning collection; a room with several collections means the last (The Night Watch: Rijksmuseum).
- Genre: from Wikidata's genre (P136), class (P31), movement and subjects (P180) and the title: poster (and Art Nouveau), Japanese print, nature illustration, modern and abstract, portrait, still life (flowers too), seascape, cityscape, landscape, religious, mythology, history, everyday scene, other.
- Family friendly: a work is flagged when Wikidata's subjects (depicts) show nudity (nude, naked, bathers, odalisque, Venus the goddess, Leda, Danae, Susanna...) or graphic violence (beheading, massacre, execution, martyrdom, murder, battle...), when its title says so in one of several languages (Venus, Nude, Desnuda, Baigneuses, Olympia, Judith, Massacre, Martyrdom, Rape of..., Last Judgment), or when a reviewer listed it (`REVIEWED_FLAGS`, a few works whose nudes or corpses dominate but carry no Wikidata tag). Wikidata's weak "nudity" tag on a religious picture (the infant Jesus) does not count. Careful, not perfect.
- Palette score (`p`): a 120 px thumbnail after the contrast step TRMNL applies before dithering (HSV brightness, sigmoidal 5,50%, as in trmnlp's `ImageQuantizer`), each pixel to the nearest ink of `color-6a` (red, green, blue, yellow, black, white), mean RGB distance scaled 0 to 1; lower is better. Dark share (`k`): the share of pixels with V below 0.2 after that step. Mat (`n`) and plate corner (`q`): black when the whole picture or its bottom-left corner is darker than 0.33. No dithering of our own.

## Test

```
node --test plugin/test tools/build_works/test     # picker, thumbnail URL, build helpers (no network)
cd plugin && trmnlp test                             # renders every view on several devices, mocked data
../../trmnl-plugin-checks/bin/check .                # the shared base checks
```

## Licence

Code: MIT (`LICENSE`). The artworks are in the public domain; a faithful photograph of a two-dimensional public-domain work adds no new copyright (Commons: PD-Art). Each file's page on Commons has the details.
