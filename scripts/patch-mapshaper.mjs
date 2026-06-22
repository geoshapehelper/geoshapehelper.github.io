// Patch mapshaper for the browser.
//
// mapshaper is authored for Node and `require()`s some packages that can't be
// bundled for the browser (their own dynamic requires / native bits). esbuild
// and rollup turn those into a shim that throws "Dynamic require of X" - and the
// `iconv-lite` one runs at module load, which crashes the geoprocessing worker
// and hangs the UI. None of these are needed for GeoShapeHelper's in-memory
// GeoJSON/TopoJSON pipeline (they're for DBF/Shapefile encodings, zip archives,
// GeoPackage/SQLite, KML and HTTP), so we replace those requires with harmless
// inline stubs. The geometry deps mapshaper actually uses (mproj, geographiclib,
// flatbush, kdbush, …) bundle fine and are left untouched.
//
// Runs from `postinstall`, so it re-applies after every `npm install` / `npm ci`
// (locally and in CI). It is idempotent: once patched, the target strings are
// gone and re-running is a no-op.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../node_modules/mapshaper/mapshaper.js', import.meta.url));

if (!existsSync(file)) {
  console.warn('[patch-mapshaper] mapshaper not installed yet - skipping.');
  process.exit(0);
}

// A stub that is safe whether called as a function or with `new`.
const FN = '(function () { return {}; })';
// UTF-8-only iconv stand-in (mapshaper only calls these for non-UTF-8 text,
// which never happens on the GeoJSON/TopoJSON path).
const ICONV =
  '{ encodingExists: function () { return true; }, encodings: {}, ' +
  "encode: function (s) { return Buffer.from(String(s == null ? '' : s)); }, " +
  "decode: function (b) { return Buffer.from(b).toString('utf8'); } }";

const replacements = [
  ["require$1('iconv-lite')", ICONV, true], // critical: runs at module load
  ["require('adm-zip')", FN, false],
  ["require$1('rw')", FN, false],
  ["require$1('sync-request')", FN, false],
  ['require$1("@placemarkio/tokml")', FN, false],
  ["require$1('@ngageoint/geopackage')", FN, false],
  ['require$1("@tmcw/togeojson")', FN, false],
  ['require$1("@xmldom/xmldom")', FN, false],
  ["require$1('better-sqlite3')", FN, false],
];

let src = readFileSync(file, 'utf8');
let total = 0;
let criticalDone = false;

for (const [needle, stub, critical] of replacements) {
  const count = src.split(needle).length - 1;
  if (count > 0) {
    src = src.split(needle).join(stub);
    total += count;
    if (critical) criticalDone = true;
  } else if (critical && src.includes(stub)) {
    criticalDone = true; // already patched
  }
}

// mapshaper's bundle aliases require to `require$1`, which esbuild/rollup do NOT
// recognize as a module require - so its remaining deps (the geometry libs
// flatbush, mproj, geographiclib-geodesic, kdbush, plus Node builtins) never get
// bundled and throw "Dynamic require of X" when reached. Rewriting the call-sites
// back to plain `require(` lets the bundler resolve them: the CJS geometry libs
// get bundled, Node builtins get the (harmless, unreached) browser externals.
// The definition `var require$1 = f;` has no `(` so it is left intact.
const callsites = src.split('require$1(').length - 1;
if (callsites > 0) {
  src = src.split('require$1(').join('require(');
  total += callsites;
}

// flatbush and kdbush expose both a CJS `main` and an ESM `module` entry. The
// browser bundler prefers the ESM entry, but mapshaper uses them as CommonJS
// (`var Flatbush = require('flatbush'); new Flatbush(...)`), so the ESM-interop
// wrapper makes `new Flatbush()` throw "not a constructor". Node sidesteps this
// because `require` uses `main`. Point these requires straight at the CJS files
// so the bundler returns the class itself. (These are the only external deps
// mapshaper requires that ship an ESM entry; mproj/geographiclib are CJS-only.)
for (const [pkg, cjs] of [
  ['flatbush', 'flatbush/flatbush.js'],
  ['kdbush', 'kdbush/kdbush.js'],
]) {
  const needle = `require('${pkg}')`;
  const count = src.split(needle).length - 1;
  if (count > 0) {
    src = src.split(needle).join(`require('${cjs}')`);
    total += count;
  }
}

if (total > 0) writeFileSync(file, src);

if (!criticalDone) {
  console.warn(
    '[patch-mapshaper] WARNING: could not find/confirm the iconv-lite require. ' +
      'mapshaper may have changed - the browser worker could fail to load.',
  );
} else {
  console.log(`[patch-mapshaper] OK (${total} require call-site(s) rewritten for the browser).`);
}
