import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, PackageX, SlidersHorizontal, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import type { Paged, ProductCard as ProductCardDto } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { QuickView } from '../components/QuickView';
import { Button, CardSkeleton, EmptyState, Pagination, TextInput } from '../components/ui';
import { useCategories } from '../components/Layout';

function Breadcrumb({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="py-3" style={{ fontSize: 13.5 }}>
      <ol className="d-flex flex-wrap gap-2 list-unstyled m-0">
        <li><Link to="/">Home</Link></li>
        {trail.map((t, i) => (
          <li key={i} className="d-flex gap-2">
            <span className="ts-muted">›</span>
            {t.to ? <Link to={t.to}>{t.label}</Link> : <span className="ts-muted" aria-current="page">{t.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const SORTS = [
  { key: 'bestSelling', label: 'Best Selling' },
  { key: 'newest', label: 'New Arrivals' },
] as const;

export function CataloguePage({ mode }: { mode: 'all' | 'category' | 'subcategory' | 'search' }) {
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const { data: categories = [] } = useCategories();

  const page = Number(sp.get('page') ?? 1);
  const sort = sp.get('sort') ?? (mode === 'search' ? 'bestSelling' : 'newest');
  const minPrice = sp.get('minPrice') ?? '';
  const maxPrice = sp.get('maxPrice') ?? '';
  const inStock = sp.get('inStock') === 'true';
  const onOffer = sp.get('onOffer') === 'true';
  const q = sp.get('q') ?? '';

  const [showFilters, setShowFilters] = useState(false);
  const [quickView, setQuickView] = useState<string | null>(null);
  const [minDraft, setMinDraft] = useState(minPrice);
  const [maxDraft, setMaxDraft] = useState(maxPrice);
  const [priceError, setPriceError] = useState<string>();

  useEffect(() => {
    setMinDraft(minPrice);
    setMaxDraft(maxPrice);
  }, [minPrice, maxPrice]);

  const category = useMemo(
    () => categories.find((c) => c.slug === params.categorySlug),
    [categories, params.categorySlug],
  );
  const subcategory = useMemo(() => {
    for (const c of categories) {
      const s = c.subcategories.find((x) => x.slug === params.subcategorySlug);
      if (s) return { ...s, category: c };
    }
    return undefined;
  }, [categories, params.subcategorySlug]);

  const queryParams: Record<string, unknown> = {
    page,
    pageSize: 24,
    sort,
    minPrice: minPrice || undefined,
    maxPrice: maxPrice || undefined,
    inStock: inStock || undefined,
    onOffer: onOffer || undefined,
    categorySlug: mode === 'category' ? params.categorySlug : undefined,
    subcategorySlug: mode === 'subcategory' ? params.subcategorySlug : undefined,
  };

  const endpoint =
    mode === 'search'
      ? `/search${qs({ q, page, pageSize: 24 })}`
      : `/products${qs(queryParams)}`;

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['catalogue', mode, endpoint],
    queryFn: () => api.raw<Paged<ProductCardDto>>(endpoint),
    staleTime: 60_000,
  });

  const heading =
    mode === 'search'
      ? `Search results for “${q}”`
      : mode === 'subcategory'
        ? (subcategory?.name ?? 'Products')
        : mode === 'category'
          ? (category?.name ?? 'Products')
          : 'All Products';

  useEffect(() => {
    document.title = `${heading} — TechStar Store`;
  }, [heading]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setSp(next, { replace: false });
  };

  const activeFilters = [
    minPrice || maxPrice
      ? { key: 'price', label: `TZS ${minPrice || '0'} – ${maxPrice || '∞'}` }
      : null,
    inStock ? { key: 'inStock', label: 'In stock only' } : null,
    onOffer ? { key: 'onOffer', label: 'On offer' } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const applyPrice = () => {
    const min = minDraft ? Number(minDraft) : undefined;
    const max = maxDraft ? Number(maxDraft) : undefined;
    if (min !== undefined && max !== undefined && min > max) {
      setPriceError('Minimum price must be less than maximum price');
      return;
    }
    setPriceError(undefined);
    const next = new URLSearchParams(sp);
    if (minDraft) next.set('minPrice', minDraft); else next.delete('minPrice');
    if (maxDraft) next.set('maxPrice', maxDraft); else next.delete('maxPrice');
    next.delete('page');
    setSp(next);
  };

  const trail =
    mode === 'subcategory' && subcategory
      ? [
          { label: subcategory.category.name, to: `/products/c/${subcategory.category.slug}` },
          { label: subcategory.name },
        ]
      : mode === 'category' && category
        ? [{ label: category.name }]
        : mode === 'search'
          ? [{ label: 'Search' }]
          : [{ label: 'Products' }];

  return (
    <div className="container pb-5">
      <Breadcrumb trail={trail} />

      <div className="d-flex flex-wrap align-items-baseline gap-3 mb-3">
        <h1 style={{ fontSize: 26, margin: 0, textTransform: 'uppercase' }}>{heading}</h1>
        {data ? (
          <span className="ts-muted">
            {data.meta.total} product{data.meta.total === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {mode !== 'search' ? (
        <div className="d-flex flex-wrap align-items-center gap-3 pb-3" style={{ borderBottom: '1px solid var(--ts-border)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Sort by:</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setParam('sort', s.key)}
              style={{
                border: 0, background: 'transparent', fontSize: 13.5, padding: '2px 0',
                color: sort === s.key ? 'var(--ts-primary)' : 'var(--ts-text-secondary)',
                fontWeight: sort === s.key ? 700 : 500,
                boxShadow: sort === s.key ? 'inset 0 -2px 0 var(--ts-primary)' : undefined,
              }}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setParam('sort', sort === 'priceAsc' ? 'priceDesc' : 'priceAsc')}
            className="d-inline-flex align-items-center gap-1"
            style={{
              border: 0, background: 'transparent', fontSize: 13.5,
              color: sort.startsWith('price') ? 'var(--ts-primary)' : 'var(--ts-text-secondary)',
              fontWeight: sort.startsWith('price') ? 700 : 500,
              boxShadow: sort.startsWith('price') ? 'inset 0 -2px 0 var(--ts-primary)' : undefined,
            }}
          >
            Price {sort === 'priceDesc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
          </button>

          <Button
            size="sm"
            variant="secondary"
            className="ms-auto"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={14} /> Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
          </Button>
        </div>
      ) : null}

      {activeFilters.length ? (
        <div className="d-flex flex-wrap gap-2 mt-3">
          {activeFilters.map((f) => (
            <button
              key={f.key}
              className="ts-badge"
              onClick={() => {
                if (f.key === 'price') {
                  const next = new URLSearchParams(sp);
                  next.delete('minPrice'); next.delete('maxPrice'); next.delete('page');
                  setSp(next);
                } else setParam(f.key, null);
              }}
            >
              {f.label} <X size={11} />
            </button>
          ))}
          <button
            className="ts-badge"
            onClick={() => setSp(new URLSearchParams(mode === 'search' ? { q } : {}))}
          >
            Clear all
          </button>
        </div>
      ) : null}

      <div className="row mt-4">
        {showFilters && mode !== 'search' ? (
          <aside className="col-12 col-lg-3 mb-4">
            <div className="ts-card p-3">
              <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Price</h2>
              <div className="row g-2">
                <div className="col-6">
                  <TextInput label="Min price" inputMode="numeric" value={minDraft}
                    onChange={(e) => setMinDraft(e.target.value.replace(/\D/g, ''))} />
                </div>
                <div className="col-6">
                  <TextInput label="Max price" inputMode="numeric" value={maxDraft}
                    onChange={(e) => setMaxDraft(e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
              {priceError ? <div className="ts-error mb-2">{priceError}</div> : null}
              <Button size="sm" block onClick={applyPrice}>Apply</Button>

              <hr />
              <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Availability</h2>
              <label className="d-flex gap-2 align-items-center mb-2" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={inStock}
                  onChange={(e) => setParam('inStock', e.target.checked ? 'true' : null)} />
                In stock only
              </label>
              <label className="d-flex gap-2 align-items-center" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={onOffer}
                  onChange={(e) => setParam('onOffer', e.target.checked ? 'true' : null)} />
                On offer
              </label>

              <hr />
              <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Categories</h2>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {categories.map((c) => (
                  <div key={c.slug} className="mb-1">
                    <Link to={`/products/c/${c.slug}`} style={{ fontSize: 13.5, fontWeight: 600, color: 'inherit' }}>
                      {c.name} <span className="ts-muted">({c.productCount})</span>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        ) : null}

        <div className={showFilters && mode !== 'search' ? 'col-12 col-lg-9' : 'col-12'}>
          {isError ? (
            <div className="ts-panel d-flex justify-content-between align-items-center">
              <span>We could not load products just now.</span>
              <Button variant="secondary" size="sm" onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : isLoading ? (
            <div className="ts-grid">
              {Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : data && data.data.length > 0 ? (
            <>
              <div className="ts-grid" style={{ opacity: isFetching ? 0.55 : 1, transition: 'opacity 150ms' }}>
                {data.data.map((p) => <ProductCard key={p.slug} product={p} onQuickView={setQuickView} />)}
              </div>
              <Pagination
                page={data.meta.page}
                pageCount={data.meta.pageCount}
                onChange={(p) => {
                  setParam('page', String(p));
                  window.scrollTo({ top: 200, behavior: 'smooth' });
                }}
              />
            </>
          ) : activeFilters.length || q ? (
            <EmptyState
              icon={<PackageX size={48} />}
              title={q ? `No products match “${q}”` : 'No products match your filters'}
              description={
                q
                  ? 'Try a different spelling or a shorter term. We may also be able to source it for you.'
                  : 'Try widening the price range or clearing a filter.'
              }
              action={
                <div className="d-flex gap-2 justify-content-center flex-wrap">
                  <Button onClick={() => setSp(new URLSearchParams())}>Clear all filters</Button>
                  <Link to="/products" className="ts-btn ts-btn--secondary">Browse all products</Link>
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={<PackageX size={48} />}
              title="No products found in the selected category"
              description="Try another subcategory, or browse the full catalogue."
              action={<Link to="/products" className="ts-btn ts-btn--primary">Browse all products</Link>}
            />
          )}
        </div>
      </div>

      <QuickView slug={quickView} onClose={() => setQuickView(null)} />
    </div>
  );
}
