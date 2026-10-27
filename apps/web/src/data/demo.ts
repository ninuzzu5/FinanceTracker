import type { AccountId, ClassifiedMovement, ExpenseCategoryId } from "@finance-tracker/domain";

/** Dati sintetici, senza collegamento al database.
 * Gli aggregati sono statici, non calcolati dalla selezione di movimenti.
 * I trasferimenti sono esclusi da entrate e uscite.
 */
export const demo = {
  period: "Ottobre 2026",
  netWorth: "12.480,32 €",
  income: "3.250,00 €",
  expenses: "1.942,18 €",
  netWorthChange: "+12,5%",
  incomeChange: "+8,1%",
  expensesChange: "−6,4%",
} as const;

export const demoAccounts = [
  { id: "revolut", balance: "6.430,21 €", description: "Conto principale", monogram: "R" },
  { id: "isybank", balance: "4.812,40 €", description: "Conto corrente", monogram: "i" },
  { id: "contanti", balance: "1.237,71 €", description: "Portafoglio", monogram: null },
] as const satisfies readonly { id: AccountId; balance: string; description: string; monogram: string | null }[];

// Quote arrotondate e geometria statica del grafico: nessun calcolo contabile.
export const demoCategories = [
  { id: "rent", amount: "680,00 €", share: "35%", arc: "33.4 66.6", offset: "-0.8", color: "var(--chart-rent)" },
  { id: "groceries", amount: "420,00 €", share: "22%", arc: "20.4 79.6", offset: "-35.8", color: "var(--chart-groceries)" },
  { id: "food", amount: "290,00 €", share: "15%", arc: "13.4 86.6", offset: "-57.8", color: "var(--chart-food)" },
  { id: "public_transport", amount: "180,00 €", share: "9%", arc: "7.4 92.6", offset: "-72.8", color: "var(--chart-transport)" },
  { id: "subscriptions", amount: "142,18 €", share: "7%", arc: "5.4 94.6", offset: "-81.8", color: "var(--chart-subscriptions)" },
  { id: "leisure", amount: "230,00 €", share: "12%", arc: "10.4 89.6", offset: "-88.8", color: "var(--chart-leisure)" },
] as const satisfies readonly { id: ExpenseCategoryId; amount: string; share: string; arc: string; offset: string; color: string }[];

export const demoSpendingChart = {
  // Coordinate statiche delle spese cumulative, fino al totale mensile indicato.
  line: "M 48 183.8 L 62 180 L 76 180 L 90 162 L 104 157 L 118 157 L 132 149 L 146 146.81 L 160 131 L 174 124 L 188 124 L 202 119 L 216 110 L 230 106 L 244 102.8 L 258 92 L 272 88 L 286 88 L 300 73 L 314 67 L 328 65 L 342 63.2 L 356 51 L 370 45 L 384 45 L 398 40 L 412 35 L 426 35 L 440 30 L 454 25.204",
  area: "M 48 183.8 L 62 180 L 76 180 L 90 162 L 104 157 L 118 157 L 132 149 L 146 146.81 L 160 131 L 174 124 L 188 124 L 202 119 L 216 110 L 230 106 L 244 102.8 L 258 92 L 272 88 L 286 88 L 300 73 L 314 67 L 328 65 L 342 63.2 L 356 51 L 370 45 L 384 45 L 398 40 L 412 35 L 426 35 L 440 30 L 454 25.204 L 454 200 L 48 200 Z",
  description: "Spese cumulative: 180,00 € al 1 ottobre, 591,00 € all’8 ottobre, 1.080,00 € al 15 ottobre, 1.520,00 € al 22 ottobre e 1.942,18 € al 30 ottobre 2026.",
} as const;

type DemoMovement = { id: string; date: string; dateLabel: string; description: string; amount: string } & (
  | (ClassifiedMovement & { account: AccountId })
  | { type: "transfer"; fromAccount: AccountId; toAccount: AccountId; category?: never }
);

export const demoMovements = [
  { id: "demo-1", date: "2026-10-30", dateLabel: "30 ott 2026", description: "Abbonamento musica", type: "expense", category: "subscriptions", account: "revolut", amount: "−9,99 €" },
  { id: "demo-2", date: "2026-10-29", dateLabel: "29 ott 2026", description: "Spesa al supermercato", type: "expense", category: "groceries", account: "isybank", amount: "−72,14 €" },
  { id: "demo-3", date: "2026-10-28", dateLabel: "28 ott 2026", description: "Stipendio di ottobre", type: "income", category: "salary", account: "isybank", amount: "+3.250,00 €" },
  { id: "demo-4", date: "2026-10-27", dateLabel: "27 ott 2026", description: "Abbonamento trasporti", type: "expense", category: "public_transport", account: "revolut", amount: "−18,45 €" },
  { id: "demo-5", date: "2026-10-26", dateLabel: "26 ott 2026", description: "Prelievo per il portafoglio", type: "transfer", fromAccount: "revolut", toAccount: "contanti", amount: "100,00 €" },
  { id: "demo-6", date: "2026-10-24", dateLabel: "24 ott 2026", description: "Cena con amici", type: "expense", category: "food", account: "contanti", amount: "−38,00 €" },
  { id: "demo-7", date: "2026-10-20", dateLabel: "20 ott 2026", description: "Serata al cinema", type: "expense", category: "leisure", account: "revolut", amount: "−12,00 €" },
] as const satisfies readonly DemoMovement[];
