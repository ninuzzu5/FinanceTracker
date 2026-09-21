export const expenseCategoryIds = [
  "groceries", "public_transport", "flights", "tobacco", "sport", "leisure",
  "food", "rent", "personal_care", "gifts", "subscriptions", "holidays", "unexpected",
] as const;
export const incomeCategoryIds = ["salary", "gifts", "personal_projects"] as const;

export type ExpenseCategoryId = (typeof expenseCategoryIds)[number];
export type IncomeCategoryId = (typeof incomeCategoryIds)[number];
export type CategoryId = ExpenseCategoryId | IncomeCategoryId;

export type ClassifiedMovement =
  | { type: "expense"; category: ExpenseCategoryId }
  | { type: "income"; category: IncomeCategoryId };
