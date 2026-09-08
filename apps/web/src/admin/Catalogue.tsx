import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ImagePlus, Package, Plus, SquarePen, Trash2 } from 'lucide-react';
import { PLACEHOLDER } from '../components/ProductCard';
import { ApiError, api, qs } from '../lib/api';
import type { MediaDto, Paged } from '../lib/types';
import { PageHeader } from './AdminLayout';
import { ImageUploader } from './ImageUploader';
import {
  Badge, Button, ConfirmDialog, EmptyState, Modal, Pagination, Select, Skeleton, TextArea, TextInput,
} from '../components/ui';
import { useUi } from '../stores';

// ═══════════════════════════════════════════════════════ categories ══

export function AdminCategories() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<{
    name: string; skuCode: string; description: string; isActive: boolean; image: MediaDto | null;
  }>({ name: '', skuCode: '', description: '', isActive: true, image: null });
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api.raw<Paged<any>>('/admin/categories?pageSize=100'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setForm({
      name: row?.name ?? '',
      skuCode: row?.skuCode ?? '',
      description: row?.description ?? '',
      isActive: row?.isActive ?? true,
      image: row?.image ?? null,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        skuCode: form.skuCode || undefined,
        description: form.description || undefined,
        isActive: form.isActive,
        imageId: form.image?.id ?? null,
      };
      if (editing) await api.patch(`/admin/categories/${editing.id}`, payload);
      else await api.post('/admin/categories', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      toast({ tone: 'success', title: editing ? 'Category edited' : 'Created new category' });
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

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/categories/${confirm.id}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      toast({ tone: 'success', title: 'Category deleted' });
      setConfirm(null);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not delete', text: (e as Error).message });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Product categories"
        description={data ? `${data.meta.total} categories` : undefined}
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New category</Button>}
      />
      {isLoading ? <Skeleton h={300} /> : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead>
              <tr><th /><th>Name</th><th>SKU</th><th>Subcategories</th><th>Products</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data!.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <img
                      src={c.image?.sm ?? PLACEHOLDER}
                      alt=""
                      width={34}
                      height={34}
                      style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 'var(--radius-sm)' }}
                    />
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="ts-mono">{c.skuCode}</td>
                  <td>{c.subcategoryCount}</td>
                  <td>{c.productCount}</td>
                  <td><Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'active' : 'hidden'}</Badge></td>
                  <td>
                    <div className="d-flex gap-1">
                      <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(c)}><SquarePen size={15} /></button>
                      <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(c)}><Trash2 size={15} /></button>
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
        title={editing ? 'Edit category' : 'Create category'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>{editing ? 'Save' : 'Create'}</Button>
        </>}
      >
        {/* This tile image is what shows in the "Shop by category" grid on the
            homepage — an admin can upload one, pick something already in the
            media library, or borrow a product's own photo so the category
            never has to sit behind the black placeholder square. */}
        <ImageUploader
          single
          value={form.image ? [form.image] : []}
          onChange={(imgs) => setForm({ ...form, image: imgs[0] ?? null })}
          label="Category image"
          hint="This is the tile shown in “Shop by category” on the homepage. Upload a photo, or pick one already in the media library."
        />
        <div className="d-flex gap-2 mb-3" style={{ marginTop: -8 }}>
          <Button type="button" size="sm" variant="secondary" onClick={() => setProductPickerOpen(true)}>
            Use a product's photo
          </Button>
          {form.image ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, image: null })}>
              Remove image
            </Button>
          ) : null}
        </div>

        <TextInput label="Category name" value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextInput label="SKU (2 digits)" value={form.skuCode} error={errors.skuCode}
          onChange={(e) => setForm({ ...form, skuCode: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          hint="Leave blank and we allocate the next free code." inputMode="numeric" />
        <TextArea label="Description" value={form.description} rows={2}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this category?"
        message={<>Delete <strong>{confirm?.name}</strong>? A category that still has subcategories cannot be deleted — move or delete them first.</>}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />

      <ProductPhotoPicker
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        onPick={(image) => {
          setForm((f) => ({ ...f, image }));
          setProductPickerOpen(false);
        }}
      />
    </>
  );
}

/**
 * Lets an admin borrow a product's existing photo for a category tile,
 * instead of sourcing a new image — useful when a category is really best
 * represented by its flagship product (e.g. "Raspberry Pi boards"). Only
 * products that actually have a display image are worth listing here.
 */
function ProductPhotoPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (image: MediaDto) => void;
}) {
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['admin', 'products', 'photo-picker', search],
    queryFn: () => api.raw<Paged<any>>(`/admin/products${qs({ page: 1, pageSize: 25, q: search })}`),
    enabled: open,
  });
  const rows = (data?.data ?? []).filter((p) => p.image);

  return (
    <Modal open={open} onClose={onClose} title="Use a product's photo" size="lg">
      <input
        className="ts-input mb-3"
        placeholder="Search product name or SKU"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <p className="ts-muted" style={{ fontSize: 14 }}>
            {search ? 'No matching products with a photo.' : 'No products with a photo yet.'}
          </p>
        ) : (
          <table className="ts-table">
            <thead><tr><th /><th>Product</th><th>SKU</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <img src={p.image.sm} alt="" width={40} height={40}
                      style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 'var(--radius-sm)' }} />
                  </td>
                  <td style={{ fontSize: 13 }}>{p.name}</td>
                  <td className="ts-mono" style={{ fontSize: 11 }}>{p.sku}</td>
                  <td>
                    <Button size="sm" variant="secondary" onClick={() => onPick(p.image)}>Use this photo</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════ subcategories ══

