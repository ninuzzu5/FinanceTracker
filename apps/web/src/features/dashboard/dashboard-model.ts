import { categoryLabels } from "@finance-tracker/domain";

export type BalanceStatus = "configured" | "before_opening" | "not_configured";
export type Balance = { id: string; name: string; active: boolean; status: BalanceStatus; cents: bigint | null };
export type Movement = {
  id: string;
  date: string;
  type: "expense" | "income" | "transfer";
  cents: bigint;
  category: string | null;
  from: string | null;
  to: string | null;
  voided: boolean;
};

const currencyFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const dayFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "long", year: "numeric" });
const romeDateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

export function parseCents(value: unknown): bigint {
  const match = typeof value === "string" ? /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value) : null;
  if (!match) throw new Error("Importo non valido");
  return BigInt(`${match[1]}${match[2]}${(match[3] ?? "").padEnd(2, "0")}`);
}

export function money(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  const whole = cents < 0n && absolute < 100n ? -0 : cents / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return currencyFormat.formatToParts(whole).map(part => part.type === "fraction" ? fraction : part.value).join("");
}

export const formatDay = (date: string) => dayFormat.format(new Date(date));
export const todayInRome = (now = new Date()) => romeDateFormat.format(now);

export function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function dashboardPeriod(month: string, today: string) {
  const from = `${month}-01`;
  const end = new Date(`${shiftMonth(month, 1)}-01`);
  end.setUTCDate(0);
  const to = month === today.slice(0, 7) ? today : end.toISOString().slice(0, 10);
  return { from, to, label: monthFormat.format(new Date(from)) };
}
export type Period = ReturnType<typeof dashboardPeriod>;

export function labelForCategory(category: string | null): string {
  if (category === null) return "Senza categoria";
  return Object.hasOwn(categoryLabels, category) ? categoryLabels[category as keyof typeof categoryLabels] : category;
}

export function statistics(movements: readonly Movement[], period: Period) {
  let income = 0n;
  let expenses = 0n;
  const byDay = Array<bigint>(Number(period.to.slice(-2))).fill(0n);
  const categories = new Map<string | null, bigint>();
  for (const movement of movements) {
    if (movement.voided || movement.type === "transfer") continue;
    if (movement.type === "income") {
      income += movement.cents;
    } else {
      expenses += movement.cents;
      byDay[Number(movement.date.slice(-2)) - 1] += movement.cents;
      categories.set(movement.category, (categories.get(movement.category) ?? 0n) + movement.cents);
    }
  }
  let running = 0n;
  return {
    income,
    expenses,
    cumulative: byDay.map(cents => running += cents),
    categories: [...categories].sort(([, left], [, right]) => left > right ? -1 : left < right ? 1 : 0),
  };
}
