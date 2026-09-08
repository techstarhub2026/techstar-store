import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Newspaper, Plus, SquarePen, Store, Trash2 } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import type { MediaDto, Paged } from '../lib/types';
import { PageHeader } from './AdminLayout';
import { ImageUploader } from './ImageUploader';
import { RichEditor } from './RichEditor';
import {
  Badge, Button, ConfirmDialog, EmptyState, Modal, Pagination, Select, Skeleton, TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

// ════════════════════════════════════════════════════════ articles ══

export function AdminArticles() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cover, setCover] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({ title: '', excerpt: '', contentHtml: '', status: 'draft' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'articles'],
    queryFn: () => api.raw<Paged<any>>('/admin/articles?pageSize=50'),
  });

  const openForm = async (row?: any) => {
    setErrors({});
    if (row) {
      const full = await api.get(`/admin/articles/${row.id}`);
      setEditing(full);
      setCover(full.coverImage ? [full.coverImage] : []);
      setForm({
        title: full.title, excerpt: full.excerpt ?? '',
        contentHtml: full.contentHtml, status: full.status,
      });
    } else {
      setEditing(null);
      setCover([]);
      setForm({ title: '', excerpt: '', contentHtml: '', status: 'draft' });
    }
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, coverImageId: cover[0]?.id ?? null };
      if (editing) await api.patch(`/admin/articles/${editing.id}`, payload);
      else await api.post('/admin/articles', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'articles'] });
      await qc.invalidateQueries({ queryKey: ['articles'] });
      toast({ tone: 'success', title: editing ? 'Article updated successfully' : 'Article published successfully' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Articles"
        description="The blog. Publishing three or four good posts is worth more than an empty section."
        actions={<Button onClick={() => void openForm()}><Plus size={15} /> New article</Button>}
      />
      {isLoading ? <Skeleton h={260} /> : !data?.data.length ? (
        <EmptyState icon={<Newspaper size={48} />} title="No articles"
          action={<Button onClick={() => void openForm()}>Write your first article</Button>} />
      ) : (
        <div className="row g-3">
          {data.data.map((a) => (
            <div className="col-12 col-md-6 col-lg-4" key={a.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden' }}>
                {a.coverImage ? (
                  <img src={a.coverImage.md} alt=""
                    style={{ width: '100%', height: 140, objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} />
                ) : null}
                <div className="p-3">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <strong className="ts-clamp-2" style={{ fontSize: 14.5 }}>{a.title}</strong>
                    <Badge tone={a.status === 'published' ? 'success' : 'warning'}>{a.status}</Badge>
                  </div>
                  <p className="ts-muted ts-clamp-2 mt-2 mb-2" style={{ fontSize: 13 }}>{a.excerpt}</p>
                  <div className="ts-muted" style={{ fontSize: 12 }}>
                    {a.viewCount} views · {a.commentCount} comments
                  </div>
                  <div className="d-flex gap-1 mt-2">
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => void openForm(a)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(a)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit article' : 'Create your article'}
        size="lg"
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}
      >
        <TextInput label="Heading" value={form.title} error={errors.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Enter heading" required />
        <TextArea label="Description" value={form.excerpt} error={errors.excerpt} rows={2}
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
          placeholder="Enter article description" required />
        <RichEditor label="Content" value={form.contentHtml} error={errors.contentHtml}
          onChange={(html) => setForm({ ...form, contentHtml: html })}
          placeholder="Compose an epic article…" minHeight={320} required />
        <ImageUploader value={cover} onChange={setCover} single max={1} label="Cover image"
          hint="Drag & drop, or browse your device. 16:9 works best." />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this article?"
        message={<>Delete <strong>{confirm?.title}</strong>? It will be removed from the blog.</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/articles/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'articles'] });
            toast({ tone: 'success', title: 'Article deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════ services ══

export function AdminServices() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({
    heading: '', excerpt: '', contentHtml: '', icon: '', linkUrl: '', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'services'],
    queryFn: () => api.get<any[]>('/admin/services'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      heading: row?.heading ?? '', excerpt: row?.excerpt ?? '',
      contentHtml: row?.contentHtml ?? '',
      icon: row?.icon ?? '', linkUrl: row?.linkUrl ?? '',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, imageId: image[0]?.id ?? null };
      if (editing) await api.patch(`/admin/services/${editing.id}`, payload);
      else await api.post('/admin/services', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'services'] });
      await qc.invalidateQueries({ queryKey: ['services'] });
      toast({ tone: 'success', title: editing ? 'Service updated successfully' : 'Service published successfully' });
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
      <PageHeader title="Services" actions={<Button onClick={() => openForm()}><Plus size={15} /> New service</Button>} />
      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState title="No services" action={<Button onClick={() => openForm()}>Add a service</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((s) => (
            <div className="col-12 col-md-6 col-lg-4" key={s.id}>
              <div className="ts-card h-100" style={{ overflow: 'hidden' }}>
                {s.image ? <img src={s.image.md} alt=""
                  style={{ width: '100%', height: 130, objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} /> : null}
                <div className="p-3">
                  <strong style={{ fontSize: 14.5 }}>{s.heading}</strong>
                  <p className="ts-muted ts-clamp-2 mt-1 mb-2" style={{ fontSize: 13 }}>{s.excerpt}</p>
                  <div className="d-flex gap-1">
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
        title={editing ? 'Edit service' : 'Create new service'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Heading" value={form.heading} error={errors.heading}
          onChange={(e) => setForm({ ...form, heading: e.target.value })}
          placeholder="Enter heading" hint="Maximum 15 words." required />
        <TextArea label="Excerpt" value={form.excerpt} rows={2}
          onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
        <RichEditor label="Content" value={form.contentHtml} error={errors.contentHtml}
          onChange={(html) => setForm({ ...form, contentHtml: html })}
          placeholder="Describe the service…" required />
        <ImageUploader value={image} onChange={setImage} single max={1} label="Service image"
          hint="Shown as the card background on the website home page." />
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Icon" value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="bi-cpu"
              hint={'Bootstrap Icons name for the corner badge, e.g. bi-cpu. Browse them at icons.getbootstrap.com.'} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Links to" value={form.linkUrl}
              onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
              placeholder="courses.html"
              hint="Where the card sends visitors." />
          </div>
        </div>
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this service?"
        message={<>Delete <strong>{confirm?.heading}</strong>?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/services/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'services'] });
            toast({ tone: 'success', title: 'Service deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ════════════════════════════════════════════════════════ partners ══

export function AdminPartners() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({ name: '', websiteUrl: '', isActive: true });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'partners'],
    queryFn: () => api.get<any[]>('/admin/partners'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setLogo(row?.logo ? [row.logo] : []);
    setForm({ name: row?.name ?? '', websiteUrl: row?.websiteUrl ?? '', isActive: row?.isActive ?? true });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, logoId: logo[0]?.id ?? null };
      if (editing) await api.patch(`/admin/partners/${editing.id}`, payload);
      else await api.post('/admin/partners', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'partners'] });
      await qc.invalidateQueries({ queryKey: ['partners'] });
      toast({ tone: 'success', title: editing ? 'Partner updated' : 'Partner created successfully' });
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Partners" actions={<Button onClick={() => openForm()}><Plus size={15} /> New partner</Button>} />
      {isLoading ? <Skeleton h={200} /> : !data.length ? (
        <EmptyState icon={<Store size={48} />} title="No partners" />
      ) : (
        <div className="d-flex flex-wrap gap-3">
          {data.map((p) => (
            <div className="ts-card p-3 text-center" key={p.id} style={{ width: 190 }}>
              {p.logo ? <img src={p.logo.md} alt=""
                style={{ width: '100%', height: 90, objectFit: 'contain' }} /> : null}
              <div style={{ fontWeight: 600, fontSize: 13.5 }} className="ts-clamp-2">{p.name}</div>
              <div className="d-flex gap-1 justify-content-center mt-2">
                <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(p)}><SquarePen size={15} /></button>
                <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(p)}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit partner' : 'Create new partner'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Partner name" value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Enter name" required />
        <TextInput label="Partner's website link" value={form.websiteUrl} error={errors.websiteUrl}
          onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://…" />
        <ImageUploader value={logo} onChange={setLogo} single max={1} label="Partner logo"
          hint="Square image with a transparent background works best." />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this partner?"
        message={<>Delete <strong>{confirm?.name}</strong>?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/partners/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'partners'] });
            toast({ tone: 'success', title: 'Partner deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════ FAQs ══

export function AdminFaqs() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ question: '', answerHtml: '', group: 'General', isActive: true });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'faqs'],
    queryFn: () => api.get<any[]>('/admin/faqs'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setForm({
      question: row?.question ?? '', answerHtml: row?.answerHtml ?? '',
      group: row?.group ?? 'General', isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) await api.patch(`/admin/faqs/${editing.id}`, form);
      else await api.post('/admin/faqs', form);
      await qc.invalidateQueries({ queryKey: ['admin', 'faqs'] });
      await qc.invalidateQueries({ queryKey: ['faqs'] });
      toast({ tone: 'success', title: 'FAQ saved' });
      setOpen(false);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not save', text: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="FAQs" actions={<Button onClick={() => openForm()}><Plus size={15} /> New FAQ</Button>} />
      {isLoading ? <Skeleton h={220} /> : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead><tr><th>Group</th><th>Question</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.id}>
                  <td>{f.group}</td>
                  <td style={{ fontWeight: 600 }}>{f.question}</td>
                  <td><Badge tone={f.isActive ? 'success' : 'neutral'}>{f.isActive ? 'active' : 'hidden'}</Badge></td>
                  <td>
                    <div className="d-flex gap-1">
                      <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(f)}><SquarePen size={15} /></button>
                      <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(f)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit FAQ' : 'New FAQ'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Group" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
        <TextInput label="Question" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required />
        <RichEditor label="Answer" value={form.answerHtml}
          onChange={(html) => setForm({ ...form, answerHtml: html })}
          placeholder="Answer the question…" minHeight={160} required />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this FAQ?"
        message={<>Delete “{confirm?.question}”?</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/faqs/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'faqs'] });
            toast({ tone: 'success', title: 'FAQ deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ═════════════════════════════════════════════════════════ invoices ══

export function AdminInvoices() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'invoices', page],
    queryFn: () => api.raw<Paged<any>>(`/admin/invoices?page=${page}&pageSize=25`),
  });

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Raise a quotation for a school or company that pays against an invoice."
      />
      {isLoading ? <Skeleton h={240} /> : !data?.data.length ? (
        <EmptyState icon={<FileText size={48} />} title="No invoices"
          description="Invoices generated from orders, and standalone quotations, appear here." />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead><tr><th>Invoice</th><th>Order</th><th>Client</th><th>Total</th><th>Status</th><th>Issued</th></tr></thead>
              <tbody>
                {data.data.map((i) => (
                  <tr key={i.id}>
                    <td className="ts-mono">{i.invoiceNumber}</td>
                    <td>{i.orderNumber ? <Link to={`/admin/orders/${i.orderNumber}`} className="ts-mono">{i.orderNumber}</Link> : '—'}</td>
                    <td>{i.clientName}<div className="ts-muted" style={{ fontSize: 12 }}>{i.clientEmail}</div></td>
                    <td style={{ fontWeight: 600 }}>{i.total.formatted}</td>
                    <td><Badge tone={i.status === 'paid' ? 'success' : i.status === 'issued' ? 'info' : 'warning'}>{i.status}</Badge></td>
                    <td className="ts-muted">{i.issuedAt ? new Date(i.issuedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.meta.page} pageCount={data.meta.pageCount}
            onChange={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} />
        </>
      )}
    </>
  );
}
