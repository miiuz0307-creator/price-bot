import React, { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMutation } from '@tanstack/react-query';
import { connectWhatsApp, disconnectWhatsApp, pairWhatsApp } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { BackHeader, Button, Card, Field, Footer, Row, Screen, Segmented, Skeleton, StatusDot, Txt } from '@/components/ui';
import { confirm } from '@/lib/confirm';
import { displayPhone } from '@/lib/format';
import { useInvalidate, useWhatsApp } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Method = 'pair' | 'qr';

export default function WhatsAppScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const { admin, can } = useSession();
  const status = useWhatsApp(true);
  const invalidate = useInvalidate();
  const canManage = can('whatsapp.manage');
  const [method, setMethod] = useState<Method>('pair');
  const [phone, setPhone] = useState('');
  const data = status.data;
  const connected = Boolean(data?.connected);
  const wasConnected = useRef(connected);

  useEffect(() => { if (!phone && admin?.phone && !admin.sharedWhatsapp) setPhone(displayPhone(admin.phone)); }, [admin, phone]);
  useEffect(() => {
    if (connected && !wasConnected.current) toast.show('WhatsApp מחובר — הבוט עונה');
    wasConnected.current = connected;
  }, [connected, toast]);

  const pair = useMutation({
    mutationFn: () => pairWhatsApp({ phoneNumber: phone.replace(/\D/g, '') }),
    onSuccess: () => invalidate.whatsapp(),
    onError: (error) => toast.error(error),
  });
  const qr = useMutation({
    mutationFn: () => connectWhatsApp(),
    onSuccess: () => invalidate.whatsapp(),
    onError: (error) => toast.error(error),
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectWhatsApp(),
    onSuccess: async () => { await invalidate.whatsapp(); toast.show('WhatsApp נותק', 'info'); },
    onError: (error) => toast.error(error),
  });

  const state = data?.connectionState;
  const waiting = state === 'initializing' || state === 'qr_ready' || state === 'pairing_code_ready';
  const banner = connected
    ? { tone: 'mint' as const, title: 'מחובר · הבוט עונה', text: displayPhone(data?.phoneNumber), dot: c.mint }
    : waiting
      ? { tone: 'amber' as const, title: 'ממתין לחיבור…', text: 'השלימו את החיבור בטלפון של הבוט', dot: c.amber }
      : { tone: 'danger' as const, title: 'לא מחובר · הבוט לא עונה', text: data?.lastError || 'חברו את המספר של הבוט כדי להפעיל אותו', dot: c.danger };

  const code = data?.pairingCode;
  const prettyCode = code ? [code.slice(0, 4), code.slice(4)] : null;

  return (
    <Screen
      refreshing={status.isRefetching}
      onRefresh={() => status.refetch()}
      footer={connected && canManage ? (
        <Footer>
          <Button
            title="ניתוק WhatsApp"
            variant="secondary"
            style={{ flex: 1 }}
            loading={disconnect.isPending}
            onPress={async () => { if (await confirm('לנתק את WhatsApp?', 'הבוט יפסיק לענות עד שתחברו מחדש.', 'ניתוק')) disconnect.mutate(); }}
          />
        </Footer>
      ) : waiting && canManage ? (
        <Footer>
          <Button title="ביטול החיבור" variant="secondary" style={{ flex: 1 }} onPress={() => disconnect.mutate()} />
        </Footer>
      ) : undefined}
    >
      <BackHeader title="חיבור WhatsApp" />
      {status.isLoading ? <Skeleton height={70} /> : (
        <Card tone={banner.tone} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 }}>
          <StatusDot color={banner.dot} size={10} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodySemi" color={banner.tone === 'danger' ? c.dangerText : banner.tone === 'amber' ? c.amberText : c.text}>{banner.title}</Txt>
            {banner.text ? <Txt variant="caption" color={banner.tone === 'danger' ? c.dangerSub : banner.tone === 'amber' ? c.amberSub : c.muted}>{banner.text}</Txt> : null}
          </View>
        </Card>
      )}

      {admin?.sharedWhatsapp ? (
        <Card style={{ flexDirection: 'row', gap: 10, padding: 14 }}>
          <Icon name="link" size={18} color={c.mint} />
          <Txt variant="label" color={c.muted} style={{ flex: 1, lineHeight: 20 }}>אתם עובדים על ה־WhatsApp של בעל המערכת — אין צורך בחיבור משלכם.</Txt>
        </Card>
      ) : null}

      {connected ? (
        <Card style={{ gap: 8 }}>
          <Txt variant="bodySemi">הכול עובד</Txt>
          <Txt variant="label" color={c.muted} style={{ lineHeight: 20 }}>הבוט עונה בשיחות ובקבוצות שמוגדרות ב„יעדים”. החיבור נשמר גם אחרי עדכונים והפעלה מחדש של השרת.</Txt>
        </Card>
      ) : !canManage ? (
        <Card style={{ gap: 8 }}>
          <Txt variant="label" color={c.muted} style={{ lineHeight: 20 }}>רק בעל המערכת או משתמש עם הרשאת „חיבור WhatsApp” יכולים לחבר את הבוט.</Txt>
        </Card>
      ) : (
        <>
          <Segmented<Method> value={method} onChange={setMethod} options={[{ value: 'pair', label: 'קוד צימוד' }, { value: 'qr', label: 'סריקת QR' }]} />

          {method === 'pair' ? (
            prettyCode && state === 'pairing_code_ready' ? (
              <Card style={{ alignItems: 'center', gap: 14, borderRadius: 24, padding: 20 }}>
                <Txt variant="label" color={c.muted} center>הקוד לטלפון של הבוט{phone ? ` · ${phone}` : ''}</Txt>
                <Row gap={6} style={{ direction: 'ltr' }}>
                  <CodeBox text={prettyCode[0]} />
                  <Txt variant="h2" color={c.faint}>–</Txt>
                  <CodeBox text={prettyCode[1]} />
                </Row>
                <Button title="העתקת הקוד" icon="copy" variant="ghost" size="md" onPress={async () => { await Clipboard.setStringAsync(code!); toast.show('הקוד הועתק'); }} />
                <Txt variant="caption" color={c.muted} center>מתעדכן אוטומטית · בתוקף כ־2 דקות</Txt>
              </Card>
            ) : (
              <View style={{ gap: 12 }}>
                <Field
                  label="מספר ה־WhatsApp של הבוט"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="050-000-0000"
                  ltr
                  hint="הטלפון שעליו מותקן ה־WhatsApp שישמש את הבוט"
                />
                <Button title="קבלת קוד צימוד" icon="key" loading={pair.isPending} disabled={phone.replace(/\D/g, '').length < 9} onPress={() => pair.mutate()} />
              </View>
            )
          ) : data?.qrCode && state === 'qr_ready' ? (
            <Card style={{ alignItems: 'center', gap: 12, borderRadius: 24, padding: 20 }}>
              <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 16 }}>
                <Image source={{ uri: data.qrCode }} style={{ width: 232, height: 232 }} accessibilityLabel="קוד QR לחיבור WhatsApp" />
              </View>
              <Txt variant="caption" color={c.muted} center>סורקים מהטלפון של הבוט — לא מהטלפון הזה. הקוד מתחלף אוטומטית.</Txt>
            </Card>
          ) : (
            <Button title="הצגת קוד QR" icon="maximize" loading={qr.isPending || state === 'initializing'} onPress={() => qr.mutate()} />
          )}

          <View style={{ gap: 12 }}>
            {(method === 'pair'
              ? ['בטלפון של הבוט: WhatsApp ← הגדרות ← מכשירים מקושרים', 'קישור מכשיר ← „קישור באמצעות מספר טלפון”', 'מקלידים את הקוד. המסך יתעדכן לבד כשהחיבור יצליח.']
              : ['פתחו את הקוד QR במסך אחר (מחשב או טלפון נוסף), או השתמשו בקוד צימוד', 'בטלפון של הבוט: WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר', 'סורקים את הקוד. המסך יתעדכן לבד כשהחיבור יצליח.']
            ).map((step, index) => (
              <Row key={step} align="flex-start">
                <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.mintSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt variant="bodySemi" color={c.mint} center style={{ fontSize: 14 }}>{index + 1}</Txt>
                </View>
                <Txt variant="body" style={{ flex: 1 }}>{step}</Txt>
              </Row>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

function CodeBox({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.surface2 }}>
      <Txt variant="h1" style={{ fontSize: 30, letterSpacing: 2 }} center selectable>{text}</Txt>
    </View>
  );
}
