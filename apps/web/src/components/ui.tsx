import React, { useEffect, useRef, useId } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────── Button ──

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        'ts-btn',
        `ts-btn--${variant}`,
        size !== 'md' ? `ts-btn--${size}` : '',
        block ? 'ts-btn--block' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`ts-iconbtn ${active ? 'ts-iconbtn--active' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────── Field ──

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (id: string) => React.ReactNode;
}

export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  return (
    <div className="mb-3">
      {label ? (
        <label className="ts-label" htmlFor={id}>
          {label}
          {required ? <span aria-hidden style={{ color: 'var(--ts-danger)' }}> *</span> : null}
        </label>
      ) : null}
      {children(id)}
      {error ? (
        <div className="ts-error" role="alert">
          <AlertCircle size={13} aria-hidden /> {error}
        </div>
      ) : hint ? (
        <div className="ts-hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  error,
  hint,
  required,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(id) => (
        <input
          id={id}
          className={`ts-input ${error ? 'ts-input--error' : ''}`}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  error,
  hint,
  required,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string; error?: string; hint?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(id) => (
        <textarea
          id={id}
          className={`ts-textarea ${error ? 'ts-textarea--error' : ''}`}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      )}
    </Field>
  );
}

export function Select({
  label,
  error,
  hint,
  required,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string; error?: string; hint?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {(id) => (
        <select
          id={id}
          className={`ts-select ${error ? 'ts-select--error' : ''}`}
          aria-invalid={error ? true : undefined}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  description,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: string }) {
  const id = useId();
  return (
    <div className="d-flex gap-2 mb-3" style={{ alignItems: 'flex-start' }}>
      <input id={id} type="checkbox" style={{ marginTop: 4, width: 16, height: 16 }} {...rest} />
      <label htmlFor={id} style={{ fontSize: 14, cursor: 'pointer' }}>
        {label}
        {description ? <div className="ts-hint" style={{ marginTop: 2 }}>{description}</div> : null}
      </label>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── Badge ──

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'accent';
  children: React.ReactNode;
}) {
  return <span className={`ts-badge ts-badge--${tone}`}>{children}</span>;
}

export function StatusPill({ label, tone }: { label: string; tone: string }) {
  const map: Record<string, string> = {
    warning: 'warning', info: 'info', primary: 'primary',
    success: 'success', danger: 'danger', neutral: 'neutral',
  };
  return <Badge tone={(map[tone] ?? 'neutral') as never}>{label}</Badge>;
}

// ──────────────────────────────────────────────────────────── Modal ──

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    boxRef.current?.querySelector<HTMLElement>('input, button, select, textarea, a')?.focus();
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ts-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className={`ts-modal__box ${size !== 'md' ? `ts-modal__box--${size}` : ''}`} ref={boxRef}>
        {title ? (
          <div className="ts-modal__head">
            <h2>{title}</h2>
            <IconButton label="Close" onClick={onClose} style={{ color: '#fff' }}>
              <X size={18} />
            </IconButton>
          </div>
        ) : null}
        <div className="ts-modal__body">{children}</div>
        {footer ? <div className="ts-modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  requireTyping,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  requireTyping?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [typed, setTyped] = React.useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const blocked = Boolean(requireTyping) && typed.trim() !== requireTyping;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} disabled={blocked} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 14 }}>{message}</div>
      {requireTyping ? (
        <div className="mt-3">
          <TextInput
            label={`Type ${requireTyping} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>
      ) : null}
    </Modal>
  );
}

// ───────────────────────────────────────────────────── empty/loading ──

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ts-empty">
      {icon}
      <h3 style={{ fontSize: 17, margin: '0 0 6px' }}>{title}</h3>
      {description ? <p className="ts-muted" style={{ maxWidth: 460, margin: '0 auto 16px' }}>{description}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="ts-skel" style={{ height: h, width: w, ...style }} />;
}

export function CardSkeleton() {
  return (
    <div className="ts-pcard">
      <div className="ts-pcard__well"><Skeleton h={140} /></div>
      <div className="ts-pcard__body">
        <Skeleton h={10} w="60%" style={{ margin: '0 auto 8px' }} />
        <Skeleton h={12} style={{ marginBottom: 6 }} />
        <Skeleton h={12} w="70%" style={{ margin: '0 auto 10px' }} />
        <Skeleton h={14} w="40%" style={{ margin: '0 auto' }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── Pagination ──

export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;

  const pages: (number | '…')[] = [];
  const push = (n: number | '…') => pages.push(n);
  push(1);
  if (page > 3) push('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(pageCount - 1, page + 1); i += 1) push(i);
  if (page < pageCount - 2) push('…');
  if (pageCount > 1) push(pageCount);

  return (
    <nav aria-label="Pagination" className="d-flex justify-content-center align-items-center gap-1 mt-4">
      <Button variant="ghost" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
        <ChevronLeft size={16} />
      </Button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="ts-muted px-1">…</span>
        ) : (
          <Button
            key={p}
            size="sm"
            variant={p === page ? 'primary' : 'ghost'}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </Button>
        ),
      )}
      <Button variant="ghost" size="sm" onClick={() => onChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
        <ChevronRight size={16} />
      </Button>
    </nav>
  );
}

// ────────────────────────────────────────────────────────── RichText ──

/**
 * The single place HTML from the API is rendered. Nothing else in the app may
 * use dangerouslySetInnerHTML (spec §8.2). The server sanitises on write; this
 * strips again on render, because one point of sanitisation is one point of
 * failure.
 */
export function RichText({ html, className = '' }: { html: string; className?: string }) {
  const safe = React.useMemo(() => {
    if (!html) return '';
    return html
      .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[^>]*\/?>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript:/gi, '');
  }, [html]);
  return <div className={`ts-rich ${className}`} dangerouslySetInnerHTML={{ __html: safe }} />;
}

// ───────────────────────────────────────────────────────── Quantity ──

export function QuantityStepper({
  value,
  min = 1,
  max = 999,
  onChange,
  disabled,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="d-inline-flex align-items-center" style={{ border: '1px solid var(--ts-border)', borderRadius: 'var(--radius-sm)' }}>
      <button
        type="button"
        className="ts-iconbtn"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
      >
        −
      </button>
      <input
        type="number"
        className="ts-input"
        style={{ width: 64, textAlign: 'center', border: 0, minHeight: 34 }}
        value={value}
        min={min}
        max={max}
        aria-label="Quantity"
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.trunc(n))));
        }}
        disabled={disabled}
      />
      <button
        type="button"
        className="ts-iconbtn"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        title={value >= max ? `Only ${max} available` : undefined}
      >
        +
      </button>
    </div>
  );
}
