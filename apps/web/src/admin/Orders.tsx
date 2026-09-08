import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, ShoppingBag } from 'lucide-react';
import { ApiError, api, qs } from '../lib/api';
import type { OrderDto, Paged } from '../lib/types';
import { PageHeader } from './AdminLayout';
import { PrintButton, PrintHeader } from './PrintButton';
import {
  Badge, Button, ConfirmDialog, EmptyState, Modal, Pagination, Skeleton, StatusPill, TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_payment', label: 'Awaiting payment' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'expired', label: 'Expired' },
];

export function AdminOrders() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const status = sp.get('status') ?? 'all';
  const paymentStatus = sp.get('paymentStatus') ?? '';
  const q = sp.get('q') ?? '';
  const [search, setSearch] = useState(q);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'orders', page, status, paymentStatus, q],
    queryFn: () => api.raw<Paged<any>>(`/admin/orders${qs({ page, pageSize: 25, status, paymentStatus, q })}`),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) {
        const next = new URLSearchParams(sp);
        if (search) next.set('q', search); else next.delete('q');
        next.delete('page');
        setSp(next);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = (data?.meta as any)?.statusCounts ?? {};
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    if (key === 'status') next.delete('paymentStatus');
    next.delete('page');
    setSp(next);
  };

  return (
    <>
      <PrintHeader title="Orders" />
      <PageHeader
        title="Orders made"
        description={data ? `${data.meta.total} orders` : undefined}
        actions={<PrintButton label="Print list" />}
      />

      <div className="d-flex gap-1 flex-wrap mb-3">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={status === t.key && !paymentStatus ? 'primary' : 'ghost'}
            onClick={() => setFilter('status', t.key)}
          >
            {t.label}
            {counts[t.key] ? <span className="ts-badge ms-1">{counts[t.key]}</span> : null}
          </Button>
        ))}
        <Button
          size="sm"
          variant={paymentStatus === 'pending_verification' ? 'primary' : 'ghost'}
          onClick={() => setFilter('paymentStatus', 'pending_verification')}
          style={{ color: paymentStatus === 'pending_verification' ? undefined : 'var(--ts-warning)' }}
        >
          Awaiting verification
        </Button>
      </div>

      <input
        className="ts-input mb-3"
        style={{ maxWidth: 380 }}
        placeholder="Search order number, customer, phone, email or SKU"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading ? (
        <Skeleton h={300} />
      ) : !data?.data.length ? (
        <EmptyState icon={<ShoppingBag size={48} />} title="No orders" description="No orders match this filter." />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Order</th><th>Date</th><th>Customer</th><th>Phone</th><th>Region</th>
                  <th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((o) => (
                  <tr key={o.orderNumber}>
                    <td><Link to={`/admin/orders/${o.orderNumber}`} className="ts-mono">{o.orderNumber}</Link></td>
                    <td className="ts-muted">{new Date(o.placedAt).toLocaleDateString()}</td>
                    <td>{o.customerName}</td>
                    <td className="ts-mono">{o.customerPhone}</td>
                    <td>{o.region ?? '—'}</td>
                    <td>{o.itemCount}</td>
                    <td style={{ fontWeight: 600 }}>{o.total.formatted}</td>
                    <td>
                      <Badge tone={
                        o.paymentStatus === 'paid' ? 'success'
                          : o.paymentStatus === 'pending_verification' ? 'warning' : 'neutral'
                      }>
                        {o.paymentStatus.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td><StatusPill label={o.statusLabel} tone={o.statusTone} /></td>
                    <td><Link to={`/admin/orders/${o.orderNumber}`} className="ts-btn ts-btn--ghost ts-btn--sm">View</Link></td>
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

export function AdminOrderDetail() {
  const { orderNumber = '' } = useParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState({ providerReference: '', amount: '', note: '' });
  const [verifyErr, setVerifyErr] = useState<Record<string, string>>({});

  const { data: order, isLoading } = useQuery({
    queryKey: ['admin', 'order', orderNumber],
    queryFn: () => api.get<OrderDto>(`/admin/orders/${orderNumber}`),
  });

  useEffect(() => {
    if (order) setVerify((v) => ({ ...v, amount: String(order.payment.outstanding.amount) }));
  }, [order]);

  if (isLoading || !order) return <Skeleton h={400} />;

  const changeStatus = async () => {
    if (!statusTarget) return;
    setBusy(true);
    try {
      await api.patch(`/admin/orders/${orderNumber}/status`, { status: statusTarget, note });
      await qc.invalidateQueries({ queryKey: ['admin', 'order', orderNumber] });
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      toast({ tone: 'success', title: `Order moved to ${statusTarget.replace(/_/g, ' ')}` });
      setStatusTarget(null);
      setNote('');
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not change status', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async () => {
    setVerifyErr({});
    setBusy(true);
    try {
      await api.post(`/admin/orders/${orderNumber}/payments/verify`, {
        providerReference: verify.providerReference,
        amount: Number(verify.amount),
        note: verify.note || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'order', orderNumber] });
      await qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      toast({ tone: 'success', title: 'Payment verified' });
      setVerifyOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setVerifyErr(e.fieldErrors());
        if (!e.details?.length) toast({ tone: 'danger', title: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PrintHeader
        title={`Order ${order.orderNumber}`}
        subtitle={`Placed ${new Date(order.placedAt).toLocaleString()} · ${order.shipping.methodName}`}
      />
      <PageHeader
        title={order.orderNumber}
        description={`Placed ${new Date(order.placedAt).toLocaleString()} · ${order.shipping.methodName}`}
        actions={
          <>
            <Button variant="ghost" className="no-print" onClick={() => window.print()}>
              <Printer size={15} /> Print / packing slip
            </Button>
            {order.paymentStatus !== 'paid' ? (
              <Button className="no-print" onClick={() => setVerifyOpen(true)}>
                <CheckCircle2 size={15} /> Verify payment
              </Button>
            ) : null}
          </>
        }
      />

      <div className="d-flex gap-2 flex-wrap mb-4">
        <StatusPill label={order.statusLabel} tone={order.statusTone} />
        <Badge tone={order.paymentStatus === 'paid' ? 'success' : 'warning'}>
          Payment: {order.paymentStatus.replace(/_/g, ' ')}
        </Badge>
        <Badge tone="neutral">Fulfilment: {order.fulfilmentStatus}</Badge>
        {order.nextStates.length ? (
          <div className="d-flex gap-1 ms-auto flex-wrap">
            {order.nextStates.map((s) => (
              <Button key={s} size="sm" variant="secondary" onClick={() => setStatusTarget(s)}>
                Mark {s.replace(/_/g, ' ')}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div className="ts-card p-4 mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Items</h2>
            <div className="ts-table__wrap" style={{ border: 0 }}>
              <table className="ts-table">
                <thead><tr><th>Product</th><th>SKU</th><th>Unit price</th><th>Qty</th><th>Total</th></tr></thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.sku}>
                      <td>
                        <div className="d-flex gap-2 align-items-center">
                          {i.image ? <img src={i.image} alt="" width={34} height={34}
                            style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} /> : null}
                          <span>{i.name}</span>
                        </div>
                      </td>
                      <td className="ts-mono">{i.sku}</td>
                      <td>{i.unitPrice.formatted}</td>
                      <td>{i.quantity}</td>
                      <td style={{ fontWeight: 600 }}>{i.lineTotal.formatted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ts-card p-4 mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Payment</h2>
            <div className="row" style={{ fontSize: 13.5 }}>
              <div className="col-6 col-md-3"><div className="ts-label">Method</div>{order.payment.method ?? '—'}</div>
              <div className="col-6 col-md-3"><div className="ts-label">Paying from</div>
                <span className="ts-mono">{order.payment.number ?? '—'}</span></div>
              <div className="col-6 col-md-3"><div className="ts-label">Paid</div>{order.payment.paid.formatted}</div>
              <div className="col-6 col-md-3"><div className="ts-label">Outstanding</div>
                <span style={{ color: order.payment.outstanding.amount > 0 ? 'var(--ts-warning)' : undefined, fontWeight: 600 }}>
                  {order.payment.outstanding.formatted}
                </span></div>
            </div>
            {order.payment.delegatedPayerEmail ? (
              <div className="mt-3" style={{ fontSize: 13.5 }}>
                <div className="ts-label">Delegated payer</div>{order.payment.delegatedPayerEmail}
              </div>
            ) : null}
            {order.payment.records.length ? (
              <div className="ts-table__wrap mt-3" style={{ border: 0 }}>
                <table className="ts-table">
                  <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
                  <tbody>
                    {order.payment.records.map((p) => (
                      <tr key={p.id}>
                        <td className="ts-muted">{new Date(p.createdAt).toLocaleString()}</td>
                        <td>{p.method}</td>
                        <td>{p.amount.formatted}</td>
                        <td className="ts-mono">{p.reference ?? '—'}</td>
                        <td><Badge tone={p.status === 'succeeded' ? 'success' : p.status === 'refunded' ? 'danger' : 'warning'}>{p.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="ts-muted mt-2" style={{ fontSize: 13 }}>No payments recorded yet.</p>}
          </div>

          <div className="ts-card p-4">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Timeline</h2>
            {order.timeline.map((t, i) => (
              <div key={i} className="d-flex gap-3 py-2" style={{ fontSize: 13.5, borderBottom: '1px solid var(--ts-border)' }}>
                <div style={{ flex: 1 }}>
                  <strong>{t.type.replace(/_/g, ' ')}</strong>
                  {t.from || t.to ? <span className="ts-muted"> · {t.from ?? '—'} → {t.to ?? '—'}</span> : null}
                  {t.message ? <div className="ts-muted">{t.message}</div> : null}
                </div>
                <div className="ts-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {t.actorType} · {new Date(t.at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-card p-4 mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Customer</h2>
            <div style={{ fontSize: 13.5 }}>
              <div><strong>Client:</strong> {order.customer.name || 'Anonymous'}</div>
              <div><strong>Email:</strong> {order.customer.email || 'Not specified'}</div>
              <div><strong>Phone:</strong> <span className="ts-mono">{order.customer.phone}</span></div>
              <div className="ts-muted mt-1">{order.customer.isGuest ? 'Guest checkout' : 'Registered customer'}</div>
            </div>
          </div>

          {order.shipping.address ? (
            <div className="ts-card p-4 mb-3" style={{ fontSize: 13.5 }}>
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>Delivery</h2>
              <div><strong>Receiver's name:</strong> {order.shipping.address.receiverName}</div>
              <div><strong>Phone:</strong> {order.shipping.address.phone}</div>
              <div><strong>Country:</strong> {order.shipping.address.country}</div>
              <div><strong>City/Town:</strong> {order.shipping.address.district}, {order.shipping.address.region}</div>
              <div><strong>Street Address:</strong> {order.shipping.address.streetAddress}</div>
              {order.shipping.address.postalCode ? <div><strong>Postal Code:</strong> {order.shipping.address.postalCode}</div> : null}
            </div>
          ) : null}

          <div className="ts-panel">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Totals</h2>
            <div className="d-flex justify-content-between"><span>Sub total:</span><span>{order.totals.subtotal.formatted}</span></div>
            <div className="d-flex justify-content-between"><span>Shipping cost:</span><span>{order.totals.shipping.formatted}</span></div>
            <hr />
            <div className="d-flex justify-content-between" style={{ fontWeight: 700, fontSize: 17 }}>
              <span>Total</span><span>{order.totals.total.formatted}</span>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="Verify payment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVerifyOpen(false)}>Cancel</Button>
            <Button onClick={() => void doVerify()} loading={busy}>Mark as paid</Button>
          </>
        }
      >
        <p style={{ fontSize: 14 }} className="ts-muted">
          Enter the mobile-money transaction reference from your merchant notification. The same
          reference can never be credited to two orders.
        </p>
        <TextInput
          label="Transaction reference"
          value={verify.providerReference}
          error={verifyErr.providerReference}
          onChange={(e) => setVerify({ ...verify, providerReference: e.target.value })}
          required
        />
        <TextInput
          label="Amount received (TZS)"
          value={verify.amount}
          error={verifyErr.amount}
          inputMode="numeric"
          onChange={(e) => setVerify({ ...verify, amount: e.target.value.replace(/\D/g, '') })}
          hint={`Expected ${order.payment.outstanding.formatted}`}
          required
        />
        <TextArea
          label="Note (optional)"
          value={verify.note}
          rows={2}
          onChange={(e) => setVerify({ ...verify, note: e.target.value })}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title={`Move order to ${statusTarget?.replace(/_/g, ' ')}?`}
        message={
          <>
            <p>Order <strong>{order.orderNumber}</strong> will move from <strong>{order.status.replace(/_/g, ' ')}</strong> to <strong>{statusTarget?.replace(/_/g, ' ')}</strong>.</p>
            {statusTarget === 'shipped' && order.paymentStatus !== 'paid'
              ? <p className="ts-muted">Stock will be deducted now, because this order has not been paid in advance.</p>
              : null}
            {statusTarget === 'cancelled'
              ? <p className="ts-muted">Reserved stock will be released.</p>
              : null}
            <TextArea label="Note (optional)" value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
          </>
        }
        confirmLabel="Confirm"
        tone={statusTarget === 'cancelled' ? 'danger' : 'primary'}
        onConfirm={() => void changeStatus()}
        onCancel={() => { setStatusTarget(null); setNote(''); }}
        busy={busy}
      />
    </>
  );
}
