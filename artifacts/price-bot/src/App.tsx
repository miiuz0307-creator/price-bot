import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Mail,
  Smartphone,
  ArrowUpLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  ClipboardPaste,
  Download,
  Flame,
  Group,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  PackageOpen,
  Pencil,
  Phone,
  Plus,
  Power,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserRound,
  UsersRound,
  Webhook,
  Wifi,
  X,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey,
  getGetWhatsAppStatusQueryKey,
  getGetCurrentSessionQueryKey,
  getListAdminsQueryKey,
  getListLookupRequestsQueryKey,
  getListProductsQueryKey,
  getListTargetsQueryKey,
  useApproveLookupEstimate,
  useCreateAdmin,
  useConnectWhatsApp,
  useCreateProduct,
  useCreateTarget,
  useDeleteAdmin,
  useDeleteLookupRequest,
  useDeleteProduct,
  useDeleteTarget,
  useDisconnectWhatsApp,
  useGetDashboardSummary,
  useGetWhatsAppStatus,
  useListAdmins,
  useListLookupRequests,
  useListProducts,
  useListTargets,
  useListWhatsAppGroups,
  useReceiveWhatsAppMessage,
  useUpdateProduct,
  useUpdateTarget,
  useBootstrapOwnerCode,
  useGetAuthStatus,
  useGetCurrentSession,
  useListLoginAdmins,
  useLoginAdmin,
  useLogoutAdmin,
  useSetAdminCode,
  usePairWhatsApp,
  useRequestLoginCode,
  useVerifyLoginCode,
  useLoginWithPin,
  type Admin,
  type LookupRequest,
  type Product,
  type Target,
} from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/error-boundary';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, QueryError, Skeleton, formatDate, formatTime, getErrorMessage } from '@/components/app-ui';
import NotFound from '@/pages/not-found';
import AbbreviationsPage from '@/pages/abbreviations';
import SurgePage from '@/pages/surge';
import UsersPage from '@/pages/users';
import ActivityPage from '@/pages/activity';
import { SessionProvider, useCan, useSessionAdmin } from '@/lib/session';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import './index.css';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'סקירה', icon: LayoutDashboard },
  { href: '/products', label: 'מחירון', icon: ShoppingBag },
  { href: '/abbreviations', label: 'קיצורים', icon: Pencil },
  { href: '/surge', label: 'זמני עומס', icon: Flame },
  { href: '/targets', label: 'יעדים פעילים', icon: UsersRound },
  { href: '/admins', label: 'משתמשים והרשאות', icon: ShieldCheck },
  { href: '/activity', label: 'מערכת ופעילות', icon: Activity, permission: 'users.manage' as const },
  { href: '/settings', label: 'חיבור ו-webhook', icon: Settings2 },
];

