import { useMemo, useState } from 'react';
import { MessageCircle, RefreshCcw, Search, Send, Users, UsersRound } from 'lucide-react';
import { getListTelegramUsersQueryKey, useGetTelegramStatus, useListTelegramUsers, type TelegramUser } from '@workspace/api-client-react';
import { Badge, Button, EmptyState, PageHeader, QueryError, Skeleton, getErrorMessage } from '@/components/app-ui';
import { timeAgo } from '@/pages/users';

const dayMs = 24 * 60 * 60 * 1000;

export default function TelegramPage() {
  const status = useGetTelegramStatus();
  const users = useListTelegramUsers({ query: { queryKey: getListTelegramUsersQueryKey(), refetchInterval: 30_000 } });
  const [query, setQuery] = useState('');
  const rows = users.data ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    if (!needle) return rows;
    return rows.filter((row) => [row.name, row.username ?? '', row.lastChatTitle ?? '', row.telegramId].some((value) => value.toLowerCase().includes(needle)));
  }, [rows, query]);
  const now = Date.now();
  const today = rows.filter((row) => now - new Date(row.lastSeenAt).getTime() < dayMs).length;
  const newThisWeek = rows.filter((row) => now - new Date(row.firstSeenAt).getTime() < 7 * dayMs).length;
  const botName = status.data?.username;

  return <div className="animate-rise-in">
    <PageHeader
      eyebrow="טלגרם"
      title="משתמשי טלגרם"
      description={botName ? `כל מי שכתב לבוט @${botName}. מתעדכן כל 30 שניות.` : 'כל מי שכתב לבוט בטלגרם.'}
      action={<Button variant="secondary" onClick={() => { void users.refetch(); void status.refetch(); }}><RefreshCcw className="size-4" /> רענון</Button>}
    />

    <div className="grid gap-4 sm:grid-cols-3">
      {[
        { label: 'משתמשים', value: rows.length, icon: Users, detail: 'כתבו לבוט לפחות פעם אחת' },
        { label: 'פעילים היום', value: today, icon: MessageCircle, detail: 'ב־24 השעות האחרונות' },
        { label: 'חדשים השבוע', value: newThisWeek, icon: Send, detail: 'הצטרפו ב־7 הימים האחרונים' },
      ].map((card) => { const Icon = card.icon; return <div key={card.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between"><p className="text-sm font-bold text-muted-foreground">{card.label}</p><div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="size-[18px]" /></div></div>
        <p className="font-mono text-3xl font-bold">{users.isLoading ? '—' : card.value}</p><p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
      </div>; })}
    </div>

    {status.data && <div className="mt-4 flex items-center gap-2 text-sm">
      <Badge tone={status.data.connected ? 'green' : status.data.configured ? 'red' : 'neutral'}>
        {status.data.connected ? 'הבוט מחובר' : status.data.configured ? 'הבוט לא מחובר' : 'הבוט לא מוגדר'}
      </Badge>
      {botName && <a className="font-bold text-primary hover:underline" href={`https://t.me/${botName}`} target="_blank" rel="noreferrer" dir="ltr">@{botName}</a>}
    </div>}

    <section className="mt-6 rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
        <div><h2 className="font-extrabold">מי משתמש בבוט</h2><p className="mt-1 text-xs text-muted-foreground">האחרונים שכתבו מופיעים ראשונים.</p></div>
        <label className="relative sm:w-64">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש לפי שם או משתמש" className="input-base" style={{ paddingRight: "2.5rem" }} aria-label="חיפוש משתמשי טלגרם" />
        </label>
      </div>
      {users.isLoading ? <div className="grid gap-2 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        : users.isError ? <div className="p-5"><QueryError message={getErrorMessage(users.error)} onRetry={() => users.refetch()} /></div>
        : !rows.length ? <div className="p-5"><EmptyState icon={Send} title="עדיין אף אחד לא כתב לבוט" description="ברגע שמישהו ישלח הודעה לבוט בטלגרם, הוא יופיע כאן." /></div>
        : !filtered.length ? <p className="p-5 text-sm text-muted-foreground">לא נמצאו משתמשים שמתאימים לחיפוש.</p>
        : <div className="divide-y divide-border">{filtered.map((row) => <UserRow key={row.id} user={row} />)}</div>}
    </section>
  </div>;
}

function UserRow({ user }: { user: TelegramUser }) {
  const initials = user.name.trim().slice(0, 1) || '?';
  return <div className="flex items-start gap-3 px-4 py-3 sm:px-5" data-testid={`telegram-user-${user.id}`}>
    <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-base font-extrabold text-primary">{initials}</div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="truncate text-sm font-bold">{user.name}</p>
        {user.username && <a className="text-xs font-semibold text-primary hover:underline" href={`https://t.me/${user.username}`} target="_blank" rel="noreferrer" dir="ltr">@{user.username}</a>}
        {user.lastChatType === 'group' && <Badge tone="neutral"><UsersRound className="size-3" /> {user.lastChatTitle ?? 'קבוצה'}</Badge>}
      </div>
      {user.lastMessage && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={user.lastMessage} dir="auto">„{user.lastMessage}”</p>}
      <p className="mt-0.5 text-[11px] text-muted-foreground">{user.messageCount} הודעות · הצטרף {new Date(user.firstSeenAt).toLocaleDateString('he-IL')}</p>
    </div>
    <time className="shrink-0 text-xs text-muted-foreground" dateTime={user.lastSeenAt} title={new Date(user.lastSeenAt).toLocaleString('he-IL')}>{timeAgo(user.lastSeenAt)}</time>
  </div>;
}
