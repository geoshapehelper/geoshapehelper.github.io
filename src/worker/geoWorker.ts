/// <reference lib="webworker" />
// Geoprocessing worker. All heavy lifting (mapshaper topology ops, turf area /
// adjacency, Chaikin smoothing) runs here so the map + UI stay responsive.
import './nodeShims'; // must run before mapshaper: fills in missing process.* fields
import mapshaper from 'mapshaper';
import area from '@turf/area';
import bbox from '@turf/bbox';
import booleanIntersects from '@turf/boolean-intersects';
import { topology } from 'topojson-server';
import { feature as topoFeature } from 'topojson-client';
import { countVertices, featureParts } from '../geo/geometry';
import {
  GID,
  LAYER_ID,
  type CleanParams,
  type GeoStats,
  type IslandParams,
  type PolyGeom,
  type ShapeFC,
  type ShapeFeature,
  type SimplifyParams,
  type SmoothParams,
  type WorkerRequest,
  type WorkerResponse,
} from '../types';

mapshaper.enableLogging();

const IN = 'in.geojson';
const OUT = 'out.geojson';

// --- mapshaper plumbing ----------------------------------------------------

/** Run mapshaper commands, capturing its log output (that's where -clean etc.
 *  write their "Repaired N / Retained N" reports). */
async function runMapshaper(
  commands: string,
  inputFC: GeoJSON.FeatureCollection,
): Promise<{ data: string; messages: string[] }> {
  const messages: string[] = [];
  const origError = console.error;
  const origLog = console.log;
  const origWarn = console.warn;
  const sink = (...args: unknown[]) => messages.push(args.map((a) => String(a)).join(' '));
  console.error = sink;
  console.log = sink;
  console.warn = sink;
  try {
    const out = await mapshaper.applyCommands(commands, { [IN]: JSON.stringify(inputFC) });
    const key = Object.keys(out)[0];
    const value = out[key];
    const data = typeof value === 'string' ? value : new TextDecoder().decode(value);
    return { data, messages };
  } finally {
    console.error = origError;
    console.log = origLog;
    console.warn = origWarn;
  }
}

/** Keep only mapshaper's command-tagged summary lines, e.g. "[clean] …". */
function reportLines(messages: string[]): string[] {
  return messages.map((m) => m.trim()).filter((m) => /^\[[a-z-]+\]/.test(m));
}

function cleanCommand(params: CleanParams): string {
  let s = '-clean';
  if (params.gapFillAreaKm2 > 0) s += ` gap-fill-area=${params.gapFillAreaKm2}km2`;
  if (params.snapIntervalDeg > 0) s += ` snap-interval=${params.snapIntervalDeg}`;
  return s;
}

function simplifyCommand(params: SimplifyParams): string {
  const method = params.method === 'dp' ? 'dp' : 'visvalingam weighted';
  const pct = Math.max(0, Math.min(100, params.percentage));
  return `-simplify percentage=${pct}% ${method}${params.keepShapes ? ' keep-shapes' : ''}`;
}

// --- stats -----------------------------------------------------------------

// `withArea` is skipped for the live simplify preview, where geodesic area over
// every feature on each slider tick is the expensive part and isn't displayed.
// Byte size is estimated from the vertex count (GeoJSON size is dominated by
// coordinates) so we avoid JSON.stringify in the hot path.
function computeStats(fc: ShapeFC, withArea = true): GeoStats {
  const vertices = countVertices(fc);
  let areaKm2 = 0;
  if (withArea) {
    try {
      areaKm2 = area(fc) / 1e6;
    } catch {
      areaKm2 = 0;
    }
  }
  return {
    features: fc.features.length,
    vertices,
    areaKm2,
    bytes: vertices * 20 + fc.features.length * 48,
  };
}

function parseFC(data: string): ShapeFC {
  return JSON.parse(data) as ShapeFC;
}

// --- island filtering (JS, geodesic via turf) ------------------------------

function rebuildFeature(feature: ShapeFeature, parts: GeoJSON.Polygon[]): ShapeFeature {
  const geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon =
    parts.length === 1
      ? { type: 'Polygon', coordinates: parts[0].coordinates }
      : { type: 'MultiPolygon', coordinates: parts.map((p) => p.coordinates) };
  return { type: 'Feature', properties: feature.properties, geometry };
}

