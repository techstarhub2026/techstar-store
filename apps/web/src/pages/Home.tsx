import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Headphones, ShieldCheck, Smartphone, Truck,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import type { CategoryDto, MediaDto, Paged, ProductCard as ProductCardDto } from '../lib/types';
import { ProductCard, PLACEHOLDER } from '../components/ProductCard';
import { RailScroller } from '../components/RailScroller';
import { RecentlyViewedRail } from '../components/RecentlyViewedRail';
import { RecommendedRail } from '../components/RecommendedRail';
import { QuickView } from '../components/QuickView';
import { Button, CardSkeleton } from '../components/ui';

interface BannerDto {
  id: number;
  title: string;
  titleColor: string;
  subtitle: string | null;
  subtitleColor: string;
  backgroundColor: string;
  image: MediaDto | null;
  linkUrl: string | null;
  buttonText: string | null;
  buttonBackground: string;
  buttonTextColor: string;
}

function BannerCarousel() {
  const { data: banners = [], isLoading } = useQuery({
    queryKey: ['banners', 'home'],
    queryFn: () => api.get<BannerDto[]>('/banners?placement=home'),
    staleTime: 5 * 60_000,
  });
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  // Pausing on hover/focus makes the CTA and dots reachable, but AnimatePresence
  // remounts them every slide (they carry `key={b.id}`) — a focused element can
  // be removed from the DOM mid-transition without ever firing `blur`, which
  // used to leave a single boolean `paused` flag stuck `true` forever with no
  // way back in. Splitting hover and focus into their own booleans, driven by
  // focus tracked at the section level with `focusin`/`focusout` (which fire
  // even when the previously-focused node is gone) rather than React's
  // per-element onFocus/onBlur, means a stray unmount can desync at most one
  // of the two flags — the other still clears normally and autoplay resumes.
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onFocusIn = () => setFocused(true);
    const onFocusOut = (e: FocusEvent) => {
      // relatedTarget is the element gaining focus; if it's still inside the
      // carousel (e.g. moving between dots) stay paused, otherwise resume.
      if (!e.relatedTarget || !el.contains(e.relatedTarget as Node)) setFocused(false);
    };
    el.addEventListener('focusin', onFocusIn);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // Belt-and-braces: if the tab is backgrounded while paused for hover/focus,
  // the mouse/focus events that would normally clear those flags may never
  // fire (e.g. the user alt-tabs away mid-hover and releases the mouse
  // elsewhere). Clearing both on visibility return guarantees autoplay can
  // never stay stopped indefinitely.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setHovered(false);
        setFocused(false);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const paused = hovered || focused;

  useEffect(() => {
    if (paused || banners.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % banners.length), 6000);
    return () => clearInterval(t);
  }, [paused, banners.length]);

  if (isLoading) return <div className="ts-skel" style={{ height: 320 }} />;
  if (!banners.length) return null; // no placeholder band — the page just starts lower

  const b = banners[index % banners.length];

  return (
    <section
      ref={sectionRef}
      className="ts-banner"
      style={{ background: b.backgroundColor }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-roledescription="carousel"
      aria-label="Promotions"
    >
      <div className="container py-4 py-lg-5" style={{ overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={b.id}
            className="ts-banner__slide"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <div style={{ padding: '8px 0' }}>
              <h1 className="ts-banner__title" style={{ color: b.titleColor }}>{b.title}</h1>
              {b.subtitle ? (
                <p className="ts-banner__sub d-none d-lg-block" style={{ color: b.subtitleColor }}>
                  {b.subtitle}
                </p>
              ) : null}
              {b.buttonText && b.linkUrl ? (
                b.linkUrl.startsWith('/') ? (
                  <Link
                    to={b.linkUrl}
                    className="ts-btn"
                    style={{ background: b.buttonBackground, color: b.buttonTextColor }}
                  >
                    {b.buttonText}
                  </Link>
                ) : (
                  <a
                    href={b.linkUrl}
                    className="ts-btn"
                    style={{ background: b.buttonBackground, color: b.buttonTextColor }}
                    rel="noopener noreferrer"
                  >
                    {b.buttonText}
                  </a>
                )
              ) : null}
            </div>
            <motion.div
              className="text-center"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.08 }}
            >
              <img src={b.image?.lg ?? PLACEHOLDER} alt="" />
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {banners.length > 1 ? (
        <>
          <button
            className="ts-banner__nav d-none d-md-grid"
            style={{ left: 12 }}
            aria-label="Previous slide"
            onClick={() => setIndex((i) => (i - 1 + banners.length) % banners.length)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="ts-banner__nav d-none d-md-grid"
            style={{ right: 12 }}
            aria-label="Next slide"
            onClick={() => setIndex((i) => (i + 1) % banners.length)}
          >
            <ChevronRight size={20} />
          </button>
          <div className="ts-banner__dots">
            {banners.map((_, i) => (
              <button
                key={i}
                className={`ts-banner__dot ${i === index ? 'ts-banner__dot--on' : ''}`}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Rail({
  title,
  lead,
  queryKey,
  params,
  viewAll,
  onQuickView,
}: {
  title: string;
  lead?: string;
  queryKey: string;
  params: Record<string, unknown>;
  viewAll?: string;
  onQuickView?: (slug: string) => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['products', queryKey],
    queryFn: () => api.raw<Paged<ProductCardDto>>(`/products${qs({ pageSize: 18, ...params })}`),
    staleTime: 5 * 60_000,
  });

  if (isError) {
    return (
      <section className="ts-section">
        <div className="container">
          <h2 className="ts-section__title">{title}</h2>
          <div className="ts-panel d-flex justify-content-between align-items-center">
            <span>Could not load this section.</span>
            <Button size="sm" variant="secondary" onClick={() => void refetch()}>Retry</Button>
          </div>
        </div>
      </section>
    );
  }

  // A section heading with nothing under it is never rendered (spec §7.2.2).
  if (!isLoading && !data?.data.length) return null;

  return (
    <section className="ts-section">
      <div className="container">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '0px 0px -80px 0px' }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <h2 className="ts-section__title">{title}</h2>
          {lead ? <p className="ts-muted d-none d-md-block mb-3">{lead}</p> : null}
        </motion.div>
        <RailScroller>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
            : data!.data.map((p) => <ProductCard key={p.slug} product={p} onQuickView={onQuickView} />)}
        </RailScroller>
        {viewAll ? (
          <div className="text-center mt-4">
            <Link to={viewAll} className="ts-btn ts-btn--primary">View more</Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Partners() {
  const { data = [] } = useQuery({
    queryKey: ['partners'],
    queryFn: () => api.get<{ name: string; websiteUrl: string | null; logo: MediaDto | null }[]>('/partners'),
    staleTime: 30 * 60_000,
  });
  if (!data.length) return null;

  return (
    <section className="ts-section">
      <div className="container text-center">
        <h2 className="ts-section__title">Our partners</h2>
        <div className="d-flex justify-content-center flex-wrap gap-4 mt-4">
          {data.map((p) => (
            <a
              key={p.name}
              href={p.websiteUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{ width: 130, color: 'inherit' }}
            >
              <img
                src={p.logo?.md ?? PLACEHOLDER}
                alt={p.name}
                style={{ width: 96, height: 96, objectFit: 'contain', filter: 'grayscale(1)' }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLImageElement).style.filter = 'none')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLImageElement).style.filter = 'grayscale(1)')}
              />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The four promises shoppers look for before trusting an unfamiliar store. */
function TrustStrip() {
  const items = [
    { icon: <Truck size={22} />, title: 'Nationwide delivery', text: 'Dar es Salaam & all regions' },
    { icon: <ShieldCheck size={22} />, title: 'Genuine parts', text: 'Sourced from trusted suppliers' },
    { icon: <Smartphone size={22} />, title: 'Mobile money', text: 'M-Pesa, Mixx, Airtel Money' },
    { icon: <Headphones size={22} />, title: 'Technical support', text: 'Talk to engineers who build' },
  ];
  return (
    <section className="ts-trust">
      <div className="container">
        <div className="ts-trust__grid">
          {items.map((i) => (
            <div className="ts-trust__item" key={i.title}>
              <span className="ts-trust__icon">{i.icon}</span>
              <div>
                <div className="ts-trust__title">{i.title}</div>
                <div className="ts-trust__text">{i.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Category entry points — the shortest path from landing to a filtered list. */
function CategoryTiles() {
  const { data = [] } = useQuery({
    queryKey: ['categories', 'home'],
    queryFn: () => api.get<CategoryDto[]>('/categories'),
    staleTime: 10 * 60_000,
  });
  if (!data.length) return null;

  return (
    <section className="ts-section">
      <div className="container">
        <h2 className="ts-section__title">Shop by category</h2>
        <p className="ts-muted d-none d-md-block mb-3">Find the right part faster — browse by what you are building.</p>
        <div className="ts-cattiles">
          {data.slice(0, 12).map((c) => (
            <Link key={c.slug} to={`/products/c/${c.slug}`} className="ts-cattile">
              <div className="ts-cattile__img">
                <img src={c.image?.md ?? PLACEHOLDER} alt="" loading="lazy" />
              </div>
              <div className="ts-cattile__name">{c.name}</div>
              <div className="ts-cattile__count">{c.productCount} items</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Closing conversion band — one clear next step for each visitor type. */
function PromoBand() {
  return (
    <section className="ts-promo">
      <div className="container">
        <div className="ts-promo__inner">
          <div>
            <h2 className="ts-promo__title">Building something bigger?</h2>
            <p className="ts-promo__text">
              Bulk orders for schools, labs and makerspaces — request a quotation and we will
              price the whole bill of materials for you.
            </p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <Link to="/contact" className="ts-btn ts-btn--primary ts-btn--lg">Request a quote</Link>
            <Link to="/products" className="ts-btn ts-btn--lg ts-promo__ghost">Browse catalogue</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  const [quickView, setQuickView] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'TechStar Store — STEM kits, components and tools in Tanzania';
  }, []);

  return (
    <>
      <BannerCarousel />
      <TrustStrip />
      <CategoryTiles />
      <Rail
        title="Hot-selling products"
        lead="What our customers buy most — proven parts that do the job."
        queryKey="bestSelling"
        params={{ sort: 'bestSelling' }}
        viewAll="/products?sort=bestSelling"
        onQuickView={setQuickView}
      />
      <Rail
        title="New arrivals"
        lead="The latest boards, modules and tools to reach our shelves."
        queryKey="newest"
        params={{ sort: 'newest' }}
        onQuickView={setQuickView}
      />
      <RecommendedRail onQuickView={setQuickView} />
      <PromoBand />
      <Rail
        title="Explore the catalogue"
        lead="TechStar Store supplies quality, affordable components, kits and instruments to students, hobbyists and practitioners across Tanzania."
        queryKey="random"
        params={{ sort: 'random' }}
        viewAll="/products"
        onQuickView={setQuickView}
      />
      <RecentlyViewedRail />
      <Partners />
      <QuickView slug={quickView} onClose={() => setQuickView(null)} />
    </>
  );
}
