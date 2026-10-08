import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetWhatsAppStatus } from '@workspace/api-client-react';
import { Notice, Page, card } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

export default function Settings(){
 const c=useColors(),q=useGetWhatsAppStatus(); const refresh=()=>void q.refetch();
 if(q.isLoading)return <Page title="חיבור WhatsApp"><Notice icon="loader" title="בודק חיבור" text="רק רגע…"/></Page>;
 if(q.isError)return <Page title="חיבור WhatsApp"><Notice icon="wifi-off" title="לא ניתן לבדוק חיבור" text="בדקו את הרשת ונסו שוב." retry={refresh}/></Page>;
 const d=q.data!;
 return <Page title="חיבור WhatsApp" subtitle="פרטי החיבור של הבוט" refreshing={q.isRefetching} onRefresh={refresh}>
  <View style={[s.status,...card(c)]}><View style={[s.statusIcon,{backgroundColor:d.connected?c.muted:c.accent}]}><Feather name={d.connected?'check-circle':'alert-circle'} color={d.connected?c.primary:c.foreground} size={30}/></View><Text style={[s.statusTitle,{color:c.foreground}]}>{d.connected?'הבוט מחובר':'הבוט אינו מחובר'}</Text><Text style={[s.statusText,{color:c.mutedForeground}]}>{d.connected?'הבוט מוכן לענות ביעדים שהופעלו.':'השלימו את חיבור ספק ה-WhatsApp במערכת.'}</Text></View>
  <View style={[...card(c),s.details]}><Line label="ספק" value={d.provider}/><Line label="מספר מחובר" value={d.phoneNumber??'לא זמין'}/><Line label="כתובת קבלה" value={d.webhookConfigured?'מוגדרת':'לא מוגדרת'} highlight={!d.webhookConfigured}/></View>
  <Text style={[s.help,{color:c.mutedForeground}]}>לאחר חיבור תקין, הגדירו יעדים ומנהלים בלשוניות המתאימות.</Text>
 </Page>
}
function Line({label,value,highlight}:{label:string;value:string;highlight?:boolean}){const c=useColors();return <View style={s.line}><Text style={[s.lineValue,{color:highlight?c.destructive:c.foreground}]}>{value}</Text><Text style={[s.lineLabel,{color:c.mutedForeground}]}>{label}</Text></View>}
const s=StyleSheet.create({status:{alignItems:'center',gap:8,paddingVertical:24},statusIcon:{height:58,width:58,borderRadius:29,alignItems:'center',justifyContent:'center'},statusTitle:{fontFamily:'Inter_700Bold',fontSize:20},statusText:{fontFamily:'Inter_400Regular',fontSize:14,textAlign:'center',lineHeight:20,paddingHorizontal:12},details:{gap:15},line:{flexDirection:'row-reverse',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:'#DDD7CA',paddingBottom:12},lineLabel:{fontFamily:'Inter_500Medium',fontSize:14},lineValue:{fontFamily:'Inter_600SemiBold',fontSize:14,textAlign:'left',maxWidth:'65%'},help:{fontFamily:'Inter_400Regular',fontSize:13,textAlign:'right',lineHeight:20,paddingHorizontal:4}});