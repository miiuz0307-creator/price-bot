import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { updateAdmin, useListAdmins, useListTargets, type PushPreferences } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import type { Admin } from '@workspace/api-client-react';
import { Button, Card, Field, ListGroup, ListRow, Press, Row, Screen, Segmented, SectionTitle, Sheet, Toggle, Txt } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { displayPhone } from '@/lib/format';
import { registerForPush, type PushState } from '@/lib/push';
import { useWhatsApp } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme, type ThemeMode } from '@/lib/theme';

const pushRows: { key: keyof PushPreferences; title: string; subtitle: string }[] = [
  { key: 'lookups', title: 'בקשת מחיר שממתינה לאישור', subtitle: 'כשהבוט לא מצא מסלול במחירון' },
  { key: 'whatsapp', title: 'WhatsApp התנתק', subtitle: 'כשהבוט מפסיק לענות, וכשהוא חוזר' },
  { key: 'surge', title: 'מחיר עומס חדש', subtitle: 'מחיר גבוה מהמחירון בקבוצות שבמעקב' },
];

export default function MoreScreen() {
  const { c, mode, setMode } = useTheme();
  const toast = useToast();
  const { admin, can, signOut, biometric, setAdmin } = useSession();
  const [editingMe, setEditingMe] = useState(false);
  const whatsapp = useWhatsApp();
  const targets = useListTargets();
  const admins = useListAdmins();
  const [push, setPush] = useState<PushState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void registerForPush().then(setPush); }, []);

  const changePush = async (key: keyof PushPreferences, value: boolean) => {
    if (!push?.ok) return;
    const next = { ...push.preferences, [key]: value };
    setPush({ ok: true, preferences: next });
    setSaving(true);
    const result = await registerForPush(next);
    setSaving(false);
    if (!result.ok) { toast.show('לא הצלחתי לשמור את הגדרת ההתראות', 'error'); setPush(result); } else setPush(result);
  };

  const pushNote = !push ? 'בודק…'
    : push.ok ? null
      : push.reason === 'not-configured' ? 'התראות לטלפון יופעלו אחרי חיבור Firebase (הגדרה חד־פעמית של בעל המערכת). עד אז אפשר לראות הכול כאן באפליקציה.'
        : push.reason === 'denied' ? 'ההתראות חסומות בהגדרות הטלפון.'
          : push.reason === 'unsupported' ? 'התראות זמינות באפליקציה שמותקנת בטלפון.'
            : 'לא הצלחתי להפעיל התראות כרגע. נסו שוב מאוחר יותר.';

  const isOwner = admin?.role === 'owner';
  const connected = whatsapp.data?.connected;

  return (
    <Screen>
      <Press onPress={() => setEditingMe(true)} accessibilityLabel="הפרטים שלי" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.mintSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="h2" color={c.mint} center>{admin?.label.trim().charAt(0) ?? ''}</Txt>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h2" style={{ fontSize: 20 }}>{admin?.label}</Txt>
          <Txt variant="label" color={c.muted}>{isOwner ? 'בעלים' : admin?.sharedWhatsapp ? 'מנהל · עובד על ה־WhatsApp של הבעלים' : 'מנהל'} · {displayPhone(admin?.phone)}</Txt>
          <Txt variant="caption" color={admin?.email ? c.muted : c.amber}>{admin?.email ? admin.email : 'לא שמור אימייל — הקישו כדי להוסיף'}</Txt>
        </View>
        <Icon name="edit-2" size={18} color={c.faint} />
      </Press>
      <MyDetails visible={editingMe} onClose={() => setEditingMe(false)} onSaved={setAdmin} />

      <SectionTitle title="ניהול" />
      <ListGroup>
        <ListRow icon="whatsapp" title="חיבור WhatsApp" value={whatsapp.data ? (connected ? 'מחובר' : 'לא מחובר') : undefined} iconTone={whatsapp.data && !connected ? 'danger' : 'mint'} onPress={() => router.push('/whatsapp')} />
        <ListRow icon="message-circle" title="יעדים: אנשי קשר וקבוצות" value={targets.data ? String(targets.data.length) : undefined} onPress={() => router.push('/targets')} />
        <ListRow icon="type" title="קיצורים" subtitle="למשל „בב” = בני ברק" onPress={() => router.push('/abbreviations')} />
        {can('users.manage') ? <ListRow icon="users" title="משתמשים והרשאות" value={admins.data ? String(admins.data.length) : undefined} onPress={() => router.push('/users')} /> : null}
        {can('users.manage') ? <ListRow icon="activity" title="מערכת ופעילות" onPress={() => router.push('/activity')} /> : null}
      </ListGroup>

      <SectionTitle title="התראות לטלפון" />
      <ListGroup>
        {pushRows.map((row) => (
          <ListRow
            key={row.key}
            title={row.title}
            subtitle={row.subtitle}
            chevron={false}
            right={(
              <Toggle
                label={row.title}
                value={push?.ok ? push.preferences[row.key] : row.key !== 'surge'}
                disabled={!push?.ok || saving}
                onChange={(value) => void changePush(row.key, value)}
              />
            )}
          />
        ))}
      </ListGroup>
      {pushNote ? (
        <Card style={{ gap: 10, padding: 14 }}>
          <Txt variant="label" color={c.muted} style={{ lineHeight: 20 }}>{pushNote}</Txt>
          {push && !push.ok && push.reason === 'denied' ? <Button title="פתיחת הגדרות הטלפון" icon="settings" variant="secondary" size="md" onPress={() => void Linking.openSettings()} /> : null}
        </Card>
      ) : null}

      <SectionTitle title="אבטחה ותצוגה" />
      <ListGroup>
        {biometric.available ? (
          <ListRow
            icon="lock"
            title="נעילה בטביעת אצבע / זיהוי פנים"
            subtitle="בכל פתיחה של האפליקציה"
            chevron={false}
            right={<Toggle label="נעילה ביומטרית" value={biometric.enabled} onChange={biometric.setEnabled} />}
          />
        ) : null}
        <View style={{ padding: 14, gap: 10 }}>
          <Txt variant="bodyMedium">ערכת צבעים</Txt>
          <Segmented<ThemeMode>
            value={mode}
            onChange={setMode}
            options={[{ value: 'system', label: 'לפי הטלפון' }, { value: 'dark', label: 'כהה' }, { value: 'light', label: 'בהירה' }]}
          />
        </View>
      </ListGroup>

      <Button
        title="יציאה מהחשבון"
        icon="log-out"
        variant="ghost"
        onPress={async () => { if (await confirm('לצאת מהחשבון?', 'תצטרכו להתחבר שוב עם קוד מ־WhatsApp או קוד אישי.', 'יציאה')) void signOut(); }}
      />
      <Txt variant="caption" color={c.faint} center>
        מחירון {Constants.expoConfig?.version ?? ''} · {apiUrl ? apiUrl.replace(/^https?:\/\//, '') : 'אותו שרת'}
      </Txt>
    </Screen>
  );
}

function MyDetails({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: (admin: Admin) => void }) {
  const toast = useToast();
  const { admin } = useSession();
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => { if (visible) { setLabel(admin?.label ?? ''); setEmail(admin?.email ?? ''); } }, [visible, admin]);
  const save = useMutation({
    mutationFn: () => updateAdmin(admin!.id, { label: label.trim(), email: email.trim() || null }),
    onSuccess: (saved) => { onSaved(saved); toast.show('הפרטים נשמרו'); onClose(); },
    onError: (error) => toast.error(error),
  });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="הפרטים שלי"
      footer={<Button title="שמירה" icon="check" style={{ flex: 1 }} disabled={!label.trim()} loading={save.isPending} onPress={() => save.mutate()} />}
    >
      <Field label="שם" value={label} onChangeText={setLabel} />
      <Field label="אימייל" hint="אחרי השמירה אפשר להיכנס גם עם האימייל. הקוד נשלח תמיד ב־WhatsApp לטלפון שלכם." value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} ltr />
    </Sheet>
  );
}
