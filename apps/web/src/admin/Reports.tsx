import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Download, Heart, PackageX,
  Search, TrendingDown, TrendingUp,
} from 'lucide-react';
import { api, getAccessToken } from '../lib/api';
import { PageHeader } from './AdminLayout';
import { ChartCard, GroupedBars, MultiLine } from './Charts';
import { PrintButton, PrintHeader } from './PrintButton';
import { Badge, Button, EmptyState, Select, Skeleton } from '../components/ui';

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString('en-US')}`;

const PERIODS = [
  ['today', 'Today'], ['last7days', '7 days'], ['last30days', '30 days'],
  ['last90days', '90 days'], ['last12months', '12 months'], ['thisYear', 'This year'],
] as const;

async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="ts-muted" style={{ fontSize: 12 }}>no change</span>;
  const up = value > 0;
  return (
    <span className="d-inline-flex align-items-center gap-1" style={{
      fontSize: 12, fontWeight: 600,
      color: up ? 'var(--ts-success)' : 'var(--ts-danger)',
    }}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value)}{suffix}
    </span>
  );
}

/**
 * Revenue beside gross profit. Both are money on the same scale, so they share
 * one axis honestly — the gap between the pair is the story. Margin % is a
 * different unit and gets its own line chart rather than a second y-axis.
 */
function ProfitChart({ series }: { series: any[] }) {
  return (
    <GroupedBars
      data={series}
      keys={[{ key: 'revenue', label: 'Revenue' }, { key: 'grossProfit', label: 'Gross profit' }]}
      money
    />
  );
}

// ═════════════════════════════════════════════════ PROFIT & MARGIN ══

export function AdminProfitReport() {
  const [period, setPeriod] = useState('last30days');
  const granularity = ['last12months', 'thisYear'].includes(period) ? 'month' : 'day';

  const { data: summary, isLoading } = useQuery({
    queryKey: ['admin', 'profit', period],
    queryFn: () => api.get(`/admin/reports/profit?period=${period}`),
  });
  const { data: series = [] } = useQuery({
    queryKey: ['admin', 'profit-series', period, granularity],
    queryFn: () => api.get(`/admin/reports/profit/series?period=${period}&granularity=${granularity}`),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['admin', 'profit-products', period],
    queryFn: () => api.get(`/admin/reports/profit/products?period=${period}&limit=50`),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['admin', 'profit-categories', period],
    queryFn: () => api.get(`/admin/reports/profit/categories?period=${period}`),
  });

  return (
    <>
      <PrintHeader title="Profit & margin report" />
      <PageHeader
        title="Profit & margin"
        description="What the store actually earns after the cost of goods."
        actions={
          <>
            <div className="d-flex gap-1 flex-wrap">
              {PERIODS.map(([k, label]) => (
                <Button key={k} size="sm" variant={period === k ? 'primary' : 'ghost'}
                  onClick={() => setPeriod(k)}>{label}</Button>
              ))}
            </div>
            <Button variant="ghost"
              onClick={() => void downloadCsv(`/admin/exports/profit?period=${period}`, 'profit.csv')}>
              <Download size={15} /> CSV
            </Button>
            <PrintButton label="Print" />
          </>
        }
      />

      {isLoading || !summary ? <Skeleton h={120} /> : (
        <>
          {summary.dataQuality.costCoveragePercent < 100 ? (
            <div className="ts-panel d-flex gap-2 align-items-start mb-3"
              style={{ background: '#fdf6e7', border: '1px solid #f0dcb0' }}>
              <AlertTriangle size={18} style={{ color: 'var(--ts-warning)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13.5 }}>
                <strong>{summary.dataQuality.costCoveragePercent}% of revenue has a recorded cost.</strong>{' '}
                {summary.dataQuality.linesWithoutCost} sold line{summary.dataQuality.linesWithoutCost === 1 ? '' : 's'} had
                no cost price, so they are excluded from margin rather than counted as pure profit.{' '}
                <Link to="/admin/stock-editor">Add the missing costs →</Link>
              </div>
            </div>
          ) : null}

          <div className="row g-3 mb-4">
            {[
              ['Revenue', summary.revenue.formatted, summary.revenue.change],
              ['Cost of goods', summary.cogs.formatted, summary.cogs.change],
              ['Gross profit', summary.grossProfit.formatted, summary.grossProfit.change],
              ['Margin', `${summary.marginPercent.value}%`, summary.marginPercent.change],
            ].map(([label, value, change], i) => (
              <div className="col-6 col-lg-3" key={label as string}>
                <div className="ts-stat">
                  <div className="ts-stat__label">{label}</div>
                  <div className="ts-stat__value" style={{
                    color: i === 2 ? 'var(--ts-primary)' : undefined,
                  }}>{value as string}</div>
                  <Delta value={change as number} suffix={i === 3 ? ' pts' : '%'} />
                </div>
              </div>
            ))}
          </div>

          <div className="row g-3 mb-4">
            {[
              ['Units sold', String(summary.unitsSold.value)],
              ['Orders', String(summary.orders.value)],
              ['Average order', summary.averageOrderValue.formatted],
              ['Profit per order', summary.profitPerOrderFormatted],
            ].map(([label, value]) => (
              <div className="col-6 col-lg-3" key={label}>
                <div className="ts-stat">
                  <div className="ts-stat__label">{label}</div>
                  <div className="ts-stat__value" style={{ fontSize: 20 }}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-7">
          <ChartCard
            title="Revenue and gross profit"
            subtitle="Both in TZS — the gap between the pair is your margin"
            height={280}
            table={
              <table className="ts-table">
                <thead><tr><th>Period</th><th>Revenue</th><th>Gross profit</th><th>Margin</th></tr></thead>
                <tbody>
                  {series.map((s: any) => (
                    <tr key={s.bucket}>
                      <td>{s.bucket}</td>
                      <td>{tzs(s.revenue)}</td>
                      <td>{tzs(s.grossProfit)}</td>
                      <td>{s.marginPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {series.length ? <ProfitChart series={series} /> : <Skeleton h={260} />}
          </ChartCard>
        </div>
        <div className="col-12 col-lg-5">
          <ChartCard
            title="Margin trend"
            subtitle="Gross margin percentage over the same period"
            height={280}
            table={
              <table className="ts-table">
                <thead><tr><th>Period</th><th>Margin</th></tr></thead>
                <tbody>
                  {series.map((s: any) => (
                    <tr key={s.bucket}><td>{s.bucket}</td><td>{s.marginPercent}%</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {series.length ? (
              <MultiLine data={series} keys={[{ key: 'marginPercent', label: 'Margin %' }]} />
            ) : <Skeleton h={260} />}
          </ChartCard>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-7">
          <div className="ts-stat">
            <div className="ts-stat__label mb-2">Most profitable products</div>
            <div className="ts-table__wrap" style={{ border: 0 }}>
              <table className="ts-table">
                <thead><tr><th>Product</th><th>Units</th><th>Revenue</th><th>Profit</th><th>Margin</th></tr></thead>
                <tbody>
                  {products.slice(0, 15).map((p: any) => (
                    <tr key={`${p.productId}-${p.name}`}>
                      <td>
                        <div className="d-flex gap-2 align-items-center">
                          {p.image ? <img src={p.image} alt="" width={28} height={28}
                            style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} /> : null}
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                            <div className="ts-muted" style={{ fontSize: 11 }}>{p.subcategory}</div>
                          </div>
                        </div>
                      </td>
                      <td>{p.unitsSold}</td>
                      <td>{p.revenueFormatted}</td>
                      <td style={{ fontWeight: 600, color: 'var(--ts-primary)' }}>{p.grossProfitFormatted}</td>
                      <td style={{
                        fontWeight: 600,
                        color: p.marginPercent < 15 ? 'var(--ts-danger)'
                          : p.marginPercent < 30 ? 'var(--ts-warning)' : 'var(--ts-success)',
                      }}>
                        {p.marginPercent}%{p.hasCostGap ? <AlertTriangle size={11} style={{ marginLeft: 4 }} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!products.length ? <p className="ts-muted">No sales in this period.</p> : null}
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="ts-stat">
            <div className="ts-stat__label mb-2">Profit by category</div>
            {!categories.length ? <p className="ts-muted">No sales in this period.</p> : null}
            {categories.map((c: any) => {
              const max = Math.max(...categories.map((x: any) => x.grossProfit));
              return (
                <div key={c.category} className="py-2" style={{ borderBottom: '1px solid var(--ts-border)' }}>
                  <div className="d-flex justify-content-between" style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{c.category}</span>
                    <span>{c.grossProfitFormatted} <span className="ts-muted">({c.marginPercent}%)</span></span>
                  </div>
                  <div style={{ height: 6, background: 'var(--ts-surface-sunken)', borderRadius: 4, marginTop: 4 }}>
                    <div style={{
                      width: `${max > 0 ? (c.grossProfit / max) * 100 : 0}%`,
                      height: '100%', background: 'var(--ts-primary)', borderRadius: 4,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════ WHAT TO STOCK NEXT ══

export function AdminStockDecisions() {
  const [period, setPeriod] = useState('last90days');
  const [rankBy, setRankBy] = useState<'profit' | 'units' | 'revenue'>('profit');

  const { data: best = [] } = useQuery({
    queryKey: ['admin', 'best-sellers', period, rankBy],
    queryFn: () => api.get(`/admin/reports/best-sellers?period=${period}&by=${rankBy}`),
  });
  const { data: missed } = useQuery({
    queryKey: ['admin', 'missed-demand'],
    queryFn: () => api.get('/admin/reports/missed-demand?days=90'),
  });
  const { data: dead } = useQuery({
    queryKey: ['admin', 'dead-stock'],
    queryFn: () => api.raw<{ data: any[]; meta: any }>('/admin/inventory/dead-stock?days=90'),
  });
  const { data: valuation } = useQuery({
    queryKey: ['admin', 'valuation'],
    queryFn: () => api.get('/admin/inventory/valuation'),
  });

  return (
    <>
      <PrintHeader title="What to stock next" />
      <PageHeader
        title="What to stock next"
        description="What sells, what customers asked for and could not get, and what is not moving."
        actions={
          <div className="d-flex gap-1 flex-wrap align-items-center">
            {PERIODS.slice(2).map(([k, label]) => (
              <Button key={k} size="sm" variant={period === k ? 'primary' : 'ghost'}
                onClick={() => setPeriod(k)}>{label}</Button>
            ))}
            <PrintButton label="Print" />
          </div>
        }
      />

      {valuation ? (
        <div className="row g-3 mb-4">
          {[
            ['Stock at cost', valuation.atCost.formatted, undefined],
            ['Stock at retail', valuation.atRetail.formatted, undefined],
            ['Potential margin', valuation.potentialMargin.formatted, 'var(--ts-primary)'],
            ['Capital in dead stock', dead?.meta.tiedUpCapital.formatted ?? '—', 'var(--ts-danger)'],
          ].map(([l, v, c]) => (
            <div className="col-6 col-lg-3" key={l as string}>
              <div className="ts-stat">
                <div className="ts-stat__label">{l}</div>
                <div className="ts-stat__value" style={{ color: c as string }}>{v as string}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row g-3">
        {/* ── best sellers ── */}
        <div className="col-12 col-lg-6">
          <div className="ts-stat h-100">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="ts-stat__label" style={{ margin: 0 }}>
                <TrendingUp size={13} style={{ marginRight: 4 }} /> Reorder more of these
              </div>
              <div className="d-flex gap-1">
                {(['profit', 'units', 'revenue'] as const).map((k) => (
                  <Button key={k} size="sm" variant={rankBy === k ? 'primary' : 'ghost'}
                    onClick={() => setRankBy(k)}>{k}</Button>
                ))}
              </div>
            </div>
            {!best.length ? <p className="ts-muted">No sales in this period.</p> : (
              <table className="ts-table">
                <thead><tr><th>Product</th><th>Units</th><th>Profit</th><th>Margin</th></tr></thead>
                <tbody>
                  {best.slice(0, 12).map((p: any) => (
                    <tr key={p.name}>
                      <td style={{ fontSize: 13 }}>{p.name}</td>
                      <td>{p.unitsSold}</td>
                      <td style={{ fontWeight: 600 }}>{p.grossProfitFormatted}</td>
                      <td>{p.marginPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── missed demand ── */}
        <div className="col-12 col-lg-6">
          <div className="ts-stat h-100">
            <div className="ts-stat__label mb-2">
              <Search size={13} style={{ marginRight: 4 }} /> Demand you are missing
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ts-text-muted)', marginTop: 8 }}>
              Searched for, nothing found
            </div>
            {!missed?.zeroResultSearches.length ? (
              <p className="ts-muted" style={{ fontSize: 13 }}>Every search returned results.</p>
            ) : missed.zeroResultSearches.slice(0, 8).map((z: any) => (
              <div key={z.term} className="d-flex justify-content-between py-1" style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--ts-danger)' }}>{z.term}</span>
                <span className="d-flex gap-2 align-items-center">
                  <span className="ts-muted">{z.searches}×</span>
                  <Link to={`/admin/products/new?name=${encodeURIComponent(z.term)}`}
                    style={{ fontSize: 12 }}>add</Link>
                </span>
              </div>
            ))}

            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ts-text-muted)', marginTop: 14 }}>
              Waiting for restock
            </div>
            {!missed?.backInStockRequests.length ? (
              <p className="ts-muted" style={{ fontSize: 13 }}>Nobody is waiting on a restock.</p>
            ) : missed.backInStockRequests.slice(0, 6).map((b: any) => (
              <div key={b.sku} className="d-flex justify-content-between py-1" style={{ fontSize: 13 }}>
                <span>{b.productName}</span>
                <Badge tone="warning">{b.waiting} waiting</Badge>
              </div>
            ))}

            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ts-text-muted)', marginTop: 14 }}>
              <Heart size={11} style={{ marginRight: 4 }} /> Wishlisted but out of stock
            </div>
            {!missed?.wishlistedOutOfStock.length ? (
              <p className="ts-muted" style={{ fontSize: 13 }}>Nothing wishlisted is out of stock.</p>
            ) : missed.wishlistedOutOfStock.slice(0, 6).map((w: any) => (
              <div key={w.productSlug} className="d-flex justify-content-between py-1" style={{ fontSize: 13 }}>
                <span>{w.productName}</span>
                <span className="ts-muted">{w.wishlisted} saved</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── dead stock ── */}
        <div className="col-12">
          <div className="ts-stat">
            <div className="ts-stat__label mb-2">
              <TrendingDown size={13} style={{ marginRight: 4 }} /> Not moving — capital sitting still
            </div>
            {!dead?.data.length ? (
              <EmptyState title="Nothing is stagnant"
                description="Every stocked product has sold at least once in the last 90 days." />
            ) : (
              <>
                <p className="ts-muted" style={{ fontSize: 13 }}>
                  {dead.meta.rowCount} product{dead.meta.rowCount === 1 ? '' : 's'} with stock but no sales in
                  90 days, holding {dead.meta.tiedUpCapital.formatted} of capital. Consider discounting,
                  bundling, or not reordering.
                </p>
                <div className="ts-table__wrap" style={{ border: 0 }}>
                  <table className="ts-table">
                    <thead><tr><th>Product</th><th>Subcategory</th><th>On hand</th><th>Tied up</th><th>Listed</th><th /></tr></thead>
                    <tbody>
                      {dead.data.slice(0, 12).map((d: any) => (
                        <tr key={d.variantId}>
                          <td>
                            <div className="d-flex gap-2 align-items-center">
                              {d.image ? <img src={d.image} alt="" width={28} height={28}
                                style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} /> : null}
                              <span style={{ fontSize: 13 }}>{d.productName}</span>
                            </div>
                          </td>
                          <td className="ts-muted" style={{ fontSize: 12.5 }}>{d.subcategory}</td>
                          <td>{d.onHand}</td>
                          <td style={{ fontWeight: 600, color: 'var(--ts-danger)' }}>{d.tiedUpCapitalFormatted}</td>
                          <td className="ts-muted">{d.daysListed}d ago</td>
                          <td>
                            <Link to={`/product/${d.productSlug}`} target="_blank"
                              className="ts-btn ts-btn--ghost ts-btn--sm">View</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════ CUSTOMERS & OPERATIONS ══

export function AdminBusinessReport() {
  const [period, setPeriod] = useState('last30days');

  const { data: customers } = useQuery({
    queryKey: ['admin', 'report-customers', period],
    queryFn: () => api.get(`/admin/reports/customers?period=${period}`),
  });
  const { data: ops } = useQuery({
    queryKey: ['admin', 'report-operations', period],
    queryFn: () => api.get(`/admin/reports/operations?period=${period}`),
  });

  const fmtMinutes = (m: number | null) =>
    m == null ? '—' : m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} hrs`;
  const fmtHours = (h: number | null) =>
    h == null ? '—' : h < 24 ? `${h} hrs` : `${(h / 24).toFixed(1)} days`;

  return (
    <>
      <PrintHeader title="Customers & operations report" />
      <PageHeader
        title="Customers & operations"
        description="Who buys, how often, and how fast the store actually runs."
        actions={
          <>
            <div className="d-flex gap-1 flex-wrap">
              {PERIODS.slice(1).map(([k, label]) => (
                <Button key={k} size="sm" variant={period === k ? 'primary' : 'ghost'}
                  onClick={() => setPeriod(k)}>{label}</Button>
              ))}
            </div>
            <Button variant="ghost"
              onClick={() => void downloadCsv('/admin/exports/customers', 'customers.csv')}>
              <Download size={15} /> CSV
            </Button>
            <PrintButton label="Print" />
          </>
        }
      />

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Customers</h2>
      {!customers ? <Skeleton h={110} /> : (
        <div className="row g-3 mb-4">
          {[
            ['New customers', String(customers.newCustomers)],
            ['Buying customers', String(customers.buyingCustomers)],
            ['Repeat rate', `${customers.repeatRatePercent}%`],
            ['Average lifetime value', customers.averageLifetimeValue.formatted],
          ].map(([l, v]) => (
            <div className="col-6 col-lg-3" key={l}>
              <div className="ts-stat">
                <div className="ts-stat__label">{l}</div>
                <div className="ts-stat__value">{v}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {customers?.byRegion.length ? (
        <div className="ts-stat mb-4">
          <div className="ts-stat__label mb-2">Orders by region</div>
          {customers.byRegion.map((r: any) => {
            const max = Math.max(...customers.byRegion.map((x: any) => x.orders));
            return (
              <div key={r.region} className="d-flex align-items-center gap-2 py-1" style={{ fontSize: 13 }}>
                <span style={{ width: 150 }}>{r.region}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--ts-surface-sunken)', borderRadius: 4 }}>
                  <div style={{ width: `${(r.orders / max) * 100}%`, height: '100%', background: 'var(--ts-primary)', borderRadius: 4 }} />
                </div>
                <span className="ts-muted" style={{ width: 34, textAlign: 'right' }}>{r.orders}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Operations</h2>
      {!ops ? <Skeleton h={110} /> : (
        <>
          <div className="row g-3 mb-3">
            {[
              ['Orders placed', String(ops.ordersPlaced), undefined],
              ['Converted to paid', `${ops.conversionToPaidPercent}%`, undefined],
              ['Cancellation rate', `${ops.cancellationRatePercent}%`,
                ops.cancellationRatePercent > 10 ? 'var(--ts-danger)' : undefined],
              ['Expiry rate', `${ops.expiryRatePercent}%`,
                ops.expiryRatePercent > 15 ? 'var(--ts-danger)' : undefined],
            ].map(([l, v, c]) => (
              <div className="col-6 col-lg-3" key={l as string}>
                <div className="ts-stat">
                  <div className="ts-stat__label">{l}</div>
                  <div className="ts-stat__value" style={{ color: c as string }}>{v as string}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="row g-3">
            {[
              ['Median payment lag', fmtMinutes(ops.medianPaymentLagMinutes),
                'From order placed to payment confirmed'],
              ['Median time to ship', fmtHours(ops.medianFulfilmentLagHours),
                'From payment confirmed to dispatch'],
              ['Median delivery time', fmtHours(ops.medianDeliveryLagHours),
                'From dispatch to delivered'],
              ['Awaiting verification now', String(ops.awaitingVerificationNow),
                'Payments a person still needs to check'],
            ].map(([l, v, hint]) => (
              <div className="col-6 col-lg-3" key={l as string}>
                <div className="ts-stat">
                  <div className="ts-stat__label">{l}</div>
                  <div className="ts-stat__value" style={{ fontSize: 20 }}>{v as string}</div>
                  <div className="ts-muted" style={{ fontSize: 11.5 }}>{hint as string}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
