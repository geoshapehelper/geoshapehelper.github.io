import type { LayerMeta } from '../types';

interface LayerListProps {
  layers: LayerMeta[];
  onUpdate: (layerId: string, patch: Partial<LayerMeta>) => void;
  onRemove: (layerId: string) => void;
}

export default function LayerList({ layers, onUpdate, onRemove }: LayerListProps) {
  if (layers.length === 0) {
    return <p className="muted small">No layers yet. Upload one or more GeoJSON files to begin.</p>;
  }
  return (
    <ul className="layer-list">
      {layers.map((layer) => (
        <li key={layer.id} className="layer-item">
          <div className="layer-row">
            <input
              type="checkbox"
              checked={layer.visible}
              title="Toggle visibility"
              aria-label={`Toggle ${layer.name}`}
              onChange={(e) => onUpdate(layer.id, { visible: e.target.checked })}
            />
            <input
              type="color"
              value={layer.color}
              title="Layer color"
              aria-label={`Color for ${layer.name}`}
              onChange={(e) => onUpdate(layer.id, { color: e.target.value })}
            />
            <span className="layer-name" title={layer.name}>
              {layer.name}
            </span>
            <span className="layer-count">{layer.featureCount}</span>
            <button
              className="icon-btn"
              title="Remove layer"
              aria-label={`Remove ${layer.name}`}
              onClick={() => onRemove(layer.id)}
            >
              ✕
            </button>
          </div>
          <label className="layer-namefield">
            <span className="muted small">Label field</span>
            <select
              value={layer.nameField ?? ''}
              onChange={(e) => onUpdate(layer.id, { nameField: e.target.value || null })}
            >
              <option value="">(none)</option>
              {layer.nameFieldCandidates.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </li>
      ))}
    </ul>
  );
}
