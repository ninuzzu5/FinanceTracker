import { timingSafeEqual } from "node:crypto";
import { processMessage, type ProcessMessageResult } from "./process-message.js";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: {
      id: number;
    };
  };
}

export interface TelegramConfig {
  allowedChatId: string;
  webhookSecret: string;
}

export type UpdateDecision =
  | { kind: "ignore"; reason: "unsupported_update" | "unauthorized_chat" }
  | { kind: "reject"; chatId: number; reason: "missing_or_invalid_amount"; reply: string }
  | {
      kind: "preview";
      chatId: number;
      transaction: Extract<ProcessMessageResult, { ok: true }>["value"];
      reply: string;
    };

export function secretsMatch(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function decideUpdate(
  update: TelegramUpdate,
  config: TelegramConfig,
  now = new Date(),
): UpdateDecision {
  const message = update.message;

  if (!message?.text) {
    return { kind: "ignore", reason: "unsupported_update" };
  }

  if (String(message.chat.id) !== config.allowedChatId) {
    return { kind: "ignore", reason: "unauthorized_chat" };
  }

  const result = processMessage(message.text, now);

  if (!result.ok) {
    return {
      kind: "reject",
      chatId: message.chat.id,
      reason: result.reason,
      reply: "Non trovo un importo valido. Prova, ad esempio: 8,30 tabacco",
    };
  }

  const amount = result.value.amount.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });

  return {
    kind: "preview",
    chatId: message.chat.id,
    transaction: result.value,
    reply: [
      "🧾 Movimento ricevuto",
      `${amount} · ${result.value.account}`,
      `Data: ${result.value.date}`,
      "",
      "Categoria e tipo verranno aggiunti nel prossimo passo.",
    ].join("\n"),
  };
}
