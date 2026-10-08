import React from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export function Page({ title, subtitle, children, refreshing, onRefresh, action }: { title: string; subtitle?: string; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; action?: React.ReactNode }) {
  const c = useColors(); const insets = useSafeAreaInsets();
  return <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={[s.page, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 18, paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 88 }]} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined}>
    <View style={s.header}><View style={{ flex: 1 }}><Text style={[s.title, { color: c.foreground }]}>{title}</Text>{subtitle ? <Text style={[s.subtitle, { color: c.mutedForeground }]}>{subtitle}</Text> : null}</View>{action}</View>
    {children}
  </ScrollView>;
}
export function IconButton({ icon, onPress, testID, destructive = false }: { icon: keyof typeof Feather.glyphMap; onPress: () => void; testID: string; destructive?: boolean }) {
 const c = useColors(); return <Pressable testID={testID} onPress={onPress} hitSlop={10} style={s.iconButton}><Feather name={icon} size={20} color={destructive ? c.destructive : c.primary} /></Pressable>;
}
export function PrimaryButton({ label, onPress, testID, loading }: { label: string; onPress: () => void; testID: string; loading?: boolean }) {
 const c=useColors(); return <Pressable testID={testID} disabled={loading} onPress={onPress} style={[s.primary,{backgroundColor:c.primary,opacity:loading?.6:1}]}>{loading?<ActivityIndicator color={c.primaryForeground}/>:<Text style={[s.primaryText,{color:c.primaryForeground}]}>{label}</Text>}</Pressable>
}
export function Notice({ icon = 'inbox', title, text, retry }: {icon?: keyof typeof Feather.glyphMap; title:string;text:string;retry?:()=>void}) {
 const c=useColors(); return <View style={[s.notice,{backgroundColor:c.card,borderColor:c.border}]}><Feather name={icon} size={28} color={c.mutedForeground}/><Text style={[s.noticeTitle,{color:c.foreground}]}>{title}</Text><Text style={[s.noticeText,{color:c.mutedForeground}]}>{text}</Text>{retry?<PrimaryButton label="נסו שוב" onPress={retry} testID="retry-button"/>:null}</View>
}
export function Field({ label, value, onChangeText, placeholder, keyboardType }: {label:string;value:string;onChangeText:(v:string)=>void;placeholder?:string;keyboardType?:'default'|'numeric'|'phone-pad'}) {
 const c=useColors(); return <View style={s.field}><Text style={[s.label,{color:c.foreground}]}>{label}</Text><TextInput testID={`input-${label}`} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.mutedForeground} keyboardType={keyboardType} style={[s.input,{color:c.foreground,borderColor:c.input,backgroundColor:c.card}]} textAlign="right" /></View>
}
export const card = (c: ReturnType<typeof useColors>) => [s.card,{backgroundColor:c.card,borderColor:c.border}];
const s=StyleSheet.create({page:{paddingHorizontal:16,gap:14},header:{flexDirection:'row-reverse',alignItems:'center',marginBottom:4},title:{fontFamily:'Inter_700Bold',fontSize:26,textAlign:'right'},subtitle:{fontFamily:'Inter_400Regular',fontSize:14,textAlign:'right',marginTop:3},card:{borderWidth:1,borderRadius:12,padding:16},iconButton:{padding:8},primary:{minHeight:46,borderRadius:12,justifyContent:'center',alignItems:'center',paddingHorizontal:16},primaryText:{fontFamily:'Inter_700Bold',fontSize:15},notice:{borderWidth:1,borderRadius:12,padding:25,alignItems:'center',gap:8},noticeTitle:{fontFamily:'Inter_700Bold',fontSize:17},noticeText:{fontFamily:'Inter_400Regular',fontSize:14,textAlign:'center',lineHeight:20},field:{gap:6},label:{fontFamily:'Inter_600SemiBold',fontSize:14,textAlign:'right'},input:{height:46,borderWidth:1,borderRadius:12,paddingHorizontal:12,fontFamily:'Inter_400Regular',fontSize:16}});