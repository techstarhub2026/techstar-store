import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Package, Plus, SquarePen, Trash2, X } from 'lucide-react';
import { ApiError, api, qs } from '../lib/api';
import type { MediaDto, Paged } from '../lib/types';
import { PageHeader } from './AdminLayout';
import { ImageUploader, SpecSheetUploader, type SpecSheetValue } from './ImageUploader';
import { PrintButton, PrintHeader } from './PrintButton';
import { RichEditor } from './RichEditor';
import {
  Badge, Button, ConfirmDialog, EmptyState, Pagination, Select, Skeleton, TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

// ══════════════════════════════════════════════════════════ list ══

export function AdminProducts() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const page = Number(sp.get('page') ?? 1);
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? 'all';
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirm, setConfirm] = useState<null | { ids: number[]; label: string }>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', page, q, status],
    queryFn: () => api.raw<Paged<any>>(`/admin/products${qs({ page, pageSize: 25, q, status })}`),
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

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.ids.length === 1) await api.del(`/admin/products/${confirm.ids[0]}`);
      else await api.post('/admin/products/bulk-delete', { ids: confirm.ids });
      await qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      setSelected([]);
      setConfirm(null);
      toast({ tone: 'success', title: 'Product deleted' });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not delete', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rows = data?.data ?? [];

  return (
    <>
      <PrintHeader title="Product catalogue" />
      <PageHeader
        title="Products"
        description={data ? `${data.meta.total} products in the catalogue` : undefined}
        actions={
          <>
            <PrintButton label="Print list" />
            <Link to="/admin/products/new" className="ts-btn ts-btn--primary no-print">
              <Plus size={15} /> New product
            </Link>
          </>
        }
      />

      <div className="d-flex gap-2 flex-wrap mb-3">
        <input
          className="ts-input"
          style={{ maxWidth: 320 }}
          placeholder="Search name, SKU, brand or part number"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="ts-select"
          style={{ maxWidth: 180 }}
          value={status}
          onChange={(e) => {
            const next = new URLSearchParams(sp);
            next.set('status', e.target.value);
            next.delete('page');
            setSp(next);
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {selected.length > 0 ? (
        <div className="ts-panel d-flex align-items-center gap-3 mb-3 py-2">
          <strong>{selected.length} selected</strong>
          <Button size="sm" variant="danger"
            onClick={() => setConfirm({ ids: selected, label: `${selected.length}` })}>
            <Trash2 size={14} /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      ) : null}

      {isLoading ? (
        <Skeleton h={320} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Package size={48} />}
          title="No products yet"
          description="Add your first product to start building the catalogue."
          action={<Link to="/admin/products/new" className="ts-btn ts-btn--primary">Add your first product</Link>}
        />
      ) : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.length === rows.length && rows.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                    />
                  </th>
                  <th style={{ width: 56 }} />
                  <th>Name</th>
                  <th>Subcategory</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Variants</th>
                  <th>Status</th>
                  <th>Sold</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.name}`}
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))
                        }
                      />
                    </td>
                    <td>
                      <img src={p.image?.sm ?? ''} alt="" width={40} height={40}
                        style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="ts-mono ts-muted" style={{ fontSize: 11 }}>{p.sku}</div>
                    </td>
                    <td>{p.subcategory.name}</td>
                    <td>{p.price.formatted}{p.priceMax ? ` – ${p.priceMax.formatted}` : ''}</td>
                    <td style={{ color: p.totalStock === 0 ? 'var(--ts-danger)' : p.totalStock <= 5 ? 'var(--ts-warning)' : undefined, fontWeight: 600 }}>
                      {p.totalStock}
                    </td>
                    <td>{p.variantCount}</td>
                    <td>
                      <Badge tone={p.status === 'active' ? 'success' : p.status === 'draft' ? 'warning' : 'neutral'}>
                        {p.status}
                      </Badge>
                    </td>
                    <td>{p.orderCount}</td>
                    <td>
                      <div className="d-flex gap-1">
                        <Link to={`/admin/products/${p.id}/edit`} className="ts-iconbtn" aria-label="Edit">
                          <SquarePen size={15} />
                        </Link>
                        <button className="ts-iconbtn" aria-label="Delete"
                          onClick={() => setConfirm({ ids: [p.id], label: p.name })}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data!.meta.page}
            pageCount={data!.meta.pageCount}
            onChange={(p) => {
              const next = new URLSearchParams(sp);
              next.set('page', String(p));
              setSp(next);
            }}
          />
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm && confirm.ids.length > 1 ? 'Delete selected products?' : 'Delete this product?'}
        message={
          confirm && confirm.ids.length > 1
            ? `${confirm.ids.length} products will be archived and removed from the storefront. They will also be removed from any open carts.`
            : <>Delete <strong>{confirm?.label}</strong>? It will be archived and removed from the storefront and from any open carts.</>
        }
        confirmLabel="Delete"
        requireTyping={confirm && confirm.ids.length > 1 ? String(confirm.ids.length) : undefined}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  );
}

// ═════════════════════════════════════════════════ variant matrix ══

interface VariantRow {
  sku?: string;
  values: string[];
  price: string;
  stock: string;
  compareAt: string;
  lowStockThreshold: string;
}

function AttributeMatrix({
  attributes,
  setAttributes,
  rows,
  setRows,
  errors,
}: {
  attributes: { name: string; unit?: string }[];
  setAttributes: (a: { name: string; unit?: string }[]) => void;
  rows: VariantRow[];
  setRows: (r: VariantRow[]) => void;
  errors: Record<string, string>;
}) {
  const [newAttr, setNewAttr] = useState('');
  const [newUnit, setNewUnit] = useState('');

  const addAttribute = () => {
    if (!newAttr.trim()) return;
    setAttributes([...attributes, { name: newAttr.trim(), unit: newUnit.trim() || undefined }]);
    setRows(rows.map((r) => ({ ...r, values: [...r.values, ''] })));
    setNewAttr('');
    setNewUnit('');
  };

  const removeAttribute = (index: number) => {
    setAttributes(attributes.filter((_, i) => i !== index));
    setRows(rows.map((r) => ({ ...r, values: r.values.filter((_, i) => i !== index) })));
  };

  const addRow = () =>
    setRows([
      ...rows,
      { values: attributes.map(() => ''), price: '', stock: '0', compareAt: '', lowStockThreshold: '5' },
    ]);

  const updateRow = (i: number, patch: Partial<VariantRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const updateValue = (rowIndex: number, attrIndex: number, value: string) =>
    setRows(
      rows.map((r, i) =>
        i === rowIndex ? { ...r, values: r.values.map((v, j) => (j === attrIndex ? value : v)) } : r,
      ),
    );

  return (
    <div className="ts-card p-4 mb-4">
      <h2 style={{ fontSize: 15, marginBottom: 4 }}>Pricing &amp; stock</h2>
      <p className="ts-muted" style={{ fontSize: 13 }}>
        Add specifications to your product here. Skip this step if the product does not have any
        special specifications — one price and stock row is enough.
      </p>

      <div className="d-flex gap-2 flex-wrap align-items-end mb-3">
        <div style={{ minWidth: 180 }}>
          <div className="ts-label">Attribute name</div>
          <input className="ts-input" value={newAttr} placeholder="e.g. Resistance"
            onChange={(e) => setNewAttr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAttribute())} />
        </div>
        <div style={{ width: 110 }}>
          <div className="ts-label">Unit</div>
          <input className="ts-input" value={newUnit} placeholder="Ω" onChange={(e) => setNewUnit(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" onClick={addAttribute}>
          <Plus size={15} /> Add attribute
        </Button>
        {attributes.length > 0 ? (
          <Button type="button" variant="ghost" onClick={() => { setAttributes([]); setRows(rows.map((r) => ({ ...r, values: [] }))); }}>
            Delete table
          </Button>
        ) : null}
      </div>

      {errors.attributeNames ? <div className="ts-error mb-2">{errors.attributeNames}</div> : null}
      {errors.variants ? <div className="ts-error mb-2">{errors.variants}</div> : null}

      <div className="ts-table__wrap">
        <table className="ts-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>SKU</th>
              {attributes.map((a, i) => (
                <th key={a.name}>
                  {a.name}{a.unit ? ` (${a.unit})` : ''}
                  <button type="button" className="ts-iconbtn" style={{ width: 20, height: 20, color: '#fff' }}
                    aria-label={`Remove ${a.name}`} onClick={() => removeAttribute(i)}>
                    <X size={12} />
                  </button>
                </th>
              ))}
              <th style={{ width: 120 }}>Price (TZS)</th>
              <th style={{ width: 120 }}>Compare at</th>
              <th style={{ width: 100 }}>Stock</th>
              <th style={{ width: 90 }}>Low at</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="ts-mono ts-muted" style={{ fontSize: 11 }}>{r.sku ?? 'auto'}</td>
                {attributes.map((a, j) => (
                  <td key={a.name}>
                    <input className="ts-input" style={{ minHeight: 34 }} value={r.values[j] ?? ''}
                      onChange={(e) => updateValue(i, j, e.target.value)} placeholder="value" />
                  </td>
                ))}
                <td>
                  <input className="ts-input" style={{ minHeight: 34 }} inputMode="numeric" value={r.price}
                    onChange={(e) => updateRow(i, { price: e.target.value.replace(/\D/g, '') })} />
                </td>
                <td>
                  <input className="ts-input" style={{ minHeight: 34 }} inputMode="numeric" value={r.compareAt}
                    onChange={(e) => updateRow(i, { compareAt: e.target.value.replace(/\D/g, '') })} />
                </td>
                <td>
                  <input className="ts-input" style={{ minHeight: 34 }} inputMode="numeric" value={r.stock}
                    onChange={(e) => updateRow(i, { stock: e.target.value.replace(/\D/g, '') })} />
                </td>
                <td>
                  <input className="ts-input" style={{ minHeight: 34 }} inputMode="numeric" value={r.lowStockThreshold}
                    onChange={(e) => updateRow(i, { lowStockThreshold: e.target.value.replace(/\D/g, '') })} />
                </td>
                <td>
                  <button type="button" className="ts-iconbtn" aria-label="Remove row"
                    onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                    disabled={rows.length === 1}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={addRow}>
        <Plus size={14} /> Add new values
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ form ══

export function AdminProductForm({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [images, setImages] = useState<MediaDto[]>([]);
  const [specSheet, setSpecSheet] = useState<SpecSheetValue | null>(null);
  const [attributes, setAttributes] = useState<{ name: string; unit?: string }[]>([]);
  const [rows, setRows] = useState<VariantRow[]>([
    { values: [], price: '', stock: '0', compareAt: '', lowStockThreshold: '5' },
  ]);
  const [form, setForm] = useState({
    subcategoryId: '',
    name: '',
    shortDescription: '',
    descriptionHtml: '',
    brand: '',
    manufacturerPartNumber: '',
    status: 'draft',
    isFeatured: false,
    metaTitle: '',
    metaDescription: '',
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['admin', 'subcategories', 'all'],
    queryFn: () => api.raw<Paged<any>>('/admin/subcategories?pageSize=200').then((r) => r.data),
  });

  const { data: existing } = useQuery({
    queryKey: ['admin', 'product', id],
    queryFn: () => api.get(`/admin/products/${id}`),
    enabled: mode === 'edit' && Boolean(id),
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      subcategoryId: String(existing.subcategoryId),
      name: existing.name,
      shortDescription: existing.shortDescription ?? '',
      descriptionHtml: existing.descriptionHtml ?? '',
      brand: existing.brand ?? '',
      manufacturerPartNumber: existing.manufacturerPartNumber ?? '',
      status: existing.status,
      isFeatured: existing.isFeatured,
      metaTitle: existing.metaTitle ?? '',
      metaDescription: existing.metaDescription ?? '',
    });
    setImages(existing.images ?? []);
    setSpecSheet(existing.specSheet ?? null);
    setAttributes(existing.attributeNames ?? []);
    setRows(
      (existing.variants ?? []).map((v: any) => ({
        sku: v.sku,
        values: (existing.attributeNames ?? []).map(
          (a: any) => v.attributes.find((x: any) => x.name === a.name)?.value ?? '',
        ),
        price: String(v.price),
        compareAt: v.compareAt ? String(v.compareAt) : '',
        stock: String(v.stock),
        lowStockThreshold: String(v.lowStockThreshold),
      })),
    );
  }, [existing]);

  const skuPrefix = useMemo(() => {
    const sub = subcategories.find((s: any) => String(s.id) === form.subcategoryId);
    return sub ? `${sub.skuCode}xxx` : '—';
  }, [subcategories, form.subcategoryId]);

  const submit = async (e: React.FormEvent, statusOverride?: string) => {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    try {
      const payload = {
        subcategoryId: Number(form.subcategoryId),
        name: form.name,
        shortDescription: form.shortDescription || undefined,
        descriptionHtml: form.descriptionHtml,
        brand: form.brand || undefined,
        manufacturerPartNumber: form.manufacturerPartNumber || undefined,
        status: statusOverride ?? form.status,
        isFeatured: form.isFeatured,
        metaTitle: form.metaTitle || undefined,
        metaDescription: form.metaDescription || undefined,
        imageIds: images.map((i) => i.id),
        specSheetId: specSheet?.id ?? null,
        attributeNames: attributes,
        variants: rows.map((r, i) => ({
          sku: r.sku,
          attributes: attributes.map((a, j) => ({ name: a.name, value: r.values[j] ?? '' })),
          price: Number(r.price || 0),
          compareAt: r.compareAt ? Number(r.compareAt) : null,
          stock: Number(r.stock || 0),
          lowStockThreshold: Number(r.lowStockThreshold || 5),
          isActive: true,
        })),
      };

      if (mode === 'create') {
        await api.post('/admin/products', payload);
        toast({ tone: 'success', title: 'Product added successfully' });
      } else {
        await api.patch(`/admin/products/${id}`, payload);
        toast({ tone: 'success', title: 'Product edited successfully' });
      }
      await qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      navigate('/admin/products');
    } catch (err) {
      if (err instanceof ApiError) {
        const f: Record<string, string> = {};
        for (const d of err.details ?? []) {
          const key = d.field ?? '';
          f[key.split('.')[0]] = d.message;
          f[key] = d.message;
        }
        setErrors(f);
        toast({
          tone: 'danger',
          title: 'Please check the form',
          text: err.details?.[0]?.message ?? err.message,
        });
      } else {
        toast({ tone: 'danger', title: 'Could not save the product' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <PageHeader
        title={mode === 'create' ? 'Create your product' : 'Edit your product'}
        description={mode === 'edit' && existing ? `SKU ${existing.sku}` : `SKU will be ${skuPrefix}`}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/admin/products')}>Cancel</Button>
            {mode === 'create' ? (
              <Button type="button" variant="secondary" loading={busy}
                onClick={(e) => void submit(e as never, 'draft')}>Save as draft</Button>
            ) : null}
            <Button type="submit" loading={busy}>Save</Button>
          </>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <div className="ts-card p-4 mb-4">
            <h2 style={{ fontSize: 15, marginBottom: 16 }}>Details</h2>
            <Select label="Subcategory" value={form.subcategoryId} error={errors.subcategoryId}
              onChange={(e) => setForm({ ...form, subcategoryId: e.target.value })} required>
              <option value="">Select one</option>
              {subcategories.map((s: any) => (
                <option key={s.id} value={s.id}>{s.category.name} › {s.name} ({s.skuCode})</option>
              ))}
            </Select>
            <TextInput label="Product name" value={form.name} error={errors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Enter product name" required />
            <TextArea label="Short description" value={form.shortDescription} rows={2}
              onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
              hint={`${form.shortDescription.length}/500 — used for search-result snippets`} />
            <RichEditor label="Description" value={form.descriptionHtml}
              error={errors.descriptionHtml}
              onChange={(html) => setForm({ ...form, descriptionHtml: html })}
              placeholder="Describe the product — what it is, what it fits, what is in the box…"
              minHeight={260} required />
            <div className="row">
              <div className="col-12 col-md-6">
                <TextInput label="Brand" value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </div>
              <div className="col-12 col-md-6">
                <TextInput label="Manufacturer part number" value={form.manufacturerPartNumber}
                  onChange={(e) => setForm({ ...form, manufacturerPartNumber: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="ts-card p-4 mb-4">
            <ImageUploader value={images} onChange={setImages} max={20} />
            {errors.imageIds ? <div className="ts-error">{errors.imageIds}</div> : null}
            <SpecSheetUploader value={specSheet} onChange={setSpecSheet} />
          </div>

          <AttributeMatrix
            attributes={attributes}
            setAttributes={setAttributes}
            rows={rows}
            setRows={setRows}
            errors={errors}
          />
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-card p-4 mb-3">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Visibility</h2>
            <Select label="Status" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft — not visible in the store</option>
              <option value="active">Active — live in the store</option>
              <option value="archived">Archived</option>
            </Select>
            <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
              <input type="checkbox" checked={form.isFeatured}
                onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
              Featured product
            </label>
          </div>

          <div className="ts-card p-4">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Search engine listing</h2>
            <TextInput label="Meta title" value={form.metaTitle}
              onChange={(e) => setForm({ ...form, metaTitle: e.target.value })}
              hint={`${form.metaTitle.length}/70`} maxLength={70} />
            <TextArea label="Meta description" value={form.metaDescription} rows={3}
              onChange={(e) => setForm({ ...form, metaDescription: e.target.value })}
              hint={`${form.metaDescription.length}/160`} maxLength={160} />
            <div style={{ background: 'var(--ts-surface-alt)', padding: 10, borderRadius: 6 }}>
              <div style={{ color: '#1a0dab', fontSize: 15 }}>{form.metaTitle || form.name || 'Product name'}</div>
              <div style={{ color: '#006621', fontSize: 12 }}>techstar.co.tz › product</div>
              <div style={{ fontSize: 12.5 }} className="ts-muted ts-clamp-2">
                {form.metaDescription || form.shortDescription || 'A short description appears here.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
