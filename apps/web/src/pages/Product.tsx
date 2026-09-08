import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Copy, FileText, Heart, RotateCcw, ShieldCheck, Smartphone, Star, Truck,
} from 'lucide-react';
import { api } from '../lib/api';
import type { ProductDetail, VariantDto } from '../lib/types';
import { ProductCard, PLACEHOLDER } from '../components/ProductCard';
import { RecentlyViewedRail } from '../components/RecentlyViewedRail';
import { RailScroller } from '../components/RailScroller';
import { BundleOffer } from '../components/BundleOffer';
import {
  Badge, Button, CardSkeleton, EmptyState, QuantityStepper, RichText, Skeleton, TextArea,
} from '../components/ui';
import { useAuth, useCart, useUi, useWishlist } from '../stores';
import { pushRecentlyViewed } from '../lib/recentlyViewed';

function StockLine({ variant }: { variant: VariantDto }) {
  const s = variant.stock;
  const dot = (colour: string) => (
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, display: 'inline-block' }} />
  );
  if (s.status === 'out_of_stock') {
    return <span className="d-inline-flex align-items-center gap-2">{dot('var(--ts-danger)')} Out of stock</span>;
  }
  if (s.status === 'low_stock') {
    return <span className="d-inline-flex align-items-center gap-2">{dot('var(--ts-warning)')} Only {s.available} left</span>;
  }
  return <span className="d-inline-flex align-items-center gap-2">{dot('var(--ts-success)')} {s.available} in stock</span>;
}

