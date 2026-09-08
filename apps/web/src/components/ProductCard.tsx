import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, Heart, ShoppingCart, Star } from 'lucide-react';
import type { ProductCard as ProductCardDto } from '../lib/types';
import { useCart, useUi, useWishlist } from '../stores';
import { Button } from './ui';

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23eceff1"/><text x="100" y="106" font-family="sans-serif" font-size="16" fill="%238b98a2" text-anchor="middle">TechStar</text></svg>`,
  );

/** Five stars with the average filled in — the review shorthand shoppers scan for. */
export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="ts-pcard__stars" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={size} fill={i < Math.round(value) ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

/**
 * Stock is shown as a traffic light plus words. "Only N left" is deliberate —
 * a real scarcity signal drawn from live stock, never a fabricated one.
 */
function StockLine({ product }: { product: ProductCardDto }) {
  if (!product.inStock) {
    return (
      <div className="ts-pcard__stock" style={{ color: 'var(--ts-danger)' }}>
        <span className="ts-pcard__dot" style={{ background: 'var(--ts-danger)' }} /> Out of stock
      </div>
    );
  }
  const low = product.totalStock > 0 && product.totalStock <= 5;
  return (
    <div className="ts-pcard__stock" style={low ? { color: 'var(--ts-warning)' } : undefined}>
      <span className="ts-pcard__dot" style={{ background: low ? 'var(--ts-warning)' : 'var(--ts-success)' }} />
      {low ? `Only ${product.totalStock} left` : 'In stock'}
    </div>
  );
}

export function ProductCard({
  product,
  onQuickView,
}: {
  product: ProductCardDto;
  onQuickView?: (slug: string) => void;
}) {
  const navigate = useNavigate();
  const add = useCart((s) => s.add);
  const busy = useCart((s) => s.busy);
  const toggleWish = useWishlist((s) => s.toggle);
  const inWishlist = useWishlist((s) => s.items.some((i) => i.productSlug === product.slug));
  const toast = useUi((s) => s.toast);

  const outOfStock = !product.inStock;
  const multi = product.hasVariants;

  const handleAdd = async () => {
    // A product with options has nothing unambiguous to add — send the shopper
    // to the detail page to choose (spec §7.2.3).
    if (multi) {
      navigate(`/product/${product.slug}`);
      return;
    }
    try {
      await add(`${product.sku}01`);
      toast({ tone: 'success', title: 'Added to cart', text: product.name });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not add to cart', text: (e as Error).message });
    }
  };

  return (
    <motion.article
      className="ts-pcard"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <div className="ts-pcard__well">
        <Link to={`/product/${product.slug}`} aria-label={product.name} style={{ display: 'contents' }}>
          <img
            src={product.image?.md ?? PLACEHOLDER}
            alt={product.image?.altText ?? product.name}
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = PLACEHOLDER;
            }}
          />
        </Link>

        {product.discount ? (
          <span className="ts-pcard__flag">−{product.discount.percent}%</span>
        ) : product.isNew ? (
          <span className="ts-pcard__flag ts-pcard__flag--new">New</span>
        ) : null}

        <button
          type="button"
          className={`ts-pcard__wish ${inWishlist ? 'ts-pcard__wish--on' : ''}`}
          aria-label={inWishlist ? 'Remove from wishlist' : 'Save to wishlist'}
          title={inWishlist ? 'Remove from wishlist' : 'Save to wishlist'}
          onClick={() => void toggleWish(product.slug)}
        >
          <Heart size={15} fill={inWishlist ? 'currentColor' : 'none'} />
        </button>

        {onQuickView ? (
          <button type="button" className="ts-pcard__quick" onClick={() => onQuickView(product.slug)}>
            <Eye size={14} /> Quick view
          </button>
        ) : null}

        {outOfStock ? <div className="ts-pcard__oos"><span>Out of stock</span></div> : null}
      </div>

      <div className="ts-pcard__body">
        <div className="ts-pcard__eyebrow">{product.brand ?? product.subcategory.name}</div>
        <Link to={`/product/${product.slug}`} className="ts-pcard__title" style={{ color: 'inherit' }}>
          {product.name}
        </Link>

        <div className="ts-pcard__rating">
          {product.rating.count > 0 ? (
            <>
              <Stars value={product.rating.average} />
              <small>({product.rating.count})</small>
            </>
          ) : null}
        </div>

        <div className="ts-pcard__price">
          {product.priceMax ? <small>From</small> : null}
          {product.price.formatted}
          {product.wasPrice ? <span className="ts-pcard__was">{product.wasPrice.formatted}</span> : null}
        </div>

        <StockLine product={product} />

        <div className="ts-pcard__cta" style={{ marginTop: 'auto', paddingTop: 10 }}>
          <Button
            size="sm"
            block
            variant={outOfStock ? 'ghost' : 'primary'}
            disabled={outOfStock || busy}
            onClick={handleAdd}
          >
            {outOfStock ? 'Out of stock' : multi ? 'Choose options' : <><ShoppingCart size={14} /> Add to cart</>}
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

export { PLACEHOLDER };
