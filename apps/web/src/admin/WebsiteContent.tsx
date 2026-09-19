import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, CalendarDays, Image as ImageIcon, Newspaper, Plus, SquarePen, Trash2, Users,
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
 * Manages the techstarhub.or.tz website's team, events and courses from the
 * same admin as the store catalogue — the mirrored site used to depend on a
 * separate Django admin at techstar-admin.onrender.com for courses; these
 * screens (plus the shared banners/services/FAQs above) replace it.
 */

// ══════════════════════════════════════════════════════════ team ══

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

/**
 * Shared implementation behind AdminStaff and AdminBoard below — both edit
 * the same `team_members` table, scoped by the `group` column, so someone
 * managing the Board page never sees (or reorders into) the Staff page's
 * people and vice versa. Mirrors the AdminPrograms/AdminProjects split for
 * the `projects` table.
 */
function TeamGroupAdmin({ group, title, description, addLabel }: {
  group: 'staff' | 'board'; title: string; description: string; addLabel: string;
}) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const queryKey = ['admin', 'team-members', group];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({
    name: '', role: '', bio: '', facebookUrl: '', xUrl: '', instagramUrl: '', linkedinUrl: '', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<any[]>(`/admin/team-members?group=${group}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      name: row?.name ?? '', role: row?.role ?? '', bio: row?.bio ?? '',
      facebookUrl: row?.facebookUrl ?? '', xUrl: row?.xUrl ?? '',
      instagramUrl: row?.instagramUrl ?? '', linkedinUrl: row?.linkedinUrl ?? '',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, group, imageId: image[0]?.id ?? null, position: editing?.position ?? data.length };
      if (editing) await api.patch(`/admin/team-members/${editing.id}`, payload);
      else await api.post('/admin/team-members', payload);
      await refresh();
      toast({ tone: 'success', title: editing ? 'Team member updated' : 'Team member added' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  const swap = async (a: any, b: any) => {
    await Promise.all([
      api.patch(`/admin/team-members/${a.id}`, { position: b.position ?? 0 }),
      api.patch(`/admin/team-members/${b.id}`, { position: a.position ?? 0 }),
    ]);
    await refresh();
  };

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={<Button onClick={() => openForm()}><Plus size={15} /> {addLabel}</Button>}
      />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState icon={<Users size={44} />} title="No one here yet" action={<Button onClick={() => openForm()}>Add your first person</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((m, i) => (
            <div className="col-12 col-md-6 col-lg-4" key={m.id}>
              <div className="ts-card h-100 p-3 d-flex gap-3 align-items-start" style={{ opacity: m.isActive ? 1 : 0.55 }}>
                <img
                  src={m.image?.sm ?? ''}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', background: 'var(--ts-surface-sunken)', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14.5 }}>{m.name}</strong>
                  <div className="ts-muted ts-clamp-2" style={{ fontSize: 12.5 }}>{m.role}</div>
                  <div className="d-flex gap-1 mt-2">
                    <OrderButtons rows={data} index={i} onSwap={(a, b) => void swap(a, b)} />
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(m)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(m)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? 'Edit team member' : 'Add team member'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Name" value={form.name} error={errors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Role / title" value={form.role} error={errors.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="e.g. Founder & CEO" required />
          </div>
        </div>
        <TextArea label="Short bio" value={form.bio} rows={2}
          onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Facebook URL" value={form.facebookUrl}
              onChange={(e) => setForm({ ...form, facebookUrl: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="X (Twitter) URL" value={form.xUrl}
              onChange={(e) => setForm({ ...form, xUrl: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Instagram URL" value={form.instagramUrl}
              onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="LinkedIn URL" value={form.linkedinUrl}
              onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
          </div>
        </div>
        <ImageUploader value={image} onChange={setImage} single max={1} label="Photo" />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Shown on the site
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Remove this team member?"
        message={<>Remove <strong>{confirm?.name}</strong> from the team page?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/team-members/${confirm.id}`);
            await refresh();
            toast({ tone: 'success', title: 'Team member removed' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

export function AdminWebsiteStaff() {
  return (
    <TeamGroupAdmin group="staff" title="Staff"
      description="The day-to-day team shown on techstarhub.or.tz's Staff page."
      addLabel="Add staff member" />
  );
}

export function AdminWebsiteBoard() {
  return (
    <TeamGroupAdmin group="board" title="Board"
      description="The advisory and consulting board shown on techstarhub.or.tz's Board page."
      addLabel="Add board member" />
  );
}

// ═══════════════════════════════════════════════════════════ events ══

export function AdminEvents() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({
    title: '', excerpt: '', contentHtml: '', location: '', startsAt: '', endsAt: '', registerUrl: '',
    tags: '', facts: '', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'events'],
    queryFn: () => api.get<any[]>('/admin/events'),
  });

  const toLocal = (v: string | null) => (v ? v.slice(0, 16) : '');

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      title: row?.title ?? '', excerpt: row?.excerpt ?? '', contentHtml: row?.contentHtml ?? '',
      location: row?.location ?? '', startsAt: toLocal(row?.startsAt), endsAt: toLocal(row?.endsAt),
      registerUrl: row?.registerUrl ?? '',
      // Stored as lists; edited as one per line, which is how the website
      // renders them anyway.
      tags: (Array.isArray(row?.tags) ? row.tags : []).join('\n'),
      facts: (Array.isArray(row?.facts) ? row.facts : []).join('\n'),
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const toList = (v: string) => v.split('\n').map((t) => t.trim()).filter(Boolean);
      const payload = {
        ...form,
        imageId: image[0]?.id ?? null,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        tags: toList(form.tags),
        facts: toList(form.facts),
      };
      if (editing) await api.patch(`/admin/events/${editing.id}`, payload);
      else await api.post('/admin/events', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'events'] });
      toast({ tone: 'success', title: editing ? 'Event updated' : 'Event published' });
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
        title="Events"
        description="Upcoming events shown on techstarhub.or.tz."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New event</Button>}
      />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState icon={<CalendarDays size={44} />} title="No events yet" action={<Button onClick={() => openForm()}>Add an event</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((e) => (
            <div className="col-12 col-md-6 col-lg-4" key={e.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden' }}>
                {e.image ? <img src={e.image.md} alt=""
                  style={{ width: '100%', height: 130, objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} /> : null}
                <div className="p-3">
                  <strong style={{ fontSize: 14.5 }}>{e.title}</strong>
                  <div className="ts-muted" style={{ fontSize: 12 }}>
                    {e.startsAt ? new Date(e.startsAt).toLocaleString() : 'Date TBA'}{e.location ? ` · ${e.location}` : ''}
                  </div>
                  <div className="d-flex gap-1 mt-2">
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(e)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(e)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? 'Edit event' : 'Create new event'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Title" value={form.title} error={errors.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextArea label="Excerpt" value={form.excerpt} rows={2}
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
        <RichEditor label="Details" value={form.contentHtml} error={errors.contentHtml}
          onChange={(html) => setForm({ ...form, contentHtml: html })}
          placeholder="What happens at this event…" required />
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput type="datetime-local" label="Starts" value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput type="datetime-local" label="Ends" value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Location" value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Registration link" value={form.registerUrl}
              onChange={(e) => setForm({ ...form, registerUrl: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div className="col-12 col-md-6">
            <TextArea label="Tags" value={form.tags} rows={3}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              hint="One per line — shown as pills on the event card." />
          </div>
          <div className="col-12 col-md-6">
            <TextArea label="Key facts" value={form.facts} rows={3}
              onChange={(e) => setForm({ ...form, facts: e.target.value })}
              hint="One per line — the bulleted list beside the event." />
          </div>
        </div>
        <ImageUploader value={image} onChange={setImage} single max={1} label="Event image" />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Published
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this event?"
        message={<>Delete <strong>{confirm?.title}</strong>?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/events/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'events'] });
            toast({ tone: 'success', title: 'Event deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ══════════════════════════════════════════════════════════ courses ══

export function AdminCourses() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({
    name: '', category: 'everyone', priceAmount: '0', excerpt: '', contentHtml: '', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'courses'],
    queryFn: () => api.get<any[]>('/admin/courses'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      name: row?.name ?? '', category: row?.category ?? 'everyone',
      priceAmount: String(row?.priceAmount ?? 0), excerpt: row?.excerpt ?? '',
      contentHtml: row?.contentHtml ?? '', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = {
        ...form,
        priceAmount: Number(form.priceAmount || 0),
        imageId: image[0]?.id ?? null,
      };
      if (editing) await api.patch(`/admin/courses/${editing.id}`, payload);
      else await api.post('/admin/courses', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'courses'] });
      toast({ tone: 'success', title: editing ? 'Course updated' : 'Course published' });
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
        title="Courses"
        description="Bootcamps and programmes shown on techstarhub.or.tz — replaces the old standalone courses admin."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New course</Button>}
      />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState title="No courses yet" action={<Button onClick={() => openForm()}>Add a course</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((c) => (
            <div className="col-12 col-md-6 col-lg-4" key={c.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden' }}>
                {c.image ? <img src={c.image.md} alt=""
                  style={{ width: '100%', height: 130, objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} /> : null}
                <div className="p-3">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <strong style={{ fontSize: 14.5 }}>{c.name}</strong>
                    <span className="ts-badge" style={{ flexShrink: 0 }}>{c.category}</span>
                  </div>
                  <div className="ts-muted" style={{ fontSize: 12.5 }}>TZS {Number(c.priceAmount).toLocaleString()}</div>
                  <div className="d-flex gap-1 mt-2">
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(c)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(c)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? 'Edit course' : 'Create new course'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Course name" value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="row">
          <div className="col-12 col-md-6">
            <Select label="Audience" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="school-kids">School kids</option>
              <option value="everyone">Everyone</option>
            </Select>
          </div>
          <div className="col-12 col-md-6">
            <TextInput type="number" min={0} label="Price (TZS)" value={form.priceAmount}
              onChange={(e) => setForm({ ...form, priceAmount: e.target.value.replace(/\D/g, '') })} />
          </div>
        </div>
        <TextArea label="Brief description" value={form.excerpt} rows={2}
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
          hint="Shown on the course card." />
        <RichEditor label="Full details" value={form.contentHtml} error={errors.contentHtml}
          onChange={(html) => setForm({ ...form, contentHtml: html })}
          placeholder="What the course covers, who it is for, what learners take away…" required />
        <ImageUploader value={image} onChange={setImage} single max={1} label="Course image" />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Published
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this course?"
        message={<>Delete <strong>{confirm?.name}</strong>?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/courses/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'courses'] });
            toast({ tone: 'success', title: 'Course deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ══════════════════════════════════════════════════════════ gallery ══

/**
 * The website's photo gallery.
 *
 * gallery.html used to carry a fixed grid of twelve photographs in its own
 * markup, so adding or removing one meant editing HTML. The page already had
 * the code to fetch this list — it just had nothing to fetch.
 */
export function AdminGallery() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const queryKey = ['admin', 'gallery-photos'];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [caption, setCaption] = useState('');
  const [isActive, setIsActive] = useState(true);

  const { data = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<any[]>('/admin/gallery-photos'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setCaption(row?.caption ?? '');
    setIsActive(row?.isActive ?? true);
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    if (!image[0]?.id) {
      setErrors({ imageId: 'Choose a photo' });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        imageId: image[0].id,
        caption,
        isActive,
        position: editing?.position ?? data.length,
      };
      if (editing) await api.patch(`/admin/gallery-photos/${editing.id}`, payload);
      else await api.post('/admin/gallery-photos', payload);
      await refresh();
      toast({ tone: 'success', title: editing ? 'Photo updated' : 'Photo added' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally { setBusy(false); }
  };

  const swap = async (a: any, b: any) => {
    await Promise.all([
      api.patch(`/admin/gallery-photos/${a.id}`, { position: b.position ?? 0 }),
      api.patch(`/admin/gallery-photos/${b.id}`, { position: a.position ?? 0 }),
    ]);
    await refresh();
  };

  return (
    <>
      <PageHeader
        title="Gallery"
        description="Photographs shown on techstarhub.or.tz's gallery page."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Add photo</Button>}
      />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState icon={<ImageIcon size={44} />} title="No photos yet"
          action={<Button onClick={() => openForm()}>Add your first photo</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((p, i) => (
            <div className="col-12 col-md-6 col-lg-4" key={p.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden', opacity: p.isActive ? 1 : 0.55 }}>
                <img src={p.image?.md ?? ''} alt=""
                  style={{ width: '100%', height: 150, objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} />
                <div className="p-3">
                  <div className="ts-clamp-2" style={{ fontSize: 13.5, minHeight: 20 }}>
                    {p.caption || <span className="ts-muted">No caption</span>}
                  </div>
                  <div className="d-flex gap-1 mt-2">
                    <OrderButtons rows={data} index={i} onSwap={(a, b) => void swap(a, b)} />
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
        title={editing ? 'Edit photo' : 'Add photo'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <ImageUploader value={image} onChange={setImage} single max={1} label="Photo" />
        {errors.imageId && <p style={{ color: 'var(--ts-danger)', fontSize: 13 }}>{errors.imageId}</p>}
        <TextInput label="Caption" value={caption}
          onChange={(e) => setCaption(e.target.value)}
          hint="Optional — shown when a visitor hovers the photo." />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Shown on the site
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Remove this photo?"
        message={<>Remove this photo from the gallery?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/gallery-photos/${confirm.id}`);
            await refresh();
            toast({ tone: 'success', title: 'Photo removed' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═════════════════════════════════════════════════════ page headers ══

/**
 * The band at the top of each inner page on the website.
 *
 * Its title and standfirst used to live in each page's markup, so changing a
 * heading meant editing HTML. The photograph is optional and appears within
 * the page's content rather than behind the title — the full-bleed images
 * these replaced pushed every page's real content below the fold.
 */
export function AdminPageHeaders() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const queryKey = ['admin', 'page-headers'];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({ pageKey: '', title: '', standfirst: '', bgColor: '', isActive: true });

  const { data = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<any[]>('/admin/page-headers'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      pageKey: row?.pageKey ?? '',
      title: row?.title ?? '',
      standfirst: row?.standfirst ?? '',
      bgColor: row?.bgColor ?? '',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, imageId: image[0]?.id ?? null };
      if (editing) await api.patch(`/admin/page-headers/${editing.id}`, payload);
      else await api.post('/admin/page-headers', payload);
      await refresh();
      toast({ tone: 'success', title: editing ? 'Page header updated' : 'Page header added' });
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
        title="Page headers"
        description="The title and standfirst at the top of each techstarhub.or.tz page."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Add page header</Button>}
      />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState icon={<Newspaper size={44} />} title="No page headers yet"
          action={<Button onClick={() => openForm()}>Add your first page header</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((h) => (
            <div className="col-12 col-md-6 col-lg-4" key={h.id}>
              <div className="ts-card h-100 p-3" style={{ opacity: h.isActive ? 1 : 0.55 }}>
                {/* What the page actually shows behind its head — the card
                    listed only words, so there was no way to tell from here
                    which photograph a page was carrying, or whether it had
                    one at all. */}
                <div
                  className="mb-2 d-flex align-items-end justify-content-end"
                  style={{
                    height: 96,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: h.bgColor || '#eef1f6',
                    backgroundImage: h.image?.md || h.image?.lg
                      ? `url(${h.image.md ?? h.image.lg})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {!h.image && (
                    <span className="ts-muted m-auto" style={{ fontSize: 11.5 }}>
                      {h.bgColor ? h.bgColor : 'No photograph'}
                    </span>
                  )}
                </div>
                <span className="ts-badge">{h.pageKey}</span>
                <strong className="d-block mt-2" style={{ fontSize: 14.5 }}>{h.title}</strong>
                <div className="ts-muted ts-clamp-2" style={{ fontSize: 12.5 }}>{h.standfirst}</div>
                <div className="d-flex gap-1 mt-2">
                  <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(h)}><SquarePen size={15} /></button>
                  <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(h)}><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="lg"
        title={editing ? 'Edit page header' : 'Add page header'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Page" value={form.pageKey} error={errors.pageKey}
          onChange={(e) => setForm({ ...form, pageKey: e.target.value })}
          disabled={Boolean(editing)}
          hint="Which page this belongs to — e.g. events, gallery, news, board, staff."
          required />
        <TextInput label="Title" value={form.title} error={errors.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextArea label="Standfirst" value={form.standfirst} rows={3}
          onChange={(e) => setForm({ ...form, standfirst: e.target.value })}
          hint="The sentence below the title." />
        <ImageUploader value={image} onChange={setImage} single max={1} label="Photograph (optional)" />

        <div className="mb-3">
          <label className="ts-label d-block">Background colour (optional)</label>
          <div className="d-flex gap-2 align-items-center">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(form.bgColor) ? form.bgColor : '#0b2f6b'}
              onChange={(e) => setForm({ ...form, bgColor: e.target.value })}
              style={{ width: 44, height: 38, padding: 2, borderRadius: 8, border: '1px solid var(--ts-border, #d9dee7)' }}
              aria-label="Pick a background colour"
            />
            <input
              className="ts-input"
              value={form.bgColor}
              placeholder="#0b2f6b"
              onChange={(e) => setForm({ ...form, bgColor: e.target.value })}
              style={{ maxWidth: 150 }}
            />
            {form.bgColor && (
              <Button variant="ghost" onClick={() => setForm({ ...form, bgColor: '' })}>Clear</Button>
            )}
          </div>
          {errors.bgColor && <div className="ts-err">{errors.bgColor}</div>}
          <div className="ts-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Backs the head where there is no photograph, and tints the one behind it where there is.
            Leave empty for the site's own colour.
          </div>
        </div>

        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Shown on the site
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Remove this page header?"
        message={<>The page keeps whatever heading is already in its markup.</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/page-headers/${confirm.id}`);
            await refresh();
            toast({ tone: 'success', title: 'Page header removed' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}
