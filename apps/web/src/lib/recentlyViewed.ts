const KEY = 'ts_recently_viewed';
const MAX = 12;

export interface RecentlyViewedItem {
  slug: string;
  name: string;
  image: string | null;
  price: string;
}

/** Best-effort — recently viewed is a convenience, never worth breaking the page for. */
export function pushRecentlyViewed(item: RecentlyViewedItem) {
  try {
    const raw = localStorage.getItem(KEY);
    const list: RecentlyViewedItem[] = raw ? JSON.parse(raw) : [];
    const next = [item, ...list.filter((i) => i.slug !== item.slug)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function getRecentlyViewed(excludeSlug?: string): RecentlyViewedItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: RecentlyViewedItem[] = raw ? JSON.parse(raw) : [];
    return excludeSlug ? list.filter((i) => i.slug !== excludeSlug) : list;
  } catch {
    return [];
  }
}
