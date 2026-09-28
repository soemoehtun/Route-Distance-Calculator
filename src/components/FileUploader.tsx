import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface Props {
  busy: boolean;
  /** Replaces the current selection with the picked/dropped files. */
  onFiles: (files: File[]) => void;
  /** Merges the picked files into the current selection. */
  onAdd?: (files: File[]) => void;
  /** True when an import is already loaded, so "Add more files" is available. */
  canAdd?: boolean;
  onSample: () => void;
}

export default function FileUploader({ busy, onFiles, onAdd, canAdd, onSample }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<'replace' | 'add'>('replace');
  const [over, setOver] = useState(false);

  const deliver = (files: File[], mode: 'replace' | 'add') => {
    if (!files.length) return;
    if (mode === 'add' && onAdd) onAdd(files);
    else onFiles(files);
  };

  const openPicker = (mode: 'replace' | 'add') => {
    modeRef.current = mode;
    inputRef.current?.click();
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setOver(false);
    if (busy) return;
    deliver(Array.from(event.dataTransfer.files), 'replace');
  };

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        data-dragging={over}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        onClick={() => openPicker('replace')}
        className="pfc-drop-zone"
        aria-label="Choose one or more route files, or drag and drop them here"
      >
        <Upload size={24} strokeWidth={1.6} className="pfc-drop-icon mb-3" aria-hidden="true" />
        <span className="pfc-drop-title">
          {busy ? 'Reading route files...' : 'Drop files to upload'}
        </span>
        <span className="pfc-drop-types mt-2">KML · KMZ · SHP · TAB · MIF</span>
        <span className="pfc-drop-hint">
          Select as many datasets as you like — they are merged into one calculation.
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".kml,.kmz,.shp,.shx,.dbf,.prj,.cpg,.tab,.dat,.map,.id,.mif,.mid"
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          deliver(files, modeRef.current);
          modeRef.current = 'replace';
          event.target.value = '';
        }}
      />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {canAdd && onAdd && (
          <button type="button" disabled={busy} onClick={() => openPicker('add')} className="pfc-text-link disabled:opacity-50">
            Add more files
          </button>
        )}
        <button type="button" disabled={busy} onClick={onSample} className="pfc-text-link disabled:opacity-50">
          Load sample dataset
        </button>
      </div>
    </div>
  );
}