// A polygon "part" is an ISLAND if it shares no boundary with any other feature.
// Inland provinces share borders with their neighbors (coincident boundary
// vertices), so they are never removed - only small, truly detached islands are.
// Connectivity is detected by shared boundary vertices (rounded), which is fast
// (O(vertices)) and reliable for topologically-derived administrative data.
function filterIslands(
  fc: ShapeFC,
  params: IslandParams,
): { fc: ShapeFC; removedParts: number; droppedFeatures: number; keptLargest: number } {
  const T = params.minAreaKm2;
  const key = (c: number[]) => `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;

  const partsByFeature = fc.features.map((f) => featureParts(f));

  // Map each boundary vertex to the set of features that touch it.
  const owners = new Map<string, Set<number>>();
  partsByFeature.forEach((parts, fi) => {
    for (const part of parts) {
      for (const ring of part.coordinates) {
        for (const c of ring) {
          let s = owners.get(key(c));
          if (!s) owners.set(key(c), (s = new Set()));
          s.add(fi);
        }
      }
    }
  });

  const sharesBorder = (fi: number, part: GeoJSON.Polygon): boolean => {
    for (const ring of part.coordinates) {
      for (const c of ring) {
        const s = owners.get(key(c));
        if (s) for (const o of s) if (o !== fi) return true;
      }
    }
    return false;
  };

  let removedParts = 0;
  let droppedFeatures = 0;
  let keptLargest = 0;
  const out: ShapeFeature[] = [];

  fc.features.forEach((f, fi) => {
    const parts = partsByFeature[fi];
    if (parts.length === 0) {
      out.push(f);
      return;
    }
    const kept: GeoJSON.Polygon[] = [];
    for (const part of parts) {
      // Keep anything that borders another feature (inland), and large islands.
      if (sharesBorder(fi, part) || area(part) / 1e6 >= T) kept.push(part);
      else removedParts++;
    }

    if (kept.length === parts.length) {
      out.push(f);
    } else if (kept.length > 0) {
      out.push(rebuildFeature(f, kept));
    } else if (params.wholeFeatureMode === 'drop') {
      droppedFeatures++;
    } else {
      // keepLargest: a wholly small, detached feature - keep its biggest part.
      let li = 0;
      for (let i = 1; i < parts.length; i++) if (area(parts[i]) > area(parts[li])) li = i;
      removedParts -= 1; // one of the "removed" parts is kept after all
      keptLargest++;
      out.push(rebuildFeature(f, [parts[li]]));
    }
  });

  return {
    fc: { type: 'FeatureCollection', features: out },
    removedParts,
    droppedFeatures,
    keptLargest,
  };
}

// --- Chaikin smoothing on shared TopoJSON arcs -----------------------------

type Pt = number[];

function chaikinOpen(points: Pt[], iterations: number): Pt[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const res: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      res.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      res.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    res.push(pts[pts.length - 1]);
    pts = res;
  }
  return pts;
}

function chaikinClosed(points: Pt[], iterations: number): Pt[] {
  let pts = points.slice(0, points.length - 1); // drop the closing duplicate
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const res: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      res.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      res.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    pts = res;
  }
  pts.push(pts[0]); // re-close
  return pts;
}

function isClosedArc(arc: Pt[]): boolean {
  if (arc.length < 4) return false;
  const a = arc[0];
  const b = arc[arc.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

function smoothFC(fc: ShapeFC, params: SmoothParams): ShapeFC {
  const iterations = Math.max(1, Math.min(6, Math.round(params.iterations)));
  // Build shared-arc topology (no quantization -> arcs hold absolute coords).
  const topo = topology({ data: fc as unknown as GeoJSON.GeoJsonObject });
  topo.arcs = topo.arcs.map((arc) =>
    isClosedArc(arc) ? chaikinClosed(arc, iterations) : chaikinOpen(arc, iterations),
  );
  const result = topoFeature(topo, topo.objects.data) as GeoJSON.FeatureCollection;
  return { type: 'FeatureCollection', features: result.features as ShapeFeature[] };
}

// --- adjacency / merge -----------------------------------------------------

function bboxesOverlap(a: number[], b: number[]): boolean {
  return !(a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]);
}

function adjacent(a: ShapeFeature, b: ShapeFeature, boxes: Map<string, number[]>): boolean {
  const ba = boxes.get(a.properties[GID])!;
  const bb = boxes.get(b.properties[GID])!;
  if (!bboxesOverlap(ba, bb)) return false;
  return booleanIntersects(a, b);
}

function connectedComponents(features: ShapeFeature[], boxes: Map<string, number[]>): ShapeFeature[][] {
  const n = features.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (adjacent(features[i], features[j], boxes)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const seen = new Array(n).fill(false);
  const comps: ShapeFeature[][] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i];
    seen[i] = true;
    const comp: ShapeFeature[] = [];
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(features[u]);
      for (const v of adj[u]) if (!seen[v]) ((seen[v] = true), stack.push(v));
    }
    comps.push(comp);
  }
  return comps;
}

function featureName(f: ShapeFeature, nameField: string): string {
  const v = nameField ? f.properties[nameField] : undefined;
  return v != null && String(v).trim() !== '' ? String(v) : `feature ${f.properties[GID]}`;
}

// --- request handler -------------------------------------------------------

async function handle(req: WorkerRequest): Promise<WorkerResponse> {
  switch (req.op) {
    case 'stats':
      return { id: req.id, ok: true, op: 'stats', stats: computeStats(req.fc) };

    case 'simplifyPreview': {
      const { data } = await runMapshaper(`-i ${IN} ${simplifyCommand(req.params)} -o ${OUT}`, req.fc);
      const fc = parseFC(data);
      return { id: req.id, ok: true, op: 'simplifyPreview', fc, stats: computeStats(fc, false) };
    }

    case 'simplify': {
      const cmd = `-i ${IN} ${simplifyCommand(req.params)} ${cleanCommand(req.clean)} -o ${OUT}`;
      const { data, messages } = await runMapshaper(cmd, req.fc);
      const fc = parseFC(data);
      return { id: req.id, ok: true, op: 'simplify', fc, stats: computeStats(fc), report: reportLines(messages) };
    }

    case 'clean': {
      const { data, messages } = await runMapshaper(`-i ${IN} ${cleanCommand(req.params)} -o ${OUT}`, req.fc);
      const fc = parseFC(data);
      return { id: req.id, ok: true, op: 'clean', fc, stats: computeStats(fc), report: reportLines(messages) };
    }

    case 'islands': {
      const r = filterIslands(req.fc, req.params);
      // Re-run clean to close any gaps left where whole features were removed.
      const { data, messages } = await runMapshaper(`-i ${IN} ${cleanCommand(req.clean)} -o ${OUT}`, r.fc);
      const fc = parseFC(data);
      const report = [
        `Removed ${r.removedParts} detached island(s) below ${req.params.minAreaKm2} km² (inland provinces kept).`,
        r.droppedFeatures > 0 ? `Dropped ${r.droppedFeatures} fully-detached feature(s) below threshold.` : '',
        r.keptLargest > 0 ? `Kept largest part of ${r.keptLargest} sub-threshold island feature(s).` : '',
        ...reportLines(messages),
      ].filter(Boolean);
      return { id: req.id, ok: true, op: 'islands', fc, stats: computeStats(fc), report };
    }

    case 'smooth': {
      const fc = smoothFC(req.fc, req.params);
      return {
        id: req.id,
        ok: true,
        op: 'smooth',
        fc,
        stats: computeStats(fc),
        report: [`Smoothed shared arcs with ${req.params.iterations} Chaikin iteration(s); junctions kept fixed.`],
      };
    }

    case 'merge': {
      const selectedSet = new Set(req.selectedGids);
      const selected = req.fc.features.filter((f) => selectedSet.has(f.properties[GID]));
      const rest = req.fc.features.filter((f) => !selectedSet.has(f.properties[GID]));

      const boxes = new Map<string, number[]>();
      for (const f of req.fc.features) boxes.set(f.properties[GID], bbox(f));

      const comps = connectedComponents(selected, boxes);
      const contiguous = comps.length <= 1;
      if (!contiguous && !req.allowNonContiguous) {
        // Suggest unselected features that bridge two or more selected groups.
        const suggestions: string[] = [];
        for (const cand of rest) {
          let touched = 0;
          for (const comp of comps) {
            if (comp.some((f) => adjacent(cand, f, boxes))) touched++;
            if (touched >= 2) break;
          }
          if (touched >= 2) suggestions.push(featureName(cand, req.nameField));
        }
        return {
          id: req.id,
          ok: true,
          op: 'merge',
          merged: false,
          info: {
            contiguous: false,
            components: comps.map((c) => c.map((f) => f.properties[GID])),
            connectorSuggestions: [...new Set(suggestions)].slice(0, 10),
          },
        };
      }

      // Dissolve the (contiguous) selected features into one, removing internal
      // borders. -dissolve drops attributes, so mapshaper emits a bare
      // GeometryCollection rather than a FeatureCollection; take the geometry
      // from whichever shape it returns (we rebuild the properties ourselves).
      const selFC: ShapeFC = { type: 'FeatureCollection', features: selected };
      const { data, messages } = await runMapshaper(`-i ${IN} -dissolve -o ${OUT}`, selFC);
      const dissolved = JSON.parse(data) as
        | ShapeFC
        | { type: 'GeometryCollection'; geometries: PolyGeom[] };
      const mergedGeom: PolyGeom =
        dissolved.type === 'GeometryCollection'
          ? dissolved.geometries[0]
          : dissolved.features[0].geometry;

      let baseFeature = selected[0];
      if (req.propsStrategy === 'largest') {
        baseFeature = selected.reduce((acc, f) => (area(f) > area(acc) ? f : acc), selected[0]);
      }
      const props = { ...baseFeature.properties };
      props[GID] = `merged-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      props[LAYER_ID] = baseFeature.properties[LAYER_ID];
      props[req.nameField || 'name'] = req.newName;

      const mergedFeature: ShapeFeature = { type: 'Feature', properties: props, geometry: mergedGeom };
      const combined: ShapeFC = { type: 'FeatureCollection', features: [...rest, mergedFeature] };

      // Auto-clean the recombined dataset.
      const cleaned = await runMapshaper(`-i ${IN} ${cleanCommand(req.clean)} -o ${OUT}`, combined);
      const fc = parseFC(cleaned.data);
      const report = [
        contiguous
          ? `Merged ${selected.length} adjacent features into "${req.newName}".`
          : `Merged ${selected.length} non-adjacent features into one multi-part feature "${req.newName}".`,
        ...reportLines(messages),
        ...reportLines(cleaned.messages),
      ];
      return { id: req.id, ok: true, op: 'merge', merged: true, fc, stats: computeStats(fc), report };
    }

    case 'export': {
      let fc = req.fc;
      if (req.layerId) {
        fc = {
          type: 'FeatureCollection',
          features: req.fc.features.filter((f) => f.properties[LAYER_ID] === req.layerId),
        };
      }
      const fmt = req.params.format;
      const ext = fmt === 'topojson' ? 'json' : 'geojson';
      let cmd = `-i ${IN} -o format=${fmt}`;
      if (req.params.precision > 0) cmd += ` precision=${req.params.precision}`;
      if (req.params.prettify) cmd += ' prettify';
      cmd += ` out.${ext}`;
      const { data } = await runMapshaper(cmd, fc);
      const mime = fmt === 'topojson' ? 'application/json' : 'application/geo+json';
      return { id: req.id, ok: true, op: 'export', filename: `export.${ext}`, mime, data };
    }
  }
}

// Process requests one at a time. They're CPU-bound (so concurrency wouldn't
// help anyway) and runMapshaper temporarily swaps console.* to capture reports,
// which must not be interleaved by an overlapping request (e.g. a debounced
// preview arriving mid-operation).
let queue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  queue = queue.then(async () => {
    try {
      const res = await handle(req);
      (self as unknown as Worker).postMessage(res);
    } catch (err) {
      (self as unknown as Worker).postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
  });
};
