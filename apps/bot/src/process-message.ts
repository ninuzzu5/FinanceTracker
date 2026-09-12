import { parseMessage, type ParsedMessage } from "@finance-tracker/domain";

export interface AcceptedMessage {
  ok: true;
  value: ParsedMessage & { amount: number };
}

export interface RejectedMessage {
  ok: false;
  reason: "missing_or_invalid_amount";
}

export type ProcessMessageResult = AcceptedMessage | RejectedMessage;

export function processMessage(text: string, now = new Date()): ProcessMessageResult {
  const parsed = parseMessage(text, {
    now,
    timeZone: process.env.APP_TIMEZONE ?? "Europe/Rome",
    defaultAccount: "revolut",
  });

  if (parsed.amount === null) {
    return { ok: false, reason: "missing_or_invalid_amount" };
  }

  return {
    ok: true,
    value: { ...parsed, amount: parsed.amount },
  };
}
