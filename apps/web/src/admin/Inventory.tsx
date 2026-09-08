import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownToLine, ClipboardCheck, Download, Package, PackageCheck,
  Plus, Save, Search, Trash2, TrendingDown, Truck, Undo2,
} from 'lucide-react';
import { ApiError, api, qs } from '../lib/api';
import type { Paged } from '../lib/types';
import { PageHeader } from './AdminLayout';
import {
  Badge, Button, ConfirmDialog, EmptyState, Modal, Pagination, Select, Skeleton, TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString('en-US')}`;

/** Downloads a CSV through the authenticated client rather than a bare link. */
async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${(await import('../lib/api')).getAccessToken() ?? ''}` },
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════ BULK STOCK EDITOR ══

interface Draft {
  stockQuantity?: number;
  priceAmount?: number;
  costAmount?: number | null;
  lowStockThreshold?: number;
  reorderPoint?: number | null;
  binLocation?: string | null;
}

/**
 * Spreadsheet-style editing. Restocking twenty lines is one action, not twenty
 * dialogs. Only changed cells are sent, and nothing is written until Save.
 */
export function AdminStockEditor() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const q = sp.get('q') ?? '';
  const low = sp.get('low') === 'true';
  const [search, setSearch] = useState(q);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [reason, setReason] = useState('purchase');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock-editor', page, q, low],
    queryFn: () => api.raw<Paged<any>>(`/admin/stock${qs({ page, pageSize: 50, q, low: low || undefined })}`),
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

  const dirtyCount = Object.keys(drafts).length;

  const setCell = (variantId: number, field: keyof Draft, raw: string, original: unknown) => {
    const parsed = field === 'binLocation'
      ? (raw || null)
      : raw === '' ? null : Number(raw.replace(/[^\d]/g, ''));

    setDrafts((d) => {
      const next = { ...d };
      const row = { ...(next[variantId] ?? {}) };
      if (parsed === original || (parsed === null && original === null)) delete row[field];
      else (row as Record<string, unknown>)[field] = parsed;
      if (Object.keys(row).length === 0) delete next[variantId];
      else next[variantId] = row;
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const rows = Object.entries(drafts).map(([variantId, d]) => ({
        variantId: Number(variantId),
        ...d,
      }));
      const res = await api.patch<{ rowsProcessed: number; changes: number }>('/admin/stock/bulk', {
        rows, reason, note: note || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'stock-editor'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      setDrafts({});
      setNote('');
      toast({
        tone: 'success',
        title: `${res.changes} change${res.changes === 1 ? '' : 's'} saved`,
        text: `${res.rowsProcessed} row${res.rowsProcessed === 1 ? '' : 's'} processed.`,
      });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not save', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const cell = (v: any, field: keyof Draft, original: number | string | null, width = 84) => {
    const draft = drafts[v.variantId]?.[field];
    const changed = draft !== undefined;
    return (
      <input
        className="ts-input"
        style={{
          minHeight: 30, width, padding: '4px 8px', fontSize: 13,
          background: changed ? '#fff8e1' : undefined,
          borderColor: changed ? 'var(--ts-warning)' : undefined,
          fontWeight: changed ? 700 : 400,
        }}
        value={String(changed ? (draft ?? '') : (original ?? ''))}
        onChange={(e) => setCell(v.variantId, field, e.target.value, original)}
        inputMode={field === 'binLocation' ? 'text' : 'numeric'}
      />
    );
  };

  return (
    <>
      <PageHeader
        title="Stock editor"
        description="Edit many lines at once. Nothing is written until you save, and every stock change is logged."
        actions={
          <>
            <Button variant="ghost" onClick={() => void downloadCsv('/admin/exports/products', 'products.csv')}>
              <Download size={15} /> Export CSV
            </Button>
            <Link to="/admin/purchase-orders" className="ts-btn ts-btn--secondary">
              <Truck size={15} /> Purchase orders
            </Link>
          </>
        }
      />

      <div className="d-flex gap-2 flex-wrap mb-3">
        <input className="ts-input" style={{ maxWidth: 300 }} placeholder="Search SKU or product name"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant={low ? 'primary' : 'secondary'}
          onClick={() => {
            const n = new URLSearchParams(sp);
            if (low) n.delete('low'); else n.set('low', 'true');
            n.delete('page');
            setSp(n);
          }}>
          {low ? 'Showing low stock' : 'Low stock only'}
        </Button>
      </div>

      {dirtyCount > 0 ? (
        <div className="ts-panel d-flex flex-wrap align-items-end gap-3 mb-3" style={{ position: 'sticky', top: 64, zIndex: 20 }}>
          <div>
            <div className="ts-label" style={{ margin: 0 }}>Unsaved</div>
            <strong style={{ fontSize: 18 }}>{dirtyCount} row{dirtyCount === 1 ? '' : 's'}</strong>
          </div>
          <div style={{ minWidth: 170 }}>
            <div className="ts-label">Reason for stock change</div>
            <select className="ts-select" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="purchase">Purchase (new stock)</option>
              <option value="adjustment">Adjustment</option>
              <option value="return">Return</option>
              <option value="damage">Damage</option>
              <option value="stocktake">Stocktake</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="ts-label">Note</div>
            <input className="ts-input" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — appears in the stock ledger" />
          </div>
          <Button onClick={() => void save()} loading={busy}><Save size={15} /> Save changes</Button>
          <Button variant="ghost" onClick={() => setDrafts({})}><Undo2 size={15} /> Discard</Button>
        </div>
      ) : null}

      {isLoading ? <Skeleton h={340} /> : !data?.data.length ? (
        <EmptyState icon={<Package size={48} />} title="No products match" />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }} />
                  <th>Product</th>
                  <th>SKU</th>
                  <th style={{ width: 92 }}>On hand</th>
                  <th style={{ width: 70 }}>Res.</th>
                  <th style={{ width: 70 }}>Avail.</th>
                  <th style={{ width: 100 }}>Price</th>
                  <th style={{ width: 100 }}>Cost</th>
                  <th style={{ width: 74 }}>Margin</th>
                  <th style={{ width: 80 }}>Low at</th>
                  <th style={{ width: 90 }}>Reorder</th>
                  <th style={{ width: 90 }}>Bin</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((v: any) => {
                  const price = drafts[v.variantId]?.priceAmount ?? v.price.amount;
                  const cost = drafts[v.variantId]?.costAmount ?? v.unitCost;
                  const margin = cost && price ? Math.round(((price - cost) / price) * 100) : null;
                  return (
                    <tr key={v.variantId}>
                      <td>
                        <img src={v.image?.sm ?? ''} alt="" width={32} height={32}
                          style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{v.productName}</div>
                        {v.attributes?.length ? (
                          <div className="ts-muted" style={{ fontSize: 11 }}>
                            {v.attributes.map((a: any) => a.value).join(' · ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="ts-mono" style={{ fontSize: 11 }}>{v.sku}</td>
                      <td>{cell(v, 'stockQuantity', v.onHand, 72)}</td>
                      <td className="ts-muted">{v.reserved}</td>
                      <td style={{ fontWeight: 700, color: v.available === 0 ? 'var(--ts-danger)' : v.isLow ? 'var(--ts-warning)' : undefined }}>
                        {v.available}
                      </td>
                      <td>{cell(v, 'priceAmount', v.price.amount, 92)}</td>
                      <td>{cell(v, 'costAmount', v.unitCost ?? null, 92)}</td>
                      <td style={{
                        fontWeight: 600,
                        color: margin == null ? 'var(--ts-text-muted)'
                          : margin < 15 ? 'var(--ts-danger)' : margin < 30 ? 'var(--ts-warning)' : 'var(--ts-success)',
                      }}>
                        {margin == null ? '—' : `${margin}%`}
                      </td>
                      <td>{cell(v, 'lowStockThreshold', v.threshold, 64)}</td>
                      <td>{cell(v, 'reorderPoint', v.reorderPoint ?? null, 74)}</td>
                      <td>{cell(v, 'binLocation', v.binLocation ?? null, 78)}</td>
                    </tr>
                  );
                })}
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

// ═══════════════════════════════════════════════════ REPLENISHMENT ══

export function AdminReplenishment() {
  const [windowDays, setWindowDays] = useState(60);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'replenishment', windowDays],
    queryFn: () => api.raw<{ data: any[]; meta: any }>(
      `/admin/inventory/replenishment?onlyNeeded=true&windowDays=${windowDays}`),
  });

  const rows = data?.data ?? [];
  const chosen = Object.entries(selected).filter(([, q]) => q > 0);
  const chosenValue = chosen.reduce((n, [id, q]) => {
    const r = rows.find((x) => x.variantId === Number(id));
    return n + q * (r?.unitCost ?? 0);
  }, 0);

  const tone = (u: string) =>
    u === 'out_of_stock' ? 'danger' : u === 'critical' ? 'danger' : u === 'low' ? 'warning' : 'neutral';

  return (
    <>
      <PageHeader
        title="What to reorder"
        description="Ranked by how soon you run out, using real sales velocity — not a fixed threshold."
        actions={
          <Select label="" value={String(windowDays)} onChange={(e) => setWindowDays(Number(e.target.value))}>
            <option value="30">Velocity over 30 days</option>
            <option value="60">Velocity over 60 days</option>
            <option value="90">Velocity over 90 days</option>
          </Select>
        }
      />

      {data ? (
        <div className="row g-3 mb-4">
          {[
            ['Lines needing attention', data.meta.rowCount, undefined],
            ['Out of stock', data.meta.outOfStock, 'var(--ts-danger)'],
            ['Critical', data.meta.critical, 'var(--ts-danger)'],
            ['Suggested spend', data.meta.totalOrderValue.formatted, undefined],
          ].map(([label, value, colour]) => (
            <div className="col-6 col-lg-3" key={label as string}>
              <div className="ts-stat">
                <div className="ts-stat__label">{label}</div>
                <div className="ts-stat__value" style={{ color: colour as string }}>{value as string}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {chosen.length > 0 ? (
        <div className="ts-panel d-flex align-items-center gap-3 mb-3" style={{ position: 'sticky', top: 64, zIndex: 20 }}>
          <strong>{chosen.length} line{chosen.length === 1 ? '' : 's'} selected — {tzs(chosenValue)}</strong>
          <Button onClick={() => {
            sessionStorage.setItem('po-draft', JSON.stringify(
              chosen.map(([id, q]) => {
                const r = rows.find((x) => x.variantId === Number(id));
                return { productVariantId: Number(id), quantityOrdered: q, unitCostAmount: r?.unitCost ?? 0 };
              }),
            ));
            navigate('/admin/purchase-orders/new');
          }}>
            <Truck size={15} /> Create purchase order
          </Button>
          <Button variant="ghost" onClick={() => setSelected({})}>Clear</Button>
        </div>
      ) : null}

      {isLoading ? <Skeleton h={320} /> : !rows.length ? (
        <EmptyState icon={<PackageCheck size={48} />} title="Nothing needs reordering"
          description="Every active product is above its reorder point." />
      ) : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead>
              <tr>
                <th style={{ width: 40 }} /><th>Product</th><th>Supplier</th>
                <th>Available</th><th>Sold</th><th>Per day</th><th>Cover</th>
                <th>Reorder at</th><th>Suggested</th><th>Value</th><th style={{ width: 96 }}>Order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <td>
                    <img src={r.image ?? ''} alt="" width={30} height={30}
                      style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.productName}</div>
                    <div className="d-flex gap-1 align-items-center">
                      <span className="ts-mono ts-muted" style={{ fontSize: 11 }}>{r.sku}</span>
                      <Badge tone={tone(r.urgency) as never}>{r.urgency.replace(/_/g, ' ')}</Badge>
                    </div>
                  </td>
                  <td className="ts-muted" style={{ fontSize: 12.5 }}>{r.supplierName ?? '—'}</td>
                  <td style={{ fontWeight: 700, color: r.available === 0 ? 'var(--ts-danger)' : undefined }}>
                    {r.available}
                  </td>
                  <td>{r.unitsSold}</td>
                  <td className="ts-muted">{r.dailyVelocity.toFixed(2)}</td>
                  <td style={{ color: r.daysOfCover != null && r.daysOfCover < 14 ? 'var(--ts-danger)' : undefined }}>
                    {r.daysOfCover != null ? `${r.daysOfCover}d` : <span className="ts-muted">no sales</span>}
                  </td>
                  <td className="ts-muted">{r.reorderPoint}</td>
                  <td style={{ fontWeight: 600 }}>{r.suggestedOrder}</td>
                  <td>{r.orderValueFormatted}</td>
                  <td>
                    <input
                      className="ts-input"
                      style={{ minHeight: 30, width: 76, padding: '4px 8px', fontSize: 13 }}
                      inputMode="numeric"
                      placeholder={String(r.suggestedOrder)}
                      value={selected[r.variantId] ?? ''}
                      onChange={(e) =>
                        setSelected((s) => ({ ...s, [r.variantId]: Number(e.target.value.replace(/\D/g, '')) || 0 }))
                      }
                      onFocus={(e) => {
                        if (!selected[r.variantId]) {
                          setSelected((s) => ({ ...s, [r.variantId]: r.suggestedOrder }));
                        }
                        e.currentTarget.select();
                      }}
                    />
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

// ═════════════════════════════════════════════════════ SUPPLIERS ══

export function AdminSuppliers() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: '', contactName: '', email: '', phone: '', address: '',
    leadTimeDays: '7', notes: '', isActive: true,
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['admin', 'suppliers'],
    queryFn: () => api.get<any[]>('/admin/suppliers'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setForm({
      name: row?.name ?? '', contactName: row?.contactName ?? '',
      email: row?.email ?? '', phone: row?.phone ?? '', address: row?.address ?? '',
      leadTimeDays: String(row?.leadTimeDays ?? 7), notes: row?.notes ?? '',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = { ...form, leadTimeDays: Number(form.leadTimeDays || 7) };
      if (editing) await api.patch(`/admin/suppliers/${editing.id}`, payload);
      else await api.post('/admin/suppliers', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
      toast({ tone: 'success', title: editing ? 'Supplier updated' : 'Supplier created' });
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
        title="Suppliers"
        description="Who you buy from, and how long they take — lead time drives the reorder suggestions."
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New supplier</Button>}
      />

      {isLoading ? <Skeleton h={220} /> : !data.length ? (
        <EmptyState icon={<Truck size={48} />} title="No suppliers yet"
          description="Add a supplier to raise purchase orders and track lead times."
          action={<Button onClick={() => openForm()}>Add a supplier</Button>} />
      ) : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead>
              <tr><th>Name</th><th>Contact</th><th>Phone</th><th>Lead time</th><th>Products</th><th>POs</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}
                    {s.notes ? <div className="ts-muted ts-clamp-2" style={{ fontSize: 12 }}>{s.notes}</div> : null}
                  </td>
                  <td>{s.contactName ?? '—'}<div className="ts-muted" style={{ fontSize: 12 }}>{s.email ?? ''}</div></td>
                  <td className="ts-mono">{s.phone ?? '—'}</td>
                  <td>{s.leadTimeDays} days</td>
                  <td>{s.productCount}</td>
                  <td>{s.purchaseOrderCount}</td>
                  <td><Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'active' : 'inactive'}</Badge></td>
                  <td>
                    <div className="d-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openForm(s)}>Edit</Button>
                      <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(s)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit supplier' : 'New supplier'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save</Button>
        </>}>
        <TextInput label="Supplier name" value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="row">
          <div className="col-12 col-md-6">
            <TextInput label="Contact person" value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Lead time (days)" value={form.leadTimeDays} inputMode="numeric"
              onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value.replace(/\D/g, '') })}
              hint="How long from order to delivery. Drives reorder timing." />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Email" type="email" value={form.email} error={errors.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="col-12 col-md-6">
            <TextInput label="Phone" value={form.phone} error={errors.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="255XXXXXXXXX" />
          </div>
        </div>
        <TextArea label="Address" value={form.address} rows={2}
          onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <TextArea label="Notes" value={form.notes} rows={2}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          hint="Payment terms, minimum order, anything worth remembering." />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog open={Boolean(confirm)} title="Delete this supplier?"
        message={<>Delete <strong>{confirm?.name}</strong>? Products keep their history; only the link is removed.</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/suppliers/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
            toast({ tone: 'success', title: 'Supplier deleted' });
          } catch (e) {
            toast({ tone: 'danger', title: 'Could not delete', text: (e as Error).message });
          } finally { setBusy(false); setConfirm(null); }
        }}
        onCancel={() => setConfirm(null)} busy={busy} />
    </>
  );
}

// ════════════════════════════════════════════════ PURCHASE ORDERS ══

export function AdminPurchaseOrders() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const status = sp.get('status') ?? 'all';

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'purchase-orders', page, status],
    queryFn: () => api.raw<Paged<any>>(`/admin/purchase-orders${qs({ page, pageSize: 25, status })}`),
  });

  const tone = (s: string) =>
    s === 'received' ? 'success' : s === 'partial' ? 'warning'
      : s === 'cancelled' ? 'danger' : s === 'ordered' ? 'info' : 'neutral';

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="What you have on order, and what has arrived."
        actions={<Link to="/admin/purchase-orders/new" className="ts-btn ts-btn--primary">
          <Plus size={15} /> New purchase order
        </Link>}
      />

      <div className="d-flex gap-1 flex-wrap mb-3">
        {['all', 'draft', 'ordered', 'partial', 'received', 'cancelled'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'ghost'}
            onClick={() => { const n = new URLSearchParams(sp); n.set('status', s); n.delete('page'); setSp(n); }}>
            {s}
          </Button>
        ))}
      </div>

      {isLoading ? <Skeleton h={260} /> : !data?.data.length ? (
        <EmptyState icon={<Truck size={48} />} title="No purchase orders"
          description="Raise one from the reorder report, or start from scratch." />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr><th>Reference</th><th>Supplier</th><th>Lines</th><th>Progress</th><th>Total</th><th>Expected</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/admin/purchase-orders/${p.id}`} className="ts-mono">{p.reference}</Link></td>
                    <td>{p.supplier}</td>
                    <td>{p.lineCount}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div style={{ width: 70, height: 6, background: 'var(--ts-surface-sunken)', borderRadius: 4 }}>
                          <div style={{
                            width: `${p.progress}%`, height: '100%', borderRadius: 4,
                            background: p.progress === 100 ? 'var(--ts-success)' : 'var(--ts-warning)',
                          }} />
                        </div>
                        <span className="ts-muted" style={{ fontSize: 12 }}>
                          {p.unitsReceived}/{p.unitsOrdered}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.total.formatted}</td>
                    <td className="ts-muted">{p.expectedAt ? new Date(p.expectedAt).toLocaleDateString() : '—'}</td>
                    <td><Badge tone={tone(p.status) as never}>{p.status}</Badge></td>
                    <td><Link to={`/admin/purchase-orders/${p.id}`} className="ts-btn ts-btn--ghost ts-btn--sm">Open</Link></td>
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

export function AdminPurchaseOrderForm() {
  const navigate = useNavigate();
  const toast = useUi((s) => s.toast);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [shipping, setShipping] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ productVariantId: number; quantityOrdered: number; unitCostAmount: number }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['admin', 'suppliers'],
    queryFn: () => api.get<any[]>('/admin/suppliers'),
  });
  const { data: stock } = useQuery({
    queryKey: ['admin', 'stock-picker', search],
    queryFn: () => api.raw<Paged<any>>(`/admin/stock${qs({ q: search, pageSize: 40 })}`),
    enabled: pickerOpen,
  });

  // Lines handed over from the reorder report.
  useEffect(() => {
    const draft = sessionStorage.getItem('po-draft');
    if (draft) {
      setLines(JSON.parse(draft));
      sessionStorage.removeItem('po-draft');
    }
  }, []);

  const { data: lineDetails = [] } = useQuery({
    queryKey: ['admin', 'po-line-details', lines.map((l) => l.productVariantId).join(',')],
    queryFn: async () => {
      if (!lines.length) return [];
      const res = await api.raw<Paged<any>>('/admin/stock?pageSize=500');
      return res.data.filter((v: any) => lines.some((l) => l.productVariantId === v.variantId));
    },
    enabled: lines.length > 0,
  });

  const subtotal = lines.reduce((n, l) => n + l.quantityOrdered * l.unitCostAmount, 0);
  const total = subtotal + Number(shipping || 0);

  const save = async () => {
    if (!supplierId) { toast({ tone: 'danger', title: 'Choose a supplier' }); return; }
    if (!lines.length) { toast({ tone: 'danger', title: 'Add at least one line' }); return; }
    setBusy(true);
    try {
      const res = await api.post<{ id: number; reference: string }>('/admin/purchase-orders', {
        supplierId: Number(supplierId),
        expectedAt: expectedAt || null,
        shippingAmount: Number(shipping || 0),
        notes: notes || undefined,
        items: lines,
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'purchase-orders'] });
      toast({ tone: 'success', title: `${res.reference} created` });
      navigate(`/admin/purchase-orders/${res.id}`);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not create', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New purchase order"
        actions={<>
          <Button variant="ghost" onClick={() => navigate('/admin/purchase-orders')}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Create</Button>
        </>}
      />

      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div className="ts-card p-4 mb-3">
            <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Select one</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.leadTimeDays} day lead time</option>
              ))}
            </Select>
            <div className="row">
              <div className="col-12 col-md-6">
                <TextInput label="Expected delivery" type="date" value={expectedAt}
                  onChange={(e) => setExpectedAt(e.target.value)} />
              </div>
              <div className="col-12 col-md-6">
                <TextInput label="Freight / shipping (TZS)" value={shipping} inputMode="numeric"
                  onChange={(e) => setShipping(e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>
            <TextArea label="Notes" value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="ts-card p-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h2 style={{ fontSize: 15, margin: 0 }}>Lines</h2>
              <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
                <Plus size={14} /> Add product
              </Button>
            </div>

            {!lines.length ? (
              <p className="ts-muted">No lines yet. Add products, or start from the reorder report.</p>
            ) : (
              <div className="ts-table__wrap" style={{ border: 0 }}>
                <table className="ts-table">
                  <thead><tr><th>Product</th><th style={{ width: 110 }}>Unit cost</th><th style={{ width: 90 }}>Qty</th><th>Line total</th><th style={{ width: 44 }} /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const d = lineDetails.find((x: any) => x.variantId === l.productVariantId);
                      return (
                        <tr key={l.productVariantId}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{d?.productName ?? `Variant ${l.productVariantId}`}</div>
                            <span className="ts-mono ts-muted" style={{ fontSize: 11 }}>{d?.sku}</span>
                          </td>
                          <td>
                            <input className="ts-input" style={{ minHeight: 30, padding: '4px 8px', fontSize: 13 }}
                              inputMode="numeric" value={l.unitCostAmount}
                              onChange={(e) => setLines((ls) => ls.map((x, j) =>
                                j === i ? { ...x, unitCostAmount: Number(e.target.value.replace(/\D/g, '')) || 0 } : x))} />
                          </td>
                          <td>
                            <input className="ts-input" style={{ minHeight: 30, padding: '4px 8px', fontSize: 13 }}
                              inputMode="numeric" value={l.quantityOrdered}
                              onChange={(e) => setLines((ls) => ls.map((x, j) =>
                                j === i ? { ...x, quantityOrdered: Number(e.target.value.replace(/\D/g, '')) || 0 } : x))} />
                          </td>
                          <td style={{ fontWeight: 600 }}>{tzs(l.quantityOrdered * l.unitCostAmount)}</td>
                          <td>
                            <button className="ts-iconbtn" aria-label="Remove line"
                              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-panel" style={{ position: 'sticky', top: 80 }}>
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Totals</h2>
            <div className="d-flex justify-content-between"><span>Lines</span><strong>{lines.length}</strong></div>
            <div className="d-flex justify-content-between"><span>Units</span>
              <strong>{lines.reduce((n, l) => n + l.quantityOrdered, 0)}</strong></div>
            <div className="d-flex justify-content-between"><span>Subtotal</span><strong>{tzs(subtotal)}</strong></div>
            <div className="d-flex justify-content-between"><span>Freight</span><strong>{tzs(Number(shipping || 0))}</strong></div>
            <hr />
            <div className="d-flex justify-content-between" style={{ fontSize: 18, fontWeight: 700 }}>
              <span>Total</span><span>{tzs(total)}</span>
            </div>
          </div>
        </div>
      </div>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add products" size="lg">
        <input className="ts-input mb-3" placeholder="Search SKU or product name"
          value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="ts-table">
            <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Cost</th><th /></tr></thead>
            <tbody>
              {(stock?.data ?? []).map((v: any) => {
                const already = lines.some((l) => l.productVariantId === v.variantId);
                return (
                  <tr key={v.variantId}>
                    <td style={{ fontSize: 13 }}>{v.productName}</td>
                    <td className="ts-mono" style={{ fontSize: 11 }}>{v.sku}</td>
                    <td>{v.onHand}</td>
                    <td>{v.unitCost != null ? tzs(v.unitCost) : '—'}</td>
                    <td>
                      <Button size="sm" variant={already ? 'ghost' : 'secondary'} disabled={already}
                        onClick={() => setLines((ls) => [...ls, {
                          productVariantId: v.variantId,
                          quantityOrdered: 10,
                          unitCostAmount: v.unitCost ?? 0,
                        }])}>
                        {already ? 'Added' : 'Add'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}

export function AdminPurchaseOrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [receive, setReceive] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: po, isLoading } = useQuery({
    queryKey: ['admin', 'purchase-order', id],
    queryFn: () => api.get(`/admin/purchase-orders/${id}`),
  });

  if (isLoading || !po) return <Skeleton h={340} />;

  const canReceive = ['ordered', 'partial'].includes(po.status);
  const receiving = Object.values(receive).reduce((n, q) => n + q, 0);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['admin', 'purchase-order', id] });
      await qc.invalidateQueries({ queryKey: ['admin', 'purchase-orders'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stock-editor'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'replenishment'] });
      toast({ tone: 'success', title: success });
      setReceive({});
    } catch (e) {
      toast({ tone: 'danger', title: 'Action failed', text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  return (
    <>
      <PageHeader
        title={po.reference}
        description={`${po.supplier.name} · ${po.supplier.leadTimeDays} day lead time`}
        actions={
          <>
            {po.status === 'draft' ? (
              <Button onClick={() => void act(
                () => api.patch(`/admin/purchase-orders/${id}/status`, { status: 'ordered' }),
                'Marked as ordered')} loading={busy}>
                Mark as ordered
              </Button>
            ) : null}
            {['draft', 'ordered'].includes(po.status) ? (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel order</Button>
            ) : null}
          </>
        }
      />

      <div className="d-flex gap-2 mb-4">
        <Badge tone={po.status === 'received' ? 'success' : po.status === 'partial' ? 'warning' : 'info'}>
          {po.status}
        </Badge>
        {po.expectedAt ? <Badge>expected {new Date(po.expectedAt).toLocaleDateString()}</Badge> : null}
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div className="ts-card p-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h2 style={{ fontSize: 15, margin: 0 }}>Lines</h2>
              {canReceive ? (
                <Button size="sm" disabled={receiving === 0} loading={busy}
                  onClick={() => void act(
                    () => api.post(`/admin/purchase-orders/${id}/receive`, {
                      lines: Object.entries(receive)
                        .filter(([, q]) => q > 0)
                        .map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity })),
                    }),
                    `Received ${receiving} unit${receiving === 1 ? '' : 's'}`)}>
                  <ArrowDownToLine size={14} /> Receive {receiving > 0 ? receiving : ''}
                </Button>
              ) : null}
            </div>

            <div className="ts-table__wrap" style={{ border: 0 }}>
              <table className="ts-table">
                <thead>
                  <tr><th>Product</th><th>Unit cost</th><th>Ordered</th><th>Received</th><th>Outstanding</th>
                    {canReceive ? <th style={{ width: 110 }}>Receive now</th> : null}</tr>
                </thead>
                <tbody>
                  {po.items.map((i: any) => (
                    <tr key={i.id}>
                      <td>
                        <div className="d-flex gap-2 align-items-center">
                          <img src={i.image ?? ''} alt="" width={30} height={30}
                            style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{i.description}</div>
                            <span className="ts-mono ts-muted" style={{ fontSize: 11 }}>{i.sku}</span>
                          </div>
                        </div>
                      </td>
                      <td>{i.unitCost.formatted}</td>
                      <td>{i.quantityOrdered}</td>
                      <td style={{ fontWeight: 600 }}>{i.quantityReceived}</td>
                      <td style={{ color: i.outstanding > 0 ? 'var(--ts-warning)' : 'var(--ts-success)', fontWeight: 600 }}>
                        {i.outstanding}
                      </td>
                      {canReceive ? (
                        <td>
                          <input className="ts-input" style={{ minHeight: 30, width: 90, padding: '4px 8px', fontSize: 13 }}
                            inputMode="numeric" disabled={i.outstanding <= 0}
                            placeholder={String(i.outstanding)}
                            value={receive[i.id] ?? ''}
                            onFocus={(e) => {
                              if (!receive[i.id] && i.outstanding > 0) {
                                setReceive((r) => ({ ...r, [i.id]: i.outstanding }));
                              }
                              e.currentTarget.select();
                            }}
                            onChange={(e) => setReceive((r) => ({
                              ...r,
                              [i.id]: Math.min(i.outstanding, Number(e.target.value.replace(/\D/g, '')) || 0),
                            }))} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canReceive ? (
              <p className="ts-muted mt-3" style={{ fontSize: 12.5 }}>
                Receiving raises stock, updates the weighted average cost, and writes a ledger entry.
                Partial receipts are fine — receive again when the rest arrives.
              </p>
            ) : null}
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-panel mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Totals</h2>
            <div className="d-flex justify-content-between"><span>Subtotal</span><span>{po.totals.subtotal.formatted}</span></div>
            <div className="d-flex justify-content-between"><span>Freight</span><span>{po.totals.shipping.formatted}</span></div>
            <hr />
            <div className="d-flex justify-content-between" style={{ fontWeight: 700, fontSize: 17 }}>
              <span>Total</span><span>{po.totals.total.formatted}</span>
            </div>
          </div>

          <div className="ts-card p-4" style={{ fontSize: 13.5 }}>
            <h2 style={{ fontSize: 15, marginBottom: 10 }}>Supplier</h2>
            <div style={{ fontWeight: 600 }}>{po.supplier.name}</div>
            {po.supplier.contactName ? <div>{po.supplier.contactName}</div> : null}
            {po.supplier.email ? <div className="ts-muted">{po.supplier.email}</div> : null}
            {po.supplier.phone ? <div className="ts-mono ts-muted">{po.supplier.phone}</div> : null}
            {po.notes ? <><hr /><div className="ts-muted">{po.notes}</div></> : null}
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirmCancel} title="Cancel this purchase order?"
        message={<>Cancel <strong>{po.reference}</strong>? No stock has been received, so nothing on the shelf changes.</>}
        confirmLabel="Cancel order"
        onConfirm={() => void act(
          () => api.patch(`/admin/purchase-orders/${id}/status`, { status: 'cancelled' }),
          'Purchase order cancelled')}
        onCancel={() => setConfirmCancel(false)} busy={busy} />
    </>
  );
}

// ══════════════════════════════════════════════════════ STOCKTAKES ══

export function AdminStockTakes() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('all');
  const [scopeId, setScopeId] = useState('');
  const [notes, setNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock-takes'],
    queryFn: () => api.raw<Paged<any>>('/admin/stock-takes?pageSize=25'),
  });
  const { data: categories } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api.raw<Paged<any>>('/admin/categories?pageSize=100'),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['admin', 'suppliers'],
    queryFn: () => api.get<any[]>('/admin/suppliers'),
  });

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ id: number; reference: string; lineCount: number }>(
        '/admin/stock-takes',
        { scope, scopeId: scopeId ? Number(scopeId) : null, notes: notes || undefined },
      );
      await qc.invalidateQueries({ queryKey: ['admin', 'stock-takes'] });
      toast({ tone: 'success', title: `${res.reference} created`, text: `${res.lineCount} lines to count.` });
      setOpen(false);
      navigate(`/admin/stock-takes/${res.id}`);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not create', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Stocktakes"
        description="Count what is physically there, see the variance, post the correction in one step."
        actions={<Button onClick={() => setOpen(true)}><Plus size={15} /> New stocktake</Button>}
      />

      {isLoading ? <Skeleton h={220} /> : !data?.data.length ? (
        <EmptyState icon={<ClipboardCheck size={48} />} title="No stocktakes yet"
          description="Start one to reconcile the system against the shelf."
          action={<Button onClick={() => setOpen(true)}>Start a stocktake</Button>} />
      ) : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead>
              <tr><th>Reference</th><th>Scope</th><th>Lines</th><th>Variances</th><th>Value</th><th>Status</th><th>By</th><th /></tr>
            </thead>
            <tbody>
              {data.data.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/admin/stock-takes/${s.id}`} className="ts-mono">{s.reference}</Link></td>
                  <td>{s.scope}</td>
                  <td>{s.lineCount}</td>
                  <td>{s.status === 'posted' ? s.varianceLines : '—'}</td>
                  <td style={{ color: s.varianceValue.amount < 0 ? 'var(--ts-danger)' : undefined, fontWeight: 600 }}>
                    {s.status === 'posted' ? s.varianceValue.formatted : '—'}
                  </td>
                  <td><Badge tone={s.status === 'posted' ? 'success' : 'warning'}>{s.status}</Badge></td>
                  <td className="ts-muted">{s.postedBy ?? s.createdBy ?? '—'}</td>
                  <td><Link to={`/admin/stock-takes/${s.id}`} className="ts-btn ts-btn--ghost ts-btn--sm">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New stocktake"
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void create()} loading={busy}>Create count sheet</Button>
        </>}>
        <Select label="What to count" value={scope}
          onChange={(e) => { setScope(e.target.value); setScopeId(''); }}>
          <option value="all">Everything</option>
          <option value="category">One category</option>
          <option value="supplier">One supplier's products</option>
          <option value="low_stock">Low stock lines only</option>
        </Select>
        {scope === 'category' ? (
          <Select label="Category" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
            <option value="">Select one</option>
            {categories?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
        {scope === 'supplier' ? (
          <Select label="Supplier" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
            <option value="">Select one</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        ) : null}
        <TextArea label="Notes" value={notes} rows={2} onChange={(e) => setNotes(e.target.value)}
          hint="Who is counting, and why." />
      </Modal>
    </>
  );
}

export function AdminStockTakeDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);

  const { data: take, isLoading } = useQuery({
    queryKey: ['admin', 'stock-take', id],
    queryFn: () => api.get(`/admin/stock-takes/${id}`),
  });

  if (isLoading || !take) return <Skeleton h={340} />;

  const posted = take.status === 'posted';
  const rows = take.items.map((i: any) => {
    const typed = counts[i.id];
    const counted = typed !== undefined && typed !== '' ? Number(typed)
      : i.countedQuantity != null ? i.countedQuantity : null;
    return { ...i, counted, variance: counted == null ? null : counted - i.expectedQuantity };
  });
  const countedRows = rows.filter((r: any) => r.counted != null);
  const varianceRows = countedRows.filter((r: any) => r.variance !== 0);
  const varianceValue = varianceRows.reduce(
    (n: number, r: any) => n + r.variance * (r.unitCost ?? 0), 0);

  const saveCounts = async () => {
    setBusy(true);
    try {
      const payload = Object.entries(counts)
        .filter(([, v]) => v !== '')
        .map(([itemId, v]) => ({ itemId: Number(itemId), countedQuantity: Number(v) }));
      if (!payload.length) { toast({ tone: 'warning', title: 'Nothing to save' }); return; }
      await api.patch(`/admin/stock-takes/${id}/counts`, { counts: payload });
      await qc.invalidateQueries({ queryKey: ['admin', 'stock-take', id] });
      setCounts({});
      toast({ tone: 'success', title: `${payload.length} count${payload.length === 1 ? '' : 's'} saved` });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not save', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ varianceLines: number; varianceValueFormatted: string }>(
        `/admin/stock-takes/${id}/post`);
      await qc.invalidateQueries({ queryKey: ['admin', 'stock-take', id] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stock-editor'] });
      toast({
        tone: 'success',
        title: 'Stocktake posted',
        text: `${res.varianceLines} correction${res.varianceLines === 1 ? '' : 's'}, ${res.varianceValueFormatted}.`,
      });
      setConfirmPost(false);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not post', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={take.reference}
        description={posted
          ? `Posted — ${take.varianceLines} correction(s), ${take.varianceValue.formatted}`
          : `${countedRows.length} of ${rows.length} lines counted`}
        actions={posted ? null : (
          <>
            <Button variant="secondary" onClick={() => void saveCounts()}
              disabled={Object.keys(counts).length === 0} loading={busy}>
              <Save size={15} /> Save counts
            </Button>
            <Button onClick={() => setConfirmPost(true)} disabled={countedRows.length === 0}>
              <ClipboardCheck size={15} /> Post stocktake
            </Button>
          </>
        )}
      />

      {!posted ? (
        <div className="row g-3 mb-3">
          {[
            ['Lines', rows.length],
            ['Counted', countedRows.length],
            ['Variances', varianceRows.length],
            ['Variance value', tzs(varianceValue)],
          ].map(([l, v]) => (
            <div className="col-6 col-lg-3" key={l as string}>
              <div className="ts-stat">
                <div className="ts-stat__label">{l}</div>
                <div className="ts-stat__value" style={{
                  color: l === 'Variance value' && varianceValue < 0 ? 'var(--ts-danger)' : undefined,
                }}>{v as string}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="ts-table__wrap">
        <table className="ts-table">
          <thead>
            <tr><th /><th>Product</th><th>SKU</th><th>System</th><th style={{ width: 110 }}>Counted</th><th>Variance</th><th>Value</th></tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <img src={r.image ?? ''} alt="" width={30} height={30}
                    style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                </td>
                <td style={{ fontSize: 13, fontWeight: 600 }}>{r.description}</td>
                <td className="ts-mono" style={{ fontSize: 11 }}>{r.sku}</td>
                <td>{r.expectedQuantity}</td>
                <td>
                  {posted ? (r.countedQuantity ?? '—') : (
                    <input className="ts-input" style={{ minHeight: 30, width: 90, padding: '4px 8px', fontSize: 13 }}
                      inputMode="numeric"
                      placeholder="—"
                      value={counts[r.id] ?? (r.countedQuantity ?? '')}
                      onChange={(e) => setCounts((c) => ({ ...c, [r.id]: e.target.value.replace(/\D/g, '') }))} />
                  )}
                </td>
                <td style={{
                  fontWeight: 700,
                  color: r.variance == null ? 'var(--ts-text-muted)'
                    : r.variance === 0 ? 'var(--ts-success)'
                      : r.variance < 0 ? 'var(--ts-danger)' : 'var(--ts-warning)',
                }}>
                  {r.variance == null ? '—' : r.variance > 0 ? `+${r.variance}` : r.variance}
                </td>
                <td className="ts-muted">
                  {r.variance ? tzs(r.variance * (r.unitCost ?? 0)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmPost}
        title="Post this stocktake?"
        message={
          <>
            <p>
              <strong>{varianceRows.length}</strong> line{varianceRows.length === 1 ? '' : 's'} will be
              corrected, a net change of <strong>{tzs(varianceValue)}</strong>.
            </p>
            <p className="ts-muted">
              Each correction becomes a stock movement you can audit. Lines you did not count are
              left untouched. This cannot be undone.
            </p>
          </>
        }
        confirmLabel="Post stocktake"
        onConfirm={() => void post()}
        onCancel={() => setConfirmPost(false)}
        busy={busy}
      />
    </>
  );
}
