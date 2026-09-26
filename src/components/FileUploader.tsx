import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface Props {
  busy: boolean;
  onFiles: (files: File[]) => void;
  onSample: () => void;
}

export default function FileUploader({ busy, onFiles, onSample }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setOver(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFiles(files);
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
        onClick={() => inputRef.current?.click()}
        className="pfc-drop-zone"
        aria-label="Choose route files or drag and drop them here"
      >
        <Upload size={24} strokeWidth={1.6} className="pfc-drop-icon mb-3" aria-hidden="true" />
        <span className="pfc-drop-title">{busy ? 'Reading route file...' : 'Drop file to upload'}</span>
        <span className="pfc-drop-types mt-2">KML · KMZ · SHP · TAB · MIF</span>
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
          if (files.length) onFiles(files);
          event.target.value = '';
        }}
      />

      <div className="mt-2 text-[11px]">
        <button type="button" disabled={busy} onClick={onSample} className="pfc-text-link disabled:opacity-50">
          Load sample dataset
        </button>
      </div>
    </div>
  );
}