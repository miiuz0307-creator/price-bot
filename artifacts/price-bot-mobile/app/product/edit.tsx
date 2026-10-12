import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { createProduct, deleteLookupRequest, deleteProduct, updateProduct, useListProducts, type Product, type ProductInput } from '@workspace/api-client-react';
import { useToast } from '@/components/Toast';
import { BackHeader, Button, Card, Field, Footer, Row, Screen, Toggle, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { matrixLabels, parsePastedPriceMessage, searchKey } from '@/lib/format';
import { useInvalidate } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Form = { name: string; matrix: string[]; distance: string; duration: string; level: string; waitTime: string; aliases: string; active: boolean; subtitle: string; notes: string; sections: Product['sections'] };
const blank: Form = { name: '', matrix: Array(8).fill(''), distance: '', duration: '', level: '', waitTime: '', aliases: '', active: true, subtitle: '', notes: '', sections: [] };

export default function ProductEditScreen() {
  const { c } = useTheme();
  const toast = useToast();
  const { can } = useSession();
  const invalidate = useInvalidate();
  const params = useLocalSearchParams<{ id?: string; name?: string; matrix?: string; distance?: string; waitTime?: string; query?: string; requestId?: string }>();
  const products = useListProducts();
  const editing = params.id ? products.data?.find((product) => String(product.id) === params.id) : undefined;
  const [form, setForm] = useState<Form>(blank);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(!params.id);

  useEffect(() => {
    if (editing && !ready) {
      setForm({
        name: editing.name,
        matrix: Array.from({ length: 8 }, (_, index) => (editing.priceMatrix[index] ? String(editing.priceMatrix[index]) : index === 0 ? String(editing.price) : '')),
        distance: editing.distance, duration: editing.duration, level: editing.level, waitTime: editing.waitTime,
        aliases: editing.aliases.join(', '), active: editing.active,
        subtitle: editing.subtitle, notes: editing.notes, sections: editing.sections,
      });
      setReady(true);
    }
  }, [editing, ready]);

  useEffect(() => {
    // Coming from a price request: start from the request / Maps estimate.
    if (params.id || !(params.name || params.query)) return;
    const matrix = params.matrix ? params.matrix.split(',').map((value) => (Number(value) > 0 ? String(Math.round(Number(value))) : '')) : [];
    setForm({
      ...blank,
      name: params.name ?? params.query ?? '',
      matrix: Array.from({ length: 8 }, (_, index) => matrix[index] ?? ''),
      distance: params.distance ?? '',
      waitTime: params.waitTime ?? '',
      aliases: params.query && params.query !== params.name ? params.query : '',
    });
  }, [params.id, params.name, params.query, params.matrix, params.distance, params.waitTime]);

  const set = (patch: Partial<Form>) => { setForm((current) => ({ ...current, ...patch })); setError(null); };

  const save = useMutation({
    mutationFn: async () => {
      // Same rules as the website: all 8 prices, or only "4 seats" (shown for every vehicle).
      const filled = form.matrix.filter((value) => value.trim() !== '').length;
      if (!form.name.trim()) throw new Error('מלאו שם מסלול.');
      if (filled > 1 && filled < 8) throw new Error('מלאו את כל 8 המחירים, או רק את מחיר 4 מקומות.');
      if (form.matrix.some((value) => value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) <= 0))) throw new Error('כל המחירים חייבים להיות מספרים חיוביים.');
      const base = Number(form.matrix[0]);
      if (!filled || !(base > 0)) throw new Error('מלאו לפחות את מחיר 4 מקומות.');
      const data: ProductInput = {
        name: form.name.trim(), price: base, currency: editing?.currency || 'ILS',
        aliases: [...new Set(form.aliases.split(/[,\n]/u).map((alias) => alias.trim()).filter(Boolean))],
        active: form.active, priceMatrix: filled === 8 ? form.matrix.map(Number) : [base],
        distance: form.distance.trim(), duration: form.duration.trim(), level: form.level.trim(), waitTime: form.waitTime.trim(),
        subtitle: form.subtitle.trim(), notes: form.notes.trim(), sections: form.sections,
      };
      if (editing) return updateProduct(editing.id, data);
      // Same route already in the catalog (e.g. pasting a new price message): update it, never duplicate.
      const existing = products.data?.find((product) => searchKey(product.name) === searchKey(data.name));
      if (existing) return updateProduct(existing.id, { ...data, aliases: data.aliases?.length ? data.aliases : existing.aliases });
      const created = await createProduct(data);
      if (params.requestId && can('lookups.manage')) await deleteLookupRequest(Number(params.requestId)).catch(() => undefined);
      return created;
    },
    onSuccess: async (product) => {
      await Promise.all([invalidate.catalog(), invalidate.requests()]);
      toast.show(editing ? 'המסלול נשמר' : 'המסלול נוסף למחירון וזמין לבוט מיד');
      if (editing) router.back();
      else router.replace({ pathname: '/product/[id]', params: { id: String(product.id) } });
    },
    onError: (failure) => setError(failure instanceof Error && !('status' in failure) ? failure.message : errorMessage(failure)),
  });

  const remove = useMutation({
    mutationFn: () => deleteProduct(editing!.id),
    onSuccess: async () => {
      await invalidate.catalog();
      toast.show('המסלול נמחק');
      router.dismissTo('/prices');
    },
    onError: (failure) => toast.error(failure),
  });

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      const parsed = parsePastedPriceMessage(text);
      set({
        name: parsed.name, matrix: parsed.priceMatrix.map(String), distance: parsed.distance, duration: parsed.duration,
        level: parsed.level, waitTime: parsed.waitTime, aliases: [...new Set([...form.aliases.split(',').map((a) => a.trim()).filter(Boolean), ...parsed.aliases])].join(', '),
        subtitle: parsed.subtitle, notes: parsed.notes, sections: parsed.sections,
      });
      const existing = !editing && products.data?.find((product) => searchKey(product.name) === searchKey(parsed.name));
      toast.show(existing
        ? `„${existing.name}” כבר במחירון — שמירה תעדכן אותו`
        : `המחירים מולאו מההודעה${parsed.sections.length ? ` (+${parsed.sections.length} בלוקים נוספים)` : ''} — בדקו ושמרו`);
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'לא הצלחתי לקרוא את ההודעה', 'error');
    }
  };

  return (
    <Screen
      footer={(
        <Footer>
          <Button title={editing ? 'שמירה' : 'הוספה למחירון'} icon="check" style={{ flex: 1 }} loading={save.isPending} onPress={() => save.mutate()} />
          <Button title="ביטול" variant="secondary" onPress={() => router.back()} />
        </Footer>
      )}
    >
      <BackHeader title={editing ? 'עריכת מסלול' : 'מסלול חדש'} />
      <Button title="הדבקת הודעת מחיר מ־WhatsApp" icon="clipboard" variant="soft" size="md" onPress={paste} />

      <Field label="שם המסלול" value={form.name} onChangeText={(name) => set({ name })} placeholder="למשל: בני ברק ⇔ ירושלים" />

      <View style={{ gap: 8 }}>
        <Txt variant="bodySemi" style={{ fontSize: 14 }}>מחירים לפי סוג רכב (₪)</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {matrixLabels.map((label, index) => (
            <Field
              key={label}
              label={label}
              value={form.matrix[index]}
              onChangeText={(value) => set({ matrix: form.matrix.map((cell, cellIndex) => (cellIndex === index ? value.replace(/[^\d.]/g, '') : cell)) })}
              keyboardType="number-pad"
              placeholder={index === 0 ? '160' : ''}
              ltr
              style={{ width: '47.5%', gap: 4 }}
              inputStyle={{ minHeight: 48, fontSize: 17 }}
            />
          ))}
        </View>
        <Txt variant="caption" color={c.muted}>מלאו את כל השמונה, או רק „4 מק׳” — ואז הבוט יציג אותו מחיר לכל סוגי הרכב.</Txt>
      </View>

      <Row gap={10}>
        <Field label="מרחק משוער" value={form.distance} onChangeText={(distance) => set({ distance })} placeholder="62 ק״מ" style={{ flex: 1 }} />
        <Field label="זמן משוער" value={form.duration} onChangeText={(duration) => set({ duration })} placeholder="50 דק׳" style={{ flex: 1 }} />
      </Row>
      <Row gap={10}>
        <Field label="המתנה בצדדים" value={form.waitTime} onChangeText={(waitTime) => set({ waitTime })} placeholder="₪40 לשעה" style={{ flex: 1 }} />
        <Field label="סוג מחירון" value={form.level} onChangeText={(level) => set({ level })} placeholder="מחירון רגיל" style={{ flex: 1 }} />
      </Row>
      <Field label="כינויים" hint="הפרידו בפסיק. הבוט מזהה את המסלול גם לפיהם." value={form.aliases} onChangeText={(aliases) => set({ aliases })} placeholder="בב ים, ירושלים בני ברק" />
      <Field label="שורה מתחת לשם (לא חובה)" value={form.subtitle} onChangeText={(subtitle) => set({ subtitle })} placeholder="רמת החייל" />
      {form.sections.length ? (
        <Card style={{ gap: 10 }}>
          <Txt variant="bodySemi">בלוקים נוספים באותה תשובה</Txt>
          {form.sections.map((section, index) => (
            <Row key={`${section.title}-${index}`} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMedium">{section.title}</Txt>
                <Txt variant="caption" color={c.muted}>{[section.subtitle, `4 מק׳ ₪${section.priceMatrix[0]}`].filter(Boolean).join(' · ')}</Txt>
              </View>
              <Button icon="trash-2" variant="ghost" size="md" accessibilityLabel={`הסרת ${section.title}`} onPress={() => set({ sections: form.sections.filter((_, cell) => cell !== index) })} />
            </Row>
          ))}
          <Txt variant="caption" color={c.muted}>לשינוי המחירים של הבלוקים — הדביקו שוב את הודעת המחיר המלאה.</Txt>
        </Card>
      ) : null}
      <Field label="הערות (בסוף התשובה)" value={form.notes} onChangeText={(notes) => set({ notes })} placeholder="המחיר משתנה לפי האיזור" multiline />

      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderRadius: 18 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodySemi">זמין בבוט</Txt>
          <Txt variant="caption" color={c.muted}>כיבוי משהה את המסלול בלי למחוק</Txt>
        </View>
        <Toggle label="זמין בבוט" value={form.active} onChange={(active) => set({ active })} />
      </Card>

      {error ? (
        <View accessibilityRole="alert" style={{ padding: 14, borderRadius: 14, backgroundColor: c.dangerBg, borderWidth: 1, borderColor: c.dangerLine }}>
          <Txt variant="bodyMedium" color={c.dangerText}>{error}</Txt>
        </View>
      ) : null}

      {editing ? (
        <Button
          title="מחיקת המסלול"
          icon="trash-2"
          variant="danger"
          loading={remove.isPending}
          onPress={async () => { if (await confirm('למחוק את המסלול?', `${editing.name} יימחק מהמחירון. אפשר במקום זה להשהות אותו.`, 'מחיקה')) remove.mutate(); }}
        />
      ) : null}
    </Screen>
  );
}
