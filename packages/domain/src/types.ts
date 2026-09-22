export const accountIds = ["isybank", "revolut"] as const;
export type AccountId = (typeof accountIds)[number];

export const transactionTypes = ["income", "expense", "transfer"] as const;
export type TransactionType = (typeof transactionTypes)[number];

import type { CategoryId } from "./categories.js";

export type TransferFields = {
  type: "transfer";
  fromAccount: AccountId | null;
  toAccount: AccountId | null;
  account?: never;
  category?: never;
};

export type TransactionDraft = { amount: number; date: string } & (
  | TransferFields
  | { type: "expense" | "income" | null; account: AccountId | null; category: CategoryId | null; fromAccount?: never; toAccount?: never }
);

export type ParsedMessage = {
  originalText: string;
  normalizedText: string;
  amount: number | null;
  date: string | null;
} & (TransferFields | { type: null; account: AccountId | null; fromAccount?: never; toAccount?: never });
