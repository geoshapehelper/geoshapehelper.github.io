interface ViewControlsProps {
  baseVisible: boolean;
  baseOpacity: number;
  showLabels: boolean;
  hasData: boolean;
  onBaseVisible: (v: boolean) => void;
  onBaseOpacity: (v: number) => void;
  onShowLabels: (v: boolean) => void;
  onFit: () => void;
}

export default function ViewControls(props: ViewControlsProps) {
  return (
    <div className="panel">
      <label className="check">
        <input
          type="checkbox"
          checked={props.baseVisible}
          onChange={(e) => props.onBaseVisible(e.target.checked)}
        />
        <span>Show OpenStreetMap base</span>
      </label>
      <label className="field">
        <span>Base map opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={props.baseOpacity}
          disabled={!props.baseVisible}
          onChange={(e) => props.onBaseOpacity(Number(e.target.value))}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={props.showLabels}
          onChange={(e) => props.onShowLabels(e.target.checked)}
        />
        <span>Show feature labels</span>
      </label>
      <button className="btn full" disabled={!props.hasData} onClick={props.onFit}>
        ⊕ Fit to data
      </button>
    </div>
  );
}
