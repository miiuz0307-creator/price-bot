import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetDashboardSummary, useGetWhatsAppStatus } from '@workspace/api-client-react';
import { Page, Notice, card } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function Dashboard() {
  const summary = useGetDashboardSummary(); const status = useGetWhatsAppStatus(); const c = useColors();
  const refresh = () => { void summary.refetch(); void status.refetch(); };
  if (summary.isLoading) return <Page title="מחירון" subtitle="טוען את נתוני העסק"><Notice icon="loader" title="טוען נתונים" text="רק רגע…" /></Page>;
  if (summary.isError) return <Page title="מחירון"><Notice icon="wifi-off" title="לא הצלחנו לטעון" text="בדקו את החיבור ונסו שוב." retry={refresh}/></Page>;
  const d=summary.data;
  return <Page title="בוקר טוב" subtitle="המחירון שלך, במקום אחד" refreshing={summary.isRefetching} onRefresh={refresh}>
    <View style={styles.hero}><View><Text style={styles.heroCaption}>מצב הבוט</Text><Text style={styles.heroTitle}>{status.data?.connected ? 'מחובר ומוכן' : 'דורש חיבור'}</Text></View><View style={[styles.dot,{backgroundColor:status.data?.connected?c.primary:c.accent}]} /></View>
    <View style={styles.grid}>
      <Stat label="מחירים פעילים" value={d?.activeProductCount ?? 0} icon="tag" />
      <Stat label="חיפושים" value={d?.lookupCount ?? 0} icon="search" />
      <Stat label="מנהלים מורשים" value={d?.adminCount ?? 0} icon="users" />
      <Stat label="סה״כ פריטים" value={d?.productCount ?? 0} icon="database" />
    </View>
    <View style={card(c)}><Text style={[styles.section,{color:c.foreground}]}>פעילות אחרונה</Text><Text style={[styles.body,{color:c.mutedForeground}]}>{d?.lastLookupAt ? `החיפוש האחרון: ${new Date(d.lastLookupAt).toLocaleString('he-IL')}` : 'עדיין לא התקבלו חיפושים בבוט.'}</Text></View>
  </Page>;
}
function Stat({label,value,icon}:{label:string;value:number;icon:keyof typeof Feather.glyphMap}){const c=useColors();return <View style={[styles.stat,...card(c)]}><Feather name={icon} color={c.primary} size={19}/><Text style={[styles.value,{color:c.foreground}]}>{value.toLocaleString('he-IL')}</Text><Text style={[styles.statLabel,{color:c.mutedForeground}]}>{label}</Text></View>}
const styles=StyleSheet.create({hero:{backgroundColor:'#1B3834',borderRadius:12,padding:20,flexDirection:'row-reverse',justifyContent:'space-between',alignItems:'center'},heroCaption:{fontFamily:'Inter_500Medium',fontSize:14,color:'#D5E7DF',textAlign:'right'},heroTitle:{fontFamily:'Inter_700Bold',fontSize:23,color:'#fff',textAlign:'right',marginTop:4},dot:{width:14,height:14,borderRadius:7},grid:{flexDirection:'row-reverse',flexWrap:'wrap',gap:10},stat:{width:'48.5%',gap:8},value:{fontFamily:'Inter_700Bold',fontSize:25,textAlign:'right'},statLabel:{fontFamily:'Inter_400Regular',fontSize:12,textAlign:'right'},section:{fontFamily:'Inter_700Bold',fontSize:17,textAlign:'right',marginBottom:8},body:{fontFamily:'Inter_400Regular',fontSize:14,textAlign:'right',lineHeight:21}});