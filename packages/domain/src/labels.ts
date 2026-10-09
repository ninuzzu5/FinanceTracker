import type { CategoryId } from "./categories.js";
import type { AccountId, TransactionType } from "./types.js";

export const categoryLabels: Record<CategoryId, string> = {
  groceries: "Spesa", public_transport: "Mezzi di trasporto", flights: "Voli",
  tobacco: "Tabacco", sport: "Sport", leisure: "Svago & uscite", food: "Cibo",
  rent: "Affitto", personal_care: "Personal Care", gifts: "Regali",
  subscriptions: "Abbonamenti", holidays: "Vacanze", unexpected: "Imprevisti",
  salary: "Stipendio", personal_projects: "Progetti personali",
};

export const transactionTypeLabels: Record<TransactionType, string> = {
  expense: "Uscita", income: "Entrata", transfer: "Trasferimento",
};

export const accountLabels: Record<AccountId, string> = {
  revolut: "Revolut", isybank: "Isybank", contanti: "Contanti",
};
