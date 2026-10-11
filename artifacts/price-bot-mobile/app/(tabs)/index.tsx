import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  getListAuditLogQueryKey, useGetDashboardSummary, useListAuditLog, type AuditEntry,
} from '@workspace/api-client-react';
import { Icon, type IconName } from '@/components/Icon';
import { FeedRow } from '@/components/FeedRow';
import { Button, Card, ErrorState, IconButton, Press, Row, Screen, SectionTitle, Skeleton, StatusDot, Txt } from '@/components/ui';
import { actionLabel, displayPhone, firstName, greeting, isProblemAction, number, shekel, timeAgo } from '@/lib/format';
import { usePendingRequests, useSurge, useWhatsApp, useInvalidate } from '@/lib/queries';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function HomeScreen() {
  const { c } = useTheme();
  const { admin, can } = useSession();
  const summary = useGetDashboardSummary();
  const whatsapp = useWhatsApp();
  const pending = usePendingRequests();
  const surge = useSurge();
  const canSeeActivity = can('users.manage');
  const activity = useListAuditLog({ limit: 5 }, { query: { queryKey: getListAuditLogQueryKey({ limit: 5 }), enabled: canSeeActivity } });
  const invalidate = useInvalidate();
  const [refreshing, setRefreshing] = React.useState(false);
  const refresh = async () => { setRefreshing(true); await invalidate.all(); setRefreshing(false); };

  const connected = whatsapp.data?.connected;
  const pendingCount = pending.data?.length ?? 0;
  const surgeCount = surge.data?.active ? surge.data.offers.length : 0;
  const problems = (activity.data ?? []).some((entry) => isProblemAction(entry.action) && Date.now() - new Date(entry.createdAt).getTime() < 86_400_000);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Txt variant="label" color={c.muted} style={{ fontSize: 14 }}>{greeting()}</Txt>
          <Txt variant="h1" style={{ fontSize: 26 }}>{admin ? firstName(admin.label) : ''}</Txt>
        </View>
        <IconButton icon="bell" label="התראות ופעילות" badge={problems || pendingCount > 0} onPress={() => router.push(canSeeActivity ? '/activity' : '/requests')} />
      </Row>

      <Animated.View entering={FadeInDown.duration(350)}>
        {whatsapp.isLoading ? <Skeleton height={70} /> : (
          <Card
            tone={connected ? 'mint' : 'danger'}
            onPress={() => router.push('/whatsapp')}
            accessibilityLabel="מצב חיבור WhatsApp"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderRadius: 18 }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: connected ? c.mint : c.danger, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="whatsapp" size={20} color={connected ? c.onMint : '#fff'} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodySemi" color={connected ? c.text : c.dangerText}>
                {connected ? 'הבוט מחובר ועונה' : whatsapp.data?.connectionState === 'initializing' ? 'מתחבר ל־WhatsApp…' : 'הבוט לא מחובר · לא עונה'}
              </Txt>
              <Txt variant="label" color={connected ? c.muted : c.dangerSub}>
                {connected ? displayPhone(whatsapp.data?.phoneNumber) : 'הקישו לחיבור מחדש'}
              </Txt>
            </View>
            <Row gap={6}>
              <StatusDot color={connected ? c.mint : c.danger} />
              <Txt variant="caption" color={connected ? c.mint : c.danger} style={{ fontWeight: '600' }}>{connected ? 'פעיל' : 'מנותק'}</Txt>
            </Row>
          </Card>
        )}
      </Animated.View>

      {summary.isError ? <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} /> : null}

      <Animated.View entering={FadeInDown.delay(60).duration(350)} style={{ gap: 12 }}>
        <Row>
          <Stat
            label="בקשות מחיר"
            value={summary.data ? number(summary.data.lookupCount) : null}
            hint={summary.data?.lastLookupAt ? `אחרונה ${timeAgo(summary.data.lastLookupAt)}` : 'עדיין אין בקשות'}
            hintColor={c.mint}
          />
          <Stat
            label="ממתינות לאישור"
            value={pending.data ? number(pendingCount) : null}
            hint={pendingCount ? 'לטיפול עכשיו ←' : 'הכול מטופל'}
            tone={pendingCount ? 'amber' : 'default'}
            onPress={() => router.push('/requests')}
          />
        </Row>
        <Row>
          <Stat
            label="מסלולים במחירון"
            value={summary.data ? number(summary.data.productCount) : null}
            hint={summary.data ? `${number(summary.data.activeProductCount)} פעילים` : ''}
            onPress={() => router.push('/prices')}
          />
          <Stat
            label="זמני עומס"
            value={surge.data ? number(surgeCount) : null}
            hint={surge.data?.active ? 'מחירים חיים בקבוצות' : 'המעקב כבוי'}
            hintColor={c.amber}
            onPress={() => router.push('/surge')}
          />
        </Row>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(350)}>
        <Row gap={10}>
          <Button title="בדיקת מחיר" icon="search" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/prices', params: { focus: '1' } })} />
          {can('catalog.edit') ? (
            <Button title="מסלול חדש" icon="plus" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/product/edit')} />
          ) : null}
        </Row>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(350)} style={{ gap: 10 }}>
        {canSeeActivity ? (
          <>
            <SectionTitle title="פעילות אחרונה" action={<Press onPress={() => router.push('/activity')}><Txt variant="label" color={c.mint}>הכול</Txt></Press>} />
            {activity.isLoading ? <Skeleton height={180} /> : (
              <Card style={{ padding: 0 }}>
                {(activity.data ?? []).length === 0 ? (
                  <Txt variant="label" color={c.muted} style={{ padding: 16 }}>אין עדיין פעילות</Txt>
                ) : (activity.data ?? []).map((entry, index, list) => (
                  <ActivityRow key={entry.id} entry={entry} last={index === list.length - 1} />
                ))}
              </Card>
            )}
          </>
        ) : pendingCount ? (
          <>
            <SectionTitle title="בקשות אחרונות" action={<Press onPress={() => router.push('/requests')}><Txt variant="label" color={c.mint}>הכול</Txt></Press>} />
            <Card style={{ padding: 0 }}>
              {(pending.data ?? []).slice(0, 4).map((request, index, list) => (
                <FeedRow
                  key={request.id}
                  icon="inbox"
                  tone={request.estimate ? 'amber' : 'muted'}
                  title={request.query}
                  subtitle={request.estimate ? `הערכה ${shekel(request.estimate.priceMatrix[0])}` : 'אין מחיר במחירון'}
                  time={timeAgo(request.createdAt)}
                  last={index === list.length - 1}
                />
              ))}
            </Card>
          </>
        ) : null}
      </Animated.View>
    </Screen>
  );
}

