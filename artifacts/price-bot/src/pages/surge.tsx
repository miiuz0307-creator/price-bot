import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Flame, Pause, Play, RefreshCcw } from 'lucide-react';
import {
  getGetSurgeStatusQueryKey,
  useGetSurgeStatus,
  useListWhatsAppGroups,
  useStartSurgeMonitoring,
  useStopSurgeMonitoring,
} from '@workspace/api-client-react';

const time = (date: string) => new Intl.DateTimeFormat('he-IL', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
}).format(new Date(date));

const displayedPrice = (offer: { price: number; extraPassenger: boolean }) =>
  offer.price + (offer.extraPassenger ? 20 : 0);

const vehicleLabels: Record<string, string> = {
  regular: 'רכב רגיל · 4 מקומות',
  small_minivan: 'מיניק · 6 מקומות קטן',
  roomy_six: '6 מקומות מרווח',
  sienna: 'סייאנה / סיינה · 7 מקומות',
};

export default function SurgePage() {
  const client = useQueryClient();
  const status = useGetSurgeStatus({ query: { queryKey: getGetSurgeStatusQueryKey(), refetchInterval: 10_000 } });
  const groups = useListWhatsAppGroups();
  const start = useStartSurgeMonitoring();
  const stop = useStopSurgeMonitoring();
  const [selection, setSelection] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = selection ?? status.data?.groupIdentifiers ?? [];
  const busy = start.isPending || stop.isPending;
  const refresh = () => { void client.invalidateQueries({ queryKey: getGetSurgeStatusQueryKey() }); };
  const toggle = (id: string) => setSelection(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const begin = () => {
    if (!selected.length) { setError('בחרו לפחות קבוצה אחת לקבלת מחירים.'); return; }
    setError(null);
    start.mutate({ data: { groupIdentifiers: selected } }, {
      onSuccess: () => { refresh(); setSelection(null); setFeedback('המעקב הופעל. מעכשיו ייקלטו רק הודעות חדשות מהקבוצות שבחרתם.'); },
      onError: (reason) => setError(reason instanceof Error ? reason.message : 'לא ניתן להפעיל מעקב. בדקו את חיבור WhatsApp.'),
    });
  };
  const halt = () => {
    setError(null);
    stop.mutate(undefined, {
      onSuccess: () => { refresh(); setFeedback('המעקב הופסק ומחירי העומס הזמניים בוטלו.'); },
      onError: (reason) => setError(reason instanceof Error ? reason.message : 'לא ניתן לעצור את המעקב.'),
    });
  };

  return <div className="animate-rise-in">
    <header className="mb-8">
      <p className="mb-2 text-xs font-extrabold tracking-[.16em] text-primary">מחירון / עדכונים מהשטח</p>
      <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl"><Flame className="size-8 text-primary" /> זמני עומס</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
        בחרו קבוצות שהמספר של הבוט חבר בהן, ואז הפעילו מעקב. הבוט יחפש מסלול ומחיר בהודעות חדשות גם כשהסדר והניסוח משתנים:
        המחיר יכול להופיע לפני המסלול או אחריו, עם או בלי סימן ₪, וסוג הרכב יכול להופיע בשורה נפרדת.
        בלי ציון סוג רכב המחיר מיועד לרכב רגיל. „מעל” מוסיף ₪20 לכל צד עבור אחד מעל המותר.
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
        {Object.entries(vehicleLabels).map(([type, label]) => <span key={type} className="rounded-lg border border-border bg-card px-3 py-2">{label}</span>)}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">למשל, „6 מרווח” נקלט כמחיר ל־6 מקומות מרווח; „סייאנה” ו„סיינה” נקלטים כמחיר ל־7 מקומות. מחיר גבוה ממחירון למסלול מזוהה יוצג ל־10 דקות בלי לשנות את המחירון הקבוע.</p>
    </header>
    {feedback && <p role="status" className="mb-5 rounded-xl bg-secondary px-4 py-3 text-sm font-bold">{feedback}</p>}
    {error && <p role="alert" className="mb-5 rounded-xl border border-destructive bg-card px-4 py-3 text-sm font-bold text-destructive">{error}</p>}
    {status.isLoading ? <p className="text-sm text-muted-foreground">טוען מצב מעקב…</p>
      : status.isError ? <div role="alert" className="rounded-xl border border-destructive p-4 text-sm">לא ניתן לטעון את המעקב. <button type="button" onClick={() => void status.refetch()} className="font-bold underline">נסו שוב</button></div>
      : <>
        <section className="mb-7 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">מעקב אחר מחירי עומס</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {status.data?.active ? 'פעיל — מחירים חדשים יכולים להתעדכן אוטומטית' : 'כבוי — מחירי העומס לא מוצגים בבוט'}
                {!status.data?.connected && ' · WhatsApp מנותק'}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.data?.active ? 'bg-secondary text-primary' : 'bg-muted text-muted-foreground'}`}>
              {status.data?.active ? 'פעיל' : 'לא פעיל'}
            </span>
          </div>
          {!status.data?.active && <>
            <h3 className="mb-3 text-sm font-extrabold">מאילו קבוצות לקלוט הצעות?</h3>
            {groups.isLoading ? <p className="text-sm text-muted-foreground">טוען קבוצות…</p>
              : groups.isError ? <p role="alert" className="text-sm text-destructive">לא ניתן לטעון את הקבוצות. ודאו שהבוט מחובר ל־WhatsApp ונסו שוב.</p>
              : !groups.data?.length ? <p className="text-sm text-muted-foreground">לא נמצאו קבוצות. הוסיפו את מספר הבוט לקבוצת WhatsApp וודאו שהוא מחובר.</p>
              : <div className="mb-5 grid gap-2 sm:grid-cols-2">
                {groups.data.map((group) => <label key={group.identifier} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-bold hover:bg-secondary">
                  <input type="checkbox" checked={selected.includes(group.identifier)} onChange={() => toggle(group.identifier)} className="size-4 accent-primary" />
                  <span className="truncate">{group.label}</span>
                </label>)}
              </div>}
          </>}
          <div className="flex flex-wrap gap-3">
            {status.data?.active
              ? <button type="button" onClick={halt} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[hsl(var(--destructive)/.1)] px-4 text-sm font-bold text-destructive disabled:opacity-50"><Pause className="size-4" /> {busy ? 'עוצר…' : 'עצירת זמני עומס'}</button>
              : <button type="button" onClick={begin} disabled={busy || !status.data?.connected || !groups.data?.length} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-start-surge"><Play className="size-4" /> {busy ? 'מפעיל…' : 'הפעלת זמני עומס'}</button>}
            <button type="button" onClick={() => { void groups.refetch(); void status.refetch(); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-bold"><RefreshCcw className="size-4" /> רענון</button>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">המערכת אינה שולפת הודעות ישנות. הודעה בלי מסלול שמור וחד־משמעי ומחיר מפורש לא תשנה את תשובת הבוט. מחיר עומס חל רק על כיוון הנסיעה שהופיע בהודעה; המחירון הקבוע נשאר זהה בשני הכיוונים. מחיר עומס נמוך מהמחירון של אותו סוג רכב לא יוצג, גם אם המחירון התעדכן מאז קליטת ההודעה. במקרה של ניתוק WhatsApp יש לחבר אותו מחדש.</p>
        </section>

        <section aria-labelledby="live-prices-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h2 id="live-prices-title" className="text-lg font-extrabold">מחירים מעודכנים בזמן אמת</h2>
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold text-primary">{status.data?.offers.length ?? 0} פעילים</span>
            </div>
            <p className="text-xs text-muted-foreground">מתעדכן כל 10 שניות · הצעות אחרונות תחילה</p>
          </div>
          {!status.data?.offers.length
            ? <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">אין כרגע מחיר עומס מזוהה. כשהמעקב פעיל, הצעות חדשות ממסלולים שמורים יופיעו כאן.</div>
            : <>
              <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-sm md:block">
                <table className="w-full min-w-[780px] text-right text-sm">
                  <caption className="sr-only">מחירי עומס פעילים לפי מסלול, סוג רכב, מחיר, קבוצה וזמן תוקף</caption>
                  <thead className="bg-secondary/60 text-xs font-bold text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-5 py-3">מסלול</th>
                      <th scope="col" className="px-4 py-3">סוג רכב</th>
                      <th scope="col" className="px-4 py-3">מחיר מוצג</th>
                      <th scope="col" className="px-4 py-3">קבוצת מקור</th>
                      <th scope="col" className="px-5 py-3">נקלט / תוקף</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {status.data.offers.map((offer) => <tr key={offer.id} className="align-top hover:bg-secondary/30">
                      <td className="max-w-[250px] px-5 py-4 font-extrabold">{offer.route}</td>
                      <td className="px-4 py-4">
                        <span>{vehicleLabels[offer.vehicleType]}</span>
                        {offer.extraPassenger && <span className="mt-1 block text-xs text-muted-foreground">אחד מעל המותר</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <strong className="text-lg text-primary">₪{displayedPrice(offer).toLocaleString('he-IL')}</strong>
                        {offer.extraPassenger && <span className="block text-xs text-muted-foreground">₪{offer.price.toLocaleString('he-IL')} + ₪20 לצד</span>}
                      </td>
                      <td className="max-w-[180px] break-words px-4 py-4">{offer.groupLabel}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs">
                        <span className="block">נקלט: <time dateTime={offer.observedAt}>{time(offer.observedAt)}</time></span>
                        <span className="mt-1 block font-bold text-primary">עד: <time dateTime={offer.expiresAt}>{time(offer.expiresAt)}</time></span>
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 md:hidden">
                {status.data.offers.map((offer) => <article key={offer.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-extrabold">{offer.route}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{vehicleLabels[offer.vehicleType]}{offer.extraPassenger && ' · אחד מעל המותר'}</p>
                    </div>
                    <strong className="shrink-0 text-xl text-primary">₪{displayedPrice(offer).toLocaleString('he-IL')}</strong>
                  </div>
                  {offer.extraPassenger && <p className="mt-2 text-xs text-muted-foreground">מחיר ההודעה ₪{offer.price.toLocaleString('he-IL')} + ₪20 לצד לנוסע נוסף</p>}
                  <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
                    <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">קבוצת מקור</dt><dd className="mt-0.5 break-words font-bold">{offer.groupLabel}</dd></div>
                    <div><dt className="text-muted-foreground">נקלט</dt><dd className="mt-0.5 font-bold"><time dateTime={offer.observedAt}>{time(offer.observedAt)}</time></dd></div>
                    <div><dt className="text-muted-foreground">בתוקף עד</dt><dd className="mt-0.5 font-bold text-primary"><time dateTime={offer.expiresAt}>{time(offer.expiresAt)}</time></dd></div>
                  </dl>
                </article>)}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">המחירים זמניים ואינם משנים את המחירון הקבוע. תוספת לנוסע מעל המותר מחושבת לכל צד בנפרד.</p>
            </>}
        </section>
      </>}
  </div>;
}