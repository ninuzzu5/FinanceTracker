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
const monthOnlyFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "long" });
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

// Scomposizione per categoria di un sottoinsieme di movimenti (un conto, un periodo, una
// finestra di dettaglio): importo e numero di movimenti, ordinata per importo decrescente.
// Unica funzione per entrate e uscite, riusata da statistics() e dalle finestre di dettaglio.
export type CategoryBreakdownRow = { category: string | null; cents: bigint; count: number };
export function categoryBreakdown(movements: readonly Movement[], type: "income" | "expense"): CategoryBreakdownRow[] {
  const rows = new Map<string | null, CategoryBreakdownRow>();
  for (const movement of movements) {
    if (movement.voided || movement.type !== type) continue;
    const row = rows.get(movement.category) ?? { category: movement.category, cents: 0n, count: 0 };
    row.cents += movement.cents;
    row.count += 1;
    rows.set(movement.category, row);
  }
  return [...rows.values()].sort((a, b) => a.cents > b.cents ? -1 : a.cents < b.cents ? 1 : 0);
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
  for (const movement of movements) {
    if (movement.voided || movement.type === "transfer") continue;
    const bucket = buckets.get(bucketKey(movement.date));
    if (movement.type === "income") {
      income += movement.cents;
      if (bucket) bucket.income += movement.cents;
    } else {
      expenses += movement.cents;
      if (bucket) bucket.expenses += movement.cents;
    }
  }
  return {
    income,
    expenses,
    buckets: [...buckets.values()],
    categories: categoryBreakdown(movements, "expense"),
    incomeCategories: categoryBreakdown(movements, "income"),
  };
}

export function spendingHeadline(period: Period, expenses: bigint): string {
  const when = period.mode === "year" ? `nel ${period.label}`
    : period.mode === "month" ? `a ${period.label}`
    : period.mode === "week" ? (period.current ? "in questa settimana" : `nella settimana del ${period.label}`)
    : period.current ? "oggi" : `il ${period.label}`;
  return `Hai speso ${money(expenses)} ${when}`;
}

export type TitlePiece = { text: string; background: string; color: string; angle: number };
// Alternanza bianco/rosso/giallo/bianco/blu dei "ritagli" del titolo (Specifiche.dc.html).
const titlePalette = [
  { background: "#fff", color: "#111" }, { background: "#E63946", color: "#fff" },
  { background: "#FFE14D", color: "#111" }, { background: "#fff", color: "#111" },
  { background: "#1D4ED8", color: "#fff" },
] as const;
const titleAngles = [-3, 2, -1, 3, -2] as const;

export function titlePieces(period: Period, expenses: bigint): TitlePiece[] {
  const words = period.mode === "year" ? ["NEL", period.label, "HAI", "SPESO"]
    : period.mode === "month" ? ["A", monthOnlyFormat.format(new Date(period.from)).toUpperCase(), "HAI", "SPESO"]
    : period.mode === "week" ? (period.current ? ["IN", "SETTIMANA", "HAI", "SPESO"] : ["QUELLA", "SETTIMANA", "HAI", "SPESO"])
    : period.current ? ["OGGI", "HAI", "SPESO"] : [formatDay(period.from).toUpperCase(), "HAI", "SPESO"];
  return [...words, money(expenses)].map((text, index) => (
    { text, ...titlePalette[index % titlePalette.length], angle: titleAngles[index % titleAngles.length] }
  ));
}

// "fino a 10 caratteri normale, 11-12, 13-14, oltre 14" (Specifiche.dc.html + brief §4b):
// il corpo del numero si riduce a gradini così l'importo non esce mai dalla scheda.
export type AmountSize = "" | "s1" | "s2" | "s3";
export function amountSizeClass(texts: readonly string[]): AmountSize {
  const longest = texts.reduce((max, text) => Math.max(max, text.length), 0);
  return longest <= 10 ? "" : longest <= 12 ? "s1" : longest <= 14 ? "s2" : "s3";
}
