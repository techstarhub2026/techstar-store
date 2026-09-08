import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, FolderKanban, GalleryHorizontal, Hash, LayoutGrid,
  Plus, SquarePen, Trash2,
} from 'lucide-react';
import { ApiError, api } from '../lib/api';
import type { MediaDto } from '../lib/types';
import { PageHeader } from './AdminLayout';
import { ImageUploader } from './ImageUploader';
import { RichEditor } from './RichEditor';
import {
  Button, ConfirmDialog, EmptyState, Modal, Select, Skeleton, TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

/**
 * The techstarhub.or.tz homepage, editable.
 *
 * Its carousel, highlight cards, impact counters and programme pages were all
 * hard-coded in index.html. Each screen here manages one of those blocks.
 * Ordering is explicit (`position`) with move up/down controls, because the
 * order these appear in on the page is a content decision, not an accident of
 * insertion order.
 */

/** Shared plumbing: fetch a list, save one, delete one, reorder two. */
function useCrud(resource: string, queryKey: string) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);

  const list = useQuery({
    queryKey: ['admin', queryKey],
    queryFn: () => api.get<any[]>(`/admin/${resource}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', queryKey] });

  const save = async (id: number | null, payload: unknown) => {
    if (id) await api.patch(`/admin/${resource}/${id}`, payload);
    else await api.post(`/admin/${resource}`, payload);
    await refresh();
  };

  const remove = async (id: number) => {
    await api.del(`/admin/${resource}/${id}`);
    await refresh();
  };

  /** Swaps two rows' positions so "move up" is one obvious action. */
  const swap = async (a: any, b: any) => {
    await Promise.all([
      api.patch(`/admin/${resource}/${a.id}`, { position: b.position ?? 0 }),
      api.patch(`/admin/${resource}/${b.id}`, { position: a.position ?? 0 }),
    ]);
    await refresh();
  };

  return { list, save, remove, swap, toast };
}

function OrderButtons({ rows, index, onSwap }: { rows: any[]; index: number; onSwap: (a: any, b: any) => void }) {
  return (
    <>
      <button className="ts-iconbtn" aria-label="Move up" disabled={index === 0}
        onClick={() => onSwap(rows[index], rows[index - 1])}>
        <ArrowUp size={14} />
      </button>
      <button className="ts-iconbtn" aria-label="Move down" disabled={index === rows.length - 1}
        onClick={() => onSwap(rows[index], rows[index + 1])}>
        <ArrowDown size={14} />
      </button>
    </>
  );
}

function ActiveToggle({ checked, onChange, label = 'Shown on the website' }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string;
}) {
  return (
    <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ══════════════════════════════════════════════════════ hero slides ══

export function AdminHeroSlides() {
  const { list, save, remove, swap, toast } = useCrud('hero-slides', 'hero-slides');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [artwork, setArtwork] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({
    title: '', subtitle: '', tabLabel: '', buttonText: '', buttonUrl: '', isActive: true,
  });

  const rows = list.data ?? [];

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setArtwork(row?.artwork ? [row.artwork] : []);
    setForm({
      title: row?.title ?? '', subtitle: row?.subtitle ?? '', tabLabel: row?.tabLabel ?? '',
      buttonText: row?.buttonText ?? '', buttonUrl: row?.buttonUrl ?? '', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      await save(editing?.id ?? null, {
        ...form,
        imageId: image[0]?.id ?? null,
        artworkImageId: artwork[0]?.id ?? null,
        position: editing?.position ?? rows.length,
      });
      toast({ tone: 'success', title: editing ? 'Slide updated' : 'Slide added' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="Hero slides"
        description="The rotating banner at the top of the website home page. The tab label is the button shown under the banner."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Add slide</Button>}
      />

      {list.isLoading ? <Skeleton h={220} /> : !rows.length ? (
        <EmptyState icon={<GalleryHorizontal size={44} />} title="No slides yet"
          action={<Button onClick={() => openForm()}>Add the first slide</Button>} />
      ) : (
        <div className="row g-3">
          {rows.map((s, i) => (
            <div className="col-12 col-lg-6" key={s.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden', opacity: s.isActive ? 1 : 0.55 }}>
                <div style={{
                  height: 130, background: s.image ? `center/cover url(${s.image.md})` : 'var(--ts-ink)',
                  display: 'grid', placeItems: 'center', color: '#fff', padding: 12, textAlign: 'center',
                }}>
                  <strong style={{ fontSize: 14, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{s.title}</strong>
                </div>
                <div className="p-3">
                  <span className="ts-badge">{s.tabLabel}</span>
                  {!s.isActive ? <span className="ts-badge ts-badge--warning ms-1">Hidden</span> : null}
                  <p className="ts-muted ts-clamp-2 mt-2 mb-2" style={{ fontSize: 12.5 }}>{s.subtitle}</p>
                  <div className="d-flex gap-1">
                    <OrderButtons rows={rows} index={i} onSwap={(a, b) => void swap(a, b)} />
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(s)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(s)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? 'Edit slide' : 'Add slide'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Headline" value={form.title} error={errors.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextArea label="Supporting text" value={form.subtitle} rows={3}
          onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
        <TextInput label="Tab label" value={form.tabLabel} error={errors.tabLabel}
          onChange={(e) => setForm({ ...form, tabLabel: e.target.value })}
          hint="The short label on the button under the banner, e.g. “STEM Bootcamps”." required />
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Button text" value={form.buttonText}
              onChange={(e) => setForm({ ...form, buttonText: e.target.value })}
              placeholder="Explore Programs" />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Button link" value={form.buttonUrl}
              onChange={(e) => setForm({ ...form, buttonUrl: e.target.value })}
              placeholder="courses.html" />
          </div>
        </div>
        <ImageUploader value={image} onChange={setImage} single max={1} label="Background image"
          hint="Fills the whole banner. Wide landscape images work best — 1920×900 or similar." />
        <ImageUploader value={artwork} onChange={setArtwork} single max={1} label="Foreground artwork"
          hint="Optional. Sits beside the text on the right — a product shot or logo on a transparent background." />
        <ActiveToggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this slide?"
        message={<>Remove <strong>{confirm?.title}</strong> from the home page banner?</>}
        onConfirm={async () => {
          setBusy(true);
          try { await remove(confirm.id); toast({ tone: 'success', title: 'Slide deleted' }); }
          finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═══════════════════════════════════════════════════ highlight cards ══

export function AdminHighlights() {
  const { list, save, remove, swap, toast } = useCrud('highlight-cards', 'highlight-cards');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({ pill: '', title: '', linkUrl: '', variant: 'navy', isActive: true });

  const rows = list.data ?? [];

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      pill: row?.pill ?? '', title: row?.title ?? '', linkUrl: row?.linkUrl ?? '',
      variant: row?.variant ?? 'navy', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      await save(editing?.id ?? null, {
        ...form, imageId: image[0]?.id ?? null, position: editing?.position ?? rows.length,
      });
      toast({ tone: 'success', title: editing ? 'Card updated' : 'Card added' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="Highlight cards"
        description="The three feature cards directly under the home page banner."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Add card</Button>}
      />

      {list.isLoading ? <Skeleton h={220} /> : !rows.length ? (
        <EmptyState icon={<LayoutGrid size={44} />} title="No highlight cards yet"
          action={<Button onClick={() => openForm()}>Add the first card</Button>} />
      ) : (
        <div className="row g-3">
          {rows.map((c, i) => (
            <div className="col-12 col-md-6 col-lg-4" key={c.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden', opacity: c.isActive ? 1 : 0.55 }}>
                <div style={{
                  padding: 14, color: '#fff',
                  background: c.variant === 'orange' ? 'var(--ts-primary)' : 'var(--ts-ink)',
                }}>
                  <span style={{
                    fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em',
                    border: '1px solid currentColor', borderRadius: 999, padding: '2px 10px',
                  }}>{c.pill}</span>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>{c.title}</div>
                </div>
                {c.image ? <img src={c.image.md} alt="" style={{ width: '100%', height: 110, objectFit: 'cover' }} /> : null}
                <div className="p-3 d-flex gap-1">
                  <OrderButtons rows={rows} index={i} onSwap={(a, b) => void swap(a, b)} />
                  <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(c)}><SquarePen size={15} /></button>
                  <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(c)}><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit card' : 'Add card'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Small label" value={form.pill} error={errors.pill}
          onChange={(e) => setForm({ ...form, pill: e.target.value })}
          placeholder="e.g. Who We Are" required />
        <TextInput label="Title" value={form.title} error={errors.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextInput label="Link" value={form.linkUrl}
          onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
          placeholder="about.html" />
        <Select label="Colour" value={form.variant}
          onChange={(e) => setForm({ ...form, variant: e.target.value })}>
          <option value="navy">Navy</option>
          <option value="orange">Orange</option>
        </Select>
        <ImageUploader value={image} onChange={setImage} single max={1} label="Card image" />
        <ActiveToggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this card?"
        message={<>Remove <strong>{confirm?.title}</strong> from the home page?</>}
        onConfirm={async () => {
          setBusy(true);
          try { await remove(confirm.id); toast({ tone: 'success', title: 'Card deleted' }); }
          finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═══════════════════════════════════════════════════ impact numbers ══

export function AdminSiteStats() {
  const { list, save, remove, swap, toast } = useCrud('site-stats', 'site-stats');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ label: '', value: '0', suffix: '', isActive: true });

  const rows = list.data ?? [];

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setForm({
      label: row?.label ?? '', value: String(row?.value ?? 0),
      suffix: row?.suffix ?? '', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      await save(editing?.id ?? null, {
        ...form, value: Number(form.value || 0), position: editing?.position ?? rows.length,
      });
      toast({ tone: 'success', title: editing ? 'Number updated' : 'Number added' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="Impact numbers"
        description="The counters on the website home page — students reached, schools, and so on."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Add number</Button>}
      />

      {list.isLoading ? <Skeleton h={180} /> : !rows.length ? (
        <EmptyState icon={<Hash size={44} />} title="No impact numbers yet"
          action={<Button onClick={() => openForm()}>Add the first number</Button>} />
      ) : (
        <div className="row g-3">
          {rows.map((s, i) => (
            <div className="col-6 col-lg-3" key={s.id}>
              <div className="ts-stat h-100" style={{ opacity: s.isActive ? 1 : 0.55 }}>
                <div className="ts-stat__value">
                  {Number(s.value).toLocaleString()}{s.suffix ?? ''}
                </div>
                <div className="ts-stat__label" style={{ textTransform: 'none', letterSpacing: 0 }}>{s.label}</div>
                <div className="d-flex gap-1 mt-2">
                  <OrderButtons rows={rows} index={i} onSwap={(a, b) => void swap(a, b)} />
                  <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(s)}><SquarePen size={15} /></button>
                  <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(s)}><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit number' : 'Add number'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Label" value={form.label} error={errors.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="e.g. Students" required />
        <div className="row">
          <div className="col-8">
            <TextInput label="Number" type="number" min={0} value={form.value} error={errors.value}
              onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, '') })} required />
          </div>
          <div className="col-4">
            <TextInput label="Suffix" value={form.suffix}
              onChange={(e) => setForm({ ...form, suffix: e.target.value })} placeholder="+" />
          </div>
        </div>
        <ActiveToggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this number?"
        message={<>Remove <strong>{confirm?.label}</strong> from the home page?</>}
        onConfirm={async () => {
          setBusy(true);
          try { await remove(confirm.id); toast({ tone: 'success', title: 'Number deleted' }); }
          finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═══════════════════════════════════════════════ programmes / projects ══

export function AdminProjects() {
  const { list, save, remove, swap, toast } = useCrud('projects', 'projects');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({ title: '', excerpt: '', contentHtml: '', isActive: true });

  const rows = list.data ?? [];

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      title: row?.title ?? '', excerpt: row?.excerpt ?? '',
      contentHtml: row?.contentHtml ?? '', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      await save(editing?.id ?? null, {
        ...form, imageId: image[0]?.id ?? null, position: editing?.position ?? rows.length,
      });
      toast({ tone: 'success', title: editing ? 'Programme updated' : 'Programme published' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="Programs"
        description="The programme pages linked from the website’s Programs menu."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New program</Button>}
      />

      {list.isLoading ? <Skeleton h={220} /> : !rows.length ? (
        <EmptyState icon={<FolderKanban size={44} />} title="No programs yet"
          action={<Button onClick={() => openForm()}>Add the first program</Button>} />
      ) : (
        <div className="row g-3">
          {rows.map((p, i) => (
            <div className="col-12 col-md-6 col-lg-4" key={p.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden', opacity: p.isActive ? 1 : 0.55 }}>
                {p.image ? <img src={p.image.md} alt=""
                  style={{ width: '100%', height: 130, objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} /> : null}
                <div className="p-3">
                  <strong style={{ fontSize: 14.5 }}>{p.title}</strong>
                  <p className="ts-muted ts-clamp-2 mt-1 mb-2" style={{ fontSize: 12.5 }}>{p.excerpt}</p>
                  <div className="d-flex gap-1">
                    <OrderButtons rows={rows} index={i} onSwap={(a, b) => void swap(a, b)} />
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(p)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(p)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? 'Edit program' : 'New program'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Title" value={form.title} error={errors.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextArea label="Short summary" value={form.excerpt} rows={2}
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
          hint="Shown on the card that links to this program." />
        <RichEditor label="Full page content" value={form.contentHtml} error={errors.contentHtml}
          onChange={(html) => setForm({ ...form, contentHtml: html })}
          placeholder="Describe the program…" required />
        <ImageUploader value={image} onChange={setImage} single max={1} label="Cover image" />
        <ActiveToggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this program?"
        message={<>Delete <strong>{confirm?.title}</strong>?</>}
        onConfirm={async () => {
          setBusy(true);
          try { await remove(confirm.id); toast({ tone: 'success', title: 'Program deleted' }); }
          finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═══════════════════════════════════════════ "What We Offer" block ══

/**
 * A single block rather than a list, so this screen loads one record and
 * saves it whole — there is nothing to create or delete.
 */
export function AdminHomeOffer() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [bullets, setBullets] = useState<string[]>([]);
  const [form, setForm] = useState({ title: '', lead: '', linkText: '', linkUrl: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'home-offer'],
    queryFn: () => api.get<any>('/admin/home-offer'),
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      title: data.title ?? '',
      lead: data.lead ?? '',
      linkText: data.linkText ?? '',
      linkUrl: data.linkUrl ?? '',
    });
    setBullets(Array.isArray(data.bullets) ? data.bullets : []);
    setImage(data.image ? [data.image] : []);
  }, [data]);

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      await api.put('/admin/home-offer', {
        ...form,
        bullets: bullets.filter((b) => b.trim()),
        imageId: image[0]?.id ?? null,
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'home-offer'] });
      toast({ tone: 'success', title: 'Section updated' });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  const setBullet = (i: number, value: string) =>
    setBullets((b) => b.map((t, idx) => (idx === i ? value : t)));

  const moveBullet = (i: number, delta: number) =>
    setBullets((b) => {
      const next = [...b];
      const to = i + delta;
      if (to < 0 || to >= next.length) return b;
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });

  if (isLoading) return <Skeleton h={420} />;

  return (
    <>
      <PageHeader
        title="What We Offer"
        description="The split section on the website home page — heading, intro, bullet points and photo."
        actions={<Button onClick={() => void save()} loading={busy}>Save changes</Button>}
      />

      <div className="row g-3">
        <div className="col-12 col-lg-7">
          <div className="ts-card p-4">
            <TextInput label="Heading" value={form.title} error={errors.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              hint="The last word is shown in the accent colour on the site." required />

            <TextArea label="Intro paragraph" value={form.lead} rows={3}
              onChange={(e) => setForm({ ...form, lead: e.target.value })} />

            <div className="ts-label">Bullet points</div>
            {bullets.length === 0 ? (
              <p className="ts-muted" style={{ fontSize: 13 }}>No bullet points yet.</p>
            ) : null}

            {bullets.map((b, i) => (
              <div className="d-flex gap-2 align-items-start mb-2" key={i}>
                <TextArea
                  value={b}
                  rows={2}
                  onChange={(e) => setBullet(i, e.target.value)}
                  // The field carries its own spacing inside a row, so the
                  // usual bottom margin would stagger the buttons beside it.
                  className="mb-0"
                />
                <div className="d-flex flex-column gap-1">
                  <button type="button" className="ts-iconbtn" aria-label="Move up"
                    disabled={i === 0} onClick={() => moveBullet(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="ts-iconbtn" aria-label="Move down"
                    disabled={i === bullets.length - 1} onClick={() => moveBullet(i, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" className="ts-iconbtn" aria-label="Remove"
                    onClick={() => setBullets((list) => list.filter((_, idx) => idx !== i))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            <Button type="button" variant="secondary" size="sm" className="mt-2"
              disabled={bullets.length >= 8}
              onClick={() => setBullets((b) => [...b, ''])}>
              <Plus size={14} /> Add bullet point
            </Button>

            <hr className="my-4" />

            <div className="row">
              <div className="col-12 col-md-6">
                <TextInput label="Button text" value={form.linkText}
                  onChange={(e) => setForm({ ...form, linkText: e.target.value })}
                  placeholder="Read More" />
              </div>
              <div className="col-12 col-md-6">
                <TextInput label="Button links to" value={form.linkUrl}
                  onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
                  placeholder="courses.html" />
              </div>
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="ts-card p-4">
            <ImageUploader value={image} onChange={setImage} single max={1} label="Section photo"
              hint="Fills the right-hand half of the section. A tall portrait crop works best." />
          </div>
        </div>
      </div>
    </>
  );
}
