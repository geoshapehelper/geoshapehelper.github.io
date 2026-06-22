import { useState } from 'react';
import type { GeoStats } from '../types';

export interface LogEntry {
  id: number;
  kind: 'info' | 'warn' | 'error' | 'report';
  text: string;
}

interface StatusBarProps {
  busy: boolean;
  stats: GeoStats | null;
  log: LogEntry[];
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function StatusBar({ busy, stats, log }: StatusBarProps) {
  const [open, setOpen] = useState(false);
  const last = log[log.length - 1];

  return (
    <footer className="statusbar">
      <div className="status-main">
        {busy ? (
          <span className="status-busy">
            <span className="spinner" aria-hidden /> Processing…
          </span>
        ) : (
          <button
            className={`status-last ${last?.kind ?? ''}`}
            onClick={() => setOpen((o) => !o)}
            title="Show log"
          >
            {last ? last.text : 'Ready.'}{' '}
            {log.length > 1 && <span className="muted small">({log.length} messages ▾)</span>}
          </button>
        )}
      </div>

      <div className="status-stats">
        {stats ? (
          <>
            <span title="Features">▦ {fmt(stats.features)}</span>
            <span title="Vertices">• {fmt(stats.vertices)} pts</span>
            <span title="Total geodesic area">⬡ {fmt(Math.round(stats.areaKm2))} km²</span>
            <span title="Approx. minified size">
              ⤓ {stats.bytes >= 1048576 ? `${(stats.bytes / 1048576).toFixed(1)} MB` : `${(stats.bytes / 1024).toFixed(0)} KB`}
            </span>
          </>
        ) : (
          <span className="muted">No data loaded</span>
        )}
      </div>

      {open && log.length > 0 && (
        <div className="log-popover">
          <div className="log-head">
            <strong>Log</strong>
            <button className="icon-btn" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <ul>
            {[...log].reverse().map((e) => (
              <li key={e.id} className={`log-${e.kind}`}>
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </footer>
  );
}
