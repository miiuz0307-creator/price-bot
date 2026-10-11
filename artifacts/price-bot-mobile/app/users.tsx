import React, { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createAdmin, deleteAdmin, getListAdminsQueryKey, inviteAdmin, revokeAdminSessions, setAdminCode, updateAdmin,
  useListAdmins, type Admin, type Permission,
} from '@workspace/api-client-react';
import { useToast } from '@/components/Toast';
import { BackHeader, Button, Card, EmptyState, ErrorState, Field, ListGroup, ListRow, Pill, Row, Screen, Sheet, Skeleton, Toggle, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { displayPhone, permissionLabels, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const allPermissions = Object.keys(permissionLabels) as Permission[];
const defaultPermissions: Permission[] = ['catalog.edit', 'targets.manage', 'lookups.manage', 'surge.manage', 'whatsapp.manage'];

export default function UsersScreen() {
  const { c } = useTheme();
  const admins = useListAdmins();
  const [editing, setEditing] = useState<Admin | 'new' | null>(null);
  const list = [...(admins.data ?? [])].sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, 'he')));
  return (
    <Screen refreshing={admins.isRefetching} onRefresh={() => admins.refetch()}>
      <BackHeader title="משתמשים והרשאות" action={<Button title="הוספה" icon="user-plus" size="md" onPress={() => setEditing('new')} />} />
      {admins.isError ? <ErrorState message={errorMessage(admins.error)} onRetry={() => admins.refetch()} /> : null}
      {admins.isLoading ? <Skeleton height={260} /> : null}
      {admins.data && !list.length ? <EmptyState icon="users" title="אין משתמשים" /> : null}
      {list.length ? (
        <ListGroup>
          {list.map((user) => (
            <ListRow
              key={user.id}
              icon={user.role === 'owner' ? 'star' : 'user'}
              iconTone={!user.active ? 'danger' : user.role === 'owner' ? 'amber' : 'mint'}
              title={user.label}
              subtitle={[
                displayPhone(user.phone),
                !user.active ? 'מושעה' : user.lastSeenAt ? `נראה ${timeAgo(user.lastSeenAt)}` : user.invitedAt ? 'הוזמן, עוד לא נכנס' : 'עוד לא נכנס',
                user.sharedWhatsapp && user.role !== 'owner' ? 'WhatsApp משותף' : null,
              ].filter(Boolean).join(' · ')}
              right={user.role === 'owner' ? <Pill label="בעלים" tone="amber" /> : !user.active ? <Pill label="מושעה" tone="danger" /> : undefined}
              onPress={() => setEditing(user)}
            />
          ))}
        </ListGroup>
      ) : null}
      <Txt variant="caption" color={c.muted} style={{ lineHeight: 18 }}>משתמש עם „WhatsApp משותף” עובד על המספר של הבעלים ולא צריך QR משלו. מספר WhatsApp נפרד דורש חיבור נפרד.</Txt>
      <UserSheet user={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

type Form = { label: string; phone: string; email: string; permissions: Permission[]; sharedWhatsapp: boolean };

function UserSheet({ user, onClose }: { user: Admin | 'new' | null; onClose: () => void }) {
  const { c } = useTheme();
  const toast = useToast();
  const client = useQueryClient();
  const { admin: me } = useSession();
  const [form, setForm] = useState<Form>({ label: '', phone: '', email: '', permissions: defaultPermissions, sharedWhatsapp: true });
  const [pin, setPin] = useState('');
  const existing = user && user !== 'new' ? user : null;
  const isOwnerRow = existing?.role === 'owner';
  const isMe = existing?.id === me?.id;

  useEffect(() => {
    setPin('');
    setForm(existing
      ? { label: existing.label, phone: displayPhone(existing.phone), email: existing.email ?? '', permissions: existing.permissions, sharedWhatsapp: existing.sharedWhatsapp }
      : { label: '', phone: '', email: '', permissions: defaultPermissions, sharedWhatsapp: true });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => client.invalidateQueries({ queryKey: getListAdminsQueryKey() });
  const done = async (message: string, close = true) => { await refresh(); toast.show(message); if (close) onClose(); };

  const save = useMutation({
    mutationFn: () => existing
      ? updateAdmin(existing.id, isOwnerRow || isMe
        ? { label: form.label.trim(), email: form.email.trim() || null }
        : { label: form.label.trim(), phone: form.phone.replace(/\D/g, ''), email: form.email.trim() || null, permissions: form.permissions, sharedWhatsapp: form.sharedWhatsapp })
      : createAdmin({ phone: form.phone.replace(/\D/g, ''), label: form.label.trim(), email: form.email.trim() || undefined, permissions: form.permissions, sharedWhatsapp: form.sharedWhatsapp }),
    onSuccess: (saved) => done(existing ? 'הפרטים נשמרו' : `${saved.label} נוסף/ה. אפשר לשלוח הזמנה ב־WhatsApp.`),
    onError: (error) => toast.error(error),
  });
  const setActive = useMutation({
    mutationFn: (active: boolean) => updateAdmin(existing!.id, { active }),
    onSuccess: (_, active) => done(active ? `${existing!.label} פעיל/ה שוב` : `${existing!.label} הושעה/תה ונותק/ה`),
    onError: (error) => toast.error(error),
  });
  const invite = useMutation({
    mutationFn: () => inviteAdmin(existing!.id),
    onSuccess: async (result) => {
      await refresh();
      if (result.sent) toast.show(`ההזמנה נשלחה ל־${existing!.label} ב־WhatsApp`);
      else {
        toast.show('WhatsApp לא מחובר — שתפו את הקישור ידנית', 'info');
        await Share.share({ message: `הוזמנת לנהל את המחירון: ${result.link}` }).catch(() => undefined);
      }
    },
    onError: (error) => toast.error(error),
  });
  const revoke = useMutation({
    mutationFn: () => revokeAdminSessions(existing!.id),
    onSuccess: () => done(`${existing!.label} נותק/ה מכל המכשירים`, false),
    onError: (error) => toast.error(error),
  });
  const savePin = useMutation({
    mutationFn: () => setAdminCode(existing!.id, { code: pin }),
    onSuccess: () => { setPin(''); return done('הקוד האישי נשמר', false); },
    onError: (error) => toast.error(error),
  });
  const remove = useMutation({
    mutationFn: () => deleteAdmin(existing!.id),
    onSuccess: () => done(`${existing!.label} נמחק/ה`),
    onError: (error) => toast.error(error),
  });

  const togglePermission = (permission: Permission, on: boolean) =>
    setForm((current) => ({ ...current, permissions: on ? [...new Set([...current.permissions, permission])] : current.permissions.filter((item) => item !== permission) }));

  const canSave = form.label.trim().length > 0 && form.phone.replace(/\D/g, '').length >= 9;

  return (
    <Sheet
      visible={user !== null}
      onClose={onClose}
      title={existing ? existing.label : 'משתמש חדש'}
      footer={<Button title={existing ? 'שמירה' : 'הוספת משתמש'} icon="check" style={{ flex: 1 }} disabled={!canSave} loading={save.isPending} onPress={() => save.mutate()} />}
    >
      <Field label="שם" value={form.label} onChangeText={(label) => setForm({ ...form, label })} placeholder="למשל: יצחק" />
      <Field label="טלפון" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} keyboardType="phone-pad" placeholder="050-000-0000" ltr editable={!isOwnerRow && !isMe} />
      <Field label="אימייל (לא חובה)" value={form.email} onChangeText={(email) => setForm({ ...form, email })} keyboardType="email-address" autoCapitalize="none" ltr />

      {!isOwnerRow && !isMe ? (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodySemi">עובד על ה־WhatsApp של הבעלים</Txt>
              <Txt variant="caption" color={c.muted}>בלי QR משלו. כבוי = מספר WhatsApp נפרד שדורש חיבור משלו.</Txt>
            </View>
            <Toggle label="WhatsApp משותף" value={form.sharedWhatsapp} onChange={(sharedWhatsapp) => setForm({ ...form, sharedWhatsapp })} />
          </Card>
          <Txt variant="h3">הרשאות</Txt>
          <ListGroup>
            {allPermissions.map((permission) => (
              <ListRow
                key={permission}
                title={permissionLabels[permission]}
                chevron={false}
                right={<Toggle label={permissionLabels[permission]} value={form.permissions.includes(permission)} onChange={(on) => togglePermission(permission, on)} />}
              />
            ))}
          </ListGroup>
        </>
      ) : null}

      {existing ? (
        <>
          <Txt variant="h3">פעולות</Txt>
          <ListGroup>
            {!isOwnerRow ? <ListRow icon="send" title="שליחת הזמנה ב־WhatsApp" subtitle="קישור כניסה אישי" onPress={() => invite.mutate()} /> : null}
            <ListRow
              icon="smartphone"
              title="ניתוק מכל המכשירים"
              subtitle="למשל אם טלפון אבד"
              onPress={async () => { if (await confirm(`לנתק את ${existing.label}?`, 'כל הכניסות הפעילות שלו/ה ייסגרו.', 'ניתוק')) revoke.mutate(); }}
            />
            {!isOwnerRow && !isMe ? (
              <ListRow
                icon={existing.active ? 'pause-circle' : 'play-circle'}
                iconTone={existing.active ? 'amber' : 'mint'}
                title={existing.active ? 'השעיית המשתמש' : 'החזרת המשתמש'}
                subtitle={existing.active ? 'ינותק מיד, אפשר להחזיר בכל רגע' : undefined}
                onPress={async () => {
                  if (!existing.active || await confirm(`להשעות את ${existing.label}?`, 'הוא/היא ינותק/ו מיד מכל המכשירים.', 'השעיה')) setActive.mutate(!existing.active);
                }}
              />
            ) : null}
            {!isOwnerRow && !isMe ? (
              <ListRow
                icon="trash-2"
                iconTone="danger"
                danger
                title="מחיקה לצמיתות"
                onPress={async () => { if (await confirm(`למחוק את ${existing.label}?`, 'היעדים והבקשות שלו/ה יימחקו. אפשר במקום זה להשעות.', 'מחיקה')) remove.mutate(); }}
              />
            ) : null}
          </ListGroup>
          {me?.role === 'owner' ? (
            <Card style={{ gap: 10 }}>
              <Txt variant="bodySemi">קוד אישי (כניסה בלי WhatsApp)</Txt>
              <Row gap={10}>
                <Field value={pin} onChangeText={(text) => setPin(text.replace(/\D/g, '').slice(0, 8))} placeholder="4–8 ספרות" keyboardType="number-pad" secureTextEntry ltr style={{ flex: 1 }} />
                <Button title="שמירה" size="md" variant="secondary" disabled={pin.length < 4} loading={savePin.isPending} onPress={() => savePin.mutate()} />
              </Row>
              <Txt variant="caption" color={c.muted}>{existing.hasPin ? 'כבר מוגדר קוד — שמירה תחליף אותו.' : 'עדיין לא הוגדר קוד אישי.'}</Txt>
            </Card>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
