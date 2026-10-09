/** Validate existing numeric payloads without rounding; arithmetic can use exact cents. */
export function amountInCents(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!match) return null;
  const cents = Number(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`);
  return Number.isSafeInteger(cents) ? cents : null;
}
