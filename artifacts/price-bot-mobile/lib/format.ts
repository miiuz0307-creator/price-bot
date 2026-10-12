import type { Product, SurgeOffer } from '@workspace/api-client-react';

export const shekel = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `₪${Math.round(value).toLocaleString('he-IL')}`;

export const number = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('he-IL');

/** "לפני 5 דק׳" style relative time. */
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString('he-IL');
}

export function minutesLeft(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000));
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'לילה טוב,';
  if (hour < 12) return 'בוקר טוב,';
  if (hour < 17) return 'צהריים טובים,';
  if (hour < 21) return 'ערב טוב,';
  return 'לילה טוב,';
}

export const firstName = (label: string) => label.trim().split(/\s+/u)[0] || label;

/** 0504107826 / 972504107826 → 050-410-7826 */
export function displayPhone(phone: string | null | undefined) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

// Product.priceMatrix order (as the bot prints it): one-way / round trip per vehicle.
export const vehicles = [
  { key: 'regular', label: '4 מקומות', short: '4 מק׳' },
  { key: 'small_minivan', label: '6 מק׳ קטן', short: '6 קטן' },
  { key: 'roomy_six', label: '6 מק׳ מרווח', short: '6 מרווח' },
  { key: 'sienna', label: '7 מק׳ סיינה', short: 'סיינה' },
] as const;

export const matrixLabels = ['4 מק׳', '4 מק׳ · הלוך ושוב', '6 מק׳ קטן', '6 קטן · הלוך ושוב', '6 מק׳ מרווח', '6 מרווח · הלוך ושוב', '7 מק׳ (סיינה)', '7 מק׳ · הלוך ושוב'];

export const vehicleLabel = (type: SurgeOffer['vehicleType']) => vehicles.find((vehicle) => vehicle.key === type)?.label ?? type;

/** One-way and round-trip price for vehicle index 0..3 (falls back to the base price). */
export function matrixPrice(product: Pick<Product, 'price' | 'priceMatrix'>, vehicle: number, roundTrip = false) {
  if (product.priceMatrix.length >= 8) return product.priceMatrix[vehicle * 2 + (roundTrip ? 1 : 0)];
  return roundTrip ? null : product.price;
}

export const hasFullMatrix = (product: Pick<Product, 'priceMatrix'>) => product.priceMatrix.length >= 8;

/** Search text: lowercase, no niqqud, final letters unified, "בב" → "בני ברק", only letters/digits. */
export function searchKey(value: string) {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => (part === 'בב' ? 'בני ברק' : part === 'תא' || part === 'ת"א' || part === 'ת״א' ? 'תל אביב' : part))
    .join(' ')
    .toLocaleLowerCase('he-IL')
    .normalize('NFD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (letter) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function productMatches(product: Product, query: string) {
  const words = query.trim().split(/\s+/u).map(searchKey).filter(Boolean);
  if (!words.length) return true;
  const haystacks = [product.name, ...product.aliases].map(searchKey);
  return haystacks.some((text) => words.every((word) => text.includes(word)));
}

/** Text to paste/send to a customer — same layout as the bot's reply. */
export function productMessage(product: Product) {
  const block = (title: string, subtitle: string | undefined, info: { distance?: string; duration?: string; level?: string; waitTime?: string }, matrix: { price: number; priceMatrix: number[] }) => {
    const lines = [`🗺️ *${title}*`];
    if (subtitle) lines.push(`*${subtitle}*`);
    lines.push('');
    if (info.distance) lines.push(`🛤️ *מרחק משוער -* ${info.distance}`);
    if (info.duration) lines.push(`⌚️ *זמן משוער -* ${info.duration}`);
    if (info.level) lines.push(`🧾 *סוג מחירון -* ${info.level}`);
    if (info.distance || info.duration || info.level) lines.push('');
    const icons = ['🚗', '🚙', '🚐', '🚌'];
    const labels = ["4 מק'", "6 מק' קטן", "6 מק' מרווח", "7 מק' (סיינה)"];
    labels.forEach((label, index) => {
      lines.push(`${icons[index]} *${label} -* ${shekel(matrixPrice(matrix, index))}`);
      if (hasFullMatrix(matrix)) lines.push(`♾️ *צדדים -* ${shekel(matrixPrice(matrix, index, true))}`);
      lines.push('');
    });
    if (info.waitTime) lines.push(`⏳ *המתנה בצדדים -* ${info.waitTime}`);
    return lines.join('\n').trim();
  };
  const parts = [block(product.name, product.subtitle, product, product)];
  for (const section of product.sections ?? []) {
    parts.push(block(section.title, section.subtitle, section, { price: section.priceMatrix[0], priceMatrix: section.priceMatrix }));
  }
  let text = parts.join('\n\n----------------------\n\n');
  if (product.notes) text += `\n\n📝 *הערות -* ${product.notes}`;
  return text;
}

