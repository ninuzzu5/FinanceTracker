import { classifyMessage, parseMessage, type AccountId, type ClassificationResult, type ParsedMessage } from "@finance-tracker/domain";
import { readMessageConfig, type MessageConfig } from "./config.js";

export interface AcceptedMessage {
  ok: true;
  value: ParsedMessage & { amount: number; date: string; account: AccountId; classification: ClassificationResult };
}

export interface RejectedMessage {
  ok: false;
  reason: "missing_or_invalid_amount" | "invalid_or_ambiguous_date" | "ambiguous_account";
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
  if (parsed.account === null) return { ok: false, reason: "ambiguous_account" };

  return {
    ok: true,
    value: {
      ...parsed, amount: parsed.amount, date: parsed.date, account: parsed.account,
      classification: classifyMessage(parsed.normalizedText),
    },
  };
}
