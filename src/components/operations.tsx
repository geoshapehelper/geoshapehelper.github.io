import { useState } from 'react';
import NumberField from './NumberField';
import type {
  CleanParams,
  GeoStats,
  IslandParams,
  SimplifyMethod,
  SimplifyParams,
  SmoothParams,
} from '../types';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

// --- Simplify --------------------------------------------------------------

interface SimplifyProps {
  beforeStats: GeoStats | null;
  afterStats: GeoStats | null;
  previewing: boolean;
  busy: boolean;
  disabled: boolean;
  onPreview: (p: SimplifyParams) => void;
  onApply: (p: SimplifyParams) => void;
  onClearPreview: () => void;
}

export function SimplifyPanel({
  beforeStats,
  afterStats,
  previewing,
  busy,
  disabled,
  onPreview,
  onApply,
  onClearPreview,
}: SimplifyProps) {
  const [percentage, setPercentage] = useState(20);
  const [method, setMethod] = useState<SimplifyMethod>('visvalingam');
  const [keepShapes, setKeepShapes] = useState(true);

  const params: SimplifyParams = { percentage, method, keepShapes };
  const preview = (p: SimplifyParams) => !disabled && onPreview(p);

  const reduction =
    beforeStats && afterStats && beforeStats.bytes > 0
      ? (1 - afterStats.bytes / beforeStats.bytes) * 100
      : null;

  return (
    <div className="panel">
      <label className="field">
        <span>
          Retain <strong>{percentage}%</strong> of vertices
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percentage}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPercentage(v);
            preview({ ...params, percentage: v });
          }}
        />
      </label>

      <label className="field">
        <span>Method</span>
        <select
          value={method}
          disabled={disabled}
          onChange={(e) => {
            const m = e.target.value as SimplifyMethod;
            setMethod(m);
            preview({ ...params, method: m });
          }}
        >
          <option value="visvalingam">Visvalingam (smoother)</option>
          <option value="dp">Douglas-Peucker</option>
        </select>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={keepShapes}
          disabled={disabled}
          onChange={(e) => {
            setKeepShapes(e.target.checked);
            preview({ ...params, keepShapes: e.target.checked });
          }}
        />
        <span>Prevent shape removal (keep small features)</span>
      </label>

      <div className="stats-grid">
        <div>
          <span className="muted small">Vertices</span>
          <div>
            {beforeStats ? fmt(beforeStats.vertices) : '-'} →{' '}
            <strong>{afterStats ? fmt(afterStats.vertices) : '-'}</strong>
          </div>
        </div>
        <div>
          <span className="muted small">Est. size</span>
          <div>
            {beforeStats ? kb(beforeStats.bytes) : '-'} →{' '}
            <strong>{afterStats ? kb(afterStats.bytes) : '-'}</strong>
            {reduction != null && <span className="muted small"> ({reduction.toFixed(0)}%↓)</span>}
          </div>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn primary" disabled={disabled || busy} onClick={() => onApply(params)}>
          Apply simplify + clean
        </button>
        <button className="btn" disabled={!previewing} onClick={onClearPreview}>
          Clear preview
        </button>
      </div>
      <p className="muted small">Preview shows simplification only; Apply also runs topology clean.</p>
    </div>
  );
}

// --- Remove islands --------------------------------------------------------

interface IslandProps {
  busy: boolean;
  disabled: boolean;
  onApply: (p: IslandParams) => void;
}

export function IslandPanel({ busy, disabled, onApply }: IslandProps) {
  const [minAreaKm2, setMin] = useState(5);
  const [wholeFeatureMode, setMode] = useState<IslandParams['wholeFeatureMode']>('keepLargest');

  return (
    <div className="panel">
      <label className="field">
        <span>Minimum island area (km²)</span>
        <NumberField value={minAreaKm2} onValue={setMin} min={0} step={0.5} disabled={disabled} />
      </label>
      <label className="field">
        <span>If an entire detached feature is below the threshold</span>
        <select
          value={wholeFeatureMode}
          disabled={disabled}
          onChange={(e) => setMode(e.target.value as IslandParams['wholeFeatureMode'])}
        >
          <option value="keepLargest">Keep its largest part</option>
          <option value="drop">Remove it entirely</option>
        </select>
      </label>
      <button
        className="btn primary"
        disabled={disabled || busy}
        onClick={() => onApply({ minAreaKm2, wholeFeatureMode })}
      >
        Remove small islands
      </button>
      <p className="muted small">
        Removes only <strong>detached islands</strong> - parts that share no border with any other
        province - below this size (geodesic area). Inland provinces that border their neighbors are
        always kept, however small.
      </p>
    </div>
  );
}

// --- Smooth ----------------------------------------------------------------

interface SmoothProps {
  busy: boolean;
  disabled: boolean;
  onApply: (p: SmoothParams) => void;
}

export function SmoothPanel({ busy, disabled, onApply }: SmoothProps) {
  const [iterations, setIter] = useState(2);
  return (
    <div className="panel">
      <label className="field">
        <span>
          Intensity: <strong>{iterations}</strong> iteration{iterations === 1 ? '' : 's'}
        </span>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={iterations}
          disabled={disabled}
          onChange={(e) => setIter(Number(e.target.value))}
        />
      </label>
      <button className="btn primary" disabled={disabled || busy} onClick={() => onApply({ iterations })}>
        Smooth edges
      </button>
      <p className="muted small">Chaikin smoothing on shared boundary arcs - junction points stay fixed, so neighbors stay coincident.</p>
    </div>
  );
}

// --- Clean / repair --------------------------------------------------------

interface CleanProps {
  params: CleanParams;
  onChange: (p: CleanParams) => void;
  onRun: () => void;
  busy: boolean;
  disabled: boolean;
}

export function CleanPanel({ params, onChange, onRun, busy, disabled }: CleanProps) {
  return (
    <div className="panel">
      <p className="muted small">
        Fixes the gaps, overlaps and slivers that editing can leave between provinces, and welds
        shared borders so neighbors line up exactly. This runs automatically after Simplify, Remove
        islands and Merge - the button just runs it on its own.
      </p>
      <label className="field">
        <span>Close gaps &amp; overlaps smaller than (km²)</span>
        <NumberField
          value={params.gapFillAreaKm2}
          onValue={(v) => onChange({ ...params, gapFillAreaKm2: v })}
          min={0}
          step={0.1}
          disabled={disabled}
        />
        <span className="muted small">0 = clean up exact overlaps only.</span>
      </label>
      <label className="field">
        <span>Merge points closer than (degrees)</span>
        <NumberField
          value={params.snapIntervalDeg}
          onValue={(v) => onChange({ ...params, snapIntervalDeg: v })}
          min={0}
          step={0.0001}
          disabled={disabled}
        />
        <span className="muted small">Nearly-overlapping vertices get snapped into one. 0 = automatic (≈0.0001° ≈ 11 m).</span>
      </label>
      <button className="btn primary" disabled={disabled || busy} onClick={onRun}>
        Run clean / repair
      </button>
    </div>
  );
}
