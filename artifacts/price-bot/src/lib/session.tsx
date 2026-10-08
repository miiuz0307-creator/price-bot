import { createContext, useContext, type ReactNode } from 'react';
import type { Admin, Permission } from '@workspace/api-client-react';

const SessionContext = createContext<Admin | null>(null);

export function SessionProvider({ admin, children }: { admin: Admin; children: ReactNode }) {
  return <SessionContext.Provider value={admin}>{children}</SessionContext.Provider>;
}

export function useSessionAdmin() {
  return useContext(SessionContext);
}

/** UI hint only — the server enforces every permission. */
export function useCan(permission: Permission) {
  const admin = useContext(SessionContext);
  return Boolean(admin && (admin.role === 'owner' || admin.permissions.includes(permission)));
}

export const permissionOptions: { value: Permission; label: string; description: string }[] = [
  { value: 'catalog.edit', label: 'עריכת מחירון', description: 'הוספה, עריכה ומחיקה של מחירים וקיצורים' },
  { value: 'targets.manage', label: 'ניהול יעדים', description: 'אילו אנשי קשר וקבוצות מקבלים מענה' },
  { value: 'lookups.manage', label: 'בקשות מחיר', description: 'אישור הערכות וסגירת בקשות' },
  { value: 'surge.manage', label: 'זמני עומס', description: 'הפעלה ועצירה של מעקב מחירי עומס' },
  { value: 'whatsapp.manage', label: 'חיבור WhatsApp', description: 'חיבור, ניתוק וסריקת QR' },
  { value: 'users.manage', label: 'ניהול משתמשים', description: 'הוספה, השעיה והרשאות (רק הבעלים יכול להעניק)' },
];
