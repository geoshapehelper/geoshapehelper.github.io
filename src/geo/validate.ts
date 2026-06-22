// Parse + validate an uploaded GeoJSON file into polygon features, with clear
// per-file diagnostics. Input/output are assumed to be EPSG:4326 (lon/lat).
import { coordinateExtent } from './geometry';

export interface ParsedFile {
  /** Polygon / MultiPolygon features, properties intact (no internal ids yet). */
  features: GeoJSON.Feature[];
  warnings: string[];
  errors: string[];
}

function asFeatureArray(json: unknown): { features: GeoJSON.Feature[]; errors: string[] } {
  const errors: string[] = [];
  if (!json || typeof json !== 'object') {
    return { features: [], errors: ['File is not valid JSON / GeoJSON.'] };
  }
  const obj = json as { type?: string; features?: unknown; geometry?: unknown };
  if (obj.type === 'FeatureCollection') {
    if (!Array.isArray(obj.features)) {
      return { features: [], errors: ['FeatureCollection has no "features" array.'] };
    }
    return { features: obj.features as GeoJSON.Feature[], errors };
  }
  if (obj.type === 'Feature') {
    return { features: [json as GeoJSON.Feature], errors };
  }
  if (obj.type === 'Polygon' || obj.type === 'MultiPolygon') {
    return {
      features: [{ type: 'Feature', properties: {}, geometry: json as GeoJSON.Geometry }],
      errors,
    };
  }
  if (obj.type === 'GeometryCollection') {
    const geoms = (json as { geometries?: GeoJSON.Geometry[] }).geometries ?? [];
    return {
      features: geoms.map((g) => ({ type: 'Feature', properties: {}, geometry: g })),
      errors,
    };
  }
  return {
    features: [],
    errors: [`Unsupported GeoJSON type "${obj.type ?? 'unknown'}". Expected FeatureCollection, Feature, Polygon or MultiPolygon.`],
  };
}

export function parseGeoJSONText(text: string): ParsedFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { features: [], warnings: [], errors: [`Could not parse JSON: ${(e as Error).message}`] };
  }

  const { features: raw, errors } = asFeatureArray(json);
  const warnings: string[] = [];

  // Named-CRS heuristic (RFC 7946 dropped crs, but older files include it).
  const crsName = (json as { crs?: { properties?: { name?: string } } })?.crs?.properties?.name;
  if (crsName && !/(4326|crs84|wgs[\s_]*84)/i.test(crsName)) {
    warnings.push(`File declares CRS "${crsName}", which may not be WGS84 (EPSG:4326).`);
  }

  const polygons: GeoJSON.Feature[] = [];
  let skipped = 0;
  for (const f of raw) {
    const t = f?.geometry?.type;
    if (t === 'Polygon' || t === 'MultiPolygon') {
      polygons.push(f);
    } else {
      skipped++;
    }
  }
  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} non-polygon feature(s) (only Polygon/MultiPolygon are supported).`);
  }
  if (polygons.length === 0 && errors.length === 0) {
    errors.push('No Polygon or MultiPolygon features found.');
  }

  // Coordinate-range (projection) heuristic.
  if (polygons.length > 0) {
    const ext = coordinateExtent(polygons, 5000);
    if (Number.isFinite(ext.minX)) {
      const outOfRange =
        ext.minX < -180.5 || ext.maxX > 180.5 || ext.minY < -90.5 || ext.maxY > 90.5;
      if (outOfRange) {
        warnings.push(
          `Coordinates fall outside the -180..180 / -90..90 range ` +
            `(x: ${ext.minX.toFixed(1)}..${ext.maxX.toFixed(1)}, y: ${ext.minY.toFixed(1)}..${ext.maxY.toFixed(1)}). ` +
            `Data looks projected - reproject to EPSG:4326 (WGS84) for correct results.`,
        );
      }
    }
  }

  return { features: polygons, warnings, errors };
}
