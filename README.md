# מחירון בוואטסאפ

בוט מחירים ל־WhatsApp עם אתר ניהול בעברית. שירות אחד מריץ את ה־API, את חיבורי ה־WhatsApp (Baileys) ואת האתר.

- ניתוח המערכת ותוכנית השדרוג: [`docs/ANALYSIS-AND-PLAN.md`](docs/ANALYSIS-AND-PLAN.md)
- משתני סביבה: [`.env.example`](.env.example)

## מבנה

| תיקייה | מה יש בה |
|---|---|
| `artifacts/api-server` | שרת Express, מנוע הבוט, חיבורי WhatsApp |
| `artifacts/price-bot` | אתר הניהול (React + Vite) |
| `artifacts/price-bot-mobile` | אפליקציית Expo (מוקפאת, ראו תוכנית) |
| `lib/db` | סכמת מסד הנתונים (Drizzle + PostgreSQL) |
| `lib/api-spec` | חוזה ה־API (OpenAPI). אחרי שינוי: `pnpm --filter @workspace/api-spec run codegen` |

## הרצה מקומית

דרישות: Node.js 24, pnpm 10, PostgreSQL.

```bash
pnpm install
cp .env.example .env              # למלא DATABASE_URL ו-SESSION_SECRET
pnpm run typecheck
pnpm --filter @workspace/api-server run test
PORT=8080 pnpm --filter @workspace/api-server run dev   # השרת
pnpm --filter @workspace/price-bot run dev              # האתר, בחלון נוסף
```

## פריסה ל־Railway + Supabase

1. **Supabase** ← Project Settings ← Database ← Connection string ← **Session pooler**. מעתיקים את הכתובת, כולל הסיסמה.
2. **Railway** ← New Project ← Deploy from GitHub repo ← בוחרים את `price-bot`. Railway יזהה את `railway.json` ואת ה־`Dockerfile`.
3. ב־Railway ← השירות ← **Variables**, מוסיפים:
   - `DATABASE_URL` (מ־Supabase)
   - `DATABASE_SSL=require`
   - `SESSION_SECRET` (מחרוזת אקראית ארוכה)
   - `GOOGLE_MAPS_API_KEY` (אופציונלי)
4. Railway ← השירות ← **Volumes** ← Add Volume, Mount path: `/data`. כאן נשמרים חיבורי ה־WhatsApp בין פריסות.
5. Settings ← Networking ← **Generate Domain**, ונכנסים לאתר.
6. **מסד חדש וריק בלבד:** מגדירים ב־Variables את `OWNER_INITIAL_CODE` (4–8 ספרות), והוא יהיה קוד הבעלים. אחרי הכניסה הראשונה מוחקים את המשתנה. באתר החי אי אפשר להגדיר קוד בעלים מהדפדפן, כדי שאף זר לא יוכל „לתפוס בעלות". במעבר מ־Replit הקוד הקיים עובר עם המסד, ולא צריך את המשתנה הזה.

### לפני מעבר מ־Replit
- **מסד הנתונים**: גיבוי מ־Replit (`pg_dump`) ושחזור ל־Supabase. אל תריצו `drizzle push` על מסד עם נתונים חיים.
- **WhatsApp**: אסור להפעיל את אותו חיבור בשני שרתים במקביל. קודם עוצרים את Replit, ורק אז מחברים מחדש ב־Railway (סריקת QR אחת).

## בדיקות אוטומטיות

בכל `push` ל־GitHub רצות בדיקת טיפוסים, בדיקות, בנייה ובניית Docker (`.github/workflows/ci.yml`). ✗ אדום ב־GitHub = לא לפרוס את הגרסה הזו.
