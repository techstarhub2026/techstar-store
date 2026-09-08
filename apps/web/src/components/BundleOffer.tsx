import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import type { ProductCard as ProductCardDto, ProductDetail } from '../lib/types';
import { useCart, useUi } from '../stores';
import { Button } from './ui';
import { PLACEHOLDER } from './ProductCard';

/**
 * "Frequently bought together" — the current product plus the companions the
 * order history most strongly associates with it, added in a single action.
 * Only renders when the API found genuinely strong associations; a bundle
 * built from weak signals is worse than no bundle at all.
 */
export function BundleOffer({ product }: { product: ProductDetail }) {
  const add = useCart((s) => s.add);
  const busy = useCart((s) => s.busy);
  const toast = useUi((s) => s.toast);
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const { data: companions = [] } = useQuery({
    queryKey: ['bundle', product.slug],
    queryFn: () => api.get<ProductCardDto[]>(`/products/${product.slug}/bundle`),
  });

  const buyable = useMemo(
    () => companions.filter((c) => c.inStock && !c.hasVariants),
    [companions],
  );

  useEffect(() => {
    setChosen(buyable.map((c) => c.slug));
  }, [buyable]);

  if (!buyable.length) return null;

  const selfPrice = product.variants[0]?.price.amount ?? product.price.amount;
  const total = selfPrice + buyable
    .filter((c) => chosen.includes(c.slug))
    .reduce((sum, c) => sum + c.price.amount, 0);

  const currency = product.price.currency ?? 'TZS';
  const formattedTotal = `${currency} ${total.toLocaleString()}`;

  const addAll = async () => {
    setAdding(true);
    try {
      const selfSku = product.variants[0]?.sku;
      if (selfSku) await add(selfSku, 1);
      for (const c of buyable.filter((x) => chosen.includes(x.slug))) {
        await add(`${c.sku}01`, 1);
      }
      toast({ tone: 'success', title: `${chosen.length + 1} items added to cart` });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not add the bundle', text: (e as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const tile = (img: string | undefined, name: string) => (
    <div className="ts-bundle__tile">
      <img src={img ?? PLACEHOLDER} alt={name} loading="lazy" />
    </div>
  );

  return (
    <section className="ts-card p-4 mt-4">
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>Frequently bought together</h2>

      <div className="ts-bundle">
        <div className="ts-bundle__row">
          {tile(product.images[0]?.md ?? product.image?.md, product.name)}
          {buyable.map((c) => (
            <div key={c.slug} className="d-flex align-items-center gap-2">
              <Plus size={16} style={{ color: 'var(--ts-text-muted)', flexShrink: 0 }} />
              {tile(c.image?.md, c.name)}
            </div>
          ))}
        </div>

        <div className="ts-bundle__side">
          <ul className="ts-bundle__list">
            <li>
              <input type="checkbox" checked disabled aria-label="This item" />
              <span><strong>This item:</strong> {product.name}</span>
              <span className="ts-bundle__price">{product.price.formatted}</span>
            </li>
            {buyable.map((c) => (
              <li key={c.slug}>
                <input
                  type="checkbox"
                  checked={chosen.includes(c.slug)}
                  aria-label={`Include ${c.name}`}
                  onChange={(e) =>
                    setChosen((s) => (e.target.checked ? [...s, c.slug] : s.filter((x) => x !== c.slug)))
                  }
                />
                <span>{c.name}</span>
                <span className="ts-bundle__price">{c.price.formatted}</span>
              </li>
            ))}
          </ul>

          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mt-3">
            <div>
              <div className="ts-muted" style={{ fontSize: 12 }}>Total for {chosen.length + 1} items</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{formattedTotal}</div>
            </div>
            <Button onClick={() => void addAll()} loading={adding} disabled={busy}>
              Add all to cart
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