function Reviews({ slug }: { slug: string }) {
  const { user } = useAuth();
  const openAuth = useUi((s) => s.openAuth);
  const toast = useUi((s) => s.toast);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['reviews', slug],
    queryFn: () => api.raw<{ data: any[]; meta: any }>(`/products/${slug}/reviews`),
  });

  const summary = data?.meta?.summary;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) {
      toast({ tone: 'danger', title: 'Please choose a rating' });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/products/${slug}/reviews`, { rating, body });
      setBody('');
      setRating(0);
      toast({ tone: 'success', title: 'Thank you — your review will appear once approved.' });
      void refetch();
    } catch (err) {
      toast({ tone: 'danger', title: 'Could not post your review', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {summary?.count ? (
        <div className="d-flex flex-wrap gap-4 align-items-center mb-4">
          <div className="text-center">
            <div style={{ fontSize: 34, fontWeight: 800 }}>{summary.average.toFixed(1)}</div>
            <div className="ts-muted" style={{ fontSize: 13 }}>{summary.count} review{summary.count === 1 ? '' : 's'}</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            {[5, 4, 3, 2, 1].map((n) => {
              const c = summary.histogram[String(n)] ?? 0;
              const pct = summary.count ? Math.round((c / summary.count) * 100) : 0;
              return (
                <div key={n} className="d-flex align-items-center gap-2" style={{ fontSize: 12 }}>
                  <span style={{ width: 12 }}>{n}</span>
                  <Star size={11} />
                  <div style={{ flex: 1, height: 7, background: 'var(--ts-surface-sunken)', borderRadius: 4 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ts-star)', borderRadius: 4 }} />
                  </div>
                  <span className="ts-muted" style={{ width: 24, textAlign: 'right' }}>{c}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {data?.data?.length ? (
        data.data.map((r) => (
          <div key={r.id} className="py-3" style={{ borderTop: '1px solid var(--ts-border)' }}>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <div style={{ color: 'var(--ts-star)' }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={13} fill={i < r.rating ? 'currentColor' : 'none'} />
                ))}
              </div>
              <strong style={{ fontSize: 14 }}>{r.title}</strong>
              {r.verifiedPurchase ? <Badge tone="success">Verified purchase</Badge> : null}
            </div>
            <div className="ts-muted" style={{ fontSize: 12 }}>
              {r.author} · {new Date(r.createdAt).toLocaleDateString()}
            </div>
            <p className="mt-2 mb-0" style={{ fontSize: 14 }}>{r.body}</p>
          </div>
        ))
      ) : (
        <p className="ts-muted">No reviews yet. Be the first to review this product.</p>
      )}

      <hr />
      {user ? (
        <form onSubmit={submit}>
          <div className="ts-label">Your rating</div>
          <div className="mb-3" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                onClick={() => setRating(n)}
                style={{ border: 0, background: 'transparent', color: 'var(--ts-star)', padding: 2 }}
              >
                <Star size={22} fill={n <= rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          <TextArea
            label="Your review"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did you think of this product?"
            minLength={10}
            maxLength={2000}
            required
          />
          <Button type="submit" loading={busy}>Post review</Button>
        </form>
      ) : (
        <div className="ts-panel d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span>Please sign in to write a review.</span>
          <Button size="sm" onClick={() => openAuth('login')}>Sign in</Button>
        </div>
      )}
    </div>
  );
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const add = useCart((s) => s.add);
  const busy = useCart((s) => s.busy);
  const toast = useUi((s) => s.toast);
  const toggleWish = useWishlist((s) => s.toggle);
  const inWishlist = useWishlist((s) => s.items.some((i) => i.productSlug === slug));

  const [imageIndex, setImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState<'description' | 'specifications' | 'reviews'>('description');

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.get<ProductDetail>(`/products/${slug}`),
  });

  const { data: related = [] } = useQuery({
    queryKey: ['related', slug],
    queryFn: () => api.get(`/products/${slug}/related`),
    enabled: Boolean(product),
  });

  const selectedSku = sp.get('v');
  const variant = useMemo<VariantDto | undefined>(() => {
    if (!product?.variants.length) return undefined;
    const chosen = product.variants.find((v) => v.sku === selectedSku);
    if (chosen) return chosen;
    return product.variants.find((v) => v.stock.available > 0) ?? product.variants[0];
  }, [product, selectedSku]);

  useEffect(() => {
    if (!product) return;
    document.title = `${product.name} — TechStar Store`;
    pushRecentlyViewed({
      slug: product.slug,
      name: product.name,
      image: product.image?.sm ?? null,
      price: product.price.formatted,
    });
  }, [product]);

  useEffect(() => {
    setQuantity(1);
  }, [variant?.sku]);

  if (isError) {
    return (
      <div className="container py-5">
        <EmptyState
          title="Product not found"
          description="The product you are looking for does not exist or is no longer available."
          action={<Link to="/products" className="ts-btn ts-btn--primary">Browse all products</Link>}
        />
      </div>
    );
  }

  if (isLoading || !product) {
    return (
      <div className="container py-4">
        <div className="row g-4">
          <div className="col-12 col-lg-6"><Skeleton h={420} /></div>
          <div className="col-12 col-lg-6">
            <Skeleton h={28} style={{ marginBottom: 12 }} />
            <Skeleton h={18} w="40%" style={{ marginBottom: 20 }} />
            <Skeleton h={44} style={{ marginBottom: 12 }} />
            <Skeleton h={44} style={{ marginBottom: 12 }} />
          </div>
        </div>
      </div>
    );
  }

  const images = product.images.length ? product.images : [];
  const image = images[imageIndex];
  const outOfStock = !variant || variant.stock.available <= 0;

  const handleAdd = async (buyNow = false) => {
    if (!variant) return;
    try {
      await add(variant.sku, quantity);
      if (buyNow) navigate('/checkout');
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not add to cart', text: (e as Error).message });
    }
  };

  return (
    <div className="container pb-5">
      <nav aria-label="Breadcrumb" className="py-3" style={{ fontSize: 13.5 }}>
        <ol className="d-flex flex-wrap gap-2 list-unstyled m-0">
          <li><Link to="/">Home</Link></li>
          {product.subcategory.category ? (
            <li className="d-flex gap-2">
              <span className="ts-muted">›</span>
              <Link to={`/products/c/${product.subcategory.category.slug}`}>{product.subcategory.category.name}</Link>
            </li>
          ) : null}
          <li className="d-flex gap-2">
            <span className="ts-muted">›</span>
            <Link to={`/products/s/${product.subcategory.slug}`}>{product.subcategory.name}</Link>
          </li>
          <li className="d-flex gap-2">
            <span className="ts-muted">›</span>
            <span className="ts-muted" aria-current="page">{product.name}</span>
          </li>
        </ol>
      </nav>

      <div className="row g-4">
        {/* gallery */}
        <div className="col-12 col-lg-6">
          <div style={{
            aspectRatio: '1', background: 'var(--ts-surface-sunken)',
            borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center', padding: 20,
          }}>
            <img
              src={image?.lg ?? PLACEHOLDER}
              alt={image?.altText ?? product.name}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
          {images.length > 1 ? (
            <div className="d-flex gap-2 mt-3 align-items-center">
              <button className="ts-iconbtn" aria-label="Previous image"
                onClick={() => setImageIndex((i) => (i - 1 + images.length) % images.length)}>
                <ChevronLeft size={16} />
              </button>
              <div className="d-flex gap-2 flex-wrap" style={{ flex: 1 }}>
                {images.map((im, i) => (
                  <button
                    key={im.id}
                    onClick={() => setImageIndex(i)}
                    aria-label={`View image ${i + 1}`}
                    aria-current={i === imageIndex}
                    style={{
                      width: 68, height: 68, padding: 4, background: 'var(--ts-surface-sunken)',
                      border: `2px solid ${i === imageIndex ? 'var(--ts-primary)' : 'transparent'}`,
                      borderRadius: 4, cursor: 'pointer',
                    }}
                  >
                    <img src={im.sm} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
              <button className="ts-iconbtn" aria-label="Next image"
                onClick={() => setImageIndex((i) => (i + 1) % images.length)}>
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
        </div>

        {/* buy box */}
        <div className="col-12 col-lg-6">
          <div className="ts-card p-4">
            <h1 style={{ fontSize: 22, textTransform: 'uppercase', margin: '0 0 8px' }}>{product.name}</h1>

            <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
              <span className="ts-mono ts-muted">
                SKU {variant?.sku ?? product.sku}
                <button
                  className="ts-iconbtn"
                  aria-label="Copy SKU"
                  style={{ width: 24, height: 24 }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(variant?.sku ?? product.sku);
                    toast({ tone: 'success', title: 'SKU copied' });
                  }}
                >
                  <Copy size={12} />
                </button>
              </span>
              {product.brand ? <Badge>{product.brand}</Badge> : null}
              {product.rating.count > 0 ? (
                <button
                  onClick={() => setTab('reviews')}
                  style={{ border: 0, background: 'transparent', fontSize: 13 }}
                  className="d-inline-flex align-items-center gap-1"
                >
                  <span style={{ color: 'var(--ts-star)' }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} size={12} fill={i < Math.round(product.rating.average) ? 'currentColor' : 'none'} />
                    ))}
                  </span>
                  ({product.rating.count} review{product.rating.count === 1 ? '' : 's'})
                </button>
              ) : null}
              {product.specSheet ? (
                <a
                  href={product.specSheet.url}
                  target="_blank"
                  rel="noopener"
                  className="d-inline-flex align-items-center gap-1"
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--ts-primary)' }}
                >
                  <FileText size={14} /> Datasheet (PDF)
                </a>
              ) : null}
            </div>

            <div className="mb-4">
              {variant?.listPrice ? (
                <div className="ts-muted" style={{ textDecoration: 'line-through', fontSize: 14 }}>
                  {variant.listPrice.formatted}
                </div>
              ) : null}
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ts-primary)' }}>
                {variant?.price.formatted ?? product.price.formatted}
              </div>
              {variant?.discount ? (
                <Badge tone="accent">Save {variant.discount.percent}%</Badge>
              ) : null}
            </div>

            {product.attributes.length > 0 ? (
              <div className="mb-4">
                {product.attributes.map((attr) => (
                  <div key={attr.name} className="mb-3">
                    <div className="ts-label">{attr.name}{attr.unit ? ` (${attr.unit})` : ''}</div>
                    <div className="d-flex flex-wrap gap-2">
                      {product.variants.map((v) => {
                        const value = v.attributes.find((a) => a.name === attr.name)?.value;
                        if (!value) return null;
                        const active = v.sku === variant?.sku;
                        const oos = v.stock.available <= 0;
                        return (
                          <button
                            key={v.sku}
                            onClick={() => {
                              const next = new URLSearchParams(sp);
                              next.set('v', v.sku);
                              setSp(next, { replace: true });
                            }}
                            disabled={oos}
                            title={oos ? 'Out of stock' : undefined}
                            style={{
                              padding: '6px 14px', borderRadius: 'var(--radius-pill)', fontSize: 13,
                              border: `1px solid ${active ? 'var(--ts-primary)' : 'var(--ts-border)'}`,
                              background: active ? 'var(--ts-primary-tint)' : '#fff',
                              color: oos ? 'var(--ts-text-muted)' : 'var(--ts-text)',
                              textDecoration: oos ? 'line-through' : undefined,
                              cursor: oos ? 'not-allowed' : 'pointer',
                              fontWeight: active ? 700 : 500,
                            }}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="row g-3 mb-4">
              <div className="col-6">
                <div className="ts-label">Quantity</div>
                <QuantityStepper
                  value={quantity}
                  max={Math.max(1, variant?.stock.available ?? 1)}
                  onChange={setQuantity}
                  disabled={outOfStock}
                />
              </div>
              <div className="col-6">
                <div className="ts-label">Available stock</div>
                <div style={{ fontSize: 14, paddingTop: 8 }}>
                  {variant ? <StockLine variant={variant} /> : '—'}
                </div>
              </div>
            </div>

            <div className="d-grid gap-2">
              <Button block disabled={outOfStock || busy} onClick={() => void handleAdd(false)}>
                {outOfStock ? 'Out of stock' : 'Add to cart'}
              </Button>
              <Button block variant="secondary" onClick={() => void toggleWish(product.slug, variant?.sku)}>
                <Heart size={15} fill={inWishlist ? 'currentColor' : 'none'} />
                {inWishlist ? 'In your wishlist' : 'Add to wishlist'}
              </Button>
              <Button block disabled={outOfStock || busy} onClick={() => void handleAdd(true)}>
                Buy now
              </Button>
            </div>

            <ul className="ts-assure">
              <li>
                <Truck size={17} />
                <div>
                  <strong>Nationwide delivery</strong>
                  <span>Dar es Salaam same/next day · regions via bus courier</span>
                </div>
              </li>
              <li>
                <Smartphone size={17} />
                <div>
                  <strong>Pay by mobile money</strong>
                  <span>M-Pesa, Mixx by Yas and Airtel Money accepted</span>
                </div>
              </li>
              <li>
                <RotateCcw size={17} />
                <div>
                  <strong>7-day returns</strong>
                  <span>Unused items in original packaging</span>
                </div>
              </li>
              <li>
                <ShieldCheck size={17} />
                <div>
                  <strong>Genuine components</strong>
                  <span>Tested before dispatch by our workshop</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <BundleOffer product={product} />

      {/* tabs */}
      <div className="ts-card mt-4">
        <div className="d-flex" role="tablist" style={{ borderBottom: '1px solid var(--ts-border)' }}>
          {(['description', ...(product.attributes.length || product.specSheet ? (['specifications'] as const) : []), 'reviews'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t as never)}
              style={{
                border: 0, background: 'transparent', padding: '14px 22px',
                fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                color: tab === t ? 'var(--ts-primary)' : 'var(--ts-text-secondary)',
                boxShadow: tab === t ? 'inset 0 -2px 0 var(--ts-primary)' : undefined,
              }}
            >
              {t === 'reviews' ? `Reviews (${product.rating.count})` : t}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === 'description' ? <RichText html={product.descriptionHtml} /> : null}
          {tab === 'specifications' ? (
            <>
            {product.specSheet ? (
              <a
                href={product.specSheet.url}
                target="_blank"
                rel="noopener"
                className="ts-card d-flex align-items-center gap-3 p-3 mb-4"
                style={{ maxWidth: 420, borderColor: 'var(--ts-primary)' }}
              >
                <span style={{
                  width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--ts-primary-tint)',
                  display: 'grid', placeItems: 'center', color: 'var(--ts-primary)', flexShrink: 0,
                }}>
                  <FileText size={20} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Download full datasheet</div>
                  <div className="ts-muted" style={{ fontSize: 12 }}>Manufacturer specification sheet (PDF)</div>
                </div>
              </a>
            ) : null}
            <table className="ts-table" style={{ maxWidth: 520 }}>
              <tbody>
                {(variant?.attributes ?? []).map((a) => (
                  <tr key={a.name}>
                    <th style={{ background: 'var(--ts-surface-alt)', color: 'var(--ts-text)', width: '45%' }}>{a.name}</th>
                    <td>{a.value}{a.unit ? ` ${a.unit}` : ''}</td>
                  </tr>
                ))}
                {product.manufacturerPartNumber ? (
                  <tr>
                    <th style={{ background: 'var(--ts-surface-alt)', color: 'var(--ts-text)' }}>Manufacturer part number</th>
                    <td className="ts-mono">{product.manufacturerPartNumber}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </>
          ) : null}
          {tab === 'reviews' ? <Reviews slug={slug} /> : null}
        </div>
      </div>

      {related.length > 0 ? (
        <section className="ts-section">
          <h2 className="ts-section__title">Customers also bought</h2>
          <p className="ts-muted">Frequently paired with this item, plus more from {product.subcategory.name}.</p>
          <RailScroller className="mt-3">
            {related.map((p: any) => <ProductCard key={p.slug} product={p} />)}
          </RailScroller>
        </section>
      ) : null}

      <RecentlyViewedRail excludeSlug={slug} />
    </div>
  );
}
