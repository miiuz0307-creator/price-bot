import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createAbbreviation, deleteAbbreviation, getListAbbreviationsQueryKey, updateAbbreviation,
  useListAbbreviations, type Abbreviation,
} from '@workspace/api-client-react';
import { useToast } from '@/components/Toast';
import { BackHeader, Button, EmptyState, ErrorState, Field, ListGroup, ListRow, Screen, SearchField, Sheet, Skeleton, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { searchKey } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function AbbreviationsScreen() {
  const { c } = useTheme();
  const { can } = useSession();
  const list = useListAbbreviations();
  const canEdit = can('catalog.edit');
  const [editing, setEditing] = useState<Abbreviation | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const shown = (list.data ?? [])
    .filter((item) => !query.trim() || searchKey(`${item.shortcut} ${item.expansion}`).includes(searchKey(query)))
    .sort((a, b) => a.shortcut.localeCompare(b.shortcut, 'he'));

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      <BackHeader title="קיצורים" action={canEdit ? <Button title="הוספה" icon="plus" size="md" onPress={() => setEditing('new')} /> : undefined} />
      <Txt variant="label" color={c.muted} style={{ lineHeight: 20 }}>קיצור שהלקוחות כותבים, והשם המלא שהבוט מחפש במחירון. למשל: „בב” ← בני ברק.</Txt>
      {(list.data?.length ?? 0) > 8 ? <SearchField value={query} onChangeText={setQuery} placeholder="חיפוש קיצור" /> : null}
      {list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /> : null}
      {list.isLoading ? <Skeleton height={220} /> : null}
      {list.data && !list.data.length ? <EmptyState icon="type" title="אין קיצורים מותאמים" text="הקיצורים המובנים של הבוט עובדים גם בלי להוסיף כאן." /> : null}
      {shown.length ? (
        <ListGroup>
          {shown.map((item) => (
            <ListRow key={item.id} title={item.shortcut} subtitle={`← ${item.expansion}`} onPress={canEdit ? () => setEditing(item) : undefined} />
          ))}
        </ListGroup>
      ) : null}
      <EditAbbreviation item={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function EditAbbreviation({ item, onClose }: { item: Abbreviation | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const [shortcut, setShortcut] = useState('');
  const [expansion, setExpansion] = useState('');
  useEffect(() => {
    setShortcut(item && item !== 'new' ? item.shortcut : '');
    setExpansion(item && item !== 'new' ? item.expansion : '');
  }, [item]);
  const done = async (message: string) => { await client.invalidateQueries({ queryKey: getListAbbreviationsQueryKey() }); toast.show(message); onClose(); };
  const save = useMutation({
    mutationFn: () => (item && item !== 'new'
      ? updateAbbreviation(item.id, { shortcut: shortcut.trim(), expansion: expansion.trim() })
      : createAbbreviation({ shortcut: shortcut.trim(), expansion: expansion.trim() })),
    onSuccess: () => done('הקיצור נשמר'),
    onError: (error) => toast.error(error),
  });
  const remove = useMutation({
    mutationFn: () => deleteAbbreviation((item as Abbreviation).id),
    onSuccess: () => done('הקיצור נמחק'),
    onError: (error) => toast.error(error),
  });
  const existing = item && item !== 'new';
  return (
    <Sheet
      visible={item !== null}
      onClose={onClose}
      title={existing ? 'עריכת קיצור' : 'קיצור חדש'}
      footer={(
        <>
          <Button title="שמירה" icon="check" style={{ flex: 1 }} disabled={!shortcut.trim() || !expansion.trim()} loading={save.isPending} onPress={() => save.mutate()} />
          {existing ? (
            <Button
              icon="trash-2"
              variant="danger"
              accessibilityLabel="מחיקה"
              loading={remove.isPending}
              onPress={async () => { if (await confirm('למחוק את הקיצור?', `„${shortcut}” לא יזוהה יותר.`, 'מחיקה')) remove.mutate(); }}
            />
          ) : null}
        </>
      )}
    >
      <Field label="קיצור" value={shortcut} onChangeText={setShortcut} placeholder="בב" autoCapitalize="none" />
      <Field label="שם מלא" value={expansion} onChangeText={setExpansion} placeholder="בני ברק" />
    </Sheet>
  );
}
