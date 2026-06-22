import { useRef, useState } from 'react';

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  busy: boolean;
}

const ACCEPT = '.geojson,.json,application/geo+json,application/json';

export default function UploadZone({ onFiles, busy }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="dropzone-icon" aria-hidden>
        ⤓
      </div>
      <div className="dropzone-text">
        <strong>Drop GeoJSON files</strong> or click to browse
      </div>
      <div className="dropzone-sub">.geojson / .json · multiple files · WGS84 (lon/lat)</div>
      {busy && <div className="dropzone-sub">Processing…</div>}
    </div>
  );
}
