import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProductCard as ProductCardDto } from '../lib/types';
import { getRecentlyViewed } from '../lib/recentlyViewed';
import { ProductCard } from './ProductCard';
import { RailScroller } from './RailScroller';
import { CardSkeleton } from './ui';

/**
 * Personalised picks. Signed-in shoppers are seeded server-side from their
 * order history; guests contribute the slugs their own browser remembers, so
 * the rail is useful before anyone has logged in.
 */
export function RecommendedRail({
  title = 'Recommended for you',
  lead = 'Picked from what you have been looking at and what customers buy together.',
  onQuickView,
}: {
  title?: string;
  lead?: string;
  onQuickView?: (slug: string) => void;
}) {
  const viewed = getRecentlyViewed().map((v) => v.slug).slice(0, 12);

  const { data = [], isLoading } = useQuery({
    queryKey: ['recommendations', viewed.join(',')],
    queryFn: () =>
      api.get<ProductCardDto[]>(
        `/recommendations${viewed.length ? `?viewed=${encodeURIComponent(viewed.join(','))}` : ''}`,
      ),
    staleTime: 5 * 60_000,
  });

  if (!isLoading && !data.length) return null;

  return (
    <section className="ts-section">
      <div className="container">
        <h2 className="ts-section__title">{title}</h2>
        <p className="ts-muted d-none d-md-block mb-3">{lead}</p>
        <RailScroller>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
            : data.map((p) => <ProductCard key={p.slug} product={p} onQuickView={onQuickView} />)}
        </RailScroller>
      </div>
    </section>
  );
}
