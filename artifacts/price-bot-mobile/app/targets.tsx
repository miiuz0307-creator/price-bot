import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createTarget, deleteTarget, getListTargetsQueryKey, getListWhatsAppGroupsQueryKey, updateTarget,
  useListTargets, useListWhatsAppGroups, type Target, type TargetInputKind,
} from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { BackHeader, Button, EmptyState, ErrorState, Field, ListGroup, ListRow, Press, Row, Screen, SearchField, Segmented, Sheet, Skeleton, Toggle, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { displayPhone } from '@/lib/format';
import { useWhatsApp } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function TargetsScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const { can } = useSession();
  const client = useQueryClient();
  const targets = useListTargets();
  const canManage = can('targets.manage');
  const [adding, setAdding] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: getListTargetsQueryKey() });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => updateTarget(id, { active }),
    onSuccess: refresh,
    onError: (error) => toast.error(error),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteTarget(id),
    onSuccess: async () => { await refresh(); toast.show('היעד הוסר', 'info'); },
    onError: (error) => toast.error(error),
  });

  const list = [...(targets.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, 'he'));
  const groups = list.filter((target) => target.kind === 'group');
  const contacts = list.filter((target) => target.kind !== 'group');

  const row = (target: Target) => (
    <ListRow
      key={target.id}
      icon={target.kind === 'group' ? 'users' : 'user'}
      iconTone={target.active ? 'mint' : 'muted'}
      title={target.label}
      subtitle={`${target.kind === 'group' ? 'קבוצה' : displayPhone(target.identifier)}${target.active ? '' : ' · מושהה'}`}
      chevron={false}
      right={canManage ? (
        <Row gap={8}>
          <Toggle label={`הבוט פעיל ב${target.label}`} value={target.active} onChange={(active) => toggle.mutate({ id: target.id, active })} />
          <Press
            accessibilityLabel={`מחיקת ${target.label}`}
            onPress={async () => { if (await confirm('להסיר את היעד?', `הבוט יפסיק לענות ב„${target.label}”.`, 'הסרה')) remove.mutate(target.id); }}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="trash-2" size={18} color={c.faint} />
          </Press>
        </Row>
      ) : undefined}
    />
  );

  return (
    <Screen refreshing={targets.isRefetching} onRefresh={() => targets.refetch()}>
      <BackHeader title="יעדים" action={canManage ? <Button title="הוספה" icon="plus" size="md" onPress={() => setAdding(true)} /> : undefined} />
      <Txt variant="label" color={c.muted} style={{ lineHeight: 20 }}>הבוט עונה רק בשיחות ובקבוצות שברשימה. השהיה עוצרת את התשובות בלי למחוק.</Txt>
      {targets.isError ? <ErrorState message={errorMessage(targets.error)} onRetry={() => targets.refetch()} /> : null}
      {targets.isLoading ? <Skeleton height={240} /> : null}
      {targets.data && !list.length ? <EmptyState icon="message-circle" title="אין עדיין יעדים" text="הוסיפו קבוצת נהגים או איש קשר כדי שהבוט יתחיל לענות." /> : null}
      {groups.length ? <><Txt variant="h3">קבוצות · {groups.length}</Txt><ListGroup>{groups.map(row)}</ListGroup></> : null}
      {contacts.length ? <><Txt variant="h3">אנשי קשר · {contacts.length}</Txt><ListGroup>{contacts.map(row)}</ListGroup></> : null}
      <AddTarget visible={adding} onClose={() => setAdding(false)} existing={list} onAdded={refresh} />
    </Screen>
  );
}

function AddTarget({ visible, onClose, existing, onAdded }: { visible: boolean; onClose: () => void; existing: Target[]; onAdded: () => Promise<unknown> }) {
  const { c } = useTheme();
  const toast = useToast();
  const whatsapp = useWhatsApp();
  const [kind, setKind] = useState<TargetInputKind>('group');
  const [label, setLabel] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [query, setQuery] = useState('');
  const groups = useListWhatsAppGroups({ query: { queryKey: getListWhatsAppGroupsQueryKey(), enabled: visible && kind === 'group' && Boolean(whatsapp.data?.connected) } });
  useEffect(() => { if (visible) { setLabel(''); setIdentifier(''); setQuery(''); } }, [visible, kind]);

  const add = useMutation({
    mutationFn: () => createTarget({ kind, identifier: kind === 'contact' ? identifier.replace(/\D/g, '') : identifier, label: label.trim() || identifier }),
    onSuccess: async () => { await onAdded(); toast.show('היעד נוסף — הבוט יענה בו מעכשיו'); onClose(); },
    onError: (error) => toast.error(error),
  });

  const known = new Set(existing.map((target) => target.identifier));
  const shown = (groups.data ?? []).filter((group) => !known.has(group.identifier) && group.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="יעד חדש"
      footer={<Button title="הוספה" icon="check" style={{ flex: 1 }} disabled={!identifier || (kind === 'contact' && identifier.replace(/\D/g, '').length < 9)} loading={add.isPending} onPress={() => add.mutate()} />}
    >
      <Segmented<TargetInputKind> value={kind} onChange={setKind} options={[{ value: 'group', label: 'קבוצה' }, { value: 'contact', label: 'איש קשר' }]} />
      {kind === 'contact' ? (
        <>
          <Field label="מספר טלפון" value={identifier} onChangeText={setIdentifier} keyboardType="phone-pad" placeholder="050-000-0000" ltr />
          <Field label="שם (לא חובה)" value={label} onChangeText={setLabel} placeholder="למשל: דני נהג" />
        </>
      ) : !whatsapp.data?.connected ? (
        <Txt variant="label" color={c.muted}>כדי לבחור קבוצה צריך ש־WhatsApp של הבוט יהיה מחובר.</Txt>
      ) : (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="חיפוש קבוצה" />
          {groups.isLoading ? <Skeleton height={160} /> : groups.isError ? <ErrorState message={errorMessage(groups.error)} /> : shown.map((group) => {
            const on = identifier === group.identifier;
            return (
              <Press
                key={group.identifier}
                onPress={() => { setIdentifier(group.identifier); setLabel(group.label); }}
                accessibilityState={{ selected: on }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: on ? c.mintTint : c.surface, borderWidth: 1, borderColor: on ? c.mint : c.line }}
              >
                <Icon name={on ? 'check-circle' : 'circle'} size={20} color={on ? c.mint : c.faint} />
                <Txt variant="bodyMedium" style={{ flex: 1 }}>{group.label}</Txt>
              </Press>
            );
          })}
          {!groups.isLoading && !shown.length ? <View><Txt variant="label" color={c.muted} center>כל הקבוצות כבר ברשימה, או שלא נמצאו קבוצות</Txt></View> : null}
        </>
      )}
    </Sheet>
  );
}
