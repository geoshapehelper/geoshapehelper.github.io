# GeoShapeHelper

A **100% client-side** web app for editing administrative-boundary GeoJSON (provinces, districts, and
similar) on top of OpenStreetMap. Upload one or more polygon files, run **topology-safe** geoprocessing
(simplify, clean, smooth, remove islands, merge neighbors), then export the result. No backend,
no uploads to any server; everything runs in your browser and deploys as static files to GitHub Pages.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W4Q021V4U0)

> **The hard part it solves:** keeping **no gaps and no overlaps** between adjacent polygons.
> Every operation runs on **shared-boundary topology** ([mapshaper](https://github.com/mbloch/mapshaper)),
> so a border between two provinces is simplified/smoothed **once** and both neighbors stay perfectly coincident.

## Features

- **Upload** - drag-and-drop or pick multiple `.geojson` / `.json` files. Each file becomes a layer
  (visibility, color, feature count, remove). Per-file validation with clear errors, auto-detected
  name field (overridable), and a **WGS84 sanity check** that warns if coordinates look projected.
- **Simplify** - retain-percentage slider, **Visvalingam** (smoother) or **Douglas-Peucker**,
  "keep shapes" to protect small features. **Live map preview** with before/after vertex count and
  estimated size reduction (debounced, runs in a Web Worker).
- **Clean / repair topology** - snaps coincident vertices, removes overlaps & slivers, closes tiny
  gaps. Runs **automatically** after simplify, island removal and merge, and shows a short report.
- **Remove small islands** - minimum-area threshold in **km² (geodesic)**. Removes detached islands
  from multipart features; for a whole feature below threshold, keep its largest part or drop it.
- **Smooth edges** - topology-preserving **Chaikin** smoothing applied to shared TopoJSON arcs, so
  junction points stay fixed and neighbors don't drift apart. Adjustable intensity (iterations).
- **Merge neighbors** - click features on the map (shift/ctrl-click for multi-select). Merge
  validates **adjacency**; if the selection isn't connected it tells you and suggests the connecting
  neighbor(s) to add. A valid merge dissolves the internal boundary into one clean feature with a
  name and attributes you choose.
- **History** - undo / redo / reset to original, plus a visible, clickable pipeline of applied steps.
- **Export** - GeoJSON or TopoJSON, pretty or minified, optional coordinate precision, whole dataset
  or a single layer. Properties (especially the name field) are preserved.
- Original uploaded data is never mutated - editing is a non-destructive pipeline.

## Tech

- **Vite + React + TypeScript**
- **Leaflet** + OpenStreetMap raster tiles (with attribution) for the map
- **mapshaper** (programmatic API) for shared-arc topology: simplify / clean / dissolve
- **turf.js** for geodesic area, bounding boxes and adjacency tests
- **topojson-server / topojson-client** for arc-level Chaikin smoothing
- All geoprocessing runs in a **Web Worker** (`src/worker/geoWorker.ts`); the UI thread stays responsive.

## Local development

Requires Node 18+.

```bash
npm install      # install dependencies
npm run dev      # start the dev server (prints a http://localhost:5173 URL)
npm run build    # production build to dist/
npm run preview  # serve the production build locally
npm run typecheck
```

Open the dev URL, then drag the two files in [`samples/`](samples/) onto the upload panel. They are
two adjacent provinces, with a tiny offshore island on the southern one to test island removal.

### Try the flow

1. Upload both sample files; they render over OSM and the map fits their combined bounds.
2. **Simplify** to about 20%: the shared border shows no gaps or overlaps, and the clean report confirms it.
3. **Remove islands** below 5 km²: the tiny offshore island disappears while the mainlands stay intact.
4. **Smooth**: edges round off and the shared border stays coincident.
5. Click both provinces, then **Merge**: one feature, with no internal boundary line.
6. Select two non-adjacent features and Merge: the app explains the selection is not connected.
7. **Export**, then re-import the file: it renders identically.

## Deploy to GitHub Pages

The build uses `base: './'` (relative asset paths), so it works at any URL - a project page like
`https://<user>.github.io/<repo>/` or a custom domain - **without** hardcoding the repo name.
A `.nojekyll` file is included so Pages serves the asset folders as-is.

### Option A - GitHub Actions (recommended)

A workflow is provided at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**.
3. Push to `main` (or run the workflow manually). It builds and publishes `dist/`.
   The live URL appears in the workflow's **deploy** job summary.

### Option B - `docs/` folder

If you prefer no Actions:

```bash
npm run build
rm -rf docs && mv dist docs   # or: npm run build -- --outDir docs
git add docs && git commit -m "Build site" && git push
```

Then **Settings → Pages → Source → Deploy from a branch**, branch `main`, folder `/docs`.

## Notes & limitations

- Input/output are assumed to be **EPSG:4326 (WGS84, lon/lat)**. Projected data is detected and
  flagged, not silently reprojected - reproject to WGS84 first.
- Adjacency for merge uses a bounding-box prefilter + `turf.booleanIntersects`; features that touch
  only at a single point count as adjacent.
- mapshaper is authored for Node, so a small `postinstall` step
  ([`scripts/patch-mapshaper.mjs`](scripts/patch-mapshaper.mjs)) makes it browser-safe: it rewrites
  mapshaper's aliased `require$1(...)` calls back to plain `require(...)` so the bundler can resolve
  its geometry deps, stubs out the Node-only/format packages it never needs here (zip, sqlite,
  KML, HTTP, DBF encodings), and points `flatbush`/`kdbush` at their CommonJS builds. This runs
  automatically on `npm install` / `npm ci`. Separately, the worker imports
  [`src/worker/nodeShims.ts`](src/worker/nodeShims.ts) first, which fills in the few `process.*`
  fields mapshaper reads (it isn't detected as a browser inside a Web Worker). The worker never
  touches a real filesystem - all I/O is in-memory.
- Very large files: the live preview runs at full resolution here; for huge inputs you may prefer to
  simplify before exploring. Province-scale datasets are comfortable.

## Project structure

```
src/
  worker/geoWorker.ts   # all geoprocessing (mapshaper, turf, chaikin smoothing)
  worker/client.ts      # typed promise wrapper around the worker
  state/pipeline.ts     # non-destructive undo/redo/reset pipeline reducer
  geo/                  # validation, name-field detection, pure geometry helpers
  components/           # MapView + sidebar panels + dialogs
  types.ts              # shared types and the worker message protocol
samples/                # two adjacent provinces for instant testing
```
