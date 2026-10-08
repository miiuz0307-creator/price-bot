export function parseBillingAmount(message: string): number | null {
  const match = /^מ\s+(\d+(?:[.,]\d{1,2})?)\s*🍓$/u.exec(message.trim());
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000 ? amount : null;
}

export function formatBillingCalculation(amount: number): string {
  const priceCents = Math.round(amount * 100);
  const feeCents = Math.round(priceCents * 0.12);
  const format = (cents: number) => `₪${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
  return [
    "🚉 *דרייווער בוט - מחירון +* 🚉",
    "",
    "🧮 *מחשבון חיוב* 🍒🍓🍏",
    "",
    `💰 *מחיר הנסיעה:* ${format(priceCents)}`,
    "",
    `💸 *החיוב על הנסיעה (12%):* ${format(feeCents)}`,
    "",
    `🟢 *הרווח שלך:* ${format(priceCents - feeCents)}`,
  ].join("\n");
}