import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CreditCard, PackageCheck, ShieldAlert, Warehouse,
} from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader } from './AdminLayout';
import { ChartCard, DonutChart, RankedBars, TrendChart } from './Charts';
import { PrintButton, PrintHeader } from './PrintButton';
import { Button, Skeleton, StatusPill } from '../components/ui';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'last7days', label: 'Last 7 Days' },
  { key: 'last30days', label: 'Last 30 Days' },
  { key: 'last12months', label: 'Last 12 Months' },
] as const;

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="ts-muted ts-stat__delta">no change</span>;
  const up = value > 0;
  return (
    <span className="ts-stat__delta d-inline-flex align-items-center gap-1"
      style={{ color: up ? 'var(--ts-success)' : 'var(--ts-danger)' }}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value)}%
    </span>
  );
}

const METRICS = [
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'orders', label: 'Orders', money: false },
] as const;

export function AdminDashboard() {
  const [period, setPeriod] = useState<string>('last30days');
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['admin', 'summary', period],
    queryFn: () => api.get(`/admin/analytics/summary?period=${period}`),
  });
  const { data: series = [] } = useQuery({
    queryKey: ['admin', 'series', period],
    queryFn: () => api.get(`/admin/analytics/series?period=${period}`),
  });
  const { data: breakdown } = useQuery({
    queryKey: ['admin', 'breakdown', period],
    queryFn: () => api.get<{
      orderStatus: { name: string; value: number }[];
      paymentMethods: { name: string; value: number; count: number }[];
      revenueByCategory: { name: string; value: number }[];
    }>(`/admin/analytics/breakdown?period=${period}`),
  });
  const { data: best = [] } = useQuery({
    queryKey: ['admin', 'best-sellers'],
    queryFn: () => api.get('/admin/analytics/best-sellers'),
  });
  const { data: recent } = useQuery({
    queryKey: ['admin', 'recent-orders'],
    queryFn: () => api.raw<{ data: any[] }>('/admin/orders?pageSize=8'),
  });
  const { data: searches = [] } = useQuery({
    queryKey: ['admin', 'top-searches'],
    queryFn: () => api.get('/admin/analytics/searches'),
  });

  const a = (summary as any)?.attention ?? {};
  const m = (summary as any)?.metrics;

  const attentionTiles = [
    { label: 'Awaiting payment verification', value: a.awaitingVerification ?? 0, to: '/admin/orders?paymentStatus=pending_verification', icon: <CreditCard size={18} />, warn: (a.awaitingVerification ?? 0) > 0 },
    { label: 'Orders to fulfil', value: a.toFulfil ?? 0, to: '/admin/orders?status=confirmed', icon: <PackageCheck size={18} /> },
    { label: 'Low stock', value: a.lowStock ?? 0, to: '/admin/stock?low=true', icon: <Warehouse size={18} />, warn: (a.lowStock ?? 0) > 0 },
    { label: 'Pending moderation', value: a.pendingModeration ?? 0, to: '/admin/comments', icon: <ShieldAlert size={18} /> },
  ];

  return (
    <>
      <PrintHeader title="Store dashboard" subtitle={PERIODS.find((p) => p.key === period)?.label} />
      <PageHeader
        title="Dashboard"
        description="What needs attention now, and how the store is doing."
        actions={
          <div className="d-flex gap-1 flex-wrap align-items-center">
            {PERIODS.map((p) => (
              <Button key={p.key} size="sm" variant={period === p.key ? 'primary' : 'ghost'}
                onClick={() => setPeriod(p.key)}>
                {p.label}
              </Button>
            ))}
            <PrintButton label="Print report" />
          </div>
        }
      />

      <div className="row g-3 mb-4">
        {attentionTiles.map((t) => (
          <div className="col-6 col-lg-3" key={t.label}>
            <Link to={t.to} className="ts-stat d-block h-100" style={{ color: 'inherit' }}>
              <div className="d-flex justify-content-between align-items-start">
                <div className="ts-stat__label">{t.label}</div>
                <span style={{ color: t.warn ? 'var(--ts-warning)' : 'var(--ts-text-muted)' }}>{t.icon}</span>
              </div>
              <div className="ts-stat__value" style={{ color: t.warn ? 'var(--ts-warning)' : undefined }}>
                {t.value}
              </div>
            </Link>
          </div>
        ))}
      </div>

      <div className="row g-3 mb-4">
        {isLoading || !m ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div className="col-6 col-lg-3" key={i}><div className="ts-stat"><Skeleton h={54} /></div></div>
          ))
        ) : (
          <>
            <div className="col-6 col-lg-3">
              <div className="ts-stat">
                <div className="ts-stat__label">Revenue</div>
                <div className="ts-stat__value">{m.revenue.value.formatted}</div>
                <Delta value={m.revenue.change} />
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="ts-stat">
                <div className="ts-stat__label">Orders</div>
                <div className="ts-stat__value">{m.orders.value}</div>
                <Delta value={m.orders.change} />
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="ts-stat">
                <div className="ts-stat__label">Average order value</div>
                <div className="ts-stat__value">{m.averageOrderValue.value.formatted}</div>
                <Delta value={m.averageOrderValue.change} />
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="ts-stat">
                <div className="ts-stat__label">New customers</div>
                <div className="ts-stat__value">{m.customers.value}</div>
                <Delta value={m.customers.change} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-8">
          <ChartCard
            title="Sales over time"
            subtitle={metric === 'revenue' ? 'Paid revenue per period' : 'Orders placed per period'}
            height={280}
            action={
              <div className="ts-segmented no-print" role="group" aria-label="Metric">
                {METRICS.map((mt) => (
                  <button key={mt.key} type="button" className={metric === mt.key ? 'is-on' : ''}
                    aria-pressed={metric === mt.key} onClick={() => setMetric(mt.key)}>
                    {mt.label}
                  </button>
                ))}
              </div>
            }
            table={
              <table className="ts-table">
                <thead><tr><th>Period</th><th>Revenue</th><th>Orders</th></tr></thead>
                <tbody>
                  {series.map((s: any) => (
                    <tr key={s.bucket}>
                      <td>{s.bucket}</td>
                      <td>TZS {s.revenue.toLocaleString()}</td>
                      <td>{s.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {series.length ? (
              <TrendChart
                data={series.map((s: any) => ({ bucket: s.bucket, value: s[metric] }))}
                metric={metric === 'revenue' ? 'Revenue' : 'Orders'}
                money={metric === 'revenue'}
              />
            ) : <Skeleton h={260} />}
          </ChartCard>
        </div>

        <div className="col-12 col-lg-4">
          <ChartCard
            title="Order pipeline"
            subtitle="Where orders sit right now"
            height={230}
            table={
              <table className="ts-table">
                <thead><tr><th>Status</th><th>Orders</th></tr></thead>
                <tbody>
                  {(breakdown?.orderStatus ?? []).map((s) => (
                    <tr key={s.name}><td>{s.name}</td><td>{s.value}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {breakdown ? <DonutChart data={breakdown.orderStatus} centreLabel="Orders" /> : <Skeleton h={200} />}
          </ChartCard>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-6">
          <ChartCard
            title="Revenue by category"
            subtitle="Which shelves earn the money"
            height={240}
            table={
              <table className="ts-table">
                <thead><tr><th>Category</th><th>Revenue</th></tr></thead>
                <tbody>
                  {(breakdown?.revenueByCategory ?? []).map((c) => (
                    <tr key={c.name}><td>{c.name}</td><td>TZS {c.value.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {breakdown ? <RankedBars data={breakdown.revenueByCategory} money /> : <Skeleton h={220} />}
          </ChartCard>
        </div>

        <div className="col-12 col-lg-6">
          <ChartCard
            title="How customers pay"
            subtitle="Paid revenue by payment method"
            height={240}
            table={
              <table className="ts-table">
                <thead><tr><th>Method</th><th>Revenue</th><th>Orders</th></tr></thead>
                <tbody>
                  {(breakdown?.paymentMethods ?? []).map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td><td>TZS {p.value.toLocaleString()}</td><td>{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {breakdown ? <DonutChart data={breakdown.paymentMethods} money centreLabel="TZS" /> : <Skeleton h={220} />}
          </ChartCard>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-8">

          <div className="ts-stat">
            <div className="ts-stat__label mb-2">Recent orders</div>
            <div className="ts-table__wrap" style={{ border: 0 }}>
              <table className="ts-table">
                <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
                <tbody>
                  {(recent?.data ?? []).map((o) => (
                    <tr key={o.orderNumber}>
                      <td><Link to={`/admin/orders/${o.orderNumber}`} className="ts-mono">{o.orderNumber}</Link></td>
                      <td>{o.customerName}</td>
                      <td>{o.total.formatted}</td>
                      <td><StatusPill label={o.statusLabel} tone={o.statusTone} /></td>
                      <td className="ts-muted">{new Date(o.placedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-stat mb-3">
            <div className="ts-stat__label mb-2">Best selling</div>
            {best.length === 0 ? <p className="ts-muted" style={{ fontSize: 13 }}>No products to display yet.</p> : null}
            {best.map((p: any) => (
              <div key={p.slug} className="d-flex gap-2 align-items-center py-2"
                style={{ borderBottom: '1px solid var(--ts-border)' }}>
                <img src={p.image ?? ''} alt="" width={36} height={36}
                  style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                  <div className="ts-clamp-2" style={{ fontWeight: 600 }}>{p.name}</div>
                  <div className="ts-muted">{p.unitsSold} sold</div>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.price.formatted}</div>
              </div>
            ))}
          </div>

          <div className="ts-stat">
            <div className="ts-stat__label mb-2">Top searches</div>
            {searches.slice(0, 10).map((s: any) => (
              <div key={s.term} className="d-flex justify-content-between py-1" style={{ fontSize: 13 }}>
                <span style={{ color: s.averageResults === 0 ? 'var(--ts-danger)' : undefined }}>
                  {s.averageResults === 0 ? <AlertTriangle size={12} style={{ marginRight: 4 }} /> : null}
                  {s.term}
                </span>
                <span className="ts-muted">{s.searches}</span>
              </div>
            ))}
            <Link to="/admin/searches" className="d-block mt-2" style={{ fontSize: 13 }}>
              View all searches →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
