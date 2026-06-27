import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import MapView from './components/MapView';
import Section from './components/Section';
import UploadZone from './components/UploadZone';
import LayerList from './components/LayerList';
import { SimplifyPanel, IslandPanel, SmoothPanel, CleanPanel } from './components/operations';
import SelectionPanel, { type SelectedInfo } from './components/SelectionPanel';
import TopBar from './components/TopBar';
import HistoryPanel from './components/HistoryPanel';
import StatusBar, { type LogEntry } from './components/StatusBar';
import ViewControls from './components/ViewControls';
import ExportDialog, { type ExportOptions } from './components/ExportDialog';
import area from '@turf/area';
import { GeoClient } from './worker/client';
import {
  canRedo,
  canReset,
  canUndo,
  displayFC,
  initialState,
  reducer,
  workingFC,
} from './state/pipeline';
import { newGid, newLayerId, newOpId } from './state/ids';
import { detectNameField } from './geo/nameField';
import { parseGeoJSONText } from './geo/validate';
import {
  GID,
  LAYER_ID,
  type CleanParams,
  type GeoStats,
  type IslandParams,
  type LayerMeta,
  type MergeNotContiguous,
  type MergePropsStrategy,
  type Operation,
  type PolyGeom,
  type ShapeFC,
  type ShapeFeature,
  type SimplifyParams,
  type SmoothParams,
} from './types';

const PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#65a30d',
];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(filename: string, data: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const clientRef = useRef<GeoClient | null>(null);
  if (!clientRef.current) clientRef.current = new GeoClient();
  const client = clientRef.current;

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const addLog = useCallback((kind: LogEntry['kind'], text: string) => {
    setLog((l) => [...l, { id: ++logId.current, kind, text }].slice(-200));
  }, []);

  const [workingStats, setWorkingStats] = useState<GeoStats | null>(null);
  const [previewStats, setPreviewStats] = useState<GeoStats | null>(null);
  const [cleanParams, setCleanParams] = useState<CleanParams>({ gapFillAreaKm2: 0, snapIntervalDeg: 0 });

  const [baseVisible, setBaseVisible] = useState(true);
  const [baseOpacity, setBaseOpacity] = useState(0.65);
  const [showLabels, setShowLabels] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  const [exportOpen, setExportOpen] = useState(false);
  const [notContiguous, setNotContiguous] = useState<MergeNotContiguous | null>(null);

  useEffect(() => {
    client.onBusyChange = setBusy;
    client.onError = (e) => addLog('error', `Worker error: ${e.message}`);
  }, [client, addLog]);

  const working = workingFC(state);
  const display = displayFC(state);
  const hasData = state.base.features.length > 0;

  // Recompute working-dataset stats whenever the committed dataset changes.
  useEffect(() => {
    if (working.features.length === 0) {
      setWorkingStats(null);
      return;
    }
    let canceled = false;
    client.stats(working).then(
      (s) => !canceled && setWorkingStats(s),
      (e) => addLog('error', `Stats failed: ${errMsg(e)}`),
    );
    return () => {
      canceled = true;
    };
  }, [working, client, addLog]);

  const layersById = useMemo(() => new Map(state.layers.map((l) => [l.id, l])), [state.layers]);
  const featureByGid = useMemo(() => {
    const m = new Map<string, ShapeFeature>();
    for (const f of working.features) m.set(f.properties[GID], f);
    return m;
  }, [working]);

  const selectedInfo: SelectedInfo[] = useMemo(() => {
    const out: SelectedInfo[] = [];
    for (const gid of state.selectedGids) {
      const f = featureByGid.get(gid);
      if (!f) continue;
      const layer = layersById.get(f.properties[LAYER_ID]);
      const nf = layer?.nameField;
      const name = nf && f.properties[nf] != null ? String(f.properties[nf]) : gid;
      let areaKm2 = 0;
      try {
        areaKm2 = area(f) / 1e6;
      } catch {
        areaKm2 = 0;
      }
      out.push({ gid, name, color: layer?.color ?? '#888', areaKm2 });
    }
    return out;
  }, [state.selectedGids, featureByGid, layersById]);

  const mergeNameField = useMemo(() => {
    const f = featureByGid.get(state.selectedGids[0]);
    const layer = f ? layersById.get(f.properties[LAYER_ID]) : undefined;
    return layer?.nameField ?? 'name';
  }, [state.selectedGids, featureByGid, layersById]);

  // --- commit helper ---
  const commit = useCallback(
    (op: Omit<Operation, 'id'>) => {
      dispatch({ type: 'COMMIT', op: { ...op, id: newOpId() } });
      setPreviewStats(null);
      if (op.report?.length) addLog('report', `${op.label}: ${op.report.join(' · ')}`);
    },
    [addLog],
  );

  const clearPreview = useCallback(() => {
    dispatch({ type: 'CLEAR_PREVIEW' });
    setPreviewStats(null);
  }, []);

  // --- upload ---
  const handleFiles = useCallback(
    async (files: File[]) => {
      const hadOps = state.ops.length > 0;
      let importedAny = false;
      for (const file of files) {
        let text: string;
        try {
          text = await file.text();
        } catch (e) {
          addLog('error', `${file.name}: could not read file (${errMsg(e)}).`);
          continue;
        }
        const parsed = parseGeoJSONText(text);
        for (const w of parsed.warnings) addLog('warn', `${file.name}: ${w}`);
        if (parsed.errors.length > 0) {
          for (const er of parsed.errors) addLog('error', `${file.name}: ${er}`);
          continue;
        }
        const layerId = newLayerId();
        const features: ShapeFeature[] = parsed.features.map((f) => ({
          type: 'Feature',
          geometry: f.geometry as PolyGeom,
          properties: { ...(f.properties ?? {}), [GID]: newGid(), [LAYER_ID]: layerId },
        }));
        const { best, candidates } = detectNameField(parsed.features);
        const color = PALETTE[(state.layers.length + (importedAny ? 1 : 0)) % PALETTE.length];
        const layer: LayerMeta = {
          id: layerId,
          name: file.name.replace(/\.(geo)?json$/i, ''),
          color,
          visible: true,
          nameField: best,
          nameFieldCandidates: candidates,
          featureCount: features.length,
        };
        dispatch({ type: 'IMPORT', layer, features });
        addLog('info', `Imported ${features.length} feature(s) from ${file.name}.`);
        importedAny = true;
      }
      if (importedAny) {
        if (hadOps) addLog('warn', 'Pipeline reset: a new import re-bases the dataset.');
        setNotContiguous(null);
        setFitSignal((n) => n + 1);
      }
    },
    [addLog, state.ops.length, state.layers.length],
  );

  // --- simplify preview (debounced) ---
  const previewTimer = useRef<number | undefined>(undefined);
  const previewToken = useRef(0);
  const onSimplifyPreview = useCallback(
    (params: SimplifyParams) => {
      if (!hasData) return;
      window.clearTimeout(previewTimer.current);
      previewTimer.current = window.setTimeout(async () => {
        const token = ++previewToken.current;
        try {
          const r = await client.simplifyPreview(workingFC(state), params);
          if (token !== previewToken.current) return; // a newer preview superseded this one
          dispatch({ type: 'SET_PREVIEW', fc: r.fc });
          setPreviewStats(r.stats);
        } catch (e) {
          addLog('error', `Simplify preview failed: ${errMsg(e)}`);
        }
      }, 300);
    },
    [client, hasData, state, addLog],
  );

  // --- operation handlers ---
  const onSimplifyApply = useCallback(
    async (params: SimplifyParams) => {
      clearPreview();
      try {
        const r = await client.simplify(workingFC(state), params, cleanParams);
        const method = params.method === 'dp' ? 'Douglas-Peucker' : 'Visvalingam';
        commit({
          type: 'simplify',
          label: `Simplify ${params.percentage}% · ${method}${params.keepShapes ? ' · keep' : ''}`,
          report: r.report,
          resultFC: r.fc,
        });
      } catch (e) {
        addLog('error', `Simplify failed: ${errMsg(e)}`);
      }
    },
    [client, state, cleanParams, commit, clearPreview, addLog],
  );

  const onIslandsApply = useCallback(
    async (params: IslandParams) => {
      clearPreview();
      try {
        const r = await client.islands(workingFC(state), params, cleanParams);
        commit({
          type: 'islands',
          label: `Remove islands < ${params.minAreaKm2} km²`,
          report: r.report,
          resultFC: r.fc,
        });
      } catch (e) {
        addLog('error', `Island removal failed: ${errMsg(e)}`);
      }
    },
    [client, state, cleanParams, commit, clearPreview, addLog],
  );

  const onSmoothApply = useCallback(
    async (params: SmoothParams) => {
      clearPreview();
      try {
        const r = await client.smooth(workingFC(state), params);
        commit({
          type: 'smooth',
          label: `Smooth · ${params.iterations} iter`,
          report: r.report,
          resultFC: r.fc,
        });
      } catch (e) {
        addLog('error', `Smooth failed: ${errMsg(e)}`);
      }
    },
    [client, state, commit, clearPreview, addLog],
  );

  const onDelete = useCallback(() => {
    const sel = new Set(state.selectedGids);
    if (sel.size === 0) return;
    const src = workingFC(state);
    const resultFC: ShapeFC = {
      type: 'FeatureCollection',
      features: src.features.filter((f) => !sel.has(f.properties[GID])),
    };
    dispatch({ type: 'SET_SELECTED', gids: [] });
    setNotContiguous(null);
    // Intentionally no clean: a basic delete leaves the hole where the feature was.
    commit({
      type: 'delete',
      label: `Delete ${sel.size} feature${sel.size === 1 ? '' : 's'}`,
      resultFC,
    });
  }, [state, commit]);

  const onCleanRun = useCallback(async () => {
    clearPreview();
    try {
      const r = await client.clean(workingFC(state), cleanParams);
      commit({ type: 'clean', label: 'Clean / repair topology', report: r.report, resultFC: r.fc });
    } catch (e) {
      addLog('error', `Clean failed: ${errMsg(e)}`);
    }
  }, [client, state, cleanParams, commit, clearPreview, addLog]);

  const onMerge = useCallback(
    async (newName: string, strategy: MergePropsStrategy, allowNonContiguous: boolean) => {
      clearPreview();
      try {
        const r = await client.merge({
          fc: workingFC(state),
          selectedGids: state.selectedGids,
          newName,
          nameField: mergeNameField,
          propsStrategy: strategy,
          allowNonContiguous,
          clean: cleanParams,
        });
        if (!r.merged) {
          setNotContiguous(r.info);
          addLog('warn', `Cannot merge: selection forms ${r.info.components.length} disconnected groups.`);
          return;
        }
        setNotContiguous(null);
        dispatch({ type: 'SET_SELECTED', gids: [] });
        commit({ type: 'merge', label: `Merge → "${newName}"`, report: r.report, resultFC: r.fc });
      } catch (e) {
        addLog('error', `Merge failed: ${errMsg(e)}`);
      }
    },
    [client, state, mergeNameField, cleanParams, commit, clearPreview, addLog],
  );

  const onSelectionChange = useCallback((gids: string[]) => {
    dispatch({ type: 'SET_SELECTED', gids });
    setNotContiguous(null);
  }, []);

  const onExport = useCallback(
    async (opts: ExportOptions) => {
      try {
        const r = await client.export(working, opts.layerId, {
          format: opts.format,
          prettify: opts.prettify,
          precision: opts.precision,
        });
        download(opts.filename, r.data, r.mime);
        addLog('info', `Exported ${opts.filename}.`);
        setExportOpen(false);
      } catch (e) {
        addLog('error', `Export failed: ${errMsg(e)}`);
      }
    },
    [client, working, addLog],
  );

  // --- keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      } else if (e.key === 'Escape') {
        dispatch({ type: 'SET_SELECTED', gids: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-shell">
      <TopBar
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        canReset={canReset(state)}
        hasData={hasData}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        onReset={() => dispatch({ type: 'RESET' })}
        onExport={() => setExportOpen(true)}
      />

      <div className="app-body">
        <aside className="sidebar">
          <Section title="Upload">
            <UploadZone onFiles={handleFiles} busy={busy} />
          </Section>

          <Section title="Layers" badge={state.layers.length || undefined}>
            <LayerList
              layers={state.layers}
              onUpdate={(id, patch) => dispatch({ type: 'UPDATE_LAYER', layerId: id, patch })}
              onRemove={(id) => dispatch({ type: 'REMOVE_LAYER', layerId: id })}
            />
          </Section>

          <Section title="Simplify">
            <SimplifyPanel
              beforeStats={workingStats}
              afterStats={previewStats}
              previewing={state.preview != null}
              busy={busy}
              disabled={!hasData}
              onPreview={onSimplifyPreview}
              onApply={onSimplifyApply}
              onClearPreview={clearPreview}
            />
          </Section>

          <Section title="Remove islands" defaultOpen={false}>
            <IslandPanel busy={busy} disabled={!hasData} onApply={onIslandsApply} />
          </Section>

          <Section title="Smooth edges" defaultOpen={false}>
            <SmoothPanel busy={busy} disabled={!hasData} onApply={onSmoothApply} />
          </Section>

          <Section title="Clean / repair" defaultOpen={false}>
            <CleanPanel
              params={cleanParams}
              onChange={setCleanParams}
              onRun={onCleanRun}
              busy={busy}
              disabled={!hasData}
            />
          </Section>

          <Section title="Map view" defaultOpen={false}>
            <ViewControls
              baseVisible={baseVisible}
              baseOpacity={baseOpacity}
              showLabels={showLabels}
              hasData={hasData}
              onBaseVisible={setBaseVisible}
              onBaseOpacity={setBaseOpacity}
              onShowLabels={setShowLabels}
              onFit={() => setFitSignal((n) => n + 1)}
            />
          </Section>

          <Section title="History / pipeline" badge={state.ops.length || undefined}>
            <HistoryPanel
              ops={state.ops}
              cursor={state.cursor}
              onJump={(c) => dispatch({ type: 'JUMP', cursor: c })}
            />
          </Section>
        </aside>

        <main className="map-wrap">
          <MapView
            fc={display}
            layers={state.layers}
            selectedGids={state.selectedGids}
            onSelectionChange={onSelectionChange}
            showLabels={showLabels}
            baseVisible={baseVisible}
            baseOpacity={baseOpacity}
            fitSignal={fitSignal}
          />
          {!hasData && (
            <div className="map-hint">
              <div>
                <strong>Upload GeoJSON to begin.</strong>
                <p className="muted">
                  Drop province/admin polygons in the panel on the left. Sample files are in the
                  repo’s <code>samples/</code> folder.
                </p>
              </div>
            </div>
          )}
          <SelectionPanel
            selected={selectedInfo}
            notContiguous={notContiguous}
            busy={busy}
            onMerge={onMerge}
            onDelete={onDelete}
            onClear={() => onSelectionChange([])}
          />
        </main>
      </div>

      <StatusBar busy={busy} stats={previewStats ?? workingStats} log={log} />

      <ExportDialog
        open={exportOpen}
        layers={state.layers}
        busy={busy}
        onClose={() => setExportOpen(false)}
        onExport={onExport}
      />
    </div>
  );
}
