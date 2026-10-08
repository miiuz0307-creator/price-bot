import { type ReactNode, useEffect } from 'react';
import { AlertCircle, PackageOpen, RefreshCcw, X } from 'lucide-react';

export function formatDate(value: string | null | undefined) {
  if (!value) return 'עדיין אין נתונים';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function formatTime(value: string | null | undefined) {
  if (!value) return 'לא בוצעה בדיקה';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'משהו השתבש. נסו שוב בעוד רגע.';
  // API errors arrive as "HTTP 403 Forbidden: <message>"; show only the message.
  return error.message.replace(/^HTTP \d{3}[^:]*:\s*/u, '') || 'משהו השתבש. נסו שוב בעוד רגע.';
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:brightness-95 shadow-sm',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-[hsl(var(--accent)/.22)]',
    ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'bg-[hsl(var(--destructive)/.09)] text-destructive hover:bg-[hsl(var(--destructive)/.15)]',
  };
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'neutral' }) {
  const tones = {
    green: 'bg-[hsl(var(--primary)/.11)] text-primary',
    amber: 'bg-[hsl(var(--accent)/.22)] text-[hsl(30_65%_29%)]',
    red: 'bg-[hsl(var(--destructive)/.1)] text-destructive',
    neutral: 'bg-muted text-muted-foreground',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-foreground">
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse-soft rounded-lg bg-muted ${className}`} aria-hidden="true" />;
}

export function QueryError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm">
      <div className="flex items-center gap-3">
        <AlertCircle className="size-5 text-destructive" />
        <span>{message || 'לא הצלחנו לטעון את הנתונים.'}</span>
      </div>
      <Button variant="ghost" onClick={onRetry} data-testid="button-retry">
        <RefreshCcw className="size-4" /> נסו שוב
      </Button>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: typeof PackageOpen; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-secondary text-primary">
        <Icon className="size-7" />
      </div>
      <h3 className="text-lg font-extrabold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[.16em] text-primary">{eyebrow}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const scrollY = window.scrollY;
    const { body } = document;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 grid items-end bg-[hsl(var(--foreground)/.42)] p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="animate-rise-in max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:mx-auto sm:max-w-lg sm:rounded-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="text-xl font-extrabold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="סגירה" data-testid="button-close-modal">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
