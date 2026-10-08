export function normalizePhone(value: string) {
  let digits = value.trim().replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits;
}

export function normalizeIdentifier(value: string, kind: string) {
  return kind === "group" ? value.trim().replace(/@g\.us$/i, "") : normalizePhone(value);
}