export function AdminSubcategories() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ categoryId: '', name: '', skuCode: '', isActive: true });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'subcategories'],
    queryFn: () => api.raw<Paged<any>>('/admin/subcategories?pageSize=200'),
  });
  const { data: categories } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => api.raw<Paged<any>>('/admin/categories?pageSize=100'),
  });

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    setErrors({});
    setForm({
      categoryId: String(row?.category?.id ?? ''),
      name: row?.name ?? '',
      skuCode: row?.skuCode ?? '',
      isActive: row?.isActive ?? true,
    });
    setOpen(true);
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const payload = {
        categoryId: Number(form.categoryId),
        name: form.name,
        skuCode: form.skuCode || undefined,
        isActive: form.isActive,
      };
      if (editing) await api.patch(`/admin/subcategories/${editing.id}`, payload);
      else await api.post('/admin/subcategories', payload);
      await qc.invalidateQueries({ queryKey: ['admin', 'subcategories'] });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      toast({ tone: 'success', title: editing ? 'Sub category edited' : 'Successfully created subcategory' });
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

  const parent = categories?.data.find((c) => String(c.id) === form.categoryId);

  return (
    <>
      <PageHeader
        title="Product subcategories"
        description={data ? `${data.meta.total} subcategories` : undefined}
        actions={<Button onClick={() => openForm()}><Plus size={15} /> New subcategory</Button>}
      />
      {isLoading ? <Skeleton h={300} /> : (
        <div className="ts-table__wrap">
          <table className="ts-table">
            <thead><tr><th>Name</th><th>Category</th><th>SKU</th><th>Products</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data!.data.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.category.name}</td>
                  <td className="ts-mono">{s.skuCode}</td>
                  <td>{s.productCount}</td>
                  <td><Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'active' : 'hidden'}</Badge></td>
                  <td>
                    <div className="d-flex gap-1">
                      <button className="ts-iconbtn" aria-label="Edit" onClick={() => openForm(s)}><SquarePen size={15} /></button>
                      <button className="ts-iconbtn" aria-label="Delete" onClick={() => setConfirm(s)}><Trash2 size={15} /></button>
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
        title={editing ? 'Edit sub-category' : 'Create sub-category'}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>{editing ? 'Save' : 'Create'}</Button>
        </>}
      >
        <Select label="Category" value={form.categoryId} error={errors.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value, skuCode: '' })} required>
          <option value="">Select one</option>
          {categories?.data.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.skuCode})</option>)}
        </Select>
        <TextInput label="Sub-category name" value={form.name} error={errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="d-flex gap-2 align-items-end">
          <div style={{ width: 70 }}>
            <div className="ts-label">Prefix</div>
            <input className="ts-input" value={parent?.skuCode ?? '—'} disabled />
          </div>
          <div style={{ flex: 1 }}>
            <TextInput
              label="SKU (4 digits)"
              value={form.skuCode}
              error={errors.skuCode}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                setForm({ ...form, skuCode: digits });
              }}
              hint="Leave blank and we allocate the next free code under this category."
              inputMode="numeric"
            />
          </div>
        </div>
        <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Active
        </label>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this subcategory?"
        message={<>Delete <strong>{confirm?.name}</strong>? A subcategory that still holds products cannot be deleted — move them first.</>}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/subcategories/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'subcategories'] });
            toast({ tone: 'success', title: 'Sub-category deleted' });
          } catch (e) {
            toast({ tone: 'danger', title: 'Could not delete', text: (e as Error).message });
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        }}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════ stock ══

