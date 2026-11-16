# Masterworks (TRMNL plugin)

A famous public-domain artwork on your TRMNL, a new one at every refresh, filling the screen. Made for the TRMNL Frame (2560x1440, 6-colour e-paper); works on every model, view and orientation.

| Part | What |
|---|---|
| `data/*.json` | About 2,000 works (paintings, drawings, prints), ranked by Wikidata sitelinks, with a palette score, material, size and a mat flag. `landscape-N.json` and `portrait-N.json` (3 parts of about 80 kB each, a work in part Q-number mod 3) are what the plugin fetches, one part per refresh; `works.json` is the whole set |
| `tools/build_works/` | Builds the data: Wikidata SPARQL, Commons image info, colour score. `node tools/build_works/build.mjs` (Node 22+, ImageMagick `convert`); monthly by `.github/workflows/build-data.yml` |
| `plugin/` | The TRMNL plugin (serverless `transform.js`, Liquid markup, `trmnlp test` specs) |

## Settings

| Setting | Values |
|---|---|
| Presentation | Gallery (default): the work centred on a pure white or black mat (by the work's brightness), a thin bevel line in the opposite colour, a museum label right-aligned under it (title in italic, ARTIST and year, then material, size in cm and collection; missing parts are left out). Full screen: the work fills the view |
| Fit | Full screen only: Fill (cover, edges cropped, default) / Whole work (contain, white mat) |
| Label | Gallery: the museum label or off. Full screen: a corner placard or off |
| Movement or period | All, or one of the ten most common movements in the data |

Label text is SVG text in the screen's own pixels (the transform computes sizes and cuts long lines): the Frame is `screen--md` at 1x like the OG, so no Framework text class can size type for 2560 px. No `style=` anywhere. A failed picture still leaves the mat and the label (or the placard) on screen.

## How a work is picked

Random, weighted. Weight = `sitelinks^0.8` (fame, the main factor) x colour factor (the worst palette match is picked 0.75 times as often as the best) x dark factor (`exp(-6 x (near-black share - 0.45))`, only for very dark works) x a shape factor (aspect close to the screen's; weaker for Whole work). The last 50 works shown are never repeated (their Q-numbers sit in `trmnl_state`, about 400 bytes). The constants are named at the top of `plugin/src/transform.js`.

The image is a Wikimedia Commons thumbnail at the screen's width. Commons serves only the widths 120, 250, 500, 960, 1280, 1920 and 3840; the plugin asks for the smallest that covers the picture (a step down when it holds 80 % of the width needed), never above 1920 (3840 px files are 2 to 9 MB). The URL is in the form Wikipedia pages use (`'`, `(` and `)` percent-encoded), TIFF files as `lossy-page1-...px-File.tif.jpg`. TRMNL does the dithering; the plugin only marks the image `image-dither`.

## Data rules

- Candidates: items with an image (P18) and at least 7 sitelinks, of a class that is painting, print, drawing, fresco, mural, watercolor painting, woodcut print, handscroll, hanging scroll, miniature, painting series or byobu (with subclasses), or exactly a triptych or altarpiece. QLever (a Wikidata mirror) first, query.wikidata.org as the fallback.
- Build check: the build stops and writes nothing when one of these is missing: Great Wave, Red Fuji, Creation of Adam, School of Athens, Along the River During the Qingming Festival.
- Public domain: the rule at the end of this list; a rights statement that does not say public domain rules a work out; no creator named: only when dated before 1850.
- Commons: file exists, is a bitmap, long side at least 1500 px.
- Palette score (`p`): a 120 px thumbnail after the contrast step TRMNL applies before dithering (HSV brightness, sigmoidal 5,50%, as in trmnlp's `ImageQuantizer`), each pixel to the nearest ink of `color-6a` (red, green, blue, yellow, black, white), mean RGB distance scaled 0 to 1; lower is better. Dark share (`k`): the share of pixels with V below 0.2 after that step. No dithering of our own.
- Public domain, as constants computed from the build year (2026): the creator died at least 70 full years before the build year (died 1955 or earlier) AND the work is dated at least 96 years before it (1930 or earlier; US). American Gothic (1930) is in; a 1931 work is not. Wikidata's own "public domain" statement (P6216) stands in for a missing death date, never for the work's date.

## Test

```
node --test plugin/test tools/build_works/test     # picker, thumbnail URL, build helpers (no network)
cd plugin && trmnlp test                             # renders every view on several devices, mocked data
../../trmnl-plugin-checks/bin/check .                # the shared base checks
```

## Licence

Code: MIT (`LICENSE`). The artworks are in the public domain; a faithful photograph of a two-dimensional public-domain work adds no new copyright (Commons: PD-Art). Each file's page on Commons has the details.