function AppShell({ children, admin, onLogout }: { children: ReactNode; admin: Admin; onLogout: () => void }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const visibleNav = navItems.filter((item) => !item.permission || admin.role === 'owner' || admin.permissions.includes(item.permission));
  const activeItem = visibleNav.find((item) => item.href === location) || visibleNav[0];
  return (
    <div className="app-noise min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 right-0 z-30 flex w-[276px] flex-col border-l border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="mb-10 flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)} data-testid="link-brand">
            <span className="grid size-11 place-items-center rounded-[14px] bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_7px_0_hsl(35_94%_57%/.25)]">
              <MessageSquareText className="size-5" strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-lg font-extrabold leading-tight">מחירון בוואטסאפ</span>
              <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/55">control room</span>
            </span>
          </Link>
          <button type="button" className="grid size-9 place-items-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent md:hidden" onClick={() => setOpen(false)} aria-label="סגירת תפריט" data-testid="button-close-navigation">
            <X className="size-5" />
          </button>
        </div>
        <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">ניהול שוטף</div>
        <nav className="grid gap-1" aria-label="ניווט ראשי">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const selected = item.href === location;
            return (
              <Link
                href={item.href}
                key={item.href}
                onClick={() => setOpen(false)}
                className={`group flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-bold ${selected ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-sidebar-foreground/64 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}
                data-testid={`link-nav-${item.href === '/' ? 'dashboard' : item.href.slice(1)}`}
              >
                <Icon className={`size-[18px] ${selected ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-primary'}`} />
                <span>{item.label}</span>
                {selected && <ChevronLeft className="mr-auto size-4 text-sidebar-primary" />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold text-sidebar-foreground/70"><span className="size-2 rounded-full bg-sidebar-primary animate-pulse-soft" /> סביבת עבודה</div>
          <p className="text-sm font-extrabold">חנות שכונתית</p>
          <p className="mt-1 text-xs leading-5 text-sidebar-foreground/50">הבוט פעיל ומוכן לענות למחירים.</p>
        </div>
      </aside>
      {open && <button type="button" className="fixed inset-0 z-20 bg-foreground/35 md:hidden" onClick={() => setOpen(false)} aria-label="סגירת תפריט" data-testid="button-dismiss-navigation" />}
      <main className="min-h-[100dvh] md:mr-[276px]">
        <div className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8">
          <button type="button" className="grid size-10 place-items-center rounded-lg border border-border bg-card md:hidden" onClick={() => setOpen(true)} aria-label="פתיחת תפריט" data-testid="button-open-navigation"><Menu className="size-5" /></button>
          <div className="mr-auto flex items-center gap-3">
            <div className="hidden text-left sm:block"><p className="text-xs font-bold text-muted-foreground">אתם כאן</p><p className="text-sm font-extrabold">{activeItem.label}</p></div>
            <div className="hidden text-right sm:block"><p className="text-xs font-bold">{admin.label}</p><button onClick={onLogout} className="text-xs text-muted-foreground hover:text-foreground">יציאה / החלפת מנהל</button></div>
            <div className="grid size-10 place-items-center rounded-full bg-secondary text-primary"><UserRound className="size-4" /></div>
          </div>
        </div>
        <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

function Dashboard() {
  const client = useQueryClient();
  const summaryQuery = useGetDashboardSummary();
  const statusQuery = useGetWhatsAppStatus();
  const productsQuery = useListProducts();
  const targetsQuery = useListTargets();
  const lookupRequestsQuery = useListLookupRequests();
  const receive = useReceiveWhatsAppMessage();
  const createRequestedProduct = useCreateProduct();
  const approveEstimate = useApproveLookupEstimate();
  const dismissLookupRequest = useDeleteLookupRequest();
  const [message, setMessage] = useState({ from: '', body: '' });
  const [result, setResult] = useState<string | null>(null);
  const [selectedLookupRequest, setSelectedLookupRequest] = useState<LookupRequest | null>(null);
  const [quickProduct, setQuickProduct] = useState({ name: '', price: '' });
  const summary = summaryQuery.data;
  const status = statusQuery.data;
  const products = productsQuery.data || [];
  const targets = targetsQuery.data || [];
  const lookupRequests = lookupRequestsQuery.data || [];
  const activeTargets = targets.filter((target) => target.active);
  const recent = useMemo(() => [
    ...products.map((product) => ({ date: product.updatedAt, title: `עודכן מחיר ל${product.name}`, detail: `${product.price.toFixed(2)} ${product.currency}`, icon: ShoppingBag })),
    ...targets.map((target) => ({ date: target.addedAt, title: `נוסף יעד ${target.label}`, detail: target.kind === 'group' ? 'קבוצה' : 'איש קשר', icon: target.kind === 'group' ? Group : Phone })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5), [products, targets]);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!message.from.trim() || !message.body.trim()) return;
    setResult(null);
    receive.mutate({ data: message }, {
      onSuccess: (data) => { setResult(data.matched ? `נמצאה התאמה. תשובת הבוט: ${data.responseText}` : `לא נמצאה התאמה. תשובת הבוט: ${data.responseText}`); setMessage((current) => ({ ...current, body: '' })); },
      onError: (error) => setResult(getErrorMessage(error)),
    });
  };
  const openQuickAdd = (request: LookupRequest) => {
    setSelectedLookupRequest(request);
    setQuickProduct({ name: request.query, price: '' });
    setResult(null);
  };
  const saveRequestedProduct = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedLookupRequest) return;
    const name = quickProduct.name.trim();
    const price = Number(quickProduct.price);
    if (!name || Number.isNaN(price) || price < 0) {
      setResult('מלאו שם ומחיר תקינים לפני שמירה.');
      return;
    }
    createRequestedProduct.mutate({
      data: {
        name,
        price,
        currency: 'ILS',
        aliases: [...new Set([name, selectedLookupRequest.query.trim()])],
        active: true,
      },
    }, {
      onSuccess: () => {
        dismissLookupRequest.mutate({ id: selectedLookupRequest.id }, {
          onSettled: () => {
            client.invalidateQueries({ queryKey: getListLookupRequestsQueryKey() });
            client.invalidateQueries({ queryKey: getListProductsQueryKey() });
            client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            setSelectedLookupRequest(null);
            setResult('המוצר נוסף למחירון ויהיה זמין לבוט מיד.');
          },
        });
      },
      onError: (error) => setResult(getErrorMessage(error)),
    });
  };
  const dismissRequest = (request: LookupRequest) => dismissLookupRequest.mutate({ id: request.id }, {
    onSuccess: () => client.invalidateQueries({ queryKey: getListLookupRequestsQueryKey() }),
    onError: (error) => setResult(getErrorMessage(error)),
  });
  const approveRequest = (request: LookupRequest) => {
    if (!request.estimate || !window.confirm(`לאשר את ההערכה ל־${request.estimate.name} ולהוסיף אותה למחירון הקבוע? מחירים קיימים לא ישתנו.`)) return;
    setResult(null);
    approveEstimate.mutate({ id: request.id }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: getListLookupRequestsQueryKey() });
        client.invalidateQueries({ queryKey: getListProductsQueryKey() });
        client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setResult(`המסלול ${request.estimate!.name} נוסף למחירון. מחירים קיימים לא השתנו.`);
      },
      onError: (error) => setResult(getErrorMessage(error)),
    });
  };
  const isLoading = summaryQuery.isLoading || statusQuery.isLoading;
  return (
    <div className="animate-rise-in">
      <PageHeader eyebrow="לוח בקרה / היום" title="בוקר טוב, זה חדר הבקרה שלך." description="מחירים מדויקים, לקוחות מחוברים, ופחות שאלות שחוזרות על עצמן." action={<Link href="/products" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm hover:brightness-95" data-testid="link-dashboard-products"><ShoppingBag className="size-4" /> ניהול מחירון <ArrowUpLeft className="size-4" /></Link>} />
      {summaryQuery.isError ? <QueryError message={getErrorMessage(summaryQuery.error)} onRetry={() => summaryQuery.refetch()} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="מוצרים במחירון" value={isLoading ? undefined : summary?.productCount} detail={isLoading ? 'טוען נתונים' : `${summary?.activeProductCount ?? 0} פעילים כרגע`} icon={ShoppingBag} tone="green" />
            <StatCard label="יעדים פעילים" value={targetsQuery.isLoading ? undefined : activeTargets.length} detail="אנשים וקבוצות שמקבלים מענה" icon={UsersRound} tone="amber" />
            <StatCard label="חיפושי מחיר" value={isLoading ? undefined : summary?.lookupCount} detail={summary?.lastLookupAt ? `אחרון ב־${formatTime(summary.lastLookupAt)}` : 'הבוט עדיין מחכה לחיפוש'} icon={MessageSquareText} tone="teal" />
            <StatCard label="חיבור WhatsApp" value={statusQuery.isLoading ? undefined : status?.connected ? 'מחובר' : 'מנותק'} detail={status?.phoneNumber || 'לא הוגדר מספר'} icon={Wifi} tone={status?.connected ? 'green' : 'red'} />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_.85fr]">
            <section className="rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div><h2 className="font-extrabold">פעילות אחרונה</h2><p className="mt-1 text-xs text-muted-foreground">השינויים האחרונים במחירון וביעדים</p></div>
                <Clock3 className="size-5 text-muted-foreground" />
              </div>
              {recent.length === 0 ? <div className="p-6"><EmptyState icon={Clock3} title="הפעילות תופיע כאן" description="כשתוסיפו מוצר או יעד, נראה כאן את העדכון האחרון." /></div> : <div className="divide-y divide-border">{recent.map((item, index) => { const Icon = item.icon; return <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={`${item.title}-${index}`} data-testid={`activity-${index}`}><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p></div><span className="shrink-0 text-xs text-muted-foreground">{formatDate(item.date)}</span></div>; })}</div>}
            </section>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-start justify-between"><div><h2 className="font-extrabold">בדיקת הודעה</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">שלחו הודעה לדוגמה ובדקו את תשובת הבוט.</p></div><div className="grid size-10 place-items-center rounded-xl bg-[hsl(var(--accent)/.22)] text-[hsl(30_65%_29%)]"><Send className="size-4" /></div></div>
              <form onSubmit={sendMessage} className="grid gap-3">
                <Field label="מספר שולח"><input value={message.from} onChange={(event) => setMessage({ ...message, from: event.target.value })} placeholder="972501234567" className="input-base font-mono" dir="ltr" data-testid="input-message-from" /></Field>
                <Field label="תוכן ההודעה"><input value={message.body} onChange={(event) => setMessage({ ...message, body: event.target.value })} placeholder="כמה עולה קפה?" className="input-base" data-testid="input-message-body" /></Field>
                <Button type="submit" disabled={receive.isPending} className="mt-1 w-full" data-testid="button-send-message"><Send className="size-4" /> {receive.isPending ? 'בודק…' : 'שליחת בדיקה'}</Button>
              </form>
              {result && <div className={`mt-4 rounded-xl p-3 text-sm leading-6 ${result.includes('משהו השתבש') ? 'bg-[hsl(var(--destructive)/.08)] text-destructive' : 'bg-secondary text-secondary-foreground'}`} data-testid="status-message-result">{result}</div>}
            </section>
          </div>
          <section className="mt-6 rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <div><h2 className="font-extrabold">הערכות ובקשות לאישור</h2><p className="mt-1 text-xs text-muted-foreground">הערכות שנשלחו למבקשים אינן חלק מהמחירון עד לאישור שלך. גם בקשות ללא הערכה מופיעות כאן.</p></div>
              <Badge tone={lookupRequests.length ? 'amber' : 'green'}>{lookupRequests.length ? `${lookupRequests.length} ממתינות` : 'אין בקשות פתוחות'}</Badge>
            </div>
            {lookupRequestsQuery.isLoading ? <div className="grid gap-3 p-5 sm:p-6"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : lookupRequestsQuery.isError ? <div className="p-5 sm:p-6"><QueryError message={getErrorMessage(lookupRequestsQuery.error)} onRetry={() => lookupRequestsQuery.refetch()} /></div> : lookupRequests.length === 0 ? <div className="p-5 text-sm text-muted-foreground sm:p-6">אין כרגע הערכות או בקשות שממתינות לאישור.</div> : (
              <div className="divide-y divide-border">
                {lookupRequests.map((request) => (
                  <div className="flex flex-col gap-3 px-5 py-4 sm:px-6" key={request.id} data-testid={`lookup-request-${request.id}`}>
                    <div><p className="font-extrabold">„{request.query}”</p><p className="mt-1 text-xs text-muted-foreground">התקבל ב־{formatTime(request.createdAt)} · שולח/ת {request.from}</p></div>
                    {request.estimate && (
                      <div className="rounded-xl border border-border bg-secondary/50 p-3 text-sm" data-testid={`estimate-request-${request.id}`}>
                        <p className="font-bold">הערכה שנשלחה: {request.estimate.name} · {request.estimate.distanceKm.toLocaleString('he-IL', { maximumFractionDigits: 1 })} ק״מ</p>
                        <p className="mt-1 text-xs text-muted-foreground">מרחק לפי Google Maps; המחירים הם הערכה בלבד ועדיין לא נוספו למחירון.</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {['4 מק׳', '4 מק׳ הלוך ושוב', '6 מק׳ קטן', '6 קטן הלוך ושוב', '6 מק׳ מרווח', '6 מרווח הלוך ושוב', '7 מק׳', '7 מק׳ הלוך ושוב'].map((label, index) => (
                            <div key={label} className="rounded-lg bg-card p-2"><span className="block text-xs text-muted-foreground">{label}</span><strong>{request.estimate!.priceMatrix[index] ? `₪${request.estimate!.priceMatrix[index].toLocaleString('he-IL')}` : 'לא ניתן להעריך'}</strong></div>
                          ))}
                        </div>
                        <p className="mt-3 text-xs font-bold">⏳ המתנה בצדדים: {request.estimate.waitTime || 'לא ניתן להעריך'}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {request.estimate ? <Button onClick={() => approveRequest(request)} disabled={approveEstimate.isPending || request.estimate.priceMatrix.some((price) => price <= 0)} data-testid={`button-approve-request-${request.id}`}><Check className="size-4" /> אישור והוספה למחירון</Button> : <Button onClick={() => openQuickAdd(request)} data-testid={`button-add-request-${request.id}`}><Plus className="size-4" /> הוספת מחיר ידנית</Button>}
                      <Button variant="ghost" onClick={() => dismissRequest(request)} disabled={dismissLookupRequest.isPending} data-testid={`button-dismiss-request-${request.id}`}>סגירה ללא הוספה</Button>
                    </div>
                    {request.estimate?.priceMatrix.some((price) => price <= 0) && <p className="text-xs text-muted-foreground">חסרים מחירי השוואה במחירון. יש להזין מחיר מלא ידנית לפני אישור מסלול זה.</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <div className="mt-6 flex flex-col gap-4 rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-start gap-3"><div className="mt-0.5 grid size-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><CheckCircle2 className="size-5" /></div><div><p className="font-extrabold">הבוט {status?.connected ? 'מחובר ומוכן לעבודה' : 'ממתין לחיבור'}</p><p className="mt-1 text-xs text-sidebar-foreground/60">{status?.webhookConfigured ? 'ה-webhook מוגדר ומקבל הודעות.' : 'כדאי להשלים את הגדרת ה-webhook כדי לקבל הודעות.'}</p></div></div><Link href="/settings" className="inline-flex items-center gap-2 text-sm font-bold text-sidebar-primary hover:text-sidebar-primary/80" data-testid="link-dashboard-settings">בדיקת חיבור <ChevronLeft className="size-4" /></Link>
          </div>
          {selectedLookupRequest && <Modal title="הוספת מחיר מבקשת לקוח" description={`הבקשה „${selectedLookupRequest.query}” תישמר גם ככינוי כדי שהבוט יבין אותה בפעם הבאה.`} onClose={() => setSelectedLookupRequest(null)}><form onSubmit={saveRequestedProduct} className="grid gap-4"><Field label="שם המוצר או המסלול"><input autoFocus required value={quickProduct.name} onChange={(event) => setQuickProduct({ ...quickProduct, name: event.target.value })} className="input-base" data-testid="input-request-product-name" /></Field><Field label="מחיר"><input required type="number" min="0" step="0.01" value={quickProduct.price} onChange={(event) => setQuickProduct({ ...quickProduct, price: event.target.value })} className="input-base font-mono" dir="ltr" placeholder="0.00" data-testid="input-request-product-price" /></Field><div className="mt-2 flex gap-2"><Button type="submit" disabled={createRequestedProduct.isPending} className="flex-1" data-testid="button-save-request-product"><Check className="size-4" /> {createRequestedProduct.isPending ? 'שומר…' : 'הוספה למחירון'}</Button><Button type="button" variant="secondary" onClick={() => setSelectedLookupRequest(null)} data-testid="button-cancel-request-product">ביטול</Button></div></form></Modal>}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, detail, icon: Icon, tone }: { label: string; value?: number | string; detail: string; icon: typeof ShoppingBag; tone: 'green' | 'amber' | 'teal' | 'red' }) {
  const colors = { green: 'bg-[hsl(var(--primary)/.12)] text-primary', amber: 'bg-[hsl(var(--accent)/.2)] text-[hsl(30_65%_29%)]', teal: 'bg-[hsl(194_50%_40%/.12)] text-[hsl(194_50%_30%)]', red: 'bg-[hsl(var(--destructive)/.1)] text-destructive' };
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-5 flex items-start justify-between gap-3"><p className="text-sm font-bold text-muted-foreground">{label}</p><div className={`grid size-10 place-items-center rounded-xl ${colors[tone]}`}><Icon className="size-[18px]" /></div></div>{value === undefined ? <Skeleton className="h-8 w-20" /> : <p className="font-mono text-3xl font-bold tracking-tight" data-testid={`stat-${label}`}>{value}</p>}<p className="mt-2 text-xs text-muted-foreground">{detail}</p></div>;
}

type ProductForm = { name: string; price: string; currency: string; aliases: string; active: boolean };
const blankProduct: ProductForm = { name: '', price: '', currency: 'ILS', aliases: '', active: true };

function normalizedProductName(value: string) {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => part === 'בב' ? 'בני ברק' : part)
    .join(' ')
    .toLocaleLowerCase('he-IL')
    .normalize('NFD')
    .replace(/[\u0591-\u05c7]/g, '')
    .replace(/[ךםןףץ]/g, (letter) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function parsePastedPriceMessage(text: string) {
  const baseSection = text.split(/תוספת שכונות/u)[0] || text;
  const clean = (value: string | undefined) => (value || '').replace(/[*_`]/g, '').trim();
  const route = clean(baseSection.match(/🗺️\s*\*?([^\n*]+)\*?/u)?.[1]).replace('↔', '⇔');
  const prices = [...baseSection.matchAll(/₪\s*([\d,.]+)/gu)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
  if (!route) throw new Error('לא מצאתי בהודעה שם מסלול או אזור בשורה שמתחילה ב־🗺️.');
  if (prices.length < 8) throw new Error('לא מצאתי שמונה מחירים: 4 מקומות, 6 קטן, 6 מרווח ו־7 מקומות כולל צדדים.');
  const field = (label: string) => clean(baseSection.match(new RegExp(`${label}\\s*-\\s*\\*?\\s*([^\\n]+)`, 'u'))?.[1]);
  const aliases = [...text.matchAll(/(?:לא מצאתי תשובה\s*ל|תיקנתי ל)\s*:\s*([^\n]+)/gu)]
    .map((match) => clean(match[1]))
    .filter(Boolean);
  return {
    name: route,
    price: prices[0],
    currency: 'ILS',
    aliases: [...new Set(aliases)],
    distance: field('מרחק משוער'),
    duration: field('זמן משוער'),
    level: field('סוג מחירון'),
    priceMatrix: prices.slice(0, 8),
    waitTime: field('המתנה בצדדים'),
    active: true,
  };
}

function ProductsPage() {
  const query = useListProducts();
  const products = query.data || [];
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const client = useQueryClient();
  const canEdit = useCan('catalog.edit');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [modal, setModal] = useState(false);
  const [pasteModal, setPasteModal] = useState(false);
  const [pastedMessage, setPastedMessage] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(blankProduct);
  const [feedback, setFeedback] = useState<string | null>(null);
  const visible = products.filter((product) => {
    const term = search.toLowerCase();
    const matchesSearch = !term || product.name.toLowerCase().includes(term) || product.aliases.some((alias) => alias.toLowerCase().includes(term));
    return matchesSearch && (filter === 'all' || (filter === 'active' ? product.active : !product.active));
  });
  const openCreate = () => { setEditing(null); setForm(blankProduct); setFeedback(null); setModal(true); };
  const openEdit = (product: Product) => { setEditing(product); setForm({ name: product.name, price: String(product.price), currency: product.currency, aliases: product.aliases.join(', '), active: product.active }); setFeedback(null); setModal(true); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data = { name: form.name.trim(), price: Number(form.price), currency: form.currency.trim() || 'ILS', aliases: form.aliases.split(',').map((alias) => alias.trim()).filter(Boolean), active: form.active };
    if (!data.name || Number.isNaN(data.price) || data.price < 0) { setFeedback('מלאו שם ומחיר תקינים לפני שמירה.'); return; }
    const onSuccess = () => { client.invalidateQueries({ queryKey: getListProductsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setModal(false); setFeedback('המוצר נשמר בהצלחה.'); };
    if (editing) update.mutate({ id: editing.id, data }, { onSuccess, onError: (error) => setFeedback(getErrorMessage(error)) }); else create.mutate({ data }, { onSuccess, onError: (error) => setFeedback(getErrorMessage(error)) });
  };
  const importPastedMessage = () => {
    try {
      const parsed = parsePastedPriceMessage(pastedMessage);
      const parsedName = normalizedProductName(parsed.name);
      const existing = products.find((product) => normalizedProductName(product.name) === parsedName);
      const data = {
        ...parsed,
        aliases: parsed.aliases.length ? parsed.aliases : (existing?.aliases || []),
      };
      const onSuccess = () => {
        client.invalidateQueries({ queryKey: getListProductsQueryKey() });
        client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setPasteModal(false);
        setPastedMessage('');
        setFeedback(existing ? `המחיר של ${data.name} עודכן בהצלחה.` : `המסלול ${data.name} נוסף למחירון בהצלחה.`);
      };
      if (existing) {
        update.mutate({ id: existing.id, data }, { onSuccess, onError: (error) => setFeedback(getErrorMessage(error)) });
      } else {
        create.mutate({ data }, { onSuccess, onError: (error) => setFeedback(getErrorMessage(error)) });
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'לא הצלחתי לקרוא את ההודעה.');
    }
  };
  const toggle = (product: Product) => update.mutate({ id: product.id, data: { active: !product.active } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListProductsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); }, onError: (error) => setFeedback(getErrorMessage(error)) });
  const deleteProduct = (product: Product) => { if (window.confirm(`למחוק את ${product.name} מהמחירון?`)) remove.mutate({ id: product.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListProductsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); }, onError: (error) => setFeedback(getErrorMessage(error)) }); };
  const downloadBackup = () => {
    const exportedAt = new Date();
    const backup = {
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      productCount: products.length,
      products,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `price-bot-backup-${exportedAt.toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFeedback(`הגיבוי ירד בהצלחה עם ${products.length} מחירים.`);
  };
  return <div className="animate-rise-in"><PageHeader eyebrow="מחירון / מוצרים" title="המחירון שעונה במקומך." description="שמרו על שמות ברורים, כינויים שהלקוחות באמת משתמשים בהם, ומחירים שאפשר לסמוך עליהם." action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={downloadBackup} disabled={query.isLoading || query.isError} data-testid="button-backup-products"><Download className="size-4" /> גיבוי נתונים</Button>{canEdit && <><Button variant="secondary" onClick={() => { setFeedback(null); setPastedMessage(''); setPasteModal(true); }} data-testid="button-paste-product"><ClipboardPaste className="size-4" /> הדבקת הודעה</Button><Button onClick={openCreate} data-testid="button-add-product"><Plus className="size-4" /> מוצר חדש</Button></>}</div>} />
    {feedback && <div className="mb-5 flex items-center justify-between rounded-xl bg-secondary px-4 py-3 text-sm font-bold" data-testid="status-products-feedback"><span>{feedback}</span><button onClick={() => setFeedback(null)} aria-label="סגירת הודעה" data-testid="button-dismiss-products-feedback"><X className="size-4" /></button></div>}
    <div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש לפי מוצר או כינוי…" className="input-base w-full pr-10" data-testid="input-search-products" /></div><div className="flex rounded-lg border border-border bg-card p-1">{[['all', 'הכל'], ['active', 'פעילים'], ['paused', 'מושהים']].map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value as typeof filter)} className={`rounded-md px-3 py-2 text-xs font-bold ${filter === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-products-${value}`}>{label}</button>)}</div></div>
    {query.isLoading ? <div className="grid gap-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-[84px]" />)}</div> : query.isError ? <QueryError message={getErrorMessage(query.error)} onRetry={() => query.refetch()} /> : visible.length === 0 ? <EmptyState icon={PackageOpen} title={search || filter !== 'all' ? 'לא נמצאו מוצרים' : 'המחירון עדיין ריק'} description={search || filter !== 'all' ? 'נסו לשנות את החיפוש או הסינון.' : 'הוסיפו את המוצר הראשון כדי שהבוט יוכל להתחיל לענות.'} action={!search && filter === 'all' ? <Button onClick={openCreate} data-testid="button-empty-add-product"><Plus className="size-4" /> הוספת מוצר</Button> : undefined} /> : <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="hidden grid-cols-[1.6fr_1fr_1fr_110px_90px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 text-xs font-bold text-muted-foreground md:grid"><span>מוצר</span><span>כינויים</span><span>מחיר</span><span>עודכן</span><span>מצב</span></div><div className="divide-y divide-border">{visible.map((product) => <ProductRow key={product.id} product={product} onEdit={openEdit} onToggle={toggle} onDelete={deleteProduct} readOnly={!canEdit} />)}</div></div>}
    {modal && <Modal title={editing ? 'עריכת מוצר' : 'מוצר חדש'} description="הבוט משתמש בשם ובכינויים כדי לזהות את השאלה." onClose={() => setModal(false)}><form onSubmit={submit} className="grid gap-4"><Field label="שם המוצר"><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="input-base" placeholder="למשל: קפה הפוך" data-testid="input-product-name" /></Field><div className="grid grid-cols-[1fr_88px] gap-3"><Field label="מחיר"><input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className="input-base font-mono" dir="ltr" placeholder="18.50" data-testid="input-product-price" /></Field><Field label="מטבע"><input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} className="input-base text-center" data-testid="input-product-currency" /></Field></div><Field label="כינויים" hint="הפרידו בין כינויים בפסיק"><input value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} className="input-base" placeholder="הפוך, קפה עם חלב" data-testid="input-product-aliases" /></Field><label className="flex cursor-pointer items-center justify-between rounded-xl bg-secondary/60 p-3 text-sm font-bold"><span>המוצר זמין לבוט</span><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-[hsl(var(--primary))]" data-testid="input-product-active" /></label>{feedback && <p className="text-sm font-bold text-destructive" data-testid="status-product-form">{feedback}</p>}<div className="mt-2 flex gap-2"><Button type="submit" disabled={create.isPending || update.isPending} className="flex-1" data-testid="button-save-product"><Check className="size-4" /> {create.isPending || update.isPending ? 'שומר…' : 'שמירת מוצר'}</Button><Button type="button" variant="secondary" onClick={() => setModal(false)} data-testid="button-cancel-product">ביטול</Button></div></form></Modal>}
    {pasteModal && <Modal title="הוספה מהודעת מחירון" description="הדביקו את כל ההודעה. המסלול, המחירים, המרחק, הזמן וההמתנה ייקלטו אוטומטית." onClose={() => setPasteModal(false)}><div className="grid gap-4"><Field label="הודעת המחירון"><textarea autoFocus value={pastedMessage} onChange={(event) => setPastedMessage(event.target.value)} className="input-base min-h-72 resize-y font-mono text-xs leading-6" placeholder="הדביקו כאן את הודעת המחירון…" data-testid="input-pasted-price-message" /></Field>{feedback && <p className="text-sm font-bold text-destructive" data-testid="status-pasted-price-message">{feedback}</p>}<div className="flex gap-2"><Button type="button" onClick={importPastedMessage} disabled={!pastedMessage.trim() || create.isPending || update.isPending} className="flex-1" data-testid="button-import-pasted-price"><ClipboardPaste className="size-4" /> {create.isPending || update.isPending ? 'מכניס למחירון…' : 'הכנסה למחירון'}</Button><Button type="button" variant="secondary" onClick={() => setPasteModal(false)}>ביטול</Button></div></div></Modal>}
  </div>;
}

function ProductRow({ product, onEdit, onToggle, onDelete, readOnly = false }: { product: Product; onEdit: (product: Product) => void; onToggle: (product: Product) => void; onDelete: (product: Product) => void; readOnly?: boolean }) {
  return <div className="grid items-center gap-3 px-4 py-4 sm:px-5 md:grid-cols-[1.6fr_1fr_1fr_110px_90px] md:gap-4"><div className="flex items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><PackageOpen className="size-[18px]" /></div><div className="min-w-0"><p className="truncate text-sm font-extrabold" data-testid={`text-product-name-${product.id}`}>{product.name}</p><p className="mt-0.5 text-xs text-muted-foreground md:hidden">{product.price.toFixed(2)} {product.currency}</p></div></div><div className="hidden min-w-0 md:block">{product.aliases.length ? <div className="flex flex-wrap gap-1">{product.aliases.slice(0, 2).map((alias) => <span key={alias} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{alias}</span>)}</div> : <span className="text-xs text-muted-foreground">אין כינויים</span>}</div><div className="hidden font-mono text-sm font-bold md:block" dir="ltr" data-testid={`text-product-price-${product.id}`}>{product.price.toFixed(2)} {product.currency}</div><div className="hidden text-xs text-muted-foreground md:block">{formatDate(product.updatedAt)}</div><div className="flex items-center justify-between gap-2 md:justify-end"><Badge tone={product.active ? 'green' : 'neutral'}>{product.active ? 'פעיל' : 'מושהה'}</Badge><div className={`flex gap-1 ${readOnly ? 'hidden' : ''}`}><button type="button" onClick={() => onToggle(product)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={product.active ? 'השהיית מוצר' : 'הפעלת מוצר'} data-testid={`button-toggle-product-${product.id}`}><Power className="size-4" /></button><button type="button" onClick={() => onEdit(product)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="עריכת מוצר" data-testid={`button-edit-product-${product.id}`}><Pencil className="size-4" /></button><button type="button" onClick={() => onDelete(product)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--destructive)/.1)] hover:text-destructive" aria-label="מחיקת מוצר" data-testid={`button-delete-product-${product.id}`}><Trash2 className="size-4" /></button></div></div></div>;
}

type TargetForm = { kind: 'contact' | 'group'; identifier: string; label: string };
function TargetsPage() {
  const canManageTargets = useCan('targets.manage');
  const query = useListTargets();
  const groupsQuery = useListWhatsAppGroups();
  const targets = query.data || [];
  const groups = groupsQuery.data || [];
  const create = useCreateTarget();
  const update = useUpdateTarget();
  const remove = useDeleteTarget();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'contact' | 'group'>('all');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<TargetForm>({ kind: 'contact', identifier: '', label: '' });
  const [feedback, setFeedback] = useState<string | null>(null);
  const visible = targets.filter((target) => (!search || `${target.label} ${target.identifier}`.toLowerCase().includes(search.toLowerCase())) && (kind === 'all' || target.kind === kind));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.identifier.trim() || !form.label.trim()) { setFeedback('מלאו מזהה ותווית לפני שמירה.'); return; }
    create.mutate({ data: { kind: form.kind, identifier: form.identifier.trim(), label: form.label.trim() } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListTargetsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setModal(false); setFeedback('היעד נוסף בהצלחה.'); }, onError: (error) => setFeedback(getErrorMessage(error)) });
  };
  const toggle = (target: Target) => update.mutate({ id: target.id, data: { active: !target.active } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListTargetsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); }, onError: (error) => setFeedback(getErrorMessage(error)) });
  const removeTarget = (target: Target) => { if (window.confirm(`להסיר את ${target.label} מרשימת היעדים?`)) remove.mutate({ id: target.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListTargetsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); }, onError: (error) => setFeedback(getErrorMessage(error)) }); };
  return <div className="animate-rise-in"><PageHeader eyebrow="היעדים הפרטיים שלכם / הרשאות" title="אתם מחליטים מי מקבל מענה." description="רשימה זו פרטית למנהל המחובר: הפעילו את הבוט רק עבור אנשי הקשר והקבוצות שלכם. שינוי מצב נכנס לתוקף מיד." action={canManageTargets ? <Button onClick={() => { setForm({ kind: 'contact', identifier: '', label: '' }); setFeedback(null); setModal(true); }} data-testid="button-add-target"><Plus className="size-4" /> יעד חדש</Button> : undefined} />
    {feedback && <div className="mb-5 rounded-xl bg-secondary px-4 py-3 text-sm font-bold" data-testid="status-targets-feedback">{feedback}</div>}
    <div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש יעד…" className="input-base w-full pr-10" data-testid="input-search-targets" /></div><div className="flex rounded-lg border border-border bg-card p-1">{[['all', 'הכל'], ['contact', 'אנשי קשר'], ['group', 'קבוצות']].map(([value, label]) => <button type="button" key={value} onClick={() => setKind(value as typeof kind)} className={`rounded-md px-3 py-2 text-xs font-bold ${kind === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-targets-${value}`}>{label}</button>)}</div></div>
    {query.isLoading ? <div className="grid gap-3">{[1, 2].map((item) => <Skeleton key={item} className="h-20" />)}</div> : query.isError ? <QueryError message={getErrorMessage(query.error)} onRetry={() => query.refetch()} /> : visible.length === 0 ? <EmptyState icon={UsersRound} title="אין יעדים ברשימה" description={search || kind !== 'all' ? 'לא נמצאו יעדים בסינון הנוכחי.' : 'הוסיפו איש קשר או קבוצה כדי לבחור מי יקבל מחירים בוואטסאפ.'} action={!search && kind === 'all' ? <Button onClick={() => setModal(true)} data-testid="button-empty-add-target"><Plus className="size-4" /> הוספת יעד</Button> : undefined} /> : <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="hidden grid-cols-[1.2fr_1.5fr_1fr_130px_90px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 text-xs font-bold text-muted-foreground md:grid"><span>סוג</span><span>שם / מזהה</span><span>נוסף בתאריך</span><span>מצב</span><span /></div><div className="divide-y divide-border">{visible.map((target) => <TargetRow key={target.id} target={target} onToggle={toggle} onDelete={removeTarget} />)}</div></div>}
    {modal && <Modal title="יעד חדש" description="היעד יוכל לשלוח שאלות מחיר מיד לאחר ההוספה." onClose={() => setModal(false)}><form onSubmit={submit} className="grid gap-4"><Field label="סוג יעד"><div className="grid grid-cols-2 gap-2">{(['contact', 'group'] as const).map((value) => <button type="button" key={value} onClick={() => setForm({ ...form, kind: value, identifier: '', label: '' })} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold ${form.kind === value ? 'border-primary bg-secondary text-primary' : 'border-border text-muted-foreground'}`} data-testid={`button-target-kind-${value}`}>{value === 'contact' ? <Phone className="size-4" /> : <Group className="size-4" />}{value === 'contact' ? 'איש קשר' : 'קבוצה'}</button>)}</div></Field>{form.kind === 'group' ? <Field label="בחירת קבוצה" hint="שלחו קודם הודעה אחת בקבוצה; היא תופיע כאן מיד."><select required value={form.identifier} onChange={(event) => { const group = groups.find((item) => item.identifier === event.target.value); setForm({ ...form, identifier: group?.identifier || '', label: group?.label || '' }); }} className="input-base" data-testid="select-target-group"><option value="">{groupsQuery.isLoading ? 'טוען קבוצות…' : groups.length ? 'בחרו קבוצה' : 'שלחו הודעה בקבוצה ואז חזרו לכאן'}</option>{groups.map((group) => <option key={group.identifier} value={group.identifier}>{group.label}</option>)}</select></Field> : <Field label="מספר טלפון" hint="כולל קידומת מדינה, ללא סימן +."><input required value={form.identifier} onChange={(event) => setForm({ ...form, identifier: event.target.value })} className="input-base font-mono" dir="ltr" placeholder="972501234567" data-testid="input-target-identifier" /></Field>}<Field label="שם תצוגה"><input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} className="input-base" placeholder={form.kind === 'contact' ? 'דנה כהן' : 'צוות מכירות'} data-testid="input-target-label" /></Field>{form.kind === 'group' && groupsQuery.isError && <p className="text-sm font-bold text-destructive">לא ניתן היה לטעון קבוצות. בדקו שה־WhatsApp מחובר ונסו שוב.</p>}{feedback && <p className="text-sm font-bold text-destructive">{feedback}</p>}<div className="mt-2 flex gap-2"><Button type="submit" disabled={create.isPending || (form.kind === 'group' && groupsQuery.isLoading)} className="flex-1" data-testid="button-save-target"><Check className="size-4" /> {create.isPending ? 'שומר…' : 'הוספת יעד'}</Button><Button type="button" variant="secondary" onClick={() => setModal(false)} data-testid="button-cancel-target">ביטול</Button></div></form></Modal>}
  </div>;
}

function TargetRow({ target, onToggle, onDelete }: { target: Target; onToggle: (target: Target) => void; onDelete: (target: Target) => void }) {
  const Icon = target.kind === 'contact' ? Phone : Group;
  return <div className="grid items-center gap-3 px-4 py-4 sm:px-5 md:grid-cols-[1.2fr_1.5fr_1fr_130px_90px] md:gap-4"><div className="flex items-center gap-2 text-sm font-bold"><div className="grid size-9 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-4" /></div>{target.kind === 'contact' ? 'איש קשר' : 'קבוצה'}</div><div className="min-w-0"><p className="truncate text-sm font-extrabold" data-testid={`text-target-label-${target.id}`}>{target.label}</p><p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" dir="ltr">{target.identifier}</p></div><span className="hidden text-xs text-muted-foreground md:block">{formatDate(target.addedAt)}</span><div className="flex items-center justify-between gap-2 md:justify-start"><button type="button" onClick={() => onToggle(target)} className={`relative h-6 w-11 rounded-full ${target.active ? 'bg-primary' : 'bg-muted-foreground/30'}`} aria-label={target.active ? 'השבתת יעד' : 'הפעלת יעד'} data-testid={`button-toggle-target-${target.id}`}><span className={`absolute top-1 size-4 rounded-full bg-card shadow-sm transition-transform ${target.active ? 'right-1' : 'right-6'}`} /></button><Badge tone={target.active ? 'green' : 'neutral'}>{target.active ? 'פעיל' : 'מושהה'}</Badge></div><button type="button" onClick={() => onDelete(target)} className="grid size-8 place-items-center justify-self-end rounded-lg text-muted-foreground hover:bg-[hsl(var(--destructive)/.1)] hover:text-destructive" aria-label="הסרת יעד" data-testid={`button-delete-target-${target.id}`}><Trash2 className="size-4" /></button></div>;
}

function SettingsPage() {
  const query = useGetWhatsAppStatus();
  const connect = useConnectWhatsApp();
  const pair = usePairWhatsApp();
  const canManageWhatsApp = useCan('whatsapp.manage');
  const me = useSessionAdmin();
  const [pairPhone, setPairPhone] = useState('');
  const [pairError, setPairError] = useState<string | null>(null);
  const disconnect = useDisconnectWhatsApp();
  const status = query.data;
  const pairing = status?.connectionState === 'initializing' || status?.connectionState === 'qr_ready' || status?.connectionState === 'pairing_code_ready';
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => { void query.refetch(); }, 3000);
    return () => window.clearInterval(timer);
  }, [pairing, query.refetch]);
  const refresh = () => { void query.refetch(); };
  const onConnect = () => connect.mutate(undefined, { onSuccess: refresh });
  const onDisconnect = () => { if (!status?.connected || window.confirm('לנתק את WhatsApp? הבוט יפסיק לענות עד לחיבור מחדש.')) disconnect.mutate(undefined, { onSuccess: refresh }); };
  const onPair = (event: FormEvent) => { event.preventDefault(); setPairError(null); pair.mutate({ data: { phoneNumber: pairPhone.trim() } }, { onSuccess: refresh, onError: (e) => setPairError(getErrorMessage(e)) }); };
  const action = !canManageWhatsApp ? undefined : status?.connected ? <Button variant="danger" onClick={onDisconnect} disabled={disconnect.isPending} data-testid="button-disconnect-whatsapp"><Power className="size-4" /> {disconnect.isPending ? 'מנתק…' : 'ניתוק'}</Button>
    : pairing ? <Button variant="danger" onClick={onDisconnect} disabled={disconnect.isPending} data-testid="button-disconnect-whatsapp"><X className="size-4" /> ביטול חיבור</Button>
    : <Button onClick={onConnect} disabled={connect.isPending} data-testid="button-connect-whatsapp"><Wifi className="size-4" /> {connect.isPending ? 'מתחבר…' : 'חיבור WhatsApp'}</Button>;
  return <div className="animate-rise-in"><PageHeader eyebrow="ה-WhatsApp שלכם / חיבור" title="החיבור שמחזיק את הכול." description="זהו חיבור ה-WhatsApp הפרטי של המנהל המחובר. חברו אותו כדי שהבוט יקבל הודעות אמיתיות ויענה רק ביעדים הפרטיים שלכם." action={<div className="flex gap-2">{action}<Button variant="secondary" onClick={refresh} disabled={query.isFetching} data-testid="button-refresh-status"><RefreshCcw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} /> רענון</Button></div>} />
    {query.isLoading ? <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div> : query.isError ? <QueryError message={getErrorMessage(query.error)} onRetry={refresh} /> : <><div className="grid gap-4 lg:grid-cols-2"><StatusCard icon={Wifi} title="חיבור WhatsApp" ok={Boolean(status?.connected)} label={status?.connected ? 'מחובר' : pairing ? 'ממתין לחיבור' : 'לא מחובר'} description={status?.connected ? 'המספר יכול לקבל הודעות ולענות למחירים.' : 'החיבור נעשה ישירות דרך WhatsApp Web.'}><div className="mt-6 grid gap-3 border-t border-border pt-4 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">ספק</span><strong>{status?.provider || 'לא ידוע'}</strong></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">מספר מחובר</span><strong className="font-mono" dir="ltr">{status?.phoneNumber || '—'}</strong></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">מצב</span><strong data-testid="whatsapp-polling-status">{pairing ? 'בודק חיבור כל 3 שניות' : status?.connectionState || 'מנותק'}</strong></div></div></StatusCard><StatusCard icon={Webhook} title="הודעות נכנסות" ok={Boolean(status?.connected)} label={status?.connected ? 'מוכן' : 'ממתין לחיבור'} description="הבוט עונה לשיחות ולקבוצות שהוגדרו כיעדים פעילים בלבד."><div className="mt-6 rounded-xl bg-secondary/65 p-4 text-xs leading-6 text-muted-foreground"><span className="font-bold text-foreground">מה נבדק?</span><br />הודעות נכנסות מנותבות למנוע המחירים ונרשמות לבדיקה.</div></StatusCard></div>{status?.pairingCode && <section className="mt-6 rounded-2xl border border-border bg-card p-5 text-center shadow-sm sm:p-6"><h2 className="font-extrabold">קוד לחיבור WhatsApp</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">בטלפון: מכשירים מקושרים ← קישור מכשיר ← קישור באמצעות מספר טלפון, ואז הזינו את הקוד.</p><div className="mx-auto mt-5 w-fit rounded-xl border border-border bg-secondary px-6 py-4 font-mono text-3xl font-black tracking-[0.25em]" dir="ltr" data-testid="text-whatsapp-pairing-code">{status.pairingCode}</div></section>}{me?.sharedWhatsapp && <div className="mt-6 rounded-xl bg-secondary p-4 text-sm font-bold">את/ה עובד/ת על חיבור ה־WhatsApp המשותף של החשבון. אין צורך בסריקת QR נוספת.</div>}{canManageWhatsApp && !status?.connected && !status?.pairingCode && <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><h2 className="font-extrabold">חיבור בלי סריקה: קוד צימוד</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">נוח כשהאתר פתוח באותו טלפון. הזינו את מספר ה־WhatsApp שמחברים, ובטלפון בחרו: מכשירים מקושרים ← קישור מכשיר ← קישור באמצעות מספר טלפון.</p><form onSubmit={onPair} className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={pairPhone} onChange={(e) => setPairPhone(e.target.value)} className="input-base flex-1 font-mono" dir="ltr" inputMode="tel" placeholder="050-1234567" required data-testid="input-pair-phone" /><Button type="submit" disabled={pair.isPending}><Smartphone className="size-4" /> {pair.isPending ? 'מבקש קוד…' : 'קבלת קוד צימוד'}</Button></form>{pairError && <p className="mt-2 text-sm font-bold text-destructive">{pairError}</p>}</section>}{status?.qrCode && <section className="mt-6 rounded-2xl border border-border bg-card p-5 text-center shadow-sm sm:p-6"><h2 className="font-extrabold">סריקת קוד לחיבור</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">פתחו את WhatsApp בטלפון, עברו אל מכשירים מקושרים, בחרו קישור מכשיר וסרקו את קוד ה-QR.</p><img src={status.qrCode} alt="קוד QR לחיבור WhatsApp" className="mx-auto mt-5 size-64 rounded-xl border border-border bg-white p-3" data-testid="image-whatsapp-qr" /></section>}{status?.lastError && <div className="mt-6 rounded-xl bg-[hsl(var(--destructive)/.08)] p-4 text-sm font-bold text-destructive" data-testid="status-whatsapp-error">{status.lastError}</div>}<section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><ShieldCheck className="size-5" /></div><div><h2 className="font-extrabold">המלצת אבטחה</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">שמרו את החיבור פרטי, הגבילו הרשאות מנהלים, והפעילו את הבוט רק ביעדים שאתם מזהים. כך כל תשובה נשארת בשליטה.</p></div></div></section></>}
  </div>;
}

function StatusCard({ icon: Icon, title, ok, label, description, children }: { icon: typeof Wifi; title: string; ok: boolean; label: string; description: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className={`grid size-11 place-items-center rounded-xl ${ok ? 'bg-[hsl(var(--primary)/.12)] text-primary' : 'bg-[hsl(var(--accent)/.2)] text-[hsl(30_65%_29%)]'}`}><Icon className="size-5" /></div><div><h2 className="font-extrabold">{title}</h2><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p></div></div><Badge tone={ok ? 'green' : 'amber'}>{ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}{label}</Badge></div>{children}</section>;
}

function LoginScreen({ bootstrap, onSuccess }: { bootstrap: boolean; onSuccess: () => void }) {
  const setup = useBootstrapOwnerCode();
  const requestCode = useRequestLoginCode();
  const verifyCode = useVerifyLoginCode();
  const pinLogin = useLoginWithPin();
  const [identifier, setIdentifier] = useState(() => { try { return localStorage.getItem('login-identifier') ?? ''; } catch { return ''; } });
  const [step, setStep] = useState<'identify' | 'whatsapp' | 'pin'>('identify');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = setup.isPending || requestCode.isPending || verifyCode.isPending || pinLogin.isPending;
  const remember = () => { try { localStorage.setItem('login-identifier', identifier.trim()); } catch { /* private mode */ } };
  const done = () => { remember(); setCode(''); onSuccess(); };
  const fail = (e: unknown) => setError(getErrorMessage(e));
  const validIdentifier = identifier.trim().includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim()) : identifier.replace(/\D/g, '').length >= 9;

  const sendCode = () => {
    if (!validIdentifier) { setError('הזינו מספר טלפון או אימייל תקינים.'); return; }
    setError(null);
    requestCode.mutate({ data: { identifier: identifier.trim() } }, {
      onSuccess: (result) => { remember(); setStep('whatsapp'); setCode(''); setNotice(result.destination ? `שלחנו קוד בן 6 ספרות ל־WhatsApp שמסתיים ב־${result.destination.replace('•••', '')}.` : 'אם המספר רשום במערכת, נשלח אליו קוד ב־WhatsApp.'); },
      onError: fail,
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (bootstrap) {
      if (!/^\d{4,8}$/.test(code)) { setError('הקוד חייב להכיל 4–8 ספרות.'); return; }
      setup.mutate({ data: { code } }, { onSuccess: done, onError: fail });
    } else if (step === 'identify') {
      sendCode();
    } else if (step === 'whatsapp') {
      if (!/^\d{6}$/.test(code)) { setError('הקוד מ־WhatsApp מכיל 6 ספרות.'); return; }
      verifyCode.mutate({ data: { identifier: identifier.trim(), code } }, { onSuccess: done, onError: fail });
    } else {
      if (!validIdentifier || !/^\d{4,8}$/.test(code)) { setError('הזינו טלפון/אימייל וקוד אישי בן 4–8 ספרות.'); return; }
      pinLogin.mutate({ data: { identifier: identifier.trim(), code } }, { onSuccess: done, onError: fail });
    }
  };

  return <main className="app-noise grid min-h-[100dvh] place-items-center bg-background p-5" dir="rtl">
    <section className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-xl sm:p-9">
      <div className="mb-7 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground"><ShieldCheck className="size-7" /></div>
      <p className="text-xs font-extrabold tracking-[.16em] text-primary">מחירון בוואטסאפ</p>
      <h1 className="mt-2 text-3xl font-extrabold">{bootstrap ? 'הגדרה חד־פעמית לבעלים' : step === 'whatsapp' ? 'הזינו את הקוד' : 'כניסה למערכת'}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {bootstrap ? 'בחרו קוד אישי לבעלים. לאחר השמירה ניתן יהיה לשנות קודים רק מתוך חשבון הבעלים.'
          : step === 'identify' ? 'הזינו טלפון או אימייל, ונשלח לכם קוד כניסה ב־WhatsApp.'
          : step === 'whatsapp' ? notice : 'כניסה עם הקוד האישי שקבע בעל המערכת.'}
      </p>
      <form onSubmit={submit} className="mt-7 grid gap-4">
        {!bootstrap && step !== 'whatsapp' && <Field label="טלפון או אימייל">
          <div className="relative">
            {identifier.includes('@') ? <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /> : <Smartphone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
            <input autoFocus required value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="input-base w-full pl-10 font-mono" dir="ltr" autoComplete="username" inputMode={identifier.includes('@') ? 'email' : 'tel'} placeholder="050-1234567" data-testid="input-login-identifier" />
          </div>
        </Field>}
        {(bootstrap || step !== 'identify') && <Field label={step === 'whatsapp' ? 'קוד מ־WhatsApp' : 'קוד אישי'}>
          <input autoFocus={step === 'whatsapp' || bootstrap} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, step === 'whatsapp' ? 6 : 8))} inputMode="numeric" autoComplete={step === 'whatsapp' ? 'one-time-code' : 'current-password'} type={step === 'whatsapp' ? 'text' : 'password'} className="input-base font-mono text-center text-lg tracking-[.35em]" dir="ltr" placeholder={step === 'whatsapp' ? '••••••' : '••••'} data-testid="input-login-code" />
        </Field>}
        {error && <p role="alert" className="text-sm font-bold text-destructive">{error}</p>}
        <Button type="submit" disabled={pending} className="mt-1 w-full" data-testid="button-login-submit">
          {pending ? 'רגע…' : bootstrap ? 'שמירת קוד הבעלים' : step === 'identify' ? <><Send className="size-4" /> שליחת קוד ב־WhatsApp</> : 'כניסה'}
        </Button>
        {!bootstrap && <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
          {step === 'whatsapp' && <button type="button" onClick={sendCode} disabled={pending} className="font-bold text-primary hover:underline">שליחת קוד חדש</button>}
          {step !== 'identify' && <button type="button" onClick={() => { setStep('identify'); setCode(''); setError(null); }} className="text-muted-foreground hover:text-foreground">חזרה</button>}
          {step !== 'pin' && <button type="button" onClick={() => { setStep('pin'); setCode(''); setError(null); }} className="text-muted-foreground hover:text-foreground" data-testid="button-login-pin">כניסה עם קוד אישי</button>}
        </div>}
      </form>
    </section>
  </main>;
}

function Router() {
  const client = useQueryClient();
  const session = useGetCurrentSession({ query: { queryKey: getGetCurrentSessionQueryKey(), retry: false } });
  const status = useGetAuthStatus();
  const logout = useLogoutAdmin();
  const reset = () => { client.clear(); void session.refetch(); };
  if (session.isLoading || status.isLoading) return <main className="grid min-h-[100dvh] place-items-center bg-background text-muted-foreground">טוען גישה מאובטחת…</main>;
  if (!session.data) return <LoginScreen bootstrap={Boolean(status.data?.ownerSetupRequired)} onSuccess={reset} />;
  const onLogout = () => logout.mutate(undefined, { onSettled: () => { client.clear(); void session.refetch(); } });
  const admin = session.data.admin;
  return <ErrorBoundary><SessionProvider admin={admin}><AppShell admin={admin} onLogout={onLogout}><Switch><Route path="/" component={Dashboard} /><Route path="/products" component={ProductsPage} /><Route path="/abbreviations" component={AbbreviationsPage} /><Route path="/surge" component={SurgePage} /><Route path="/targets" component={TargetsPage} /><Route path="/admins" component={UsersPage} /><Route path="/activity" component={ActivityPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></AppShell></SessionProvider></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;