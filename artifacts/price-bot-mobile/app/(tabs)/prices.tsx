import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListProducts, type Product } from '@workspace/api-client-react';
import { Icon } from '@/components/Icon';
import { Chip, EmptyState, ErrorState, PageTitle, Press, Row, SearchField, Skeleton, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { hasFullMatrix, matrixPrice, number, productMatches, shekel, vehicles } from '@/lib/format';
import { useSurge } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Filter = 'all' | 'active' | 'paused' | 'surge';

export default function PricesScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { can } = useSession();
  const params = useLocalSearchParams<{ focus?: string }>();
  const products = useListProducts();
  const surge = useSurge();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const surgeByProduct = useMemo(() => {
    const map = new Map<number, number>();
    if (surge.data?.active) {
      for (const offer of surge.data.offers) map.set(offer.productId, Math.max(map.get(offer.productId) ?? 0, offer.price));
    }
    return map;
  }, [surge.data]);

  const list = useMemo(() => {
    const all = products.data ?? [];
    return all
      .filter((product) => filter === 'all' || (filter === 'active' ? product.active : filter === 'paused' ? !product.active : surgeByProduct.has(product.id)))
      .filter((product) => productMatches(product, query))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'he'));
  }, [products.data, filter, query, surgeByProduct]);

  const searching = query.trim().length > 0 && list.length <= 30;

  const header = (
    <View style={{ gap: 14, paddingTop: insets.top + 14, paddingBottom: 6 }}>
      <PageTitle title="מחירון" subtitle={products.data ? `${number(products.data.length)} מסלולים` : ' '} />
      <SearchField value={query} onChangeText={setQuery} placeholder="חיפוש: בב ים, אופקים…" autoFocus={params.focus === '1'} />
      <Row gap={8}>
        <Chip label="הכול" selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="פעילים" selected={filter === 'active'} onPress={() => setFilter('active')} />
        <Chip label="מושהים" selected={filter === 'paused'} onPress={() => setFilter('paused')} />
        {surgeByProduct.size ? <Chip label={`בעומס · ${surgeByProduct.size}`} tone="amber" selected={filter === 'surge'} onPress={() => setFilter('surge')} /> : null}
      </Row>
      {products.isError ? <ErrorState message={errorMessage(products.error)} onRetry={() => products.refetch()} /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: 'rtl' }}>
      <FlatList
        data={list}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        windowSize={9}
        refreshControl={<RefreshControl refreshing={products.isRefetching} onRefresh={() => products.refetch()} tintColor={c.mint} colors={[c.mint]} progressBackgroundColor={c.surface} />}
        renderItem={({ item }) => <ProductCard product={item} surgePrice={surgeByProduct.get(item.id)} expanded={searching} />}
        ListEmptyComponent={products.isLoading ? (
          <View style={{ gap: 10 }}>{[0, 1, 2, 3, 4].map((key) => <Skeleton key={key} height={76} />)}</View>
        ) : products.isError ? null : (
          <EmptyState
            icon="search"
            title={query ? 'לא נמצא מסלול' : 'אין מסלולים בתצוגה הזו'}
            text={query ? 'נסו שם קצר יותר או כינוי (למשל „בב ים”).' : undefined}
          />
        )}
      />
      {can('catalog.edit') ? (
        <Press
          accessibilityLabel="מסלול חדש"
          onPress={() => router.push('/product/edit')}
          style={{
            position: 'absolute', end: 20, bottom: 20, width: 60, height: 60, borderRadius: 20, backgroundColor: c.mint,
            alignItems: 'center', justifyContent: 'center', shadowColor: c.mint, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
          }}
        >
          <Icon name="plus" size={28} color={c.onMint} />
        </Press>
      ) : null}
    </View>
  );
}

const ProductCard = React.memo(function ProductCard({ product, surgePrice, expanded }: { product: Product; surgePrice?: number; expanded: boolean }) {
  const { c } = useTheme();
  const detail = !product.active
    ? 'מושהה · הבוט לא עונה עליו'
    : [product.distance, product.duration].filter(Boolean).join(' · ') || (product.aliases.length ? `כינוי: ${product.aliases.slice(0, 2).join(', ')}` : product.level);
  return (
    <Press
      onPress={() => router.push({ pathname: '/product/[id]', params: { id: String(product.id) } })}
      accessibilityLabel={`${product.name}, ${shekel(product.price)}`}
      style={{ backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line, padding: 16, gap: 12, opacity: product.active ? 1 : 0.62 }}
    >
      <Row style={{ justifyContent: 'space-between' }} align="flex-start">
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="bodySemi" style={{ fontSize: 17 }}>{product.name}</Txt>
          {detail ? <Txt variant="label" color={c.muted} numberOfLines={1}>{detail}</Txt> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Txt variant="numLg" color={product.active ? c.mint : c.muted} style={{ fontSize: 24 }}>{shekel(product.price)}</Txt>
          {surgePrice ? (
            <Row gap={4} style={{ backgroundColor: c.amberBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Icon name="flame" size={12} color={c.amber} />
              <Txt variant="caption" color={c.amber} style={{ fontWeight: '600' }}>עומס {shekel(surgePrice)}</Txt>
            </Row>
          ) : null}
        </View>
      </Row>
      {expanded && hasFullMatrix(product) ? (
        <Row gap={6}>
          {vehicles.slice(1).map((vehicle, index) => (
            <View key={vehicle.key} style={{ flex: 1, backgroundColor: c.surface2, borderRadius: 12, paddingVertical: 8, alignItems: 'center', gap: 2 }}>
              <Txt variant="caption" color={c.muted} center>{vehicle.short}</Txt>
              <Txt variant="num" style={{ fontSize: 16 }} center>{shekel(matrixPrice(product, index + 1))}</Txt>
            </View>
          ))}
        </Row>
      ) : null}
    </Press>
  );
});
