import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, SquarePen, Trash2, Users } from 'lucide-react';
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

export function AdminTeam() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
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
    queryKey: ['admin', 'team-members'],
    queryFn: () => api.get<any[]>('/admin/team-members'),
  });

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
      const payload = { ...form, imageId: image[0]?.id ?? null };
      if (editing) await api.patch(`/admin/team-members/${editing.id}`, payload);
      else await api.post('/admin/team-members', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'team-members'] });
      toast({ tone: 'success', title: editing ? 'Team member updated' : 'Team member added' });
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
        title="Team"
        description="The people shown on techstarhub.or.tz’s team page."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Add team member</Button>}
      />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState icon={<Users size={44} />} title="No team members yet" action={<Button onClick={() => openForm()}>Add your first team member</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((m) => (
            <div className="col-12 col-md-6 col-lg-4" key={m.id}>
              <div className="ts-card h-100 p-3 d-flex gap-3 align-items-start">
                <img
                  src={m.image?.sm ?? ''}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', background: 'var(--ts-surface-sunken)', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14.5 }}>{m.name}</strong>
                  <div className="ts-muted ts-clamp-2" style={{ fontSize: 12.5 }}>{m.role}</div>
                  <div className="d-flex gap-1 mt-2">
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
            await qc.invalidateQueries({ queryKey: ['admin', 'team-members'] });
            toast({ tone: 'success', title: 'Team member removed' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
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
    title: '', excerpt: '', contentHtml: '', location: '', startsAt: '', endsAt: '', registerUrl: '', isActive: true,
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
      registerUrl: row?.registerUrl ?? '', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = {
        ...form,
        imageId: image[0]?.id ?? null,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
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
