import { classifyMessage, parseMessage, type ClassificationResult, type TransactionDraft } from "@finance-tracker/domain";
import { readMessageConfig, type MessageConfig } from "./config.js";

export interface AcceptedMessage {
  ok: true;
  value: TransactionDraft & { originalText: string; normalizedText: string; classification: ClassificationResult };
}

export interface RejectedMessage {
  ok: false;
  reason: "missing_or_invalid_amount" | "invalid_or_ambiguous_date" | "ambiguous_account" | "incomplete_transfer" | "same_transfer_accounts";
}

export type ProcessMessageResult = AcceptedMessage | RejectedMessage;

export function processMessage(text: string, now = new Date(), config: MessageConfig = readMessageConfig()): ProcessMessageResult {
  const parsed = parseMessage(text, {
    now,
    timeZone: config.timeZone,
    defaultAccount: config.defaultAccount,
  });

  if (parsed.amount === null) {
    return { ok: false, reason: "missing_or_invalid_amount" };
  }
  if (parsed.date === null) return { ok: false, reason: "invalid_or_ambiguous_date" };
  const classification = classifyMessage(parsed.normalizedText);
  if (parsed.type === "transfer") {
    if (!parsed.fromAccount || !parsed.toAccount) return { ok: false, reason: "incomplete_transfer" };
    if (parsed.fromAccount === parsed.toAccount) return { ok: false, reason: "same_transfer_accounts" };
    return { ok: true, value: { ...parsed, amount: parsed.amount, date: parsed.date, classification } };
  }
  if (parsed.account === null) return { ok: false, reason: "ambiguous_account" };

  return {
    ok: true,
    value: {
      ...parsed, amount: parsed.amount, date: parsed.date, account: parsed.account,
      type: classification.type === "transfer" ? null : classification.type,
      category: classification.category, classification,
    },
  };
}
