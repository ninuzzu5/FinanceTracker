import { parseMessage, type ParsedMessage } from "@finance-tracker/domain";
import { readMessageConfig, type MessageConfig } from "./config.js";

export interface AcceptedMessage {
  ok: true;
  value: ParsedMessage & { amount: number };
}

export interface RejectedMessage {
  ok: false;
  reason: "missing_or_invalid_amount";
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

  return {
    ok: true,
    value: { ...parsed, amount: parsed.amount },
  };
}