function Stat({ label, value, hint, hintColor, tone = 'default', onPress }: {
  label: string; value: string | null; hint: string; hintColor?: string; tone?: 'default' | 'amber'; onPress?: () => void;
}) {
  const { c } = useTheme();
  const amber = tone === 'amber';
  return (
    <Card tone={amber ? 'amber' : 'default'} onPress={onPress} accessibilityLabel={label} style={{ flex: 1, gap: 10 }}>
      <Txt variant="label" color={amber ? c.amberSub : c.muted}>{label}</Txt>
      {value === null ? <Skeleton height={32} style={{ width: 70, borderRadius: 8, backgroundColor: c.surface2 }} /> : (
        <Txt variant="numXl" color={amber ? c.amber : c.text}>{value}</Txt>
      )}
      <Txt variant="caption" color={amber ? c.amberSub : hintColor ?? c.muted} numberOfLines={1}>{hint}</Txt>
    </Card>
  );
}

function ActivityRow({ entry, last }: { entry: AuditEntry; last: boolean }) {
  const problem = isProblemAction(entry.action);
  const icon: IconName = entry.action.startsWith('whatsapp') ? 'whatsapp' : entry.action.startsWith('product') || entry.action.startsWith('lookup') ? 'tag'
    : entry.action.startsWith('surge') ? 'flame' : entry.action.startsWith('auth') ? 'log-in' : 'user';
  const details = entry.details as Record<string, unknown>;
  const subtitle = [entry.actorLabel, typeof details.label === 'string' ? details.label : null].filter(Boolean).join(' · ');
  return (
    <FeedRow
      icon={icon}
      tone={problem ? 'danger' : entry.action.startsWith('surge') ? 'amber' : 'mint'}
      title={actionLabel(entry.action)}
      subtitle={subtitle || undefined}
      time={timeAgo(entry.createdAt)}
      last={last}
    />
  );
}
