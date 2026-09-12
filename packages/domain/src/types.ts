export const accountIds = ["isybank", "revolut"] as const;
export type AccountId = (typeof accountIds)[number];

export const transactionTypes = ["income", "expense", "transfer"] as const;
export type TransactionType = (typeof transactionTypes)[number];

export interface ParsedMessage {
  originalText: string;
  normalizedText: string;
  amount: number | null;
  date: string;
  account: AccountId;
}
