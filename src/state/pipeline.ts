// Non-destructive editing model: a `base` dataset (union of all imports) plus an
// ordered list of committed operations, each holding the dataset snapshot it
// produced. A cursor selects how far down the pipeline we're currently viewing,
// which gives undo / redo / reset for free.
import type { LayerMeta, Operation, ShapeFC, ShapeFeature } from '../types';
import { LAYER_ID } from '../types';

export interface AppState {
  layers: LayerMeta[];
  base: ShapeFC;
  ops: Operation[];
  /** -1 = viewing `base`; otherwise index into `ops`. */
  cursor: number;
  /** Uncommitted live preview (e.g. the simplify slider); overlays the map. */
  preview: ShapeFC | null;
  selectedGids: string[];
}

export const emptyFC: ShapeFC = { type: 'FeatureCollection', features: [] };

/** Keep at most this many committed operations; each stores a full dataset
 *  snapshot, so an unbounded history grows memory and triggers GC stalls. */
export const MAX_HISTORY = 10;

export const initialState: AppState = {
  layers: [],
  base: emptyFC,
  ops: [],
  cursor: -1,
  preview: null,
  selectedGids: [],
};

export type Action =
  | { type: 'IMPORT'; layer: LayerMeta; features: ShapeFeature[] }
  | { type: 'REMOVE_LAYER'; layerId: string }
  | { type: 'UPDATE_LAYER'; layerId: string; patch: Partial<LayerMeta> }
  | { type: 'SET_PREVIEW'; fc: ShapeFC }
  | { type: 'CLEAR_PREVIEW' }
  | { type: 'COMMIT'; op: Operation }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'JUMP'; cursor: number }
  | { type: 'RESET' }
  | { type: 'SET_SELECTED'; gids: string[] };

export function workingFC(state: AppState): ShapeFC {
  return state.cursor < 0 ? state.base : state.ops[state.cursor].resultFC;
}

/** What the map should draw: the live preview if present, else the committed state. */
export function displayFC(state: AppState): ShapeFC {
  return state.preview ?? workingFC(state);
}

export const canUndo = (s: AppState) => s.cursor >= 0;
export const canRedo = (s: AppState) => s.cursor < s.ops.length - 1;
export const canReset = (s: AppState) => s.ops.length > 0 || s.cursor >= 0;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'IMPORT': {
      const base: ShapeFC = {
        type: 'FeatureCollection',
        features: [...state.base.features, ...action.features],
      };
      // A new import re-bases the dataset: clear the pipeline so we never mix
      // freshly imported raw features with already-processed ones.
      return {
        ...state,
        layers: [...state.layers, action.layer],
        base,
        ops: [],
        cursor: -1,
        preview: null,
      };
    }

    case 'REMOVE_LAYER': {
      const base: ShapeFC = {
        type: 'FeatureCollection',
        features: state.base.features.filter((f) => f.properties[LAYER_ID] !== action.layerId),
      };
      return {
        ...state,
        layers: state.layers.filter((l) => l.id !== action.layerId),
        base,
        ops: [],
        cursor: -1,
        preview: null,
        selectedGids: [],
      };
    }

    case 'UPDATE_LAYER':
      return {
        ...state,
        layers: state.layers.map((l) => (l.id === action.layerId ? { ...l, ...action.patch } : l)),
      };

    case 'SET_PREVIEW':
      return { ...state, preview: action.fc };

    case 'CLEAR_PREVIEW':
      return state.preview ? { ...state, preview: null } : state;

    case 'COMMIT': {
      let ops = state.ops.slice(0, state.cursor + 1);
      ops.push(action.op);
      let cursor = ops.length - 1;
      if (ops.length > MAX_HISTORY) {
        const drop = ops.length - MAX_HISTORY;
        ops = ops.slice(drop); // discard oldest snapshots to bound memory
        cursor -= drop;
      }
      return { ...state, ops, cursor, preview: null };
    }

    case 'UNDO':
      return canUndo(state) ? { ...state, cursor: state.cursor - 1, preview: null } : state;

    case 'REDO':
      return canRedo(state) ? { ...state, cursor: state.cursor + 1, preview: null } : state;

    case 'JUMP': {
      const cursor = Math.max(-1, Math.min(state.ops.length - 1, action.cursor));
      return { ...state, cursor, preview: null };
    }

    case 'RESET':
      return { ...state, ops: [], cursor: -1, preview: null, selectedGids: [] };

    case 'SET_SELECTED':
      return { ...state, selectedGids: action.gids };

    default:
      return state;
  }
}
