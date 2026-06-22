import type { Operation } from '../types';

interface HistoryPanelProps {
  ops: Operation[];
  cursor: number; // -1 = base
  onJump: (cursor: number) => void;
}

const OP_ICON: Record<Operation['type'], string> = {
  import: '⤓',
  simplify: '∿',
  clean: '✓',
  islands: '⌗',
  smooth: '◠',
  merge: '⧉',
};

export default function HistoryPanel({ ops, cursor, onJump }: HistoryPanelProps) {
  return (
    <ol className="history">
      <li className={`history-item ${cursor === -1 ? 'active' : ''}`}>
        <button onClick={() => onJump(-1)}>
          <span className="op-icon" aria-hidden>
            ●
          </span>
          <span className="op-label">Original</span>
        </button>
      </li>
      {ops.map((op, i) => (
        <li key={op.id} className={`history-item ${i === cursor ? 'active' : ''} ${i > cursor ? 'undone' : ''}`}>
          <button onClick={() => onJump(i)} title={op.report?.join('\n')}>
            <span className="op-icon" aria-hidden>
              {OP_ICON[op.type]}
            </span>
            <span className="op-label">{op.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
