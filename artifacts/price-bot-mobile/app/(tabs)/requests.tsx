import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useMutation } from '@tanstack/react-query';
import { approveLookupEstimate, deleteLookupRequest, type LookupRequest } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Button, Card, EmptyState, ErrorState, PageTitle, Pill, Row, Screen, Skeleton, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { shekel, timeAgo, vehicles } from '@/lib/format';
import { useInvalidate, usePendingRequests } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function RequestsScreen() {
  const { c } = useTheme();
  const requests = usePendingRequests();
  const list = requests.data ?? [];
  return (
    <Screen refreshing={requests.isRefetching} onRefresh={() => requests.refetch()}>
      <PageTitle
        title="בקשות לאישור"
        subtitle={requests.data ? (list.length ? `${list.length} ממתינות · מסלולים שהבוט לא מצא במחירון` : 'אין בקשות פתוחות') : ' '}
      />
      {requests.isError ? <ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} /> : null}
      {requests.isLoading ? [0, 1, 2].map((key) => <Skeleton key={key} height={150} />) : null}
      {requests.data && !list.length ? (
        <EmptyState icon="check-circle" title="הכול מטופל" text="כשמישהו ישאל על מסלול שאין במחירון, הבקשה תופיע כאן — ותקבלו התראה לטלפון." />
      ) : null}
      {list.map((request, index) => (
        <Animated.View key={request.id} entering={FadeInDown.delay(Math.min(index, 6) * 50).duration(320)} exiting={FadeOut.duration(200)} layout={LinearTransition}>
          <RequestCard request={request} />
        </Animated.View>
      ))}
      {list.length ? <Txt variant="caption" color={c.faint} center>מוצגות עד 20 הבקשות האחרונות</Txt> : null}
    </Screen>
  );
}

function RequestCard({ request }: { request: LookupRequest }) {
  const { c } = useTheme();
  const toast = useToast();
  const { can } = useSession();
  const invalidate = useInvalidate();
  const canManage = can('lookups.manage');
  const canAdd = can('catalog.edit');
  const estimate = request.estimate;

  const approve = useMutation({
    mutationFn: () => approveLookupEstimate(request.id),
    onSuccess: async (product) => {
      await Promise.all([invalidate.requests(), invalidate.catalog()]);
      toast.show(`${product.name} נוסף למחירון. מחירים קיימים לא השתנו.`);
    },
    onError: (error) => toast.error(error),
  });
  const dismiss = useMutation({
    mutationFn: () => deleteLookupRequest(request.id),
    onSuccess: async () => { await invalidate.requests(); toast.show('הבקשה נסגרה', 'info'); },
    onError: (error) => toast.error(error),
  });

  const openEditor = () => router.push({
    pathname: '/product/edit',
    params: estimate
      ? { name: estimate.name, matrix: estimate.priceMatrix.join(','), distance: `${Math.round(estimate.distanceKm)} ק״מ`, waitTime: estimate.waitTime ?? '', query: request.query, requestId: String(request.id) }
      : { query: request.query, requestId: String(request.id) },
  });

  const closeButton = canManage ? (
    <Button
      icon="x"
      variant="ghost"
      accessibilityLabel="סגירה ללא הוספה"
      loading={dismiss.isPending}
      onPress={async () => { if (await confirm('לסגור את הבקשה?', `„${request.query}” תוסר מהרשימה בלי להוסיף למחירון.`, 'סגירה')) dismiss.mutate(); }}
    />
  ) : null;

  return (
    <Card style={{ gap: 14, borderRadius: 22 }}>
      <Row style={{ justifyContent: 'space-between' }} align="flex-start">
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="h3" style={{ fontSize: 18 }}>{estimate ? estimate.name : `„${request.query}”`}</Txt>
          <Txt variant="caption" color={c.muted}>
            {estimate
              ? `הערכה לפי Google Maps · ${Math.round(estimate.distanceKm)} ק״מ · ${timeAgo(request.createdAt)}`
              : `אין הערכה אוטומטית · ${timeAgo(request.createdAt)}`}
          </Txt>
          {request.from ? (
            <Row gap={4}>
              <Icon name="user" size={12} color={c.faint} />
              <Txt variant="caption" color={c.faint} style={{ writingDirection: 'ltr' }}>{request.from.replace(/@.*/, '')}</Txt>
            </Row>
          ) : null}
        </View>
        {estimate ? <Pill label="הערכה" tone="amber" /> : null}
      </Row>

      {estimate ? (
        <Row gap={6}>
          {vehicles.map((vehicle, index) => (
            <View key={vehicle.key} style={{ flex: 1, backgroundColor: c.surface2, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', gap: 2 }}>
              <Txt variant="caption" color={c.muted} center style={{ fontSize: 11 }}>{vehicle.short}</Txt>
              <Txt variant="num" color={index === 0 ? c.mint : c.text} center style={{ fontSize: 16 }}>{shekel(estimate.priceMatrix[index * 2])}</Txt>
            </View>
          ))}
        </Row>
      ) : null}

      {canManage || canAdd ? (
        <Row gap={10}>
          {estimate && canManage ? (
            <Button
              title="אישור למחירון"
              icon="check"
              style={{ flex: 1 }}
              loading={approve.isPending}
              disabled={estimate.priceMatrix.some((price) => price <= 0)}
              onPress={async () => { if (await confirm('לאשר את ההערכה?', `${estimate.name} יתווסף למחירון הקבוע. מחירים קיימים לא ישתנו.`, 'אישור', false)) approve.mutate(); }}
            />
          ) : null}
          {canAdd ? (
            <Button
              title={estimate ? 'עריכה' : 'הוספת מחיר ידנית'}
              variant={estimate ? 'ghost' : 'soft'}
              style={estimate ? undefined : { flex: 1 }}
              onPress={openEditor}
            />
          ) : null}
          {closeButton}
        </Row>
      ) : (
        <Txt variant="caption" color={c.muted}>ממתין להשלמת מחיר על ידי מנהל</Txt>
      )}
    </Card>
  );
}
