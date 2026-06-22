/// <reference types="vite/client" />

// mapshaper ships no type declarations. We only use a tiny slice of its API.
declare module 'mapshaper' {
  /**
   * Run mapshaper commands against in-memory inputs and receive the outputs
   * produced by `-o` as a `{ filename: Uint8Array | string }` object.
   * Returns a Promise when no callback is supplied.
   */
  export function applyCommands(
    commands: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, Uint8Array | string>>;

  export function runCommands(commands: string, input?: Record<string, unknown>): Promise<void>;

  /** Turn on mapshaper's status logging (routed through console.*). */
  export function enableLogging(): void;

  const mapshaper: {
    applyCommands: typeof applyCommands;
    runCommands: typeof runCommands;
    enableLogging: typeof enableLogging;
  };
  export default mapshaper;
}

// Minimal shapes for the slice of TopoJSON we touch during arc smoothing.
interface TopoJsonTopology {
  type: 'Topology';
  arcs: number[][][];
  objects: Record<string, unknown>;
  bbox?: number[];
  transform?: { scale: [number, number]; translate: [number, number] };
}

declare module 'topojson-server' {
  export function topology(
    objects: Record<string, GeoJSON.GeoJsonObject>,
    quantization?: number,
  ): TopoJsonTopology;
}

declare module 'topojson-client' {
  export function feature(
    topology: TopoJsonTopology,
    object: unknown,
  ): GeoJSON.Feature | GeoJSON.FeatureCollection;
}
