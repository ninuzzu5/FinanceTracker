import type { AccountId, CategoryId } from "@finance-tracker/domain";

export type WizardStep = "type" | "amount" | "category" | "account" | "fromAccount" | "toAccount" | "date" | "customDate";
export type WizardValues = { amount: number | null; date: string | null } & (
  | { mode: "movement"; type: "expense" | "income" | null; account: AccountId | null; category: CategoryId | null }
  | { mode: "transfer"; type: "transfer"; fromAccount: AccountId | null; toAccount: AccountId | null }
);

export interface WizardState {
  kind: "wizard";
  id: string;
  revision: number;
  step: WizardStep;
  history: WizardStep[];
  values: WizardValues;
}

export interface MenuState { kind: "menu"; id: string }
