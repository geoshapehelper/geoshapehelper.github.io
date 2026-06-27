import { useEffect, useState } from 'react';
import type { MergeNotContiguous, MergePropsStrategy } from '../types';

export interface SelectedInfo {
  gid: string;
  name: string;
  color: string;
  areaKm2: number;
}

function fmtArea(km2: number): string {
  if (km2 >= 1000) return `${Math.round(km2).toLocaleString('en-US')} km²`;
  if (km2 >= 1) return `${km2.toFixed(1)} km²`;
  return `${km2.toFixed(2)} km²`;
}

interface SelectionPanelProps {
  selected: SelectedInfo[];
  notContiguous: MergeNotContiguous | null;
  busy: boolean;
  onMerge: (newName: string, strategy: MergePropsStrategy, allowNonContiguous: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}

export default function SelectionPanel({
  selected,
  notContiguous,
  busy,
  onMerge,
  onDelete,
  onClear,
}: SelectionPanelProps) {
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<MergePropsStrategy>('largest');

  // Seed the merged-name suggestion from the first selected feature.
  const firstName = selected[0]?.name ?? '';
  const selKey = selected.map((s) => s.gid).join(',');
  useEffect(() => {
    setName(firstName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  if (selected.length === 0) return null;

  const nameToComponent = new Map<string, number>();
  if (notContiguous) {
    notContiguous.components.forEach((comp, i) => comp.forEach((gid) => nameToComponent.set(gid, i)));
  }

  return (
    <div className="selection-panel">
      <div className="selection-header">
        <span>
          <strong>{selected.length} selected</strong>{' '}
          <span className="muted small">· {fmtArea(selected.reduce((t, s) => t + s.areaKm2, 0))}</span>
        </span>
        <button className="icon-btn" title="Clear selection" onClick={onClear}>
          ✕
        </button>
      </div>

      <ul className="selection-list">
        {selected.map((s) => (
          <li key={s.gid}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="ellipsis sel-name" title={s.name}>
              {s.name}
            </span>
            <span className="sel-area" title="Geodesic area">
              {fmtArea(s.areaKm2)}
            </span>
            {notContiguous && (
              <span className="group-tag">grp {(nameToComponent.get(s.gid) ?? 0) + 1}</span>
            )}
          </li>
        ))}
      </ul>

      {notContiguous && (
        <div className="warn-box">
          <strong>Selection is not connected.</strong> The selected features form{' '}
          {notContiguous.components.length} separate groups, so they can't merge into one
          contiguous feature.
          {notContiguous.connectorSuggestions.length > 0 ? (
            <>
              {' '}
              Add a connecting neighbor, e.g.{' '}
              <em>{notContiguous.connectorSuggestions.join(', ')}</em>, then merge again - or merge
              them anyway as one multi-part feature (useful for islands).
            </>
          ) : (
            <> Add the province(s) that connect these groups, or merge them anyway as one multi-part feature (useful for islands).</>
          )}
          <button
            className="btn full"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => onMerge(name.trim() || firstName || 'Merged', strategy, true)}
          >
            Merge anyway (multi-part)
          </button>
        </div>
      )}

      {selected.length >= 2 && (
        <>
          <label className="field">
            <span>Merged feature name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name…" />
          </label>
          <label className="field">
            <span>Keep attributes from</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as MergePropsStrategy)}>
              <option value="largest">Largest feature</option>
              <option value="first">First selected feature</option>
            </select>
          </label>
          <button
            className="btn primary full"
            disabled={busy}
            onClick={() => onMerge(name.trim() || firstName || 'Merged', strategy, false)}
          >
            Merge {selected.length} features
          </button>
        </>
      )}
      {selected.length < 2 && (
        <p className="muted small">Shift/Ctrl-click to add more features, then merge.</p>
      )}

      <button className="btn danger full" disabled={busy} onClick={onDelete}>
        Delete {selected.length} feature{selected.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}