export function AdminStock() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const low = sp.get('low') === 'true';
  const q = sp.get('q') ?? '';
  const page = Number(sp.get('page') ?? 1);
  const [search, setSearch] = useState(q);
  const [adjust, setAdjust] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ mode: 'delta', value: '', reason: 'adjustment', note: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock', page, q, low],
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

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/admin/stock/adjust', {
        variantId: adjust.variantId,
        mode: form.mode,
        value: Number(form.value),
        reason: form.reason,
        note: form.note || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'stock'] });
      toast({ tone: 'success', title: 'Stock adjusted' });
      setAdjust(null);
      setForm({ mode: 'delta', value: '', reason: 'adjustment', note: '' });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not adjust stock', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Stock"
        description="Every change writes a ledger entry — nothing moves silently."
        actions={
          <Button variant={low ? 'primary' : 'secondary'}
            onClick={() => {
              const n = new URLSearchParams(sp);
              if (low) n.delete('low'); else n.set('low', 'true');
              n.delete('page');
              setSp(n);
            }}>
            {low ? 'Showing low stock' : 'Show low stock only'}
          </Button>
        }
      />

      <input className="ts-input mb-3" style={{ maxWidth: 340 }} placeholder="Search SKU or product name"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      {isLoading ? <Skeleton h={300} /> : (
        <>
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr><th /><th>Product</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Low at</th><th /></tr>
              </thead>
              <tbody>
                {data!.data.map((v) => (
                  <tr key={v.variantId}>
                    <td>
                      <img src={v.image?.sm ?? ''} alt="" width={34} height={34}
                        style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{v.productName}</div>
                      {v.attributes.length ? (
                        <div className="ts-muted" style={{ fontSize: 11.5 }}>
                          {v.attributes.map((a: any) => `${a.name}: ${a.value}`).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="ts-mono">{v.sku}</td>
                    <td>{v.onHand}</td>
                    <td>{v.reserved}</td>
                    <td style={{ fontWeight: 700, color: v.available === 0 ? 'var(--ts-danger)' : v.isLow ? 'var(--ts-warning)' : undefined }}>
                      {v.available}
                    </td>
                    <td className="ts-muted">{v.threshold}</td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => setAdjust(v)}>Adjust</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data!.meta.page} pageCount={data!.meta.pageCount}
            onChange={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} />
        </>
      )}

      <Modal
        open={Boolean(adjust)}
        onClose={() => setAdjust(null)}
        title="Adjust stock"
        footer={<>
          <Button variant="ghost" onClick={() => setAdjust(null)}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>Save adjustment</Button>
        </>}
      >
        {adjust ? (
          <>
            <p style={{ fontSize: 14 }}>
              <strong>{adjust.productName}</strong><br />
              <span className="ts-mono ts-muted">{adjust.sku}</span> — currently {adjust.onHand} on hand
            </p>
            <Select label="Mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="delta">Add or remove (+/−)</option>
              <option value="absolute">Set exact count</option>
            </Select>
            <TextInput label={form.mode === 'delta' ? 'Change by' : 'New count'} value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value.replace(/[^\d-]/g, '') })}
              inputMode="numeric" required />
            <Select label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              <option value="purchase">Purchase (new stock)</option>
              <option value="adjustment">Adjustment</option>
              <option value="return">Return</option>
              <option value="damage">Damage</option>
              <option value="stocktake">Stocktake</option>
            </Select>
            <TextArea label="Note" value={form.note} rows={2}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              hint="Required for changes over 10 units." />
          </>
        ) : null}
      </Modal>
    </>
  );
}

