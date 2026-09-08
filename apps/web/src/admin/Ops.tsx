import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, Eye, EyeOff, Info, Mail, Megaphone, Plus, Search as SearchIcon,
  ShieldCheck, SquarePen, Star, Trash2, Users, X,
} from 'lucide-react';
import { ApiError, api, qs } from '../lib/api';
import type { MediaDto, Paged } from '../lib/types';
import { PageHeader } from './AdminLayout';
import { ImageUploader } from './ImageUploader';
import {
  Badge, Button, ConfirmDialog, EmptyState, Modal, Pagination, Select, Skeleton, StatusPill,
  TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

// ═══════════════════════════════════════════════════════ customers ══

export function AdminCustomers() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const q = sp.get('q') ?? '';
  const [search, setSearch] = useState(q);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'customers', page, q],
    queryFn: () => api.raw<Paged<any>>(`/admin/customers${qs({ page, pageSize: 25, q })}`),
  });

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) {
        const n = new URLSearchParams(sp);
        if (search) n.set('q', search); else n.delete('q');
        n.delete('page');
        setSp(n);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Customers" description={data ? `${data.meta.total} registered customers` : undefined} />
      <input className="ts-input mb-3" style={{ maxWidth: 340 }} placeholder="Search name, email or phone"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      {isLoading ? <Skeleton h={300} /> : !data?.data.length ? (
        <EmptyState icon={<Users size={48} />} title="No customers found" />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Lifetime value</th><th>Last order</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.username}</td>
                    <td>
                      {c.email ?? '—'}
                      {c.emailVerified ? <Check size={13} style={{ color: 'var(--ts-success)', marginLeft: 4 }} /> : null}
                    </td>
                    <td className="ts-mono">{c.phone ?? '—'}</td>
                    <td>{c.orderCount}</td>
                    <td style={{ fontWeight: 600 }}>{c.lifetimeValue.formatted}</td>
                    <td className="ts-muted">{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}</td>
                    <td><Badge tone={c.status === 'active' ? 'success' : 'danger'}>{c.status}</Badge></td>
                    <td><Link to={`/admin/customers/${c.id}`} className="ts-btn ts-btn--ghost ts-btn--sm">View</Link></td>
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

export function AdminCustomerDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: c, isLoading } = useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: () => api.get(`/admin/customers/${id}`),
  });

  if (isLoading || !c) return <Skeleton h={320} />;

  const suspend = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/customers/${id}/suspend`, { suspend: c.status === 'active' });
      await qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      toast({ tone: 'success', title: c.status === 'active' ? 'Customer suspended' : 'Customer reactivated' });
      setConfirm(false);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not update', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={c.username}
        description={`${c.email ?? c.phone} · joined ${new Date(c.createdAt).toLocaleDateString()}`}
        actions={
          <Button variant={c.status === 'active' ? 'danger' : 'primary'} onClick={() => setConfirm(true)}>
            {c.status === 'active' ? 'Suspend' : 'Reactivate'}
          </Button>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-lg-4">
          <div className="ts-card p-4 mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Profile</h2>
            <div style={{ fontSize: 13.5 }}>
              <div><strong>Email:</strong> {c.email ?? '—'} {c.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}</div>
              <div><strong>Phone:</strong> <span className="ts-mono">{c.phone ?? '—'}</span></div>
              <div><strong>Status:</strong> {c.status}</div>
              <div><strong>Marketing:</strong> {c.marketingOptIn ? 'opted in' : 'not opted in'}</div>
              <div><strong>Last sign-in:</strong> {c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString() : 'never'}</div>
            </div>
          </div>

          <div className="ts-card p-4">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Stats</h2>
            <div className="d-flex justify-content-between"><span>Orders</span><strong>{c.stats.orderCount}</strong></div>
            <div className="d-flex justify-content-between"><span>Paid orders</span><strong>{c.stats.paidCount}</strong></div>
            <div className="d-flex justify-content-between"><span>Lifetime value</span><strong>{c.stats.lifetimeValue.formatted}</strong></div>
            <div className="d-flex justify-content-between"><span>Reviews</span><strong>{c.stats.reviewCount}</strong></div>
          </div>
        </div>

        <div className="col-12 col-lg-8">
          <div className="ts-card p-4 mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Orders</h2>
            {!c.orders.length ? <p className="ts-muted">No orders yet.</p> : (
              <div className="ts-table__wrap" style={{ border: 0 }}>
                <table className="ts-table">
                  <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {c.orders.map((o: any) => (
                      <tr key={o.orderNumber}>
                        <td><Link to={`/admin/orders/${o.orderNumber}`} className="ts-mono">{o.orderNumber}</Link></td>
                        <td className="ts-muted">{new Date(o.placedAt).toLocaleDateString()}</td>
                        <td>{o.itemCount}</td>
                        <td>{o.total.formatted}</td>
                        <td><Badge tone={o.paymentStatus === 'paid' ? 'success' : 'warning'}>{o.statusLabel}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {c.addresses.length ? (
            <div className="ts-card p-4">
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>Addresses</h2>
              {c.addresses.map((a: any) => (
                <div key={a.id} style={{ fontSize: 13.5, borderBottom: '1px solid var(--ts-border)', paddingBottom: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>{a.receiverName} {a.isDefault ? <Badge>default</Badge> : null}</div>
                  <div>{a.streetAddress}, {a.district}, {a.region}</div>
                  <div className="ts-mono ts-muted">{a.phone}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title={c.status === 'active' ? 'Suspend this customer?' : 'Reactivate this customer?'}
        message={c.status === 'active'
          ? <>A suspended customer can still sign in but cannot place orders. All their sessions will be revoked.</>
          : <>The customer will be able to place orders again.</>}
        confirmLabel={c.status === 'active' ? 'Suspend' : 'Reactivate'}
        tone={c.status === 'active' ? 'danger' : 'primary'}
        onConfirm={() => void suspend()}
        onCancel={() => setConfirm(false)}
        busy={busy}
      />
    </>
  );
}

// ═════════════════════════════════════════════════ shipping methods ══

export function AdminShipping() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: '', description: '', costAmount: '0',
    requiresShippingAddress: true, acceptsMobilePayment: true, isCashOnDelivery: false,
    estimatedDaysMin: '', estimatedDaysMax: '', freeOverAmount: '', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'shipping'],
    queryFn: () => api.get<any[]>('/admin/shipping-methods'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setForm({
      name: row?.name ?? '',
      description: row?.description ?? '',
      costAmount: String(row?.costAmount ?? 0),
      requiresShippingAddress: row?.requiresShippingAddress ?? true,
      acceptsMobilePayment: row?.acceptsMobilePayment ?? true,
      isCashOnDelivery: row?.isCashOnDelivery ?? false,
      estimatedDaysMin: row?.estimatedDaysMin != null ? String(row.estimatedDaysMin) : '',
      estimatedDaysMax: row?.estimatedDaysMax != null ? String(row.estimatedDaysMax) : '',
      freeOverAmount: row?.freeOverAmount != null ? String(row.freeOverAmount) : '',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        costAmount: Number(form.costAmount || 0),
        requiresShippingAddress: form.requiresShippingAddress,
        acceptsMobilePayment: form.acceptsMobilePayment,
        isCashOnDelivery: form.isCashOnDelivery,
        estimatedDaysMin: form.estimatedDaysMin ? Number(form.estimatedDaysMin) : null,
        estimatedDaysMax: form.estimatedDaysMax ? Number(form.estimatedDaysMax) : null,
        freeOverAmount: form.freeOverAmount ? Number(form.freeOverAmount) : null,
        isActive: form.isActive,
      };
      if (editing) await api.patch(`/admin/shipping-methods/${editing.id}`, payload);
      else await api.post('/admin/shipping-methods', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'shipping'] });
      await qc.invalidateQueries({ queryKey: ['shipping-methods'] });
      toast({ tone: 'success', title: editing ? 'Successfully edited shipping method' : 'Created new shipping method' });
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
        title="Shipping methods"
        description="What customers can choose at checkout, and what each costs."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> Create shipping method</Button>}
      />

      {isLoading ? <Skeleton h={220} /> : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead>
              <tr><th>Name</th><th>Cost</th><th>Description</th><th>Address</th><th>Mobile pay</th><th>COD</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.cost.formatted}</td>
                  <td className="ts-muted ts-clamp-2" style={{ maxWidth: 320 }}>{m.description}</td>
                  <td>{m.requiresShippingAddress ? 'required' : '—'}</td>
                  <td>{m.acceptsMobilePayment ? 'yes' : 'no'}</td>
                  <td>{m.isCashOnDelivery ? 'yes' : '—'}</td>
                  <td><Badge tone={m.isActive ? 'success' : 'neutral'}>{m.isActive ? 'active' : 'hidden'}</Badge></td>
                  <td>
                    <div className="d-flex gap-1">
                      <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(m)}><SquarePen size={15} /></button>
                      <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(m)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit shipping method' : 'Create shipping method'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>{editing ? 'Save' : 'Create'}</Button>
        </>}
      >
        <TextInput label="Shipping method" value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextInput label="Shipping cost (TZS)" value={form.costAmount} error={errors.costAmount}
          onChange={(e) => setForm({ ...form, costAmount: e.target.value.replace(/\D/g, '') })}
          inputMode="numeric" required />
        <TextArea label="Description" value={form.description} error={errors.description} rows={3}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          hint="Shown to the customer at checkout — this is how they choose." required />
        <div className="row">
          <div className="col-6">
            <TextInput label="Min days" value={form.estimatedDaysMin} inputMode="numeric"
              onChange={(e) => setForm({ ...form, estimatedDaysMin: e.target.value.replace(/\D/g, '') })} />
          </div>
          <div className="col-6">
            <TextInput label="Max days" value={form.estimatedDaysMax} inputMode="numeric"
              onChange={(e) => setForm({ ...form, estimatedDaysMax: e.target.value.replace(/\D/g, '') })} />
          </div>
        </div>
        <TextInput label="Free over (TZS, optional)" value={form.freeOverAmount} inputMode="numeric"
          onChange={(e) => setForm({ ...form, freeOverAmount: e.target.value.replace(/\D/g, '') })} />

        <label className="d-flex gap-2 align-items-start mb-2" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.requiresShippingAddress} style={{ marginTop: 4 }}
            onChange={(e) => setForm({ ...form, requiresShippingAddress: e.target.checked })} />
          Check the box if this shipping method requires the client to provide shipping details.
        </label>
        <label className="d-flex gap-2 align-items-start mb-2" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.acceptsMobilePayment} style={{ marginTop: 4 }}
            onChange={(e) => setForm({ ...form, acceptsMobilePayment: e.target.checked })} />
          Check the box if this shipping method can receive mobile payments.
        </label>
        <label className="d-flex gap-2 align-items-start mb-2" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isCashOnDelivery} style={{ marginTop: 4 }}
            onChange={(e) => setForm({ ...form, isCashOnDelivery: e.target.checked })} />
          This method is cash on delivery.
        </label>
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this shipping method?"
        message={<>Delete <strong>{confirm?.name}</strong>? Existing orders keep their recorded method and cost.</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/shipping-methods/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'shipping'] });
            toast({ tone: 'success', title: 'Shipping method deleted' });
          } catch (e) {
            toast({ tone: 'danger', title: 'Could not delete', text: (e as Error).message });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  );
}

// ═════════════════════════════════════════════════════════ banners ══

export function AdminBanners() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [image, setImage] = useState<MediaDto[]>([]);
  const [form, setForm] = useState({
    title: '', titleColor: '#FFFFFF', subtitle: '', subtitleColor: '#FFFFFF',
    backgroundColor: '#0A5C43', linkUrl: '', buttonText: '',
    buttonBackground: '#0E7C5A', buttonTextColor: '#FFFFFF', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'banners'],
    queryFn: () => api.get<any[]>('/admin/banners'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setImage(row?.image ? [row.image] : []);
    setForm({
      title: row?.title ?? '', titleColor: row?.titleColor ?? '#FFFFFF',
      subtitle: row?.subtitle ?? '', subtitleColor: row?.subtitleColor ?? '#FFFFFF',
      backgroundColor: row?.backgroundColor ?? '#0A5C43',
      linkUrl: row?.linkUrl ?? '', buttonText: row?.buttonText ?? '',
      buttonBackground: row?.buttonBackground ?? '#0E7C5A',
      buttonTextColor: row?.buttonTextColor ?? '#FFFFFF',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    if (!image.length) {
      setErrors({ imageId: 'An image is required' });
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, imageId: image[0].id, subtitle: form.subtitle || undefined };
      if (editing) await api.patch(`/admin/banners/${editing.id}`, payload);
      else await api.post('/admin/banners', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'banners'] });
      await qc.invalidateQueries({ queryKey: ['banners', 'home'] });
      toast({ tone: 'success', title: editing ? 'Banner edited' : 'Created new banner' });
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

  const ColorField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="mb-3">
      <div className="ts-label">{label}</div>
      <div className="d-flex gap-2 align-items-center">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 36, border: '1px solid var(--ts-border)', borderRadius: 4, padding: 2 }} />
        <input className="ts-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 120 }} />
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Banners"
        description="Home page promotions. Colours and copy are yours to set — no code change needed."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New banner</Button>}
      />

      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState title="No banners yet" description="Add a banner to promote a product on the home page."
          action={<Button onClick={() => openForm()}>Create banner</Button>} />
      ) : (
        <div className="row g-3">
          {data.map((b) => (
            <div className="col-12 col-lg-6" key={b.id}>
              <div className="ts-card" style={{ overflow: 'hidden' }}>
                <div style={{ background: b.backgroundColor, padding: 16, display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12, alignItems: 'center' }}>
                  <div>
                    <div style={{ color: b.titleColor, fontWeight: 800, fontSize: 20 }}>{b.title}</div>
                    {b.subtitle ? <div style={{ color: b.subtitleColor, fontSize: 12.5 }} className="ts-clamp-2">{b.subtitle}</div> : null}
                    {b.buttonText ? (
                      <span className="ts-badge mt-2" style={{ background: b.buttonBackground, color: b.buttonTextColor }}>
                        {b.buttonText}
                      </span>
                    ) : null}
                  </div>
                  {b.image ? <img src={b.image.md} alt="" style={{ width: '100%', maxHeight: 90, objectFit: 'contain' }} /> : null}
                </div>
                <div className="d-flex justify-content-between align-items-center p-2">
                  <Badge tone={b.isActive ? 'success' : 'neutral'}>{b.isActive ? 'active' : 'hidden'}</Badge>
                  <div className="d-flex gap-1">
                    <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(b)}><SquarePen size={15} /></button>
                    <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(b)}><Trash2 size={15} /></button>
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
        title={editing ? 'Edit banner' : 'Create banner'}
        size="lg"
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>{editing ? 'Save' : 'Create'}</Button>
        </>}
      >
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Title" value={form.title} error={errors.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Enter title" required />
            <TextArea label="Subtitle" value={form.subtitle} rows={2}
              onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="Enter subtitle" />
            <TextInput label="Link" value={form.linkUrl}
              onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
              hint="Where does the banner redirect to, e.g. /products?q=arduino" />
            <TextInput label="Button text" value={form.buttonText}
              onChange={(e) => setForm({ ...form, buttonText: e.target.value })} placeholder="Enter button text" />
            <ImageUploader value={image} onChange={setImage} single max={1} label="Image"
              hint="Drag & drop, or browse your device. A transparent PNG or WebP cut-out works best." />
            {errors.imageId ? <div className="ts-error">{errors.imageId}</div> : null}
          </div>
          <div className="col-12 col-md-6">
            <ColorField label="Title colour" value={form.titleColor} onChange={(v) => setForm({ ...form, titleColor: v })} />
            <ColorField label="Subtitle colour" value={form.subtitleColor} onChange={(v) => setForm({ ...form, subtitleColor: v })} />
            <ColorField label="Background" value={form.backgroundColor} onChange={(v) => setForm({ ...form, backgroundColor: v })} />
            <ColorField label="Button background" value={form.buttonBackground} onChange={(v) => setForm({ ...form, buttonBackground: v })} />
            <ColorField label="Button text colour" value={form.buttonTextColor} onChange={(v) => setForm({ ...form, buttonTextColor: v })} />

            <div className="ts-label">Live preview</div>
            <div style={{ background: form.backgroundColor, padding: 16, borderRadius: 6 }}>
              <div style={{ color: form.titleColor, fontWeight: 800, fontSize: 22 }}>{form.title || 'Title'}</div>
              <div style={{ color: form.subtitleColor, fontSize: 13 }}>{form.subtitle || 'Subtitle text appears here.'}</div>
              {form.buttonText ? (
                <span className="ts-badge mt-2" style={{ background: form.buttonBackground, color: form.buttonTextColor }}>
                  {form.buttonText}
                </span>
              ) : null}
            </div>

            <label className="d-flex gap-2 align-items-center mt-3" style={{ fontSize: 14 }}>
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this banner?"
        message={<>Delete <strong>{confirm?.title}</strong>? It will be removed from the home page.</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/banners/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'banners'] });
            toast({ tone: 'success', title: 'Banner deleted' });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  );
}

// ═════════════════════════════════════════════════════ moderation ══

export function AdminModeration({ kind }: { kind: 'comments' | 'reviews' }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', kind, status],
    queryFn: () => api.raw<Paged<any>>(`/admin/${kind}?status=${status}&pageSize=50`),
  });

  const moderate = async (id: number, next: string) => {
    setBusy(true);
    try {
      await api.post(`/admin/${kind}/${id}/moderate`, { status: next });
      await qc.invalidateQueries({ queryKey: ['admin', kind] });
      toast({ tone: 'success', title: `Marked ${next}` });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not moderate', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={kind === 'comments' ? 'Comments' : 'Reviews'}
        description="Nothing appears on the storefront until it is approved."
      />
      <div className="d-flex gap-1 mb-3">
        {['pending', 'approved', 'rejected', 'spam', 'all'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'ghost'} onClick={() => setStatus(s)}>
            {s}
          </Button>
        ))}
      </div>

      {isLoading ? <Skeleton h={220} /> : !data?.data.length ? (
        <EmptyState icon={kind === 'reviews' ? <Star size={48} /> : <Mail size={48} />}
          title={`No ${kind} with this status`} />
      ) : (
        <div className="d-grid gap-3">
          {data.data.map((r) => (
            <div key={r.id} className="ts-card p-3">
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="d-flex gap-2 align-items-center flex-wrap">
                    <strong style={{ fontSize: 14 }}>{r.author}</strong>
                    {kind === 'reviews' ? (
                      <span style={{ color: 'var(--ts-star)' }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={12} fill={i < r.rating ? 'currentColor' : 'none'} />
                        ))}
                      </span>
                    ) : null}
                    {r.verifiedPurchase ? <Badge tone="success">verified purchase</Badge> : null}
                    <Badge tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'danger'}>
                      {r.status}
                    </Badge>
                  </div>
                  <div className="ts-muted" style={{ fontSize: 12 }}>
                    {kind === 'reviews' ? r.product?.name : r.article?.title} · {new Date(r.createdAt).toLocaleString()}
                  </div>
                  {r.title ? <div style={{ fontWeight: 600, marginTop: 6 }}>{r.title}</div> : null}
                  <p className="mb-0 mt-1" style={{ fontSize: 14 }}>{r.body}</p>
                </div>
                <div className="d-flex gap-1">
                  <Button size="sm" disabled={busy || r.status === 'approved'}
                    onClick={() => void moderate(r.id, 'approved')}><Check size={14} /> Approve</Button>
                  <Button size="sm" variant="ghost" disabled={busy || r.status === 'rejected'}
                    onClick={() => void moderate(r.id, 'rejected')}><X size={14} /> Reject</Button>
                  <Button size="sm" variant="danger" disabled={busy}
                    onClick={() => void moderate(r.id, 'spam')}>Spam</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════ campaigns ══

export function AdminCampaigns() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState<false | 'sms' | 'email'>(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', bodyText: '', audience: 'all', additional: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api.raw<Paged<any>>('/admin/campaigns?pageSize=25'),
  });

  const totals = (data?.meta as any)?.totals ?? {};
  const segments = Math.max(1, Math.ceil(form.bodyText.length / 160));

  const create = async () => {
    setErrors({});
    setBusy(true);
    try {
      const res = await api.post<{ id: number; recipientCount: number }>('/admin/campaigns', {
        channel: open,
        name: form.name,
        audience: form.audience,
        bodyText: form.bodyText,
        additionalRecipients: form.additional.split(/[\s,]+/).filter(Boolean),
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      toast({
        tone: 'success',
        title: 'Campaign created successfully',
        text: `${res.recipientCount} recipient${res.recipientCount === 1 ? '' : 's'} — review, then send.`,
      });
      setOpen(false);
      setForm({ name: '', bodyText: '', audience: 'all', additional: '' });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const send = async (id: number) => {
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; failed: number }>(`/admin/campaigns/${id}/send`);
      await qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      toast({ tone: 'success', title: `Sent to ${res.sent} recipient${res.sent === 1 ? '' : 's'}` });
    } catch (e) {
      toast({ tone: 'danger', title: 'Send failed', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Recipients without consent, or who have unsubscribed, are excluded automatically."
        actions={<>
          <Button variant="secondary" onClick={() => setOpen('sms')}>New SMS campaign</Button>
          <Button onClick={() => setOpen('email')}>New email campaign</Button>
        </>}
      />

      <div className="row g-3 mb-4">
        {[
          ['Total campaigns', totals.campaigns ?? 0],
          ['Total contacts', totals.contacts ?? 0],
          ['Messages sent', totals.sent ?? 0],
        ].map(([label, value]) => (
          <div className="col-6 col-lg-3" key={label as string}>
            <div className="ts-stat">
              <div className="ts-stat__label">{label}</div>
              <div className="ts-stat__value">{value as number}</div>
            </div>
          </div>
        ))}
      </div>

      {isLoading ? <Skeleton h={220} /> : !data?.data.length ? (
        <EmptyState icon={<Megaphone size={48} />} title="No campaigns found."
          description="Create an SMS or email campaign to reach your contacts." />
      ) : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead>
              <tr><th>Name</th><th>Channel</th><th>Audience</th><th>Recipients</th><th>Sent</th><th>Status</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><Badge tone={c.channel === 'sms' ? 'info' : 'neutral'}>{c.channel}</Badge></td>
                  <td>{c.audience}</td>
                  <td>{c.recipientCount}</td>
                  <td>{c.sentCount}{c.failedCount ? <span style={{ color: 'var(--ts-danger)' }}> · {c.failedCount} failed</span> : null}</td>
                  <td><Badge tone={c.status === 'sent' ? 'success' : c.status === 'draft' ? 'warning' : 'neutral'}>{c.status}</Badge></td>
                  <td className="ts-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td>
                    {c.status !== 'sent' ? (
                      <Button size="sm" disabled={busy} onClick={() => void send(c.id)}>Send now</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(false)}
        title={open === 'sms' ? 'Create a new SMS campaign' : 'Create a new email campaign'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void create()} loading={busy}>Create</Button>
        </>}
      >
        <TextInput label={open === 'sms' ? 'Campaign name' : 'Subject'} value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Select label="Send to" value={form.audience} error={errors.audience}
          onChange={(e) => setForm({ ...form, audience: e.target.value })}>
          <option value="all">All contacts</option>
          <option value="specific">Specific contacts</option>
        </Select>
        <TextArea label="Message" value={form.bodyText} error={errors.bodyText} rows={5}
          onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
          hint={open === 'sms'
            ? `Chars. remaining (${Math.max(0, segments * 160 - form.bodyText.length)}) ${form.bodyText.length}/${segments * 160} · ${segments} segment${segments === 1 ? '' : 's'} per recipient`
            : undefined}
          required />
        <TextArea label="Additional recipients" value={form.additional} rows={2}
          onChange={(e) => setForm({ ...form, additional: e.target.value })}
          hint={open === 'sms'
            ? 'Space or comma separated, e.g. 255729XXXXXX, 255729YYYYYY'
            : 'Space or comma separated, e.g. person1@example.com, person2@example.com'} />
      </Modal>
    </>
  );
}

export function AdminContacts() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'contacts', page],
    queryFn: () => api.raw<Paged<any>>(`/admin/contacts?page=${page}&pageSize=50`),
  });

  return (
    <>
      <PageHeader title="Contacts" description={data ? `${data.meta.total} contacts` : undefined} />
      {isLoading ? <Skeleton h={260} /> : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Email consent</th><th>SMS consent</th><th>Joined</th></tr></thead>
              <tbody>
                {data!.data.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.email ?? '—'}</td>
                    <td className="ts-mono">{c.phone ?? '—'}</td>
                    <td>{c.source}</td>
                    <td>{c.emailOptIn ? <Badge tone="success">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                    <td>{c.smsOptIn ? <Badge tone="success">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                    <td className="ts-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data!.meta.page} pageCount={data!.meta.pageCount}
            onChange={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} />
        </>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════ searches ══

export function AdminSearches() {
  const [zeroOnly, setZeroOnly] = useState(true);
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'searches', zeroOnly],
    queryFn: () => api.get<any[]>(`/admin/analytics/searches?zeroOnly=${zeroOnly}`),
  });

  return (
    <>
      <PageHeader
        title="Searches"
        description="Terms that return nothing are customers telling you what to stock."
        actions={
          <Button variant={zeroOnly ? 'primary' : 'secondary'} onClick={() => setZeroOnly((v) => !v)}>
            {zeroOnly ? 'Showing zero-result only' : 'Show all searches'}
          </Button>
        }
      />
      {isLoading ? <Skeleton h={240} /> : !data.length ? (
        <EmptyState icon={<SearchIcon size={48} />} title="No searches found"
          description={zeroOnly ? 'Every search so far returned results — that is a good sign.' : undefined} />
      ) : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead><tr><th>Search query</th><th>Number of searches</th><th>Average results</th><th>Last searched</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.term}>
                  <td style={{ fontWeight: 600 }}>
                    {s.averageResults === 0 ? <AlertTriangle size={14} style={{ color: 'var(--ts-danger)', marginRight: 6 }} /> : null}
                    {s.term}
                  </td>
                  <td>{s.searches}</td>
                  <td style={{ color: s.averageResults === 0 ? 'var(--ts-danger)' : undefined }}>{s.averageResults}</td>
                  <td className="ts-muted">{new Date(s.lastSearchedAt).toLocaleDateString()}</td>
                  <td>
                    <Link to={`/admin/products/new?name=${encodeURIComponent(s.term)}`}
                      className="ts-btn ts-btn--ghost ts-btn--sm">Create product</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════ settings ══

const SETTING_GROUPS: {
  title: string;
  note?: string;
  keys: [string, string, 'text' | 'textarea' | 'bool' | 'secret'][];
}[] = [
  {
    title: 'Store',
    keys: [
      ['store.name', 'Store name', 'text'],
      ['store.legalName', 'Legal entity name', 'text'],
      ['store.tagline', 'Tagline', 'text'],
      ['store.registrationCountry', 'Country of registration', 'text'],
      ['store.tin', 'TIN', 'text'],
      ['store.registrationNumber', 'Registration number', 'text'],
      ['store.poBox', 'P.O. box', 'text'],
    ],
  },
  {
    title: 'Contact',
    keys: [
      ['contact.phonePrimary', 'Primary phone', 'text'],
      ['contact.phoneSecondary', 'Secondary phone', 'text'],
      ['contact.email', 'Email', 'text'],
      ['contact.whatsapp', 'WhatsApp number (255…)', 'text'],
      ['contact.address', 'Physical address', 'text'],
      ['contact.latitude', 'Map latitude', 'text'],
      ['contact.longitude', 'Map longitude', 'text'],
      ['contact.openingHours', 'Opening hours', 'text'],
    ],
  },
  {
    title: 'Social',
    keys: [
      ['social.facebook', 'Facebook URL', 'text'],
      ['social.instagram', 'Instagram URL', 'text'],
      ['social.x', 'X URL', 'text'],
      ['social.linkedin', 'LinkedIn URL', 'text'],
      ['social.youtube', 'YouTube URL', 'text'],
    ],
  },
  {
    title: 'Payments',
    keys: [
      ['payment.tillMpesa', 'M-Pesa Lipa Namba', 'text'],
      ['payment.tillMixx', 'Mixx by Yas Lipa Namba', 'text'],
      ['payment.tillAirtel', 'Airtel Money Lipa Namba', 'text'],
      ['payment.instructionsSw', 'Payment instructions (Kiswahili)', 'textarea'],
      ['payment.instructionsEn', 'Payment instructions (English)', 'textarea'],
    ],
  },
  {
    title: 'Policies',
    keys: [
      ['policies.returnsWindowDays', 'Returns window (days)', 'text'],
      ['policies.invoiceTerms', 'Standard invoice terms', 'textarea'],
    ],
  },
  {
    title: 'Features',
    keys: [
      ['features.reviews', 'Product reviews', 'bool'],
      ['features.comments', 'Blog comments', 'bool'],
      ['features.wishlist', 'Wishlist', 'bool'],
      ['features.guestCheckout', 'Guest checkout', 'bool'],
      ['features.delegatedPayment', 'Delegated payment', 'bool'],
      ['catalogue.hideEmptySubcategories', 'Hide empty subcategories in navigation', 'bool'],
    ],
  },
  {
    // Third-party credentials. Any key whose last segment names a secret
    // (apiKey / secret / password / token) is stored server-side and only
    // ever returned masked — see lib/settings.ts.
    title: 'Payment gateways',
    note: 'Credentials are stored here securely and are read by the checkout when a '
      + 'gateway is switched on. Checkout currently completes with manual Lipa Namba '
      + 'verification; each gateway also needs its live charge + webhook flow enabled '
      + 'and tested against the provider’s sandbox before you turn it on for customers.',
    keys: [
      ['gateway.selcom.enabled', 'Enable Selcom checkout', 'bool'],
      ['gateway.selcom.mode', 'Mode (sandbox / live)', 'text'],
      ['gateway.selcom.vendorId', 'Selcom vendor ID', 'text'],
      ['gateway.selcom.apiKey', 'Selcom API key', 'secret'],
      ['gateway.selcom.apiSecret', 'Selcom API secret', 'secret'],
      ['gateway.selcom.webhookUrl', 'Webhook URL (read-only, give this to Selcom)', 'text'],

      ['gateway.flutterwave.enabled', 'Enable Flutterwave checkout', 'bool'],
      ['gateway.flutterwave.mode', 'Mode (test / live)', 'text'],
      ['gateway.flutterwave.publicKey', 'Flutterwave public key', 'text'],
      ['gateway.flutterwave.secretKey', 'Flutterwave secret key', 'secret'],
      ['gateway.flutterwave.encryptionKey', 'Flutterwave encryption key', 'secret'],

      ['gateway.stripe.enabled', 'Enable Stripe (card payments)', 'bool'],
      ['gateway.stripe.publishableKey', 'Stripe publishable key', 'text'],
      ['gateway.stripe.secretKey', 'Stripe secret key', 'secret'],
      ['gateway.stripe.webhookSecret', 'Stripe webhook signing secret', 'secret'],
    ],
  },
  {
    title: 'SMS & email',
    note: 'Used for order confirmations, delivery updates and campaigns.',
    keys: [
      ['sms.provider', 'SMS provider (beem / nextsms / console)', 'text'],
      ['sms.senderId', 'Sender ID', 'text'],
      ['sms.apiKey', 'SMS API key', 'secret'],
      ['sms.apiSecret', 'SMS API secret', 'secret'],

      ['mail.host', 'SMTP host', 'text'],
      ['mail.port', 'SMTP port', 'text'],
      ['mail.username', 'SMTP username', 'text'],
      ['mail.password', 'SMTP password', 'secret'],
      ['mail.fromName', 'From name', 'text'],
      ['mail.fromAddress', 'From address', 'text'],
    ],
  },
  {
    title: 'Analytics & maps',
    note: 'Optional third-party services used by the storefront.',
    keys: [
      ['integrations.googleAnalyticsId', 'Google Analytics measurement ID', 'text'],
      ['integrations.facebookPixelId', 'Meta Pixel ID', 'text'],
      ['integrations.googleMapsApiKey', 'Google Maps API key', 'secret'],
      ['integrations.whatsappNumber', 'WhatsApp business number', 'text'],
    ],
  },
];

/**
 * Feature switches ship on and are opted out of; integrations ship off and are
 * opted in to. So an unset key is only "true" for the former — an unconfigured
 * payment gateway must never render as enabled.
 */
function boolSetting(values: Record<string, string>, key: string): boolean {
  const stored = values[key];
  if (stored !== undefined) return stored !== 'false';
  return key.startsWith('features.') || key.startsWith('catalogue.');
}

/**
 * A credential field. The server sends secrets pre-masked (`••••••••1234`) and
 * ignores a value that comes back still masked, so the operator can save this
 * form without retyping keys they did not intend to change.
 */
function SecretInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const masked = value.startsWith('••••••••');

  return (
    <div className="mb-3">
      <div className="ts-label">{label}</div>
      <div className="d-flex gap-2">
        <input
          className="ts-input"
          type={reveal || masked ? 'text' : 'password'}
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder="Not configured"
          onFocus={() => { if (masked) onChange(''); }}
          onChange={(e) => onChange(e.target.value)}
        />
        {!masked && value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </Button>
        ) : null}
      </div>
      <div className="ts-hint">
        {masked
          ? 'Stored securely. Click the field to replace it.'
          : 'Never shown again once saved.'}
      </div>
    </div>
  );
}

export function AdminSettings() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<Record<string, string>>('/admin/settings'),
  });

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/admin/settings', values);
      await qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast({ tone: 'success', title: 'Settings updated' });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not save settings', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton h={400} />;

  const group = SETTING_GROUPS[tab];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Store identity, contact details, payments, feature switches and third-party API credentials."
        actions={<Button onClick={() => void save()} loading={busy}>Update</Button>}
      />

      <div className="d-flex gap-1 flex-wrap mb-3">
        {SETTING_GROUPS.map((g, i) => (
          <Button key={g.title} size="sm" variant={tab === i ? 'primary' : 'ghost'} onClick={() => setTab(i)}>
            {g.title}
          </Button>
        ))}
      </div>

      <div className="ts-card p-4" style={{ maxWidth: 780 }}>
        {group.note ? (
          <div className="ts-panel d-flex gap-2 align-items-start mb-4" style={{ padding: 12 }}>
            <Info size={16} style={{ color: 'var(--ts-info)', flexShrink: 0, marginTop: 2 }} />
            <p className="mb-0" style={{ fontSize: 13 }}>{group.note}</p>
          </div>
        ) : null}

        {group.keys.map(([key, label, type]) => (
          type === 'bool' ? (
            <label key={key} className="d-flex gap-2 align-items-center mb-3" style={{ fontSize: 14 }}>
              <input
                type="checkbox"
                checked={boolSetting(values, key)}
                onChange={(e) => setValues({ ...values, [key]: e.target.checked ? 'true' : 'false' })}
              />
              {label}
            </label>
          ) : type === 'textarea' ? (
            <TextArea key={key} label={label} rows={5} value={values[key] ?? ''}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          ) : type === 'secret' ? (
            <SecretInput key={key} label={label} value={values[key] ?? ''}
              onChange={(v) => setValues({ ...values, [key]: v })} />
          ) : (
            <TextInput key={key} label={label} value={values[key] ?? ''}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          )
        ))}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════ staff ══

export function AdminStaff() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ username: '', email: '', password: '', roleKeys: ['support'] });

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['admin', 'staff'],
    queryFn: () => api.get<any[]>('/admin/staff'),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<any[]>('/admin/roles'),
  });

  const create = async () => {
    setErrors({});
    setBusy(true);
    try {
      await api.post('/admin/staff', form);
      await qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
      toast({ tone: 'success', title: 'Staff member created' });
      setOpen(false);
      setForm({ username: '', email: '', password: '', roleKeys: ['support'] });
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
        title="Staff & roles"
        description="Nobody may edit their own roles, and there must always be at least one owner."
        actions={<Button onClick={() => setOpen(true)}><Plus size={15} /> Add staff member</Button>}
      />

      {isLoading ? <Skeleton h={200} /> : (
        <div className="ts-table__wrap mb-4">
          <table className="ts-table">
            <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Last sign-in</th><th>Status</th></tr></thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>{u.email}</td>
                  <td>
                    <div className="d-flex gap-1 flex-wrap">
                      {u.roles.map((r: any) => <Badge key={r.key} tone="info">{r.name}</Badge>)}
                    </div>
                  </td>
                  <td className="ts-muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
                  <td><Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Roles</h2>
      <div className="row g-3">
        {roles.map((r) => (
          <div className="col-12 col-md-6 col-lg-4" key={r.key}>
            <div className="ts-card p-3 h-100">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <div style={{ fontWeight: 700 }}>{r.name}</div>
                  <div className="ts-muted" style={{ fontSize: 12.5 }}>{r.description}</div>
                </div>
                {r.isSystem ? <Badge>system</Badge> : null}
              </div>
              <div className="mt-2" style={{ fontSize: 12 }}>
                <strong>{r.permissions.length}</strong> permissions · <strong>{r.memberCount}</strong> member{r.memberCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add staff member"
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void create()} loading={busy}>Create</Button>
        </>}
      >
        <TextInput label="Name" value={form.username} error={errors.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        <TextInput label="Email" type="email" value={form.email} error={errors.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <TextInput label="Temporary password" type="text" value={form.password} error={errors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          hint="At least 10 characters. Ask them to change it after first sign-in." required />
        <div className="ts-label">Roles</div>
        {roles.map((r) => (
          <label key={r.key} className="d-flex gap-2 align-items-center mb-1" style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.roleKeys.includes(r.key)}
              onChange={(e) =>
                setForm({
                  ...form,
                  roleKeys: e.target.checked
                    ? [...form.roleKeys, r.key]
                    : form.roleKeys.filter((k) => k !== r.key),
                })
              }
            />
            {r.name} <span className="ts-muted" style={{ fontSize: 12 }}>— {r.description}</span>
          </label>
        ))}
      </Modal>
    </>
  );
}

// ═══════════════════════════════════════════════════════ audit log ══

export function AdminAudit() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => api.raw<Paged<any>>(`/admin/audit-logs?page=${page}&pageSize=50`),
  });
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <>
      <PageHeader title="Audit log" description="Every administrative change, permanently. Read only." />
      {isLoading ? <Skeleton h={300} /> : !data?.data.length ? (
        <EmptyState icon={<ShieldCheck size={48} />} title="No audit entries yet" />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th><th /></tr></thead>
              <tbody>
                {data.data.map((a) => (
                  <>
                    <tr key={a.id}>
                      <td className="ts-muted" style={{ whiteSpace: 'nowrap' }}>{new Date(a.createdAt).toLocaleString()}</td>
                      <td>{a.actor}</td>
                      <td><span className="ts-mono">{a.action}</span></td>
                      <td>{a.entityLabel ?? `${a.entityType}#${a.entityId ?? '—'}`}</td>
                      <td className="ts-muted ts-mono">{a.ipAddress ?? '—'}</td>
                      <td>
                        {a.before || a.after ? (
                          <Button size="sm" variant="ghost"
                            onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                            {expanded === a.id ? 'Hide' : 'Diff'}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {expanded === a.id ? (
                      <tr key={`${a.id}-diff`}>
                        <td colSpan={6} style={{ background: 'var(--ts-surface-alt)' }}>
                          <div className="row g-3" style={{ fontSize: 12 }}>
                            <div className="col-6">
                              <div className="ts-label">Before</div>
                              <pre className="ts-mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                                {JSON.stringify(a.before, null, 2) ?? '—'}
                              </pre>
                            </div>
                            <div className="col-6">
                              <div className="ts-label">After</div>
                              <pre className="ts-mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                                {JSON.stringify(a.after, null, 2) ?? '—'}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
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
