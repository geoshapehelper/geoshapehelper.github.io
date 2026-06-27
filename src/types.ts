// ---------------------------------------------------------------------------
// Shared types used by both the UI (main thread) and the geoprocessing worker.
// ---------------------------------------------------------------------------

/** Internal id keys we stamp onto every feature's properties. */
export const GID = '__gid';
export const LAYER_ID = '__layer';

export type PolyGeom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** A feature's properties always carry our two internal ids plus user data. */
export interface ShapeProps {
  [GID]: string;
  [LAYER_ID]: string;
  [key: string]: unknown;
}

export type ShapeFeature = GeoJSON.Feature<PolyGeom, ShapeProps>;
export type ShapeFC = GeoJSON.FeatureCollection<PolyGeom, ShapeProps>;

/** Display metadata for an uploaded file (one layer per file). */
export interface LayerMeta {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  /** Property key used as the feature label, or null if none detected. */
  nameField: string | null;
  /** All candidate name-field keys found in this layer's features. */
  nameFieldCandidates: string[];
  featureCount: number;
}

export type SimplifyMethod = 'visvalingam' | 'dp';

export interface SimplifyParams {
  /** 0..100 retain percentage. */
  percentage: number;
  method: SimplifyMethod;
  keepShapes: boolean;
}

export interface CleanParams {
  /** Fill gaps/slivers up to this many km²; 0 disables gap filling. */
  gapFillAreaKm2: number;
  /** Snap vertices within this distance (degrees); 0 = mapshaper default. */
  snapIntervalDeg: number;
}

export type IslandMode = 'keepLargest' | 'drop';

export interface IslandParams {
  minAreaKm2: number;
  /** What to do when a *whole* feature falls below the threshold. */
  wholeFeatureMode: IslandMode;
}

export interface SmoothParams {
  iterations: number;
}

export type MergePropsStrategy = 'largest' | 'first';

/** A committed step in the editable pipeline. */
export interface Operation {
  id: string;
  type: 'import' | 'simplify' | 'clean' | 'islands' | 'smooth' | 'merge' | 'delete';
  label: string;
  report?: string[];
  /** Snapshot of the dataset *after* this operation ran. */
  resultFC: ShapeFC;
}

export interface GeoStats {
  features: number;
  vertices: number;
  /** Total geodesic area in km². */
  areaKm2: number;
  /** Approx serialized size in bytes (minified GeoJSON). */
  bytes: number;
}

export type ExportFormat = 'geojson' | 'topojson';

export interface ExportParams {
  format: ExportFormat;
  prettify: boolean;
  /** Coordinate rounding precision (e.g. 0.0001), or 0 for full precision. */
  precision: number;
}

// --- Worker protocol -------------------------------------------------------

export type WorkerRequest =
  | { id: number; op: 'stats'; fc: ShapeFC }
  | { id: number; op: 'simplifyPreview'; fc: ShapeFC; params: SimplifyParams }
  | { id: number; op: 'simplify'; fc: ShapeFC; params: SimplifyParams; clean: CleanParams }
  | { id: number; op: 'clean'; fc: ShapeFC; params: CleanParams }
  | { id: number; op: 'islands'; fc: ShapeFC; params: IslandParams; clean: CleanParams }
  | { id: number; op: 'smooth'; fc: ShapeFC; params: SmoothParams }
  | {
      id: number;
      op: 'merge';
      fc: ShapeFC;
      selectedGids: string[];
      newName: string;
      nameField: string;
      propsStrategy: MergePropsStrategy;
      /** Merge disjoint selections into one multi-part feature instead of refusing. */
      allowNonContiguous: boolean;
      clean: CleanParams;
    }
  | { id: number; op: 'export'; fc: ShapeFC; layerId: string | null; params: ExportParams };

export interface MergeNotContiguous {
  contiguous: false;
  /** Selected gids grouped into their connected components. */
  components: string[][];
  /** Names of unselected features that would bridge the components. */
  connectorSuggestions: string[];
}

export type WorkerResponse =
  | { id: number; ok: true; op: 'stats'; stats: GeoStats }
  | { id: number; ok: true; op: 'simplifyPreview'; fc: ShapeFC; stats: GeoStats }
  | { id: number; ok: true; op: 'simplify'; fc: ShapeFC; stats: GeoStats; report: string[] }
  | { id: number; ok: true; op: 'clean'; fc: ShapeFC; stats: GeoStats; report: string[] }
  | { id: number; ok: true; op: 'islands'; fc: ShapeFC; stats: GeoStats; report: string[] }
  | { id: number; ok: true; op: 'smooth'; fc: ShapeFC; stats: GeoStats; report: string[] }
  | { id: number; ok: true; op: 'merge'; merged: true; fc: ShapeFC; stats: GeoStats; report: string[] }
  | { id: number; ok: true; op: 'merge'; merged: false; info: MergeNotContiguous }
  | { id: number; ok: true; op: 'export'; filename: string; mime: string; data: string }
  | { id: number; ok: false; error: string };
