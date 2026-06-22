interface TopBarProps {
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  hasData: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onExport: () => void;
}

export default function TopBar(props: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ◳
        </span>
        <span className="brand-name">GeoShapeHelper</span>
        <span className="brand-sub">topology-safe GeoJSON editor</span>
      </div>
      <div className="topbar-actions">
        <button className="btn" disabled={!props.canUndo} onClick={props.onUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button className="btn" disabled={!props.canRedo} onClick={props.onRedo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <button className="btn" disabled={!props.canReset} onClick={props.onReset} title="Reset to original">
          ⤺ Reset
        </button>
        <button className="btn primary" disabled={!props.hasData} onClick={props.onExport}>
          ⤓ Export
        </button>
        <a
          className="btn kofi"
          href="https://ko-fi.com/W4Q021V4U0"
          target="_blank"
          rel="noopener noreferrer"
          title="Support this project on Ko-fi"
        >
          ☕ Buy me a coffee
        </a>
      </div>
    </header>
  );
}
