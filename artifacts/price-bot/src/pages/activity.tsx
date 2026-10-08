import { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Flame, MessageCircle, RefreshCcw, UserCheck, UserX, Wifi, WifiOff } from 'lucide-react';
import { getGetSystemOverviewQueryKey, useGetSystemOverview, useListAdmins, useListAuditLog, type AuditEntry } from '@workspace/api-client-react';
import { Badge, Button, EmptyState, PageHeader, QueryError, Skeleton, getErrorMessage } from '@/components/app-ui';
import { timeAgo } from '@/pages/users';

const actionLabels: Record<string, string> = {
  'auth.login': 'התחבר/ה',
  'auth.login_failed': 'ניסיון כניסה שגוי',
  'auth.owner_setup': 'הגדיר/ה קוד בעלים',
  'user.create': 'הוסיף/ה משתמש',
  'user.update': 'עדכן/ה משתמש',
  'user.suspend': 'השעה/תה משתמש',
  'user.restore': 'הפעיל/ה משתמש מחדש',
  'user.delete': 'מחק/ה משתמש',
  'user.invite': 'שלח/ה הזמנה',
  'user.invite_failed': 'הזמנה לא נשלחה',
  'user.set_pin': 'קבע/ה קוד אישי',
  'user.sessions_revoked': 'ניתק/ה מכל המכשירים',
  'whatsapp.connect_started': 'התחיל/ה חיבור WhatsApp',
  'whatsapp.disconnect': 'ניתק/ה WhatsApp',
  'whatsapp.connected': 'WhatsApp התחבר',
  'whatsapp.disconnected': 'WhatsApp התנתק (מתחבר מחדש)',
  'whatsapp.logged_out': 'WhatsApp נותק מהטלפון',
  'whatsapp.replaced': 'WhatsApp נפתח במקום אחר',
  'whatsapp.code_expired': 'פג תוקף קוד החיבור',
  'whatsapp.error': 'תקלה בחיבור WhatsApp',
  'product.create': 'הוסיף/ה מסלול למחירון',
  'product.update': 'עדכן/ה מסלול',
  'product.delete': 'מחק/ה מסלול',
  'abbreviation.create': 'הוסיף/ה קיצור',
  'abbreviation.update': 'עדכן/ה קיצור',
  'abbreviation.delete': 'מחק/ה קיצור',
  'target.create': 'הוסיף/ה יעד',
  'target.update': 'עדכן/ה יעד',
  'target.delete': 'הסיר/ה יעד',
  'lookup.approve': 'אישר/ה הערכת מחיר למחירון',
  'surge.start': 'הפעיל/ה זמני עומס',
  'surge.stop': 'עצר/ה זמני עומס',
};

const problem = (action: string) => /\.(error|failed|disconnected|logged_out|replaced|login_failed)$/u.test(action);

const stateLabels: Record<string, string> = {
  connected: 'מחובר', disconnected: 'מנותק', initializing: 'מתחבר…', qr_ready: 'ממתין לסריקת QR',
  pairing_code_ready: 'ממתין לקוד צימוד', error: 'תקלה',
};

const methodLabels: Record<string, string> = { pin: 'קוד אישי', whatsapp: 'קוד ב־WhatsApp', qr: 'סריקת QR', pairing_code: 'קוד צימוד' };
const fieldLabels: Record<string, string> = { label: 'שם', phone: 'טלפון', email: 'אימייל', permissions: 'הרשאות', sharedWhatsapp: 'WhatsApp משותף', active: 'סטטוס', name: 'שם', price: 'מחיר', priceMatrix: 'מחירים', aliases: 'כינויים', distance: 'מרחק', duration: 'זמן', level: 'סוג מחירון', waitTime: 'המתנה', currency: 'מטבע' };

