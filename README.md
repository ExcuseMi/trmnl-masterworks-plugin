# Masterworks (TRMNL plugin)

A famous public-domain artwork on your TRMNL, a new one at every refresh, filling the screen. Made for the TRMNL Frame (2560x1440, 6-colour e-paper); works on every model, view and orientation.

| Part | What |
|---|---|
| `data/*.json` | About 2,000 works (paintings, drawings, prints), ranked by Wikidata sitelinks, with a palette score. `landscape.json` and `portrait.json` are what the plugin fetches |
| `tools/build_works/` | Builds the data: Wikidata SPARQL, Commons image info, colour score. `node tools/build_works/build.mjs` (Node 22+, ImageMagick `convert`); monthly by `.github/workflows/build-data.yml` |
| `plugin/` | The TRMNL plugin (serverless `transform.js`, Liquid markup, `trmnlp test` specs) |

## Settings

| Setting | Values |
|---|---|
| Fit | Fill (cover, edges cropped, default) / Whole work (contain, white mat) |
| Label | Corner placard (default) / Off |
| Movement or period | All, or one of the most common movements in the data |

## How a work is picked

Random, weighted: `sitelinks^0.6` (fame) x `(1 - colour error)^3` (suits the 6 inks) x a shape factor (aspect close to the screen's; weaker for Whole work). The last 50 works shown are never repeated (their Q-numbers sit in `trmnl_state`, about 400 bytes). The constants are at the top of `plugin/src/transform.js`.

The image is a Wikimedia Commons thumbnail at the screen's width. Commons serves only the widths 120, 250, 500, 960, 1280, 1920 and 3840; the plugin asks for the smallest that covers the screen (a step down when it holds 70 % of the width needed). TRMNL does the dithering; the plugin only marks the image `image-dither`.

## Data rules

- Candidates: items of class painting, watercolor painting, drawing, print, woodblock print, fresco, mural with an image (P18) and at least a few sitelinks.
- Public domain: Wikidata's own statement (P6216 = public domain), else every creator died before 1955; a work with no creator only when dated before 1850. A rights statement that does not say public domain rules a work out.
- Commons: file exists, is a bitmap, long side at least 1500 px.
- Palette score: a 120 px thumbnail, each pixel to the nearest ink of TRMNL's `color-6a` (red, green, blue, yellow, black, white), mean RGB distance scaled 0 to 1. Lower is better. No dithering.

## Test

```
node --test plugin/test tools/build_works/test     # picker, thumbnail URL, build helpers (no network)
cd plugin && trmnlp test                             # renders every view on several devices, mocked data
../../trmnl-plugin-checks/bin/check .                # the shared base checks
```

## Licence

Code: MIT (`LICENSE`). Published on TRMNL, the plugin's design and markup are also under TRMNL's plugin licence (CC-BY 4.0). The artworks are in the public domain; a faithful photograph of a two-dimensional public-domain work adds no new copyright (Commons: PD-Art). Each file's page on Commons has the details.
