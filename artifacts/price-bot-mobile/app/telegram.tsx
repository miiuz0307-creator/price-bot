import React, { useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { getListTelegramUsersQueryKey, useGetTelegramStatus, useListTelegramUsers } from '@workspace/api-client-react';
import { BackHeader, Card, EmptyState, ErrorState, Field, ListGroup, ListRow, Pill, Row, Screen, SectionTitle, Skeleton, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { number, timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const dayMs = 24 * 60 * 60 * 1000;

export default function TelegramUsersScreen() {
  const { c } = useTheme();
  const status = useGetTelegramStatus();
  const users = useListTelegramUsers({ query: { queryKey: getListTelegramUsersQueryKey(), refetchInterval: 30_000 } });
  const [query, setQuery] = useState('');
  const rows = users.data ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, '');
    if (!needle) return rows;
    return rows.filter((row) => [row.name, row.username ?? '', row.lastChatTitle ?? ''].some((value) => value.toLowerCase().includes(needle)));
  }, [rows, query]);
  const now = Date.now();
  const today = rows.filter((row) => now - new Date(row.lastSeenAt).getTime() < dayMs).length;
  const newThisWeek = rows.filter((row) => now - new Date(row.firstSeenAt).getTime() < 7 * dayMs).length;
  const botName = status.data?.username;

  return (
    <Screen refreshing={users.isRefetching} onRefresh={() => { void users.refetch(); void status.refetch(); }}>
      <BackHeader title="משתמשי טלגרם" />
      {status.data ? (
        <Row gap={8} style={{ alignItems: 'center' }}>
          <Pill label={status.data.connected ? 'הבוט מחובר' : status.data.configured ? 'הבוט לא מחובר' : 'הבוט לא מוגדר'} tone={status.data.connected ? 'mint' : 'danger'} />
          {botName ? <Txt variant="label" color={c.mint} onPress={() => void Linking.openURL(`https://t.me/${botName}`)}>@{botName}</Txt> : null}
        </Row>
      ) : null}
      <Row gap={10}>
        <Mini label="משתמשים" value={users.data ? number(rows.length) : '—'} />
        <Mini label="פעילים היום" value={users.data ? number(today) : '—'} />
        <Mini label="חדשים השבוע" value={users.data ? number(newThisWeek) : '—'} />
      </Row>

      <SectionTitle title="מי משתמש בבוט" />
      {rows.length > 5 ? <Field label="חיפוש" value={query} onChangeText={setQuery} placeholder="שם או משתמש" /> : null}
      {users.isError ? <ErrorState message={errorMessage(users.error)} onRetry={() => users.refetch()} /> : null}
      {users.isLoading ? <Skeleton height={260} /> : null}
      {users.data && !rows.length ? <EmptyState icon="send" title="עדיין אף אחד לא כתב לבוט" text="ברגע שמישהו ישלח הודעה לבוט בטלגרם, הוא יופיע כאן." /> : null}
      {rows.length && !filtered.length ? <Txt variant="caption" color={c.muted}>לא נמצאו משתמשים שמתאימים לחיפוש.</Txt> : null}
      {filtered.length ? (
        <ListGroup>
          {filtered.map((user) => (
            <ListRow
              key={user.id}
              icon={user.lastChatType === 'group' ? 'users' : 'user'}
              iconTone={now - new Date(user.lastSeenAt).getTime() < dayMs ? 'mint' : 'muted'}
              title={user.username ? `${user.name} · @${user.username}` : user.name}
              subtitle={[
                user.lastMessage ? `„${user.lastMessage}”` : null,
                `${number(user.messageCount)} הודעות`,
                user.lastChatType === 'group' ? `בקבוצה ${user.lastChatTitle ?? ''}`.trim() : null,
              ].filter(Boolean).join(' · ')}
              value={timeAgo(user.lastSeenAt)}
              onPress={user.username ? () => void Linking.openURL(`https://t.me/${user.username}`) : undefined}
            />
          ))}
        </ListGroup>
      ) : null}
      <Txt variant="caption" color={c.muted} style={{ lineHeight: 18 }}>לחיצה על משתמש עם שם משתמש פותחת איתו שיחה בטלגרם.</Txt>
    </Screen>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <Card style={{ flex: 1, padding: 10, gap: 4, borderRadius: 16 }}>
      <Txt variant="num" center>{value}</Txt>
      <Txt variant="caption" color={c.muted} center style={{ fontSize: 11, lineHeight: 14 }}>{label}</Txt>
    </Card>
  );
}
