import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart, ShoppingCart } from 'lucide-react';
import { api } from '../lib/api';
import type { ProductDetail, VariantDto } from '../lib/types';
import { useCart, useUi, useWishlist } from '../stores';
import { Button, Modal, QuantityStepper, Skeleton } from './ui';
import { PLACEHOLDER, Stars } from './ProductCard';

/**
 * Quick view — inspect and buy without losing your place in a long grid.
 * Deliberately a subset of the product page: gallery, price, options and
 * add-to-cart. Anything deeper (specs, reviews, datasheet) links through.
 */
export function QuickView({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const add = useCart((s) => s.add);
  const busy = useCart((s) => s.busy);
  const toast = useUi((s) => s.toast);
  const toggleWish = useWishlist((s) => s.toggle);
  const inWishlist = useWishlist((s) => s.items.some((i) => i.productSlug === slug));

  const [imageIndex, setImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [sku, setSku] = useState<string | null>(null);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.get<ProductDetail>(`/products/${slug}`),
    enabled: Boolean(slug),
  });

  useEffect(() => {
    setImageIndex(0);
    setQuantity(1);
    setSku(null);
  }, [slug]);

  const variant = useMemo<VariantDto | undefined>(() => {
    if (!product?.variants.length) return undefined;
    return (
      product.variants.find((v) => v.sku === sku) ??
      product.variants.find((v) => v.stock.available > 0) ??
      product.variants[0]
    );
  }, [product, sku]);

  const outOfStock = !variant || variant.stock.available <= 0;

  const handleAdd = async () => {
    if (!variant) return;
    try {
      await add(variant.sku, quantity);
      toast({ tone: 'success', title: 'Added to cart', text: product?.name });
      onClose();
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not add to cart', text: (e as Error).message });
    }
  };

  const images = product?.images ?? [];

  return (
    <Modal open={Boolean(slug)} onClose={onClose} size="lg" title="Quick view">
      {isLoading || !product ? (
        <div className="row g-4">
          <div className="col-12 col-md-6"><Skeleton h={280} /></div>
          <div className="col-12 col-md-6">
            <Skeleton h={24} style={{ marginBottom: 12 }} />
            <Skeleton h={16} w="50%" style={{ marginBottom: 20 }} />
            <Skeleton h={40} />
          </div>
        </div>
      ) : (
        <div className="row g-4">
          <div className="col-12 col-md-6">
            <div style={{
              aspectRatio: '1', background: '#fff', border: '1px solid var(--ts-border)',
              borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center', padding: 16,
            }}>
              <img
                src={images[imageIndex]?.lg ?? product.image?.lg ?? PLACEHOLDER}
                alt={product.name}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            </div>
            {images.length > 1 ? (
              <div className="d-flex gap-2 mt-2 flex-wrap">
                {images.slice(0, 5).map((im, i) => (
                  <button
                    key={im.id}
                    type="button"
                    onClick={() => setImageIndex(i)}
                    aria-label={`View image ${i + 1}`}
                    style={{
                      width: 54, height: 54, padding: 3, background: '#fff', cursor: 'pointer',
                      border: `2px solid ${i === imageIndex ? 'var(--ts-primary)' : 'var(--ts-border)'}`,
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <img src={im.sm} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="col-12 col-md-6">
            <div className="ts-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {product.brand ?? product.subcategory.name}
            </div>
            <h2 style={{ fontSize: 19, margin: '4px 0 8px' }}>{product.name}</h2>

            {product.rating.count > 0 ? (
              <div className="d-flex align-items-center gap-2 mb-2">
                <Stars value={product.rating.average} size={13} />
                <span className="ts-muted" style={{ fontSize: 12.5 }}>
                  {product.rating.average.toFixed(1)} · {product.rating.count} review{product.rating.count === 1 ? '' : 's'}
                </span>
              </div>
            ) : null}

            <div className="d-flex align-items-baseline gap-2 mb-3">
              <span style={{ fontSize: 24, fontWeight: 800 }}>
                {variant?.price.formatted ?? product.price.formatted}
              </span>
              {variant?.listPrice ? (
                <s className="ts-muted" style={{ fontSize: 14 }}>{variant.listPrice.formatted}</s>
              ) : null}
            </div>

            {product.shortDescription ? (
              <p className="ts-muted ts-clamp-3" style={{ fontSize: 13.5 }}>{product.shortDescription}</p>
            ) : null}

            {product.variants.length > 1 ? (
              <div className="mb-3">
                <div className="ts-label">Options</div>
                <div className="d-flex flex-wrap gap-2">
                  {product.variants.map((v) => {
                    const label = v.attributes.map((a) => a.value).join(' / ') || v.sku;
                    const active = v.sku === variant?.sku;
                    const oos = v.stock.available <= 0;
                    return (
                      <button
                        key={v.sku}
                        type="button"
                        onClick={() => setSku(v.sku)}
                        disabled={oos}
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
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="d-flex align-items-center gap-3 mb-3">
              <QuantityStepper
                value={quantity}
                max={Math.max(1, variant?.stock.available ?? 1)}
                onChange={setQuantity}
                disabled={outOfStock}
              />
              <span style={{ fontSize: 13 }} className={outOfStock ? 'text-danger' : 'ts-muted'}>
                {outOfStock ? 'Out of stock' : `${variant?.stock.available} available`}
              </span>
            </div>

            <div className="d-grid gap-2">
              <Button block disabled={outOfStock || busy} onClick={() => void handleAdd()}>
                <ShoppingCart size={15} /> Add to cart
              </Button>
              <div className="d-flex gap-2">
                <Button variant="secondary" className="flex-fill" onClick={() => void toggleWish(product.slug, variant?.sku)}>
                  <Heart size={15} fill={inWishlist ? 'currentColor' : 'none'} />
                  {inWishlist ? 'Saved' : 'Save'}
                </Button>
                <Link to={`/product/${product.slug}`} className="ts-btn ts-btn--ghost flex-fill" onClick={onClose}>
                  Full details
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