/** Turns stored details into a short Hebrew line. */
function describeDetails(details: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof details.label === 'string') parts.push(details.label);
  if (typeof details.method === 'string') parts.push(`באמצעות ${methodLabels[details.method] ?? details.method}`);
  if (details.sharedWhatsapp === true) parts.push('WhatsApp משותף');
  if (Array.isArray(details.fields)) parts.push(`עודכנו: ${details.fields.map((field) => fieldLabels[String(field)] ?? String(field)).join(', ')}`);
  if (typeof details.phoneNumber === 'string') parts.push(`+${details.phoneNumber}`);
  if (typeof details.detail === 'string') parts.push(details.detail);
  if (typeof details.link === 'string') parts.push(details.link);
  if (typeof details.groups === 'number') parts.push(`${details.groups} קבוצות`);
  if (Array.isArray(details.before) && Array.isArray(details.after)) {
    const cells = ["4 מק׳", "4 צדדים", "6 קטן", "6 קטן צדדים", "6 מרווח", "6 מרווח צדדים", "7 מק׳", "7 צדדים"];
    const changes = details.after.map((value, index) => value !== (details.before as unknown[])[index] ? `${cells[index] ?? index + 1} ₪${(details.before as unknown[])[index] ?? '—'}→₪${value}` : null).filter(Boolean);
    if (changes.length) parts.push(changes.slice(0, 4).join(', ') + (changes.length > 4 ? '…' : ''));
  }
  return parts.join(' · ');
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const bad = problem(entry.action);
  const details = describeDetails(entry.details ?? {});
  return <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
    <div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${bad ? 'bg-[hsl(var(--destructive)/.1)] text-destructive' : 'bg-secondary text-primary'}`}>
      {bad ? <AlertTriangle className="size-4" /> : <Activity className="size-4" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold">
        <span>{entry.actorLabel ?? 'המערכת'}</span>{' '}
        <span className={bad ? 'text-destructive' : ''}>{actionLabels[entry.action] ?? entry.action}</span>
      </p>
      {details && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={details}>{details}</p>}
    </div>
    <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString('he-IL')}>{timeAgo(entry.createdAt)}</time>
  </div>;
}

export default function ActivityPage() {
  const overview = useGetSystemOverview({ query: { queryKey: getGetSystemOverviewQueryKey(), refetchInterval: 15_000 } });
  const [actorId, setActorId] = useState<number | undefined>(undefined);
  const log = useListAuditLog({ limit: 200, ...(actorId ? { actorId } : {}) });
  const users = useListAdmins();
  const data = overview.data;

  return <div className="animate-rise-in">
    <PageHeader
      eyebrow="בעלים / בקרה"
      title="מערכת ופעילות"
      description="כל חיבורי ה־WhatsApp, משתמשים, התראות ויומן פעולות במקום אחד. מתעדכן כל 15 שניות."
      action={<Button variant="secondary" onClick={() => { void overview.refetch(); void log.refetch(); }}><RefreshCcw className="size-4" /> רענון</Button>}
    />
    {overview.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-28" />)}</div>
      : overview.isError ? <QueryError message={getErrorMessage(overview.error)} onRetry={() => overview.refetch()} />
      : data && <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'משתמשים פעילים', value: data.activeUsers, icon: UserCheck, detail: `${data.suspendedUsers} מושהים` },
            { label: 'חיבורי WhatsApp', value: `${data.connections.filter((row) => row.connected).length}/${data.connections.length}`, icon: Wifi, detail: 'מחוברים מתוך החשבונות' },
            { label: 'בקשות מחיר ממתינות', value: data.pendingLookups, icon: MessageCircle, detail: 'בכל החשבונות' },
            { label: 'זמני עומס פעילים', value: data.activeSurges, icon: Flame, detail: 'מעקבים פועלים' },
          ].map((card) => { const Icon = card.icon; return <div key={card.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between"><p className="text-sm font-bold text-muted-foreground">{card.label}</p><div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-[18px]" /></div></div>
            <p className="font-mono text-3xl font-bold">{card.value}</p><p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
          </div>; })}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold">חיבורי WhatsApp</h2><p className="mt-1 text-xs text-muted-foreground">כל חשבון עם המספר שלו, וכמה משתמשים עובדים עליו.</p></div>
            <div className="divide-y divide-border">
              {data.connections.map((row) => <div key={row.adminId} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {row.connected ? <Wifi className="size-5 shrink-0 text-primary" /> : <WifiOff className="size-5 shrink-0 text-destructive" />}
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{row.label}</p><p className="truncate text-xs text-muted-foreground" dir="auto">{row.phoneNumber ? `+${row.phoneNumber}` : row.lastError ?? 'לא מחובר'}</p></div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.sharedUsers > 0 && <Badge tone="neutral">+{row.sharedUsers} משתמשים</Badge>}
                  <Badge tone={row.connected ? 'green' : row.connectionState === 'error' ? 'red' : 'amber'}>{stateLabels[row.connectionState] ?? row.connectionState}</Badge>
                </div>
              </div>)}
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4"><h2 className="font-extrabold">התראות ותקלות אחרונות</h2><p className="mt-1 text-xs text-muted-foreground">ניתוקים, כניסות שגויות ושליחות שנכשלו.</p></div>
            {data.recentProblems.length === 0
              ? <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-5 text-primary" /> אין תקלות אחרונות. הכול תקין.</div>
              : <div className="divide-y divide-border">{data.recentProblems.map((entry) => <EntryRow key={entry.id} entry={entry} />)}</div>}
          </section>
        </div>
      </>}

    <section className="mt-6 rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <div><h2 className="font-extrabold">יומן פעילות</h2><p className="mt-1 text-xs text-muted-foreground">מי עשה מה ומתי. 200 הפעולות האחרונות.</p></div>
        <select value={actorId ?? ''} onChange={(event) => setActorId(Number(event.target.value) || undefined)} className="input-base sm:w-56" aria-label="סינון לפי משתמש">
          <option value="">כל המשתמשים</option>
          {(users.data ?? []).map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}
        </select>
      </div>
      {log.isLoading ? <div className="grid gap-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        : log.isError ? <div className="p-5"><QueryError message={getErrorMessage(log.error)} onRetry={() => log.refetch()} /></div>
        : !log.data?.length ? <div className="p-5"><EmptyState icon={Activity} title="אין עדיין פעילות" description="פעולות של משתמשים ואירועי WhatsApp יופיעו כאן." /></div>
        : <div className="divide-y divide-border">{log.data.map((entry) => <EntryRow key={entry.id} entry={entry} />)}</div>}
    </section>
    <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><UserX className="size-3.5" /> משתמש מושהה מנותק מיד מכל המכשירים ולא יכול להיכנס עד שיופעל מחדש.</p>
  </div>;
}
