import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Check, KeyRound, LogOut, MessageCircle, Pencil, Plus, Send, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey,
  getListAdminsQueryKey,
  useCreateAdmin,
  useDeleteAdmin,
  useInviteAdmin,
  useListAdmins,
  useRevokeAdminSessions,
  useSetAdminCode,
  useUpdateAdmin,
  type Admin,
  type Permission,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, QueryError, Skeleton, getErrorMessage } from '@/components/app-ui';
import { permissionOptions, useCan, useSessionAdmin } from '@/lib/session';

const defaultPermissions: Permission[] = ['catalog.edit', 'targets.manage', 'lookups.manage', 'surge.manage', 'whatsapp.manage'];

export function timeAgo(value: string | null | undefined) {
  if (!value) return 'אף פעם';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 2) return 'עכשיו';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  return days < 30 ? `לפני ${days} ימים` : new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

type UserForm = { phone: string; label: string; email: string; permissions: Permission[]; sharedWhatsapp: boolean };
const blankForm: UserForm = { phone: '', label: '', email: '', permissions: defaultPermissions, sharedWhatsapp: true };

export default function UsersPage() {
  const me = useSessionAdmin()!;
  const canManage = useCan('users.manage');
  const isOwner = me.role === 'owner';
  const client = useQueryClient();
  const query = useListAdmins();
  const create = useCreateAdmin();
  const update = useUpdateAdmin();
  const remove = useDeleteAdmin();
  const setCode = useSetAdminCode();
  const invite = useInviteAdmin();
  const revoke = useRevokeAdminSessions();
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<Admin | 'new' | null>(null);
  const [form, setForm] = useState<UserForm>(blankForm);
  const [codeFor, setCodeFor] = useState<Admin | null>(null);
  const [code, setPersonalCode] = useState('');
  const users = query.data ?? [];
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListAdminsQueryKey() });
    void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };
  const ok = (text: string) => setFeedback({ tone: 'ok', text });
  const fail = (error: unknown) => setFeedback({ tone: 'error', text: getErrorMessage(error) });

  const openNew = () => { setForm(blankForm); setEditing('new'); setFeedback(null); };
  const openEdit = (user: Admin) => {
    setForm({ phone: user.phone, label: user.label, email: user.email ?? '', permissions: user.permissions, sharedWhatsapp: user.sharedWhatsapp });
    setEditing(user);
    setFeedback(null);
  };
  const togglePermission = (permission: Permission) => setForm((current) => ({
    ...current,
    permissions: current.permissions.includes(permission)
      ? current.permissions.filter((item) => item !== permission)
      : [...current.permissions, permission],
  }));

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (editing === 'new') {
      if (form.phone.replace(/\D/g, '').length < 9) { setFeedback({ tone: 'error', text: 'הזינו מספר טלפון תקין.' }); return; }
      create.mutate({ data: { phone: form.phone.trim(), label: form.label.trim(), email: form.email.trim() || undefined, permissions: form.permissions, sharedWhatsapp: form.sharedWhatsapp } }, {
        onSuccess: (user) => { refresh(); setEditing(null); ok(`${user.label} נוסף/ה. אפשר לשלוח הזמנה ב־WhatsApp מהרשימה.`); },
        onError: fail,
      });
    } else if (editing) {
      const self = editing.id === me.id && !canManage;
      update.mutate({ id: editing.id, data: self
        ? { label: form.label.trim(), email: form.email.trim() || null }
        : { label: form.label.trim(), phone: form.phone.trim(), email: form.email.trim() || null, permissions: form.permissions, sharedWhatsapp: form.sharedWhatsapp } }, {
        onSuccess: () => { refresh(); setEditing(null); ok('הפרטים נשמרו.'); },
        onError: fail,
      });
    }
  };
  const toggleActive = (user: Admin) => {
    if (user.active && !window.confirm(`להשעות את ${user.label}? הוא/היא ינותק/ו מיד מכל המכשירים.`)) return;
    update.mutate({ id: user.id, data: { active: !user.active } }, {
      onSuccess: () => { refresh(); ok(user.active ? `${user.label} הושעה/תה ונותק/ה.` : `${user.label} פעיל/ה שוב.`); },
      onError: fail,
    });
  };
  const sendInvite = (user: Admin) => invite.mutate({ id: user.id }, {
    onSuccess: (result) => { refresh(); result.sent ? ok(`ההזמנה נשלחה ל־${user.label} ב־WhatsApp.`) : setFeedback({ tone: 'error', text: `לא ניתן לשלוח כרגע (WhatsApp לא מחובר). אפשר לשלוח ידנית את הקישור: ${result.link}` }); },
    onError: fail,
  });
  const signOutEverywhere = (user: Admin) => {
    if (!window.confirm(`לנתק את ${user.label} מכל המכשירים?`)) return;
    revoke.mutate({ id: user.id }, { onSuccess: () => ok(`${user.label} נותק/ה מכל המכשירים.`), onError: fail });
  };
  const deleteUser = (user: Admin) => {
    if (!window.confirm(`למחוק לצמיתות את ${user.label}? היעדים והבקשות שלו/ה יימחקו. אפשר במקום זה להשעות.`)) return;
    remove.mutate({ id: user.id }, { onSuccess: () => { refresh(); ok(`${user.label} נמחק/ה.`); }, onError: fail });
  };
  const saveCode = (event: FormEvent) => {
    event.preventDefault();
    if (!codeFor || !/^\d{4,8}$/.test(code)) { setFeedback({ tone: 'error', text: 'הקוד חייב להכיל 4–8 ספרות.' }); return; }
    setCode.mutate({ id: codeFor.id, data: { code } }, {
      onSuccess: () => { refresh(); setCodeFor(null); setPersonalCode(''); ok('הקוד האישי נשמר.'); },
      onError: fail,
    });
  };

  const busy = create.isPending || update.isPending;
  const editingSelfOnly = editing !== 'new' && editing !== null && editing.id === me.id && !canManage;

  return <div className="animate-rise-in">
    <PageHeader
      eyebrow="צוות / גישה"
      title={canManage ? 'משתמשים והרשאות' : 'החשבון שלי'}
      description={canManage
        ? 'הוסיפו משתמשים לפי טלפון או אימייל, קבעו מה כל אחד רשאי לעשות, ושתפו איתם את חיבור ה־WhatsApp שלכם בלי QR נוסף.'
        : 'הפרטים וההרשאות שלך. הכניסה נעשית בקוד שנשלח אליך ב־WhatsApp או בקוד האישי.'}
      action={canManage ? <Button onClick={openNew} data-testid="button-add-user"><Plus className="size-4" /> משתמש חדש</Button> : undefined}
    />
    {feedback && <div role="status" className={`mb-5 rounded-xl px-4 py-3 text-sm font-bold ${feedback.tone === 'ok' ? 'bg-secondary' : 'bg-[hsl(var(--destructive)/.08)] text-destructive'}`}>{feedback.text}</div>}

    {query.isLoading ? <div className="grid gap-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28" />)}</div>
      : query.isError ? <QueryError message={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      : users.length === 0 ? <EmptyState icon={Users} title="אין משתמשים" description="הוסיפו את המשתמש הראשון." />
      : <div className="grid gap-3">
        {users.map((user) => {
          const owner = user.role === 'owner';
          const self = user.id === me.id;
          return <article key={user.id} className={`rounded-2xl border bg-card p-4 shadow-sm sm:p-5 ${user.active ? 'border-border' : 'border-dashed border-[hsl(var(--destructive)/.35)] opacity-80'}`} data-testid={`user-${user.id}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className={`grid size-11 shrink-0 place-items-center rounded-2xl text-base font-extrabold ${owner ? 'bg-[hsl(var(--accent)/.25)] text-[hsl(30_65%_29%)]' : 'bg-secondary text-primary'}`}>
                  {user.label.trim().slice(0, 1) || <UserRound className="size-5" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-extrabold">{user.label}{self && <span className="mr-1 text-xs font-bold text-muted-foreground">(את/ה)</span>}</h3>
                    <Badge tone={owner ? 'amber' : 'neutral'}>{owner ? 'בעלים' : 'משתמש'}</Badge>
                    {!user.active && <Badge tone="red"><Ban className="size-3" /> מושהה</Badge>}
                    {user.sharedWhatsapp && <Badge tone="green"><MessageCircle className="size-3" /> WhatsApp משותף</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{user.phone}{user.email ? ` · ${user.email}` : ''}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    נראה לאחרונה: {timeAgo(user.lastSeenAt)} · כניסה אחרונה: {timeAgo(user.lastLoginAt)}
                    {user.invitedAt && ` · הוזמן ${timeAgo(user.invitedAt)}`}
                    {user.hasPin ? ' · יש קוד אישי' : ''}
                  </p>
                  {!owner && <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.permissions.length === 0
                      ? <span className="text-xs text-muted-foreground">צפייה בלבד</span>
                      : permissionOptions.filter((option) => user.permissions.includes(option.value)).map((option) =>
                        <span key={option.value} className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{option.label}</span>)}
                  </div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 lg:justify-end">
                {(canManage || self) && (!owner || self) && <Button variant="ghost" onClick={() => openEdit(user)} data-testid={`button-edit-user-${user.id}`}><Pencil className="size-4" /> עריכה</Button>}
                {canManage && !owner && user.active && <Button variant="ghost" onClick={() => sendInvite(user)} disabled={invite.isPending}><Send className="size-4" /> הזמנה</Button>}
                {isOwner && !self && <Button variant="ghost" onClick={() => { setCodeFor(user); setPersonalCode(''); }}><KeyRound className="size-4" /> קוד אישי</Button>}
                {(canManage || self) && (!owner || self) && <Button variant="ghost" onClick={() => signOutEverywhere(user)}><LogOut className="size-4" /> ניתוק מכל המכשירים</Button>}
                {canManage && !owner && !self && <Button variant={user.active ? 'danger' : 'secondary'} onClick={() => toggleActive(user)}>{user.active ? <><Ban className="size-4" /> השעיה</> : <><Check className="size-4" /> הפעלה</>}</Button>}
                {canManage && !owner && !self && <button type="button" onClick={() => deleteUser(user)} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-[hsl(var(--destructive)/.1)] hover:text-destructive" aria-label={`מחיקת ${user.label}`}><Trash2 className="size-4" /></button>}
              </div>
            </div>
          </article>;
        })}
      </div>}

    {editing && <Modal
      title={editing === 'new' ? 'משתמש חדש' : `עריכת ${editing.label}`}
      description={editing === 'new' ? 'המשתמש ייכנס עם קוד שיישלח לטלפון שלו ב־WhatsApp.' : undefined}
      onClose={() => setEditing(null)}
    >
      <form onSubmit={save} className="grid gap-4">
        <Field label="שם"><input autoFocus value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} className="input-base" placeholder="למשל: יעל" /></Field>
        {!editingSelfOnly && <Field label="טלפון" hint="המספר שאליו יישלחו קודי כניסה והזמנות."><input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="input-base font-mono" dir="ltr" inputMode="tel" placeholder="050-1234567" /></Field>}
        <Field label="אימייל (לא חובה)" hint="אפשר להיכנס גם עם האימייל; הקוד עדיין נשלח ב־WhatsApp."><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="input-base font-mono" dir="ltr" inputMode="email" placeholder="name@example.com" /></Field>
        {!editingSelfOnly && (editing === 'new' || editing.role !== 'owner') && <>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
            <input type="checkbox" checked={form.sharedWhatsapp} onChange={(event) => setForm({ ...form, sharedWhatsapp: event.target.checked })} className="mt-1 size-4 accent-[hsl(var(--primary))]" />
            <span><span className="block text-sm font-bold">עובד/ת על ה־WhatsApp שלי</span><span className="text-xs text-muted-foreground">בלי QR נוסף: אותם יעדים, בקשות, קבוצות וזמני עומס. כבו אם המשתמש יחבר מספר משלו.</span></span>
          </label>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-bold">הרשאות</legend>
            {permissionOptions.filter((option) => option.value !== 'users.manage' || isOwner).map((option) =>
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-xl bg-secondary/50 p-3">
                <input type="checkbox" checked={form.permissions.includes(option.value)} onChange={() => togglePermission(option.value)} className="mt-1 size-4 accent-[hsl(var(--primary))]" />
                <span><span className="block text-sm font-bold">{option.label}</span><span className="text-xs text-muted-foreground">{option.description}</span></span>
              </label>)}
            <p className="text-xs text-muted-foreground"><ShieldCheck className="inline size-3.5" /> בלי הרשאות המשתמש יכול לצפות בלבד.</p>
          </fieldset>
        </>}
        {feedback?.tone === 'error' && <p className="text-sm font-bold text-destructive">{feedback.text}</p>}
        <div className="mt-1 flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1"><Check className="size-4" /> {busy ? 'שומר…' : editing === 'new' ? 'הוספת משתמש' : 'שמירה'}</Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(null)}>ביטול</Button>
        </div>
      </form>
    </Modal>}

    {codeFor && <Modal title={`קוד אישי עבור ${codeFor.label}`} description="קוד גיבוי בן 4–8 ספרות, לכניסה כשאין WhatsApp זמין. נשמר מוצפן." onClose={() => setCodeFor(null)}>
      <form onSubmit={saveCode} className="grid gap-4">
        <Field label="קוד אישי"><input autoFocus required value={code} onChange={(event) => setPersonalCode(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" type="password" className="input-base font-mono" dir="ltr" /></Field>
        <Button type="submit" disabled={setCode.isPending}>{setCode.isPending ? 'שומר…' : 'שמירת קוד'}</Button>
      </form>
    </Modal>}
  </div>;
}
