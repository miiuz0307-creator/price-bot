import React, { useState } from 'react';
import { View } from 'react-native';
import { getListAuditLogQueryKey, useGetSystemOverview, useListAuditLog, type AuditEntry } from '@workspace/api-client-react';
import { FeedRow } from '@/components/FeedRow';
import type { IconName } from '@/components/Icon';
import { BackHeader, Card, EmptyState, ErrorState, Row, Screen, Segmented, SectionTitle, Skeleton, StatusDot, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { actionLabel, displayPhone, isProblemAction, number, timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function ActivityScreen() {
  const { c } = useTheme();
  const overview = useGetSystemOverview();
  const log = useListAuditLog({ limit: 100 }, { query: { queryKey: getListAuditLogQueryKey({ limit: 100 }), refetchInterval: 30_000 } });
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const entries = (log.data ?? []).filter((entry) => filter === 'all' || isProblemAction(entry.action));
  const data = overview.data;

  return (
    <Screen refreshing={log.isRefetching} onRefresh={() => { void overview.refetch(); void log.refetch(); }}>
      <BackHeader title="מערכת ופעילות" />
      {overview.isError ? <ErrorState message={errorMessage(overview.error)} onRetry={() => overview.refetch()} /> : null}
      {overview.isLoading ? <Skeleton height={120} /> : data ? (
        <>
          <Row gap={10}>
            <Mini label="משתמשים פעילים" value={number(data.activeUsers)} />
            <Mini label="מושעים" value={number(data.suspendedUsers)} />
            <Mini label="בקשות פתוחות" value={number(data.pendingLookups)} amber={data.pendingLookups > 0} />
            <Mini label="מחירי עומס" value={number(data.activeSurges)} />
          </Row>
          <SectionTitle title="חיבורי WhatsApp" />
          {data.connections.map((connection) => (
            <Card key={connection.adminId} tone={connection.connected ? 'default' : 'danger'} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <StatusDot color={connection.connected ? c.mint : c.danger} size={10} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodySemi">{connection.label}</Txt>
                <Txt variant="caption" color={connection.connected ? c.muted : c.dangerSub}>
                  {connection.connected ? displayPhone(connection.phoneNumber) : connection.lastError || 'לא מחובר'}
                  {connection.sharedUsers ? ` · ${connection.sharedUsers} משתמשים משותפים` : ''}
                </Txt>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle title="יומן פעילות" />
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'הכול' }, { value: 'problems', label: 'תקלות ואזהרות' }]} />
      {log.isError ? <ErrorState message={errorMessage(log.error)} onRetry={() => log.refetch()} /> : null}
      {log.isLoading ? <Skeleton height={300} /> : entries.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {entries.map((entry, index) => <Entry key={entry.id} entry={entry} last={index === entries.length - 1} />)}
        </Card>
      ) : log.data ? <EmptyState icon="check-circle" title={filter === 'problems' ? 'אין תקלות' : 'אין פעילות'} /> : null}
    </Screen>
  );
}

function Mini({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  const { c } = useTheme();
  return (
    <Card tone={amber ? 'amber' : 'default'} style={{ flex: 1, padding: 10, gap: 4, borderRadius: 16 }}>
      <Txt variant="num" color={amber ? c.amber : c.text} center>{value}</Txt>
      <Txt variant="caption" color={amber ? c.amberSub : c.muted} center style={{ fontSize: 11, lineHeight: 14 }}>{label}</Txt>
    </Card>
  );
}

function Entry({ entry, last }: { entry: AuditEntry; last: boolean }) {
  const problem = isProblemAction(entry.action);
  const area = entry.action.split('.')[0];
  const icons: Record<string, IconName> = { whatsapp: 'whatsapp', product: 'tag', lookup: 'inbox', surge: 'flame', auth: 'log-in', user: 'user', target: 'message-circle', abbreviation: 'type', push: 'bell' };
  const details = entry.details as Record<string, unknown>;
  const extra = typeof details.label === 'string' ? details.label : typeof details.detail === 'string' ? details.detail : null;
  return (
    <FeedRow
      icon={icons[area] ?? 'circle'}
      tone={problem ? 'danger' : area === 'surge' ? 'amber' : 'mint'}
      title={actionLabel(entry.action)}
      subtitle={[entry.actorLabel, extra].filter(Boolean).join(' · ') || undefined}
      time={timeAgo(entry.createdAt)}
      last={last}
    />
  );
}
