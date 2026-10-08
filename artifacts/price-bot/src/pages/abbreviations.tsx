import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import {
  getListAbbreviationsQueryKey,
  useCreateAbbreviation,
  useDeleteAbbreviation,
  useListAbbreviations,
  useUpdateAbbreviation,
  type Abbreviation,
} from '@workspace/api-client-react';

const emptyForm = { shortcut: '', expansion: '' };

export default function AbbreviationsPage() {
  const query = useListAbbreviations();
  const create = useCreateAbbreviation();
  const update = useUpdateAbbreviation();
  const remove = useDeleteAbbreviation();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Abbreviation | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending || remove.isPending;

  const reset = () => { setEditing(null); setForm(emptyForm); setError(null); };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = { shortcut: form.shortcut.trim(), expansion: form.expansion.trim() };
    if (!/^[\p{L}\p{N}]{2,20}$/u.test(data.shortcut) || data.expansion.length < 2 || data.expansion.length > 80) {
      setError('הקיצור חייב להיות מילה אחת בת 2–20 תווים, ושם המקום חייב להיות מלא.');
      return;
    }
    setError(null);
    const onSuccess = () => {
      void client.invalidateQueries({ queryKey: getListAbbreviationsQueryKey() });
      setFeedback(editing ? 'הקיצור עודכן והבוט משתמש בו מעכשיו.' : 'הקיצור נוסף והבוט משתמש בו מעכשיו.');
      reset();
    };
    const onError = (reason: unknown) => setError(reason instanceof Error ? reason.message : 'לא ניתן לשמור את הקיצור.');
    if (editing) update.mutate({ id: editing.id, data }, { onSuccess, onError });
    else create.mutate({ data }, { onSuccess, onError });
  };
  const deleteShortcut = (row: Abbreviation) => {
    if (!window.confirm(`למחוק את הקיצור „${row.shortcut}”?`)) return;
    remove.mutate({ id: row.id }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListAbbreviationsQueryKey() });
        if (editing?.id === row.id) reset();
        setFeedback('הקיצור נמחק.');
        setError(null);
      },
      onError: (reason) => setError(reason instanceof Error ? reason.message : 'לא ניתן למחוק את הקיצור.'),
    });
  };

  return (
    <div className="animate-rise-in">
      <header className="mb-7">
        <p className="mb-2 text-xs font-extrabold tracking-[.16em] text-primary">מחירון / קיצורים</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">קיצורים שהבוט מבין.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          הגדירו שם קצר למקום, למשל רג = רמת גן. הקיצור יעבוד בשני כיווני הנסיעה, אך לא ישנה מחירים שמורים.
          הקיצורים המובנים בבוט ממשיכים לעבוד כרגיל.
        </p>
      </header>

      {feedback && <p role="status" className="mb-5 rounded-xl bg-secondary px-4 py-3 text-sm font-bold" data-testid="status-abbreviation-feedback">{feedback}</p>}
      <section className="mb-7 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-secondary text-primary"><Plus className="size-4" /></div>
          <h2 className="text-lg font-extrabold">{editing ? 'עריכת קיצור' : 'קיצור חדש'}</h2>
        </div>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
          <label className="grid gap-1.5 text-sm font-bold">
            <span>קיצור</span>
            <input required maxLength={20} value={form.shortcut} onChange={(event) => setForm({ ...form, shortcut: event.target.value })}
              className="input-base" placeholder="רג" data-testid="input-abbreviation-shortcut" />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            <span>שם המקום המלא</span>
            <input required maxLength={80} value={form.expansion} onChange={(event) => setForm({ ...form, expansion: event.target.value })}
              className="input-base" placeholder="רמת גן" data-testid="input-abbreviation-expansion" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-save-abbreviation">
              <Check className="size-4" /> {busy ? 'שומר…' : editing ? 'שמירת שינוי' : 'הוספה'}
            </button>
            {editing && <button type="button" onClick={reset} className="min-h-10 rounded-lg bg-secondary px-4 text-sm font-bold">ביטול</button>}
          </div>
        </form>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-destructive" data-testid="status-abbreviation-error">{error}</p>}
        <p className="mt-3 text-xs text-muted-foreground">הקיצור חייב להיות מילה אחת. יש לשלוח לבוט מוצא ויעד מלאים, למשל: מ אשדוד רג.</p>
      </section>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">קיצורים ששמרתם</h2>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-muted-foreground hover:bg-secondary" aria-label="רענון קיצורים">
          <RefreshCcw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} /> רענון
        </button>
      </div>
      {query.isLoading ? <p className="text-sm text-muted-foreground">טוען קיצורים…</p>
        : query.isError ? <div role="alert" className="rounded-xl border border-destructive p-4 text-sm">לא הצלחנו לטעון את הקיצורים. <button type="button" onClick={() => void query.refetch()} className="font-bold underline">נסו שוב</button></div>
        : !query.data?.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">עוד לא הוספתם קיצורים משלכם. אפשר להתחיל עם רג → רמת גן.</div>
        : <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid="list-abbreviations">
          {query.data.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-4">
                <strong className="rounded-lg bg-secondary px-3 py-2 text-sm text-primary">{row.shortcut}</strong>
                <span className="text-muted-foreground" aria-hidden="true">←</span>
                <span className="break-words text-sm font-bold">{row.expansion}</span>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => { setEditing(row); setForm({ shortcut: row.shortcut, expansion: row.expansion }); setFeedback(null); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary" aria-label={`עריכת ${row.shortcut}`} data-testid={`button-edit-abbreviation-${row.id}`}><Pencil className="size-4" /></button>
                <button type="button" onClick={() => deleteShortcut(row)} disabled={busy}
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50" aria-label={`מחיקת ${row.shortcut}`} data-testid={`button-delete-abbreviation-${row.id}`}><Trash2 className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>}
    </div>
  );
}