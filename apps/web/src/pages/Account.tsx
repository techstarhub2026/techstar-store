import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Printer, RotateCcw } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import type { OrderDto, Paged } from '../lib/types';
import { useAuth, useUi } from '../stores';
import { Button, ConfirmDialog, EmptyState, Select, StatusPill, TextInput } from '../components/ui';
import { PLACEHOLDER } from '../components/ProductCard';

export function AccountLayout() {
  const { user, ready } = useAuth();
  const openAuth = useUi((s) => s.openAuth);
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && !user) {
      openAuth('login', '/account/orders');
      navigate('/');
    }
  }, [ready, user, openAuth, navigate]);

  if (!user) return <div className="container py-5"><div className="ts-skel" style={{ height: 200 }} /></div>;

  const tabs = [
    { to: '/account/profile', label: 'Account' },
    { to: '/account/orders', label: 'Orders' },
    { to: '/account/address', label: 'Shipping address' },
    { to: '/account/password', label: 'Change password' },
  ];

  return (
    <div className="container py-4 pb-5">
      <div className="d-flex align-items-center gap-3 mb-4">
        <div style={{
          width: 52, height: 52, borderRadius: '50%', background: 'var(--ts-primary)',
          color: '#fff', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700,
        }}>
          {user.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{user.username}</h1>
          <div className="ts-muted" style={{ fontSize: 13.5 }}>{user.email ?? user.phone}</div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-12 col-lg-3">
          <nav className="ts-card p-2">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => 'd-block px-3 py-2'}
                style={({ isActive }) => ({
                  color: isActive ? 'var(--ts-primary)' : 'var(--ts-text)',
                  fontWeight: isActive ? 700 : 500,
                  background: isActive ? 'var(--ts-primary-tint)' : undefined,
                  borderRadius: 4, fontSize: 14,
                })}
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="col-12 col-lg-9"><Outlet /></div>
      </div>
    </div>
  );
}

export function ProfileTab() {
  const { user, setUser } = useAuth();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    username: user?.username ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    marketingOptIn: user?.marketingOptIn ?? false,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    try {
      const updated = await api.patch('/me', {
        username: form.username,
        email: form.email || undefined,
        phone: form.phone || undefined,
        marketingOptIn: form.marketingOptIn,
      });
      setUser(updated);
      toast({ tone: 'success', title: 'Successfully updated user account' });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        if (!err.details?.length) toast({ tone: 'danger', title: err.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const updated = await api.post('/me/avatar', fd);
      setUser(updated);
      toast({ tone: 'success', title: 'Profile photo updated' });
    } catch {
      toast({ tone: 'danger', title: 'Failed to upload image' });
    }
  };

  return (
    <form className="ts-card p-4" onSubmit={submit}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>Account settings</h2>

      <div className="d-flex align-items-center gap-3 mb-4">
        <img
          src={user?.profileImage?.sm ?? PLACEHOLDER}
          alt=""
          width={64}
          height={64}
          style={{ borderRadius: '50%', objectFit: 'cover', background: 'var(--ts-surface-sunken)' }}
        />
        <label className="ts-btn ts-btn--secondary ts-btn--sm" style={{ cursor: 'pointer' }}>
          Upload image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => e.target.files?.[0] && void uploadAvatar(e.target.files[0])}
          />
        </label>
      </div>

      <div className="row">
        <div className="col-12 col-md-6">
          <TextInput label="Username" value={form.username} error={errors.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div className="col-12 col-md-6">
          <TextInput label="Email" type="email" value={form.email} error={errors.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            hint={user?.emailVerified ? 'Verified' : 'Not verified yet'} />
        </div>
        <div className="col-12 col-md-6">
          <TextInput label="Phone number (255XXXXXXXXX)" value={form.phone} error={errors.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="numeric" />
        </div>
      </div>

      <label className="d-flex gap-2 align-items-center mb-3" style={{ fontSize: 14 }}>
        <input type="checkbox" checked={form.marketingOptIn}
          onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })} />
        Send me occasional offers and product news
      </label>

      <Button type="submit" loading={busy}>Update</Button>
    </form>
  );
}

