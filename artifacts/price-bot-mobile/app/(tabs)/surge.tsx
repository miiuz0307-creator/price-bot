import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMutation } from '@tanstack/react-query';
import {
  getListWhatsAppGroupsQueryKey, startSurgeMonitoring, stopSurgeMonitoring, useListProducts, useListWhatsAppGroups,
} from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Button, Card, Chip, EmptyState, ErrorState, PageTitle, Press, Row, Screen, SearchField, SectionTitle, Sheet, Skeleton, Toggle, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { minutesLeft, shekel, timeAgo, vehicleLabel } from '@/lib/format';
import { useInvalidate, useSurge } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function SurgeScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const { can } = useSession();
  const surge = useSurge();
  const products = useListProducts();
  const invalidate = useInvalidate();
  const canManage = can('surge.manage');
  const [picker, setPicker] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);

  const groups = useListWhatsAppGroups({ query: { queryKey: getListWhatsAppGroupsQueryKey(), enabled: Boolean(surge.data?.connected), staleTime: 5 * 60_000 } });
  const groupName = (identifier: string) => groups.data?.find((group) => group.identifier === identifier)?.label ?? identifier.replace(/@.*/, '');
  const productById = useMemo(() => new Map((products.data ?? []).map((product) => [product.id, product])), [products.data]);

  const start = useMutation({
    mutationFn: (groupIdentifiers: string[]) => startSurgeMonitoring({ groupIdentifiers }),
    onSuccess: async () => { await invalidate.surge(); setPicker(false); toast.show('מעקב העומס פעיל — מחירים מהקבוצות יופיעו כאן'); },
    onError: (error) => toast.error(error),
  });
  const stop = useMutation({
    mutationFn: () => stopSurgeMonitoring(),
    onSuccess: async () => { await invalidate.surge(); toast.show('מעקב העומס כובה — הבוט חוזר למחירון הרגיל', 'info'); },
    onError: (error) => toast.error(error),
  });

  const data = surge.data;
  const active = Boolean(data?.active);
  const offers = active ? [...(data?.offers ?? [])].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()) : [];

  return (
    <Screen refreshing={surge.isRefetching} onRefresh={() => surge.refetch()}>
      <PageTitle title="זמני עומס" />
      {surge.isError ? <ErrorState message={errorMessage(surge.error)} onRetry={() => surge.refetch()} /> : null}
      {surge.isLoading ? <Skeleton height={140} /> : data ? (
        <Card tone={active ? 'amber' : 'default'} style={{ gap: 14, borderRadius: 24, padding: 18 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3" style={{ fontSize: 19 }} color={active ? c.amberText : c.text}>{active ? 'המעקב פעיל' : 'המעקב כבוי'}</Txt>
              <Txt variant="label" color={active ? c.amberSub : c.muted}>
                {active
                  ? `מאזין ל־${data.groupIdentifiers.length} ${data.groupIdentifiers.length === 1 ? 'קבוצה' : 'קבוצות'}`
                  : !data.connected ? 'צריך חיבור WhatsApp כדי להאזין לקבוצות' : 'הפעילו כדי שהבוט יציע מחירי עומס מהקבוצות'}
              </Txt>
            </View>
            <Toggle
              label="מעקב עומס"
              tone="amber"
              value={active}
              disabled={!canManage || start.isPending || stop.isPending || (!active && !data.connected)}
              onChange={(value) => {
                if (!value) stop.mutate();
                else if (data.groupIdentifiers.length) start.mutate(data.groupIdentifiers);
                else setPicker(true);
              }}
            />
          </Row>
          {data.groupIdentifiers.length || canManage ? (
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {data.groupIdentifiers.map((identifier) => <Chip key={identifier} label={groupName(identifier)} tone="amber" />)}
              {canManage && data.connected ? (
                <Press onPress={() => setPicker(true)} style={{ height: 38, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: c.amberLine, justifyContent: 'center' }}>
                  <Txt variant="bodyMedium" color={c.amber} style={{ fontSize: 14 }}>{data.groupIdentifiers.length ? '+ קבוצה' : '+ בחירת קבוצות'}</Txt>
                </Press>
              ) : null}
            </Row>
          ) : null}
        </Card>
      ) : null}

      {active ? (
        <>
          <SectionTitle title="מחירים חיים" action={<Txt variant="caption" color={c.muted}>מתעדכן אוטומטית</Txt>} />
          {offers.length ? offers.map((offer, index) => {
            const product = productById.get(offer.productId);
            const total = Math.max(1, new Date(offer.expiresAt).getTime() - new Date(offer.observedAt).getTime());
            const left = Math.max(0, new Date(offer.expiresAt).getTime() - now);
            return (
              <Animated.View key={offer.id} entering={FadeInDown.delay(Math.min(index, 6) * 50).duration(300)}>
                <Card style={{ gap: 10, paddingVertical: 14 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodySemi" style={{ fontSize: 16 }}>{offer.route}</Txt>
                      <Txt variant="caption" color={c.muted}>
                        {vehicleLabel(offer.vehicleType)}{offer.extraPassenger ? ' · אחד מעל' : ''}{product ? ` · מחירון ${shekel(product.price)}` : ''}
                      </Txt>
                    </View>
                    <Txt variant="numLg" color={c.amber}>{shekel(offer.price)}</Txt>
                  </Row>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: c.lineSoft, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round((left / total) * 100)}%`, height: '100%', backgroundColor: c.amber, borderRadius: 3 }} />
                  </View>
                  <Txt variant="caption" color={c.muted}>נשאר {minutesLeft(offer.expiresAt, now)} דק׳ · {offer.groupLabel || groupName(offer.groupIdentifier)} · {timeAgo(offer.observedAt, now)}</Txt>
                </Card>
              </Animated.View>
            );
          }) : (
            <EmptyState icon="flame" title="אין כרגע מחירי עומס" text="כשמישהו בקבוצה יכתוב מחיר גבוה מהמחירון למסלול מוכר, הוא יופיע כאן והבוט יציע אותו." />
          )}
        </>
      ) : !surge.isLoading ? (
        <Card style={{ gap: 10 }}>
          <Row align="flex-start">
            <Icon name="info" size={18} color={c.muted} />
            <Txt variant="label" color={c.muted} style={{ flex: 1, lineHeight: 20 }}>
              בזמן עומס הבוט קורא מחירים שנשלחים בקבוצות הנהגים שבחרתם, ומציע ללקוחות את המחיר העדכני (רק אם הוא גבוה מהמחירון). כל מחיר תקף לזמן מוגבל.
            </Txt>
          </Row>
        </Card>
      ) : null}

      <GroupPicker
        visible={picker}
        onClose={() => setPicker(false)}
        initial={data?.groupIdentifiers ?? []}
        groups={groups.data ?? []}
        loading={groups.isLoading}
        error={groups.isError ? errorMessage(groups.error) : null}
        saving={start.isPending}
        onSave={(selected) => start.mutate(selected)}
      />
    </Screen>
  );
}

function GroupPicker({ visible, onClose, initial, groups, loading, error, saving, onSave }: {
  visible: boolean; onClose: () => void; initial: string[]; groups: { identifier: string; label: string }[];
  loading: boolean; error: string | null; saving: boolean; onSave: (selected: string[]) => void;
}) {
  const { c } = useTheme();
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState('');
  const initialKey = initial.join('|');
  useEffect(() => {
    if (visible) { setSelected(initialKey ? initialKey.split('|') : []); setQuery(''); }
  }, [visible, initialKey]);
  const shown = groups.filter((group) => group.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="קבוצות למעקב עומס"
      footer={<Button title={selected.length ? `הפעלה · ${selected.length} קבוצות` : 'בחרו קבוצה'} icon="flame" variant="amber" style={{ flex: 1 }} disabled={!selected.length} loading={saving} onPress={() => onSave(selected)} />}
    >
      <SearchField value={query} onChangeText={setQuery} placeholder="חיפוש קבוצה" />
      {error ? <ErrorState message={error} /> : null}
      {loading ? <Skeleton height={200} /> : shown.map((group) => {
        const on = selected.includes(group.identifier);
        return (
          <Press
            key={group.identifier}
            onPress={() => setSelected((current) => (on ? current.filter((id) => id !== group.identifier) : [...current, group.identifier]))}
            accessibilityState={{ checked: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: on ? c.amberBg : c.surface, borderWidth: 1, borderColor: on ? c.amberLine : c.line }}
          >
            <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? c.amber : c.faint, backgroundColor: on ? c.amber : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="check" size={15} color={c.onAmber} /> : null}
            </View>
            <Txt variant="bodyMedium" style={{ flex: 1 }}>{group.label}</Txt>
          </Press>
        );
      })}
      {!loading && !shown.length && !error ? <Txt variant="label" color={c.muted} center>לא נמצאו קבוצות</Txt> : null}
    </Sheet>
  );
}