/** Same parser as the website's "paste price message" (bot reply → product). */
export function parsePastedPriceMessage(text: string) {
  // The automatic Jerusalem "neighborhood additions" block is added by the bot itself.
  const baseSection = text.split(/תוספת שכונות/u)[0] || text;
  const clean = (value: string | undefined) => (value || '').replace(/[*_`]/g, '').trim();
  const blocks = baseSection.split(/(?=🗺️)/u).filter((block) => block.includes('🗺️'));
  const parseBlock = (block: string) => {
    const lines = block.split('\n');
    const titleIndex = lines.findIndex((line) => line.includes('🗺️'));
    const next = (lines[titleIndex + 1] || '').trim();
    const field = (label: string) => clean(block.match(new RegExp(`${label}\\s*-\\s*\\*?\\s*([^\\n]+)`, 'u'))?.[1]);
    return {
      title: clean(block.match(/🗺️\s*\*?([^\n*]+)\*?/u)?.[1]).replace('↔', '⇔'),
      // A bold line right under the route name, e.g. "*רמת החייל*".
      subtitle: /^\*[^*\n]+\*$/u.test(next) ? clean(next) : '',
      prices: [...block.matchAll(/₪\s*([\d,.]+)/gu)].map((match) => Number(match[1].replace(/,/g, ''))).filter((value) => Number.isFinite(value) && value > 0),
      distance: field('מרחק משוער'),
      duration: field('זמן משוער'),
      level: field('סוג מחירון'),
      waitTime: field('המתנה בצדדים'),
    };
  };
  const [main, ...rest] = blocks.map(parseBlock);
  if (!main?.title) throw new Error('לא מצאתי בהודעה שם מסלול או אזור בשורה שמתחילה ב־🗺️.');
  if (main.prices.length < 8) throw new Error('לא מצאתי שמונה מחירים: 4 מקומות, 6 קטן, 6 מרווח ו־7 מקומות כולל צדדים.');
  // "<route> - 1", "<route> - 2": the route itself is the product, the rest are extra price blocks.
  const name = rest.length && /\s-\s*1$/u.test(main.title) ? main.title.replace(/\s*-\s*1$/u, '').trim() : main.title;
  const notesMatch = text.match(/📝\s*\*?\s*הערות\s*-\s*\*?\s*([^\n]*)((?:\n[^\n]*)*)/u);
  const notes = notesMatch ? [clean(notesMatch[1]), ...notesMatch[2].split('\n').map((line) => line.trim()).filter((line) => line && !/^(פותח על ידי|🤖|-{3,})/u.test(line))].filter(Boolean).join('\n') : '';
  const aliases = [...text.matchAll(/(?:לא מצאתי תשובה\s*ל|תיקנתי ל)\s*:\s*([^\n]+)/gu)]
    .map((match) => clean(match[1]))
    .filter(Boolean);
  return {
    name,
    price: main.prices[0],
    currency: 'ILS',
    aliases: [...new Set(aliases)],
    distance: main.distance,
    duration: main.duration,
    level: main.level,
    priceMatrix: main.prices.slice(0, 8),
    waitTime: main.waitTime,
    subtitle: main.subtitle,
    notes,
    sections: rest.filter((block) => block.title && block.prices.length).map((block) => ({
      title: block.title,
      subtitle: block.subtitle,
      distance: block.distance,
      duration: block.duration,
      level: block.level,
      priceMatrix: block.prices.length >= 8 ? block.prices.slice(0, 8) : [block.prices[0]],
      waitTime: block.waitTime,
    })),
    active: true,
  };
}

export const permissionLabels: Record<string, string> = {
  'catalog.edit': 'עריכת מחירון וקיצורים',
  'targets.manage': 'ניהול יעדים (אנשי קשר וקבוצות)',
  'lookups.manage': 'טיפול בבקשות מחיר',
  'surge.manage': 'הפעלת מעקב עומס',
  'whatsapp.manage': 'חיבור וניתוק WhatsApp',
  'users.manage': 'ניהול משתמשים',
};

/** Activity log action → Hebrew. */
export const actionLabels: Record<string, string> = {
  'auth.login': 'כניסה למערכת',
  'auth.login_failed': 'ניסיון כניסה שגוי',
  'auth.owner_setup': 'הגדרת קוד בעלים',
  'auth.owner_code_reset': 'איפוס קוד בעלים',
  'user.create': 'משתמש נוסף',
  'user.update': 'עדכון משתמש',
  'user.delete': 'משתמש נמחק',
  'user.suspend': 'השעיית משתמש',
  'user.restore': 'החזרת משתמש',
  'user.invite': 'נשלחה הזמנה',
  'user.set_pin': 'עדכון קוד אישי',
  'user.sessions_revoked': 'ניתוק מכל המכשירים',
  'product.create': 'מסלול נוסף',
  'product.update': 'עדכון מחיר',
  'product.delete': 'מסלול נמחק',
  'lookup.approve': 'הערכה אושרה למחירון',
  'abbreviation.create': 'קיצור נוסף',
  'abbreviation.update': 'עדכון קיצור',
  'abbreviation.delete': 'קיצור נמחק',
  'target.create': 'יעד נוסף',
  'target.update': 'עדכון יעד',
  'target.delete': 'יעד נמחק',
  'surge.start': 'מעקב עומס הופעל',
  'surge.stop': 'מעקב עומס כובה',
  'whatsapp.connect_started': 'התחלת חיבור WhatsApp',
  'whatsapp.disconnect': 'ניתוק WhatsApp',
  'whatsapp.connected': 'WhatsApp התחבר',
  'whatsapp.disconnected': 'WhatsApp התנתק',
  'whatsapp.logged_out': 'WhatsApp נותק מהטלפון',
  'whatsapp.replaced': 'WhatsApp נפתח במקום אחר',
  'whatsapp.code_expired': 'פג תוקף קוד חיבור',
  'whatsapp.error': 'שגיאת WhatsApp',
  'push.device_registered': 'טלפון נרשם להתראות',
};

export const actionLabel = (action: string) => actionLabels[action] ?? action;
export const isProblemAction = (action: string) => /\.(error|disconnected|logged_out|replaced|failed|login_failed)$/u.test(action);