export function AddressTab() {
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: addresses = [] } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get<any[]>('/me/addresses'),
  });
  const { data: regions = [] } = useQuery({
    queryKey: ['regions'],
    queryFn: () => api.get<string[]>('/locations/regions'),
  });

  const existing = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [form, setForm] = useState({
    receiverName: '', email: '', phone: '',
    region: '', district: '', streetAddress: '', postalCode: '',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existing && !loaded) {
      setForm({
        receiverName: existing.receiverName, email: existing.email ?? '', phone: existing.phone,
        region: existing.region, district: existing.district,
        streetAddress: existing.streetAddress, postalCode: existing.postalCode ?? '',
      });
      setLoaded(true);
    }
  }, [existing, loaded]);

  const { data: districts = [] } = useQuery({
    queryKey: ['districts', form.region],
    queryFn: () => api.get<string[]>(`/locations/regions/${encodeURIComponent(form.region)}/districts`),
    enabled: Boolean(form.region),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, country: 'Tanzania', isDefault: true };
      if (existing) await api.patch(`/me/addresses/${existing.id}`, payload);
      else await api.post('/me/addresses', payload);
      await qc.invalidateQueries({ queryKey: ['addresses'] });
      toast({ tone: 'success', title: 'Successfully updated shipping details' });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      toast({ tone: 'danger', title: 'Could not save your address' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ts-card p-4" onSubmit={submit}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>Shipping address</h2>
      <label className="d-flex gap-2 align-items-center mb-3" style={{ fontSize: 14 }}>
        <input
          type="checkbox"
          onChange={(e) => {
            if (e.target.checked && user) {
              setForm((f) => ({
                ...f,
                receiverName: user.username,
                email: user.email ?? '',
                phone: user.phone ?? '',
              }));
            }
          }}
        />
        Details similar to my account
      </label>
      <div className="row">
        <div className="col-12 col-md-6">
          <TextInput label="Receiver's name" value={form.receiverName} error={errors.receiverName}
            onChange={(e) => setForm({ ...form, receiverName: e.target.value })} required />
        </div>
        <div className="col-12 col-md-6">
          <TextInput label="Phone" value={form.phone} error={errors.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="255XXXXXXXXX" required />
        </div>
        <div className="col-12 col-md-6">
          <TextInput label="Email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="col-12 col-md-6">
          <TextInput label="Country" value="Tanzania" disabled />
        </div>
        <div className="col-12 col-md-6">
          <Select label="Region" value={form.region} error={errors.region}
            onChange={(e) => setForm({ ...form, region: e.target.value, district: '' })} required>
            <option value="">Select one</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <div className="col-12 col-md-6">
          <Select label="District" value={form.district} error={errors.district}
            onChange={(e) => setForm({ ...form, district: e.target.value })} disabled={!form.region} required>
            <option value="">{form.region ? 'Select one' : 'Choose a region first'}</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        <div className="col-12 col-md-8">
          <TextInput label="Street address" value={form.streetAddress} error={errors.streetAddress}
            onChange={(e) => setForm({ ...form, streetAddress: e.target.value })} required />
        </div>
        <div className="col-12 col-md-4">
          <TextInput label="Postal code / Zip code" value={form.postalCode}
            onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        </div>
      </div>
      <Button type="submit" loading={busy}>Update</Button>
    </form>
  );
}

export function PasswordTab() {
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    try {
      await api.patch('/auth/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast({
        tone: 'success',
        title: 'Password changed',
        text: 'You have been signed out on other devices.',
      });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      toast({ tone: 'danger', title: 'Could not change your password' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ts-card p-4" onSubmit={submit} style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: 16, marginBottom: 16 }}>Change password</h2>
      <TextInput label="Current password" type="password" value={form.currentPassword}
        error={errors.currentPassword} autoComplete="current-password"
        onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
      <TextInput label="New password" type="password" value={form.newPassword}
        error={errors.newPassword} autoComplete="new-password" hint="At least 10 characters."
        onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
      <TextInput label="Confirm new password" type="password" value={form.confirm}
        error={errors.confirm} autoComplete="new-password"
        onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
      <Button type="submit" loading={busy}>Change password</Button>
    </form>
  );
}

export function OrdersTab() {
  const [status, setStatus] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['my-orders', status],
    queryFn: () => api.raw<Paged<any>>(`/orders?status=${status}&pageSize=20`),
  });

  if (isLoading) return <div className="ts-skel" style={{ height: 220 }} />;

  if (!data?.data.length && status === 'all') {
    return (
      <EmptyState
        icon={<Package size={48} />}
        title="You have not placed any orders yet"
        action={<Link to="/products" className="ts-btn ts-btn--primary">Browse products</Link>}
      />
    );
  }

  return (
    <div>
      <div className="d-flex gap-2 flex-wrap mb-3">
        {['all', 'awaiting_payment', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled'].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className="ts-badge"
            style={{
              background: status === s ? 'var(--ts-primary)' : undefined,
              color: status === s ? '#fff' : undefined,
              cursor: 'pointer', border: 0,
            }}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="ts-table__wrap">
        <table className="ts-table">
          <thead>
            <tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {data?.data.map((o) => (
              <tr key={o.orderNumber}>
                <td className="ts-mono">{o.orderNumber}</td>
                <td>{new Date(o.placedAt).toLocaleDateString()}</td>
                <td>{o.itemCount}</td>
                <td style={{ fontWeight: 600 }}>{o.total.formatted}</td>
                <td><StatusPill label={o.statusLabel} tone={o.statusTone} /></td>
                <td><Link to={`/account/orders/${o.orderNumber}`} className="ts-btn ts-btn--ghost ts-btn--sm">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.data.length ? <p className="ts-muted mt-3">No orders with this status.</p> : null}
    </div>
  );
}

export function OrderDetailPage() {
  const { orderNumber = '' } = useParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: () => api.get<OrderDto>(`/orders/${orderNumber}`),
  });

  if (isLoading || !order) return <div className="ts-skel" style={{ height: 300 }} />;

  const canCancel = ['awaiting_payment'].includes(order.status);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/orders/${orderNumber}/cancel`, {});
      await qc.invalidateQueries({ queryKey: ['order', orderNumber] });
      await qc.invalidateQueries({ queryKey: ['my-orders'] });
      toast({ tone: 'success', title: 'Order cancelled' });
      setConfirmCancel(false);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not cancel', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reorder = async () => {
    try {
      const res = await api.post<{ added: string[]; unavailable: string[] }>(
        `/orders/${orderNumber}/reorder`,
      );
      toast({
        tone: 'success',
        title: `${res.added.length} item${res.added.length === 1 ? '' : 's'} added to your cart`,
        text: res.unavailable.length ? `${res.unavailable.length} no longer available.` : undefined,
      });
      navigate('/cart');
    } catch {
      toast({ tone: 'danger', title: 'Could not reorder' });
    }
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <h2 style={{ fontSize: 20, margin: 0 }} className="ts-mono">{order.orderNumber}</h2>
          <div className="ts-muted" style={{ fontSize: 13 }}>
            Placed {new Date(order.placedAt).toLocaleString()}
          </div>
        </div>
        <div className="d-flex gap-2">
          <StatusPill label={order.statusLabel} tone={order.statusTone} />
          <StatusPill
            label={order.paymentStatus.replace(/_/g, ' ')}
            tone={order.paymentStatus === 'paid' ? 'success' : 'warning'}
          />
        </div>
      </div>

      <div className="row g-4">
        <div className="col-12 col-lg-8">
          <div className="ts-card p-4 mb-4">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Items</h3>
            {order.items.map((i) => (
              <div key={i.sku} className="d-flex gap-3 py-2" style={{ borderBottom: '1px solid var(--ts-border)' }}>
                <img src={i.image ?? PLACEHOLDER} alt="" width={48} height={48}
                  style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                <div style={{ flex: 1, fontSize: 13.5 }}>
                  {i.slug ? <Link to={`/product/${i.slug}`} style={{ color: 'inherit', fontWeight: 600 }}>{i.name}</Link>
                    : <span style={{ fontWeight: 600 }}>{i.name}</span>}
                  <div className="ts-mono ts-muted" style={{ fontSize: 11 }}>{i.sku}</div>
                  <div className="ts-muted">Quantity: {i.quantity} × {i.unitPrice.formatted}</div>
                </div>
                <div style={{ fontWeight: 600 }}>{i.lineTotal.formatted}</div>
              </div>
            ))}
          </div>

          <div className="ts-card p-4">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Order timeline</h3>
            {order.timeline.map((t, i) => (
              <div key={i} className="d-flex gap-3 py-2" style={{ fontSize: 13.5 }}>
                <div style={{ width: 10, marginTop: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ts-primary)', display: 'block' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <strong>{t.type.replace(/_/g, ' ')}</strong>
                  {t.to ? <span className="ts-muted"> → {t.to.replace(/_/g, ' ')}</span> : null}
                  {t.message ? <div className="ts-muted">{t.message}</div> : null}
                </div>
                <div className="ts-muted" style={{ fontSize: 12 }}>{new Date(t.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-panel mb-3">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Totals</h3>
            <div className="d-flex justify-content-between"><span>Sub total:</span><span>{order.totals.subtotal.formatted}</span></div>
            <div className="d-flex justify-content-between"><span>Shipping cost:</span><span>{order.totals.shipping.formatted}</span></div>
            <hr />
            <div className="d-flex justify-content-between" style={{ fontWeight: 700, fontSize: 17 }}>
              <span>Total</span><span>{order.totals.total.formatted}</span>
            </div>
            {order.payment.outstanding.amount > 0 ? (
              <div className="d-flex justify-content-between mt-2" style={{ color: 'var(--ts-warning)', fontWeight: 600 }}>
                <span>Outstanding</span><span>{order.payment.outstanding.formatted}</span>
              </div>
            ) : null}
          </div>

          {order.shipping.address ? (
            <div className="ts-panel mb-3" style={{ fontSize: 13.5 }}>
              <h3 style={{ fontSize: 15, marginBottom: 10 }}>Delivery</h3>
              <div><strong>Receiver's name:</strong> {order.shipping.address.receiverName}</div>
              <div><strong>Country:</strong> {order.shipping.address.country}</div>
              <div><strong>City/Town:</strong> {order.shipping.address.district}, {order.shipping.address.region}</div>
              <div><strong>Street Address:</strong> {order.shipping.address.streetAddress}</div>
              {order.shipping.address.postalCode ? (
                <div><strong>Postal Code:</strong> {order.shipping.address.postalCode}</div>
              ) : null}
              <div className="mt-2 ts-muted">{order.shipping.methodName}</div>
            </div>
          ) : null}

          <div className="d-grid gap-2 no-print">
            <Button variant="secondary" onClick={() => void reorder()}>
              <RotateCcw size={15} /> Order again
            </Button>
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer size={15} /> Print
            </Button>
            {canCancel ? (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel order</Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this order?"
        message={`Order ${order.orderNumber} will be cancelled and the items released back to stock. This cannot be undone.`}
        confirmLabel="Cancel order"
        onConfirm={() => void cancel()}
        onCancel={() => setConfirmCancel(false)}
        busy={busy}
      />
    </div>
  );
}
