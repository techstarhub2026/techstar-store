import { useCallback, useRef, useState } from 'react';
import { FileText, GripVertical, ImagePlus, Loader2, Star, Trash2, UploadCloud } from 'lucide-react';
import { api } from '../lib/api';
import { useUi } from '../stores';
import { Button, IconButton, Modal } from '../components/ui';
import type { MediaDto } from '../lib/types';
import { convertHeicFiles, isHeic } from '../lib/heic';

// `image/heic`/`image/heif` are listed here even though the server rejects
// them, so a phone's file picker still shows and allows selecting the
// photo — convertHeicFiles() below turns it into a JPEG before it ever
// reaches the size/type checks or the network request.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif';
const MAX_MB = 5;

/**
 * Uploads images straight from the administrator's own device — drag-and-drop
 * or a file picker — and returns the stored media records. Files go to the
 * media library immediately so a half-finished form never loses an upload.
 */
export function ImageUploader({
  value,
  onChange,
  max = 20,
  label = 'Photos',
  hint = 'Drag & drop images here, or browse your device — iPhone photos included. Up to 5 MB each.',
  single = false,
}: {
  value: MediaDto[];
  onChange: (images: MediaDto[]) => void;
  max?: number;
  label?: string;
  hint?: string;
  single?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Separate from `busy`: converting a large iPhone photo can take a couple
  // of seconds of real CPU work in the browser, before the network request
  // that `busy` otherwise represents has even started — a photo picked and
  // then nothing visibly happening for a moment is exactly what "upload
  // isn't working" looks like from the other side of the screen.
  const [converting, setConverting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const toast = useUi((s) => s.toast);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      let list = Array.from(files);
      if (!list.length) return;

      const heicCount = list.filter(isHeic).length;
      if (heicCount) {
        setConverting(true);
        try {
          const failed: string[] = [];
          list = await convertHeicFiles(list, (f) => failed.push(f.name));
          if (failed.length) {
            toast({
              tone: 'danger',
              title: `Could not convert ${failed.length} photo${failed.length === 1 ? '' : 's'}`,
              text: failed.join(', '),
            });
          }
          if (!list.length) return;
        } finally {
          setConverting(false);
        }
      }

      // Checked after HEIC conversion, not before: HEIC compresses noticeably
      // better than JPEG, so a photo that was under the limit as HEIC can
      // land over it once re-encoded — the limit has to apply to what's
      // actually about to be uploaded.
      const tooBig = list.filter((f) => f.size > MAX_MB * 1024 * 1024);
      if (tooBig.length) {
        toast({ tone: 'danger', title: 'File too large', text: `Images must be ${MAX_MB} MB or smaller.` });
        return;
      }
      const wrongType = list.filter((f) => !ACCEPT.split(',').includes(f.type));
      if (wrongType.length) {
        toast({ tone: 'danger', title: 'Unsupported file type', text: 'Only JPEG, PNG, WebP and AVIF are accepted.' });
        return;
      }

      setBusy(true);
      try {
        const fd = new FormData();
        for (const f of list.slice(0, max)) fd.append('files', f);
        const stored = await api.post<MediaDto[]>('/admin/media', fd);
        const next = single ? stored.slice(0, 1) : [...value, ...stored].slice(0, max);
        onChange(next);
        toast({
          tone: 'success',
          title: `${stored.length} image${stored.length === 1 ? '' : 's'} uploaded`,
        });
      } catch (e) {
        toast({ tone: 'danger', title: 'Upload failed', text: (e as Error).message });
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [max, onChange, single, toast, value],
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="mb-3">
      <div className="ts-label">{label}</div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        style={{
          border: `2px dashed ${dragging ? 'var(--ts-primary)' : 'var(--ts-border)'}`,
          background: dragging ? 'var(--ts-primary-tint)' : 'var(--ts-surface-alt)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          textAlign: 'center',
        }}
      >
        {converting ? (
          <div className="d-flex align-items-center justify-content-center gap-2">
            <Loader2 size={18} className="spin" /> Converting photo…
          </div>
        ) : busy ? (
          <div className="d-flex align-items-center justify-content-center gap-2">
            <Loader2 size={18} className="spin" /> Uploading…
          </div>
        ) : (
          <>
            <UploadCloud size={30} style={{ color: 'var(--ts-text-muted)' }} />
            <div style={{ fontSize: 14, marginTop: 6 }}>{hint}</div>
            <div className="d-flex gap-2 justify-content-center mt-3 flex-wrap">
              <Button type="button" size="sm" onClick={() => inputRef.current?.click()}>
                <ImagePlus size={15} /> Choose from device
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setLibraryOpen(true)}>
                Pick from library
              </Button>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple={!single}
          hidden
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>

      {value.length > 0 ? (
        <div className="d-flex flex-wrap gap-2 mt-3">
          {value.map((img, i) => (
            <div
              key={img.id}
              style={{
                position: 'relative', width: 104, border: '1px solid var(--ts-border)',
                borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: '#fff',
              }}
            >
              <img src={img.sm} alt={img.altText ?? ''} style={{ width: '100%', height: 84, objectFit: 'contain', background: 'var(--ts-surface-sunken)' }} />
              {i === 0 && !single ? (
                <span
                  className="ts-badge ts-badge--primary"
                  style={{ position: 'absolute', top: 4, left: 4, fontSize: 9 }}
                >
                  <Star size={9} /> Main
                </span>
              ) : null}
              <div className="d-flex justify-content-between px-1 py-1" style={{ background: 'var(--ts-surface-alt)' }}>
                {!single ? (
                  <div className="d-flex">
                    <button type="button" className="ts-iconbtn" style={{ width: 22, height: 22 }}
                      aria-label="Move left" onClick={() => move(i, i - 1)} disabled={i === 0}>‹</button>
                    <button type="button" className="ts-iconbtn" style={{ width: 22, height: 22 }}
                      aria-label="Move right" onClick={() => move(i, i + 1)} disabled={i === value.length - 1}>›</button>
                  </div>
                ) : <span />}
                <button
                  type="button"
                  className="ts-iconbtn"
                  style={{ width: 22, height: 22 }}
                  aria-label="Remove image"
                  onClick={() => onChange(value.filter((v) => v.id !== img.id))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <MediaLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(picked) => {
          const next = single ? [picked] : [...value.filter((v) => v.id !== picked.id), picked].slice(0, max);
          onChange(next);
          setLibraryOpen(false);
        }}
      />
    </div>
  );
}

export interface SpecSheetValue {
  id: number;
  url: string;
  filename: string;
  byteSize?: number;
}

function formatBytes(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A single-file PDF uploader for product datasheets — every serious
 * electronics retailer (AliExpress, Mouser, DigiKey) attaches a manufacturer
 * spec sheet, so this shares the same /admin/media pipeline as photos but
 * only accepts PDFs and keeps exactly one file.
 */
export function SpecSheetUploader({
  value,
  onChange,
  hint = 'Attach the manufacturer datasheet as a PDF, up to 5 MB.',
}: {
  value: SpecSheetValue | null;
  onChange: (file: SpecSheetValue | null) => void;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const toast = useUi((s) => s.toast);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (!file) return;

      if (file.type !== 'application/pdf') {
        toast({ tone: 'danger', title: 'Unsupported file type', text: 'Only PDF documents are accepted.' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ tone: 'danger', title: 'File too large', text: 'Datasheets must be 5 MB or smaller.' });
        return;
      }

      setBusy(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const [stored] = await api.post<MediaDto[]>('/admin/media', fd);
        onChange({ id: stored.id, url: stored.lg, filename: file.name, byteSize: file.size });
        toast({ tone: 'success', title: 'Datasheet uploaded' });
      } catch (e) {
        toast({ tone: 'danger', title: 'Upload failed', text: (e as Error).message });
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onChange, toast],
  );

  if (value) {
    return (
      <div className="mb-3">
        <div className="ts-label">Spec sheet (PDF)</div>
        <div className="d-flex align-items-center gap-3 p-3" style={{ border: '1px solid var(--ts-border)', borderRadius: 'var(--radius-md)', background: 'var(--ts-surface-alt)' }}>
          <FileText size={26} style={{ color: 'var(--ts-primary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <a href={value.url} target="_blank" rel="noopener" style={{ fontSize: 13.5, fontWeight: 600, wordBreak: 'break-all' }}>
              {value.filename}
            </a>
            {value.byteSize ? <div className="ts-muted" style={{ fontSize: 12 }}>{formatBytes(value.byteSize)}</div> : null}
          </div>
          <button type="button" className="ts-iconbtn" aria-label="Remove datasheet" onClick={() => onChange(null)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="ts-label">Spec sheet (PDF)</div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragging ? 'var(--ts-primary)' : 'var(--ts-border)'}`,
          background: dragging ? 'var(--ts-primary-tint)' : 'var(--ts-surface-alt)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          textAlign: 'center',
        }}
      >
        {busy ? (
          <div className="d-flex align-items-center justify-content-center gap-2">
            <Loader2 size={18} className="spin" /> Uploading…
          </div>
        ) : (
          <>
            <FileText size={28} style={{ color: 'var(--ts-text-muted)' }} />
            <div style={{ fontSize: 14, marginTop: 6 }}>{hint}</div>
            <Button type="button" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
              <UploadCloud size={15} /> Choose PDF
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>
    </div>
  );
}

export function MediaLibraryModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: MediaDto) => void;
}) {
  const [items, setItems] = useState<MediaDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.raw<{ data: MediaDto[] }>(`/admin/media?pageSize=60&q=${encodeURIComponent(q)}`);
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }, [q]);

  return (
    <Modal open={open} onClose={onClose} title="Media library" size="lg">
      <div className="d-flex gap-2 mb-3">
        <input
          className="ts-input"
          placeholder="Search by filename"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
        />
        <Button type="button" onClick={() => void load()} loading={loading}>Search</Button>
      </div>
      {!items.length ? (
        <div className="text-center py-4">
          <Button type="button" variant="secondary" onClick={() => void load()}>Load images</Button>
        </div>
      ) : (
        <div className="d-flex flex-wrap gap-2" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m)}
              style={{
                width: 110, padding: 0, border: '1px solid var(--ts-border)',
                borderRadius: 4, background: '#fff', cursor: 'pointer', overflow: 'hidden',
              }}
            >
              <img src={m.sm} alt="" style={{ width: '100%', height: 88, objectFit: 'contain', background: 'var(--ts-surface-sunken)' }} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
