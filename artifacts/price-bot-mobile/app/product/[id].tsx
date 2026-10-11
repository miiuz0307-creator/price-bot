import React from 'react';
import { Linking, Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { updateProduct, useListProducts } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { BackHeader, Button, Card, Chip, EmptyState, Footer, Row, Screen, Skeleton, Toggle, Txt } from '@/components/ui';
import { hasFullMatrix, matrixPrice, minutesLeft, productMessage, shekel, vehicleLabel, vehicles } from '@/lib/format';
import { useInvalidate, useSurge } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function ProductScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const { can } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const products = useListProducts();
  const surge = useSurge();
  const invalidate = useInvalidate();
  const product = products.data?.find((item) => String(item.id) === id);
  const offers = surge.data?.active ? surge.data.offers.filter((offer) => String(offer.productId) === id) : [];
  const canEdit = can('catalog.edit');

  const toggle = useMutation({
    mutationFn: (active: boolean) => updateProduct(Number(id), { active }),
    onSuccess: async (_, active) => { await invalidate.catalog(); toast.show(active ? 'המסלול זמין שוב בבוט' : 'המסלול הושהה — הבוט לא יענה עליו'); },
    onError: (error) => toast.error(error),
  });

  if (!product) {
    return (
      <Screen>
        <BackHeader />
        {products.isLoading ? <Skeleton height={300} /> : <EmptyState icon="alert-circle" title="המסלול לא נמצא" text="ייתכן שנמחק. חזרו למחירון." />}
      </Screen>
    );
  }

  const message = productMessage(product);
  const sendWhatsApp = async () => {
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    } catch {
      await Share.share({ message }).catch(() => undefined);
    }
  };
  const copy = async () => { await Clipboard.setStringAsync(message); toast.show('ההודעה הועתקה'); };

  return (
    <Screen
      footer={(
        <Footer>
          <Button title="שליחה ב־WhatsApp" icon="whatsapp" style={{ flex: 1 }} onPress={sendWhatsApp} />
          <Button icon="copy" variant="secondary" accessibilityLabel="העתקת ההודעה" onPress={copy} />
        </Footer>
      )}
    >
      <BackHeader action={canEdit ? (
        <Button title="עריכה" icon="edit-2" variant="secondary" size="md" onPress={() => router.push({ pathname: '/product/edit', params: { id: String(product.id) } })} />
      ) : undefined} />

      <View style={{ gap: 6 }}>
        <Txt variant="h1">{product.name}</Txt>
        <Txt variant="body" color={c.muted} style={{ fontSize: 14 }}>
          {[product.distance, product.duration, product.level || 'מחירון רגיל'].filter(Boolean).join(' · ')}
        </Txt>
      </View>

      {offers.map((offer) => (
        <Card key={offer.id} tone="amber" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.amber, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="flame" size={20} color={c.onAmber} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodySemi" color={c.amberText}>מחיר עומס: {shekel(offer.price)} · {vehicleLabel(offer.vehicleType)}</Txt>
            <Txt variant="caption" color={c.amberSub}>{offer.route} · עוד {minutesLeft(offer.expiresAt)} דק׳ · {offer.groupLabel}</Txt>
          </View>
        </Card>
      ))}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.lineSoft }} gap={0}>
          <Txt variant="caption" color={c.muted} style={{ flex: 1.4 }}>סוג רכב</Txt>
          <Txt variant="caption" color={c.muted} style={{ flex: 1 }}>צד אחד</Txt>
          <Txt variant="caption" color={c.muted} style={{ flex: 1 }}>הלוך ושוב</Txt>
        </Row>
        {vehicles.map((vehicle, index) => (
          <Row key={vehicle.key} gap={0} style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: index < 3 ? 1 : 0, borderBottomColor: c.lineSoft }}>
            <Txt variant="bodyMedium" style={{ flex: 1.4 }}>{vehicle.label}</Txt>
            <Txt variant="num" color={index === 0 ? c.mint : c.text} style={{ flex: 1 }}>{shekel(matrixPrice(product, index))}</Txt>
            <Txt variant="num" style={{ flex: 1, fontSize: 16 }}>{hasFullMatrix(product) ? shekel(matrixPrice(product, index, true)) : '—'}</Txt>
          </Row>
        ))}
      </Card>
      {!hasFullMatrix(product) ? (
        <Txt variant="caption" color={c.muted}>יש למסלול מחיר אחד — הבוט מציג אותו לכל סוגי הרכב.</Txt>
      ) : null}

      {product.aliases.length || product.waitTime ? (
        <View style={{ gap: 8 }}>
          <Txt variant="label" color={c.muted}>הבוט מזהה גם</Txt>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>
            {product.aliases.map((alias) => <Chip key={alias} label={alias} />)}
            {product.waitTime ? <Chip label={`⏳ המתנה ${product.waitTime}`} /> : null}
          </Row>
        </View>
      ) : null}

      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderRadius: 18 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodySemi">זמין בבוט</Txt>
          <Txt variant="caption" color={c.muted}>{canEdit ? 'כיבוי משהה את המסלול בלי למחוק' : 'רק משתמש עם הרשאת עריכה יכול לשנות'}</Txt>
        </View>
        <Toggle label="זמין בבוט" value={product.active} disabled={!canEdit || toggle.isPending} onChange={(value) => toggle.mutate(value)} />
      </Card>
      <Txt variant="caption" color={c.faint} center>עודכן {new Date(product.updatedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</Txt>
    </Screen>
  );
}
