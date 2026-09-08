import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecentlyViewed, type RecentlyViewedItem } from '../lib/recentlyViewed';
import { PLACEHOLDER } from './ProductCard';
import { RailScroller } from './RailScroller';

export function RecentlyViewedRail({ excludeSlug }: { excludeSlug?: string }) {
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    setItems(getRecentlyViewed(excludeSlug));
  }, [excludeSlug]);

  if (!items.length) return null;

  return (
    <section className="ts-section">
      <h2 className="ts-section__title">Recently viewed</h2>
      <RailScroller className="mt-3">
        {items.map((i) => (
          <Link key={i.slug} to={`/product/${i.slug}`} className="ts-pcard" style={{ color: 'inherit' }}>
            <div className="ts-pcard__well">
              <img src={i.image ?? PLACEHOLDER} alt={i.name} loading="lazy" />
            </div>
            <div className="ts-pcard__body">
              <div className="ts-pcard__title">{i.name}</div>
              <div className="ts-pcard__price">{i.price}</div>
            </div>
          </Link>
        ))}
      </RailScroller>
    </section>
  );
}
