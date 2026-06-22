import { useEffect, useMemo, useRef, useState } from 'react';
import NumberField from './NumberField';
import type { ExportFormat, LayerMeta } from '../types';

export interface ExportOptions {
  layerId: string | null;
  format: ExportFormat;
  prettify: boolean;
  precision: number;
  filename: string;
}

interface ExportDialogProps {
  open: boolean;
  layers: LayerMeta[];
  busy: boolean;
  onClose: () => void;
  onExport: (opts: ExportOptions) => void;
}

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_') || 'export';
}

export default function ExportDialog({ open, layers, busy, onClose, onExport }: ExportDialogProps) {
  const [scope, setScope] = useState<string>('all'); // 'all' or layer id
  const [format, setFormat] = useState<ExportFormat>('geojson');
  const [prettify, setPrettify] = useState(true);
  const [precision, setPrecision] = useState(0);
  const [filename, setFilename] = useState('geoshapehelper.geojson');
  const editedRef = useRef(false);

  const suggested = useMemo(() => {
    const ext = format === 'topojson' ? 'topojson' : 'geojson';
    const layer = layers.find((l) => l.id === scope);
    const stem = scope === 'all' ? 'geoshapehelper' : safeName(layer?.name ?? 'layer');
    return `${stem}.${ext}`;
  }, [scope, format, layers]);

  useEffect(() => {
    if (!editedRef.current) setFilename(suggested);
  }, [suggested]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Export</strong>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Whole processed dataset</option>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                Layer: {l.name} ({l.featureCount})
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="geojson">GeoJSON</option>
            <option value="topojson">TopoJSON (smaller, shared arcs)</option>
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={prettify} onChange={(e) => setPrettify(e.target.checked)} />
          <span>Pretty-print (larger, human-readable)</span>
        </label>

        <label className="field">
          <span>Coordinate precision (decimal degrees, 0 = full)</span>
          <NumberField value={precision} onValue={setPrecision} min={0} step={0.0001} />
        </label>

        <label className="field">
          <span>Filename</span>
          <input
            value={filename}
            onChange={(e) => {
              editedRef.current = true;
              setFilename(e.target.value);
            }}
          />
        </label>

        <div className="btn-row">
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              onExport({
                layerId: scope === 'all' ? null : scope,
                format,
                prettify,
                precision,
                filename: filename.trim() || suggested,
              })
            }
          >
            Download
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
