// Pure, dependency-free geometry helpers shared by the UI and the worker.
import type { ShapeFC, ShapeFeature } from '../types';

/** Count every coordinate pair (vertex) across all features. */
export function countVertices(fc: ShapeFC): number {
  let n = 0;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) n += ring.length;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) n += ring.length;
    }
  }
  return n;
}

/** Return each top-level polygon "part" of a feature as its own Polygon geometry. */
export function featureParts(feature: ShapeFeature): GeoJSON.Polygon[] {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g];
  return g.coordinates.map((coords) => ({ type: 'Polygon', coordinates: coords }));
}

/** Scan up to `limit` coordinates and report the min/max lon/lat encountered. */
export function coordinateExtent(
  features: GeoJSON.Feature[],
  limit = 5000,
): { minX: number; minY: number; maxX: number; maxY: number; count: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  const visit = (c: unknown): boolean => {
    if (count >= limit) return false;
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      count++;
      return true;
    }
    if (Array.isArray(c)) {
      for (const child of c) if (!visit(child)) return false;
    }
    return true;
  };
  for (const f of features) {
    if (!visit((f.geometry as { coordinates?: unknown })?.coordinates)) break;
  }
  return { minX, minY, maxX, maxY, count };
}

/** Leaflet-style [[south, west], [north, east]] bounds, or null if empty. */
export function fcLatLngBounds(fc: ShapeFC): [[number, number], [number, number]] | null {
  const ext = coordinateExtent(fc.features, Number.MAX_SAFE_INTEGER);
  if (!Number.isFinite(ext.minX)) return null;
  return [
    [ext.minY, ext.minX],
    [ext.maxY, ext.maxX],
  ];
}
