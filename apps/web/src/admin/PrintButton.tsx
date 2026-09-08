import { Printer } from 'lucide-react';
import { Button } from '../components/ui';

/**
 * Sends the current admin screen to the printer. Print CSS strips the sidebar,
 * top bar and controls, and reveals `.ts-printhead` so the sheet carries a
 * title, the store name and the moment it was produced.
 */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button variant="ghost" size="sm" className="no-print" onClick={() => window.print()}>
      <Printer size={14} /> {label}
    </Button>
  );
}

/**
 * Letterhead for anything printed out of the admin. Uses the dark-ink logo,
 * since paper is white — the light variant used in the app chrome would come
 * out invisible.
 */
export function PrintHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="ts-printhead">
      <img src="/techstar-store-logo.png" alt="TechStar Store" className="ts-printhead__logo" />
      <div>
        <h1>{title}</h1>
        <p>
          TechStar Store{subtitle ? ` · ${subtitle}` : ''} · Printed {new Date().toLocaleString()}
        </p>
      </div>
    </div>
  );
}