// ═══════════════════════════════════════════════════ media library ══

export function AdminMedia() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [uploads, setUploads] = useState<MediaDto[]>([]);
  const [confirm, setConfirm] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'media', page],
    queryFn: () => api.raw<Paged<any>>(`/admin/media?page=${page}&pageSize=40`),
  });

  useEffect(() => {
    if (uploads.length) {
      void qc.invalidateQueries({ queryKey: ['admin', 'media'] });
      setUploads([]);
    }
  }, [uploads, qc]);

  return (
    <>
      <PageHeader
        title="Media library"
        description="Every image in the store. Upload straight from your device."
      />

      <div className="ts-card p-4 mb-4">
        <ImageUploader
          value={uploads}
          onChange={setUploads}
          max={20}
          label="Upload new images"
          hint="Drag & drop images here, or browse your device. They are added to the library immediately."
        />
      </div>

      {isLoading ? <Skeleton h={300} /> : !data?.data.length ? (
        <EmptyState icon={<ImagePlus size={48} />} title="No images yet"
          description="Upload images to use them on products, banners and articles." />
      ) : (
        <>
          <div className="d-flex flex-wrap gap-3">
            {data.data.map((m) => (
              <div key={m.id} className="ts-card" style={{ width: 168, overflow: 'hidden' }}>
                <img src={m.sm} alt={m.altText ?? ''}
                  style={{ width: '100%', height: 120, objectFit: 'contain', background: 'var(--ts-surface-sunken)' }} />
                <div className="p-2" style={{ fontSize: 11.5 }}>
                  <div className="ts-clamp-2" title={m.originalFilename}>{m.originalFilename || 'image'}</div>
                  <div className="ts-muted d-flex justify-content-between mt-1">
                    <span>{Math.round(m.byteSize / 1024)} KB</span>
                    <span>{m.referenceCount} use{m.referenceCount === 1 ? '' : 's'}</span>
                  </div>
                  <div className="d-flex justify-content-end mt-1">
                    <button className="ts-iconbtn" aria-label="Delete image"
                      style={{ width: 26, height: 26 }} onClick={() => setConfirm(m)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={data.meta.page} pageCount={data.meta.pageCount} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete this image?"
        message={
          confirm?.referenceCount > 0
            ? <>This image is used by {confirm.referenceCount} item(s) and cannot be deleted until it is removed from them.</>
            : <>Delete <strong>{confirm?.originalFilename}</strong>? This cannot be undone.</>
        }
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/admin/media/${confirm.id}`);
            await qc.invalidateQueries({ queryKey: ['admin', 'media'] });
            toast({ tone: 'success', title: 'Image deleted' });
          } catch (e) {
            toast({ tone: 'danger', title: 'Could not delete image', text: (e as Error).message });
          } finally {
            setBusy(false);
            setConfirm(null);
          }
        }}
        onCancel={() => setConfirm(null)}
        busy={busy}
      />
    </>
  );
}
