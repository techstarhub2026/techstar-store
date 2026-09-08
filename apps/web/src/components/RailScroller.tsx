import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Wraps a horizontally-scrolling `.ts-rail` with branded prev/next arrow
 * buttons instead of relying on the browser's own scrollbar — the native
 * scrollbar track/thumb is hidden in CSS, this is the only way to navigate
 * with a mouse (touch/trackpad drag still works as before).
 */
export function RailScroller({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const amount = Math.min(el.clientWidth * 0.8, 640) * dir;
    el.scrollBy({ left: amount, behavior: 'smooth' });
  };

  return (
    <div className="ts-rail-wrap">
      <button type="button" className="ts-rail-nav ts-rail-nav--prev" aria-label="Scroll left" onClick={() => scroll(-1)}>
        <ChevronLeft size={18} />
      </button>
      <div className={`ts-rail ${className ?? ''}`} ref={ref}>
        {children}
      </div>
      <button type="button" className="ts-rail-nav ts-rail-nav--next" aria-label="Scroll right" onClick={() => scroll(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
