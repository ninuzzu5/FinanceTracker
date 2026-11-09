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
const shortDay = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "numeric", month: "short" });
const shortMonth = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "short" });
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

export const periodModes = { year: "Anno", month: "Mese", week: "Settimana", day: "Giorno" } as const;
export type PeriodMode = keyof typeof periodModes;

// Limite di navigazione all'indietro: non c'è un inizio noto del ledger, quindi il
// selettore blocca "precedente" solo a una data sentinella assurda (anno 1), per evitare
// una scorsa infinita nel passato senza inventare un vincolo contabile che non esiste.
export const firstDate = "0001-01-01";

// Le date civili sono calendario puro (Europe/Rome), non un istante: l'aritmetica
// resta in UTC su stringhe YYYY-MM-DD per non dipendere dall'ora legale locale.
function shiftDays(day: string, offset: number): string {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isoWeekStart(day: string): string {
  const date = new Date(day);
  return shiftDays(day, -((date.getUTCDay() + 6) % 7));
}

export function shiftPeriod(mode: PeriodMode, from: string, offset: number): string {
  if (mode === "day") return shiftDays(from, offset);
  if (mode === "week") return shiftDays(from, offset * 7);
  const date = new Date(from);
  date.setUTCMonth(date.getUTCMonth() + offset * (mode === "year" ? 12 : 1));
  return date.toISOString().slice(0, 10);
}

export function dashboardPeriod(mode: PeriodMode, anchor: string, today: string) {
  const day = anchor > today ? today : anchor;
  const from = mode === "year" ? `${day.slice(0, 4)}-01-01`
    : mode === "month" ? `${day.slice(0, 7)}-01`
    : mode === "week" ? isoWeekStart(day)
    : day;
  const periodEnd = shiftDays(shiftPeriod(mode, from, 1), -1);
  const to = periodEnd < today ? periodEnd : today;
  const label = mode === "year" ? from.slice(0, 4)
    : mode === "month" ? monthFormat.format(new Date(from))
    : mode === "week" ? `${shortDay.format(new Date(from))} – ${formatDay(to)}`
    : formatDay(from);
  return { mode, from, to, label, current: to === today };
}
export type Period = ReturnType<typeof dashboardPeriod>;

export function labelForCategory(category: string | null): string {
  if (category === null) return "Senza categoria";
  return Object.hasOwn(categoryLabels, category) ? categoryLabels[category as keyof typeof categoryLabels] : category;
}

export function statistics(movements: readonly Movement[], period: Period) {
  let income = 0n;
  let expenses = 0n;
  // Nella vista Anno i bucket sono mensili, altrimenti giornalieri: evita centinaia di
  // colonne vuote e tiene i grafici leggibili qualunque sia l'ampiezza del periodo.
  const byMonth = period.mode === "year";
  const bucketKey = (day: string) => byMonth ? day.slice(0, 7) : day;
  const buckets = new Map<string, { date: string; label: string; income: bigint; expenses: bigint }>();
  for (let date = period.from; date <= period.to; date = shiftPeriod(byMonth ? "month" : "day", date, 1)) {
    buckets.set(bucketKey(date), { date, label: (byMonth ? shortMonth : shortDay).format(new Date(date)), income: 0n, expenses: 0n });
  }
  const categories = new Map<string | null, bigint>();
  for (const movement of movements) {
    if (movement.voided || movement.type === "transfer") continue;
    const bucket = buckets.get(bucketKey(movement.date));
    if (movement.type === "income") {
      income += movement.cents;
      if (bucket) bucket.income += movement.cents;
    } else {
      expenses += movement.cents;
      if (bucket) bucket.expenses += movement.cents;
      categories.set(movement.category, (categories.get(movement.category) ?? 0n) + movement.cents);
    }
  }
  return {
    income,
    expenses,
    buckets: [...buckets.values()],
    categories: [...categories].sort(([, left], [, right]) => left > right ? -1 : left < right ? 1 : 0),
  };
}

export function spendingHeadline(period: Period, expenses: bigint): string {
  const when = period.mode === "year" ? `nel ${period.label}`
    : period.mode === "month" ? `a ${period.label}`
    : period.mode === "week" ? (period.current ? "in questa settimana" : `nella settimana del ${period.label}`)
    : period.current ? "oggi" : `il ${period.label}`;
  return `Hai speso ${money(expenses)} ${when}`;
}
