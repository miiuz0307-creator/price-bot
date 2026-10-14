/**
 * WhatsApp contact/message links (wa.me/…, api.whatsapp.com/…) that come along when a
 * price message is pasted (someone's signature). They never belong in the catalog or
 * in the bot's replies.
 */
const whatsappLink = /(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com)\/[^\s]*/giu;

export function hasWhatsAppLink(text: string) {
  whatsappLink.lastIndex = 0;
  return whatsappLink.test(text);
}

/** Removes the links; a line left with no words or numbers (e.g. "👇") is dropped. */
export function stripWhatsAppLinks(text: string) {
  if (!text || !hasWhatsAppLink(text)) return text;
  const lines = text.split("\n").flatMap((line) => {
    if (!hasWhatsAppLink(line)) return [line];
    const rest = line.replace(whatsappLink, "").replace(/[ \t]{2,}/g, " ").trim();
    return /[\p{L}\p{N}]/u.test(rest) ? [rest] : [];
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Section = { title: string; subtitle?: string; distance?: string; duration?: string; level?: string; waitTime?: string; priceMatrix: number[] };

/** Cleans every text field of a product (only the ones present). */
export function stripProductLinks<T extends Partial<{
  name: string; subtitle: string; notes: string; distance: string; duration: string; level: string; waitTime: string;
  aliases: string[]; sections: Section[];
}>>(product: T): T {
  const out: Record<string, unknown> = { ...product };
  for (const key of ["name", "subtitle", "notes", "distance", "duration", "level", "waitTime"] as const) {
    if (typeof product[key] === "string") out[key] = stripWhatsAppLinks(product[key] as string);
  }
  if (Array.isArray(product.aliases)) out.aliases = product.aliases.map(stripWhatsAppLinks).filter((alias) => alias.trim());
  if (Array.isArray(product.sections)) {
    out.sections = product.sections.map((section) => Object.fromEntries(Object.entries(section).map(([key, value]) => [key, typeof value === "string" ? stripWhatsAppLinks(value) : value])));
  }
  return out as T;
}
