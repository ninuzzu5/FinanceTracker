import { timingSafeEqual } from "node:crypto";
import { processMessage, type ProcessMessageResult } from "./process-message.js";
import type { MessageConfig } from "./config.js";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: {
      id: number;
      type: string;
    };
  };
}

export interface TelegramConfig {
  allowedChatId: string;
  messageConfig?: MessageConfig;
}

export type UpdateDecision =
  | { kind: "ignore"; reason: "unsupported_update" | "unauthorized_chat" }
  | { kind: "help"; chatId: number; reply: string }
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function updateId(update: unknown): number | undefined {
  if (!isRecord(update)) return undefined;
  const id = update.update_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 && id < Number.MAX_SAFE_INTEGER
    ? id : undefined;
}

export function decideUpdate(
  update: unknown,
  config: TelegramConfig,
  now = new Date(),
): UpdateDecision {
  if (updateId(update) === undefined || !isRecord(update) || !isRecord(update.message)) {
    return { kind: "ignore", reason: "unsupported_update" };
  }
  const message = update.message;
  if (!Number.isSafeInteger(message.message_id) || !isRecord(message.chat) ||
      !Number.isSafeInteger(message.chat.id) || typeof message.text !== "string" || !message.text.trim()) {
    return { kind: "ignore", reason: "unsupported_update" };
  }

  if (message.chat.type !== "private" || String(message.chat.id) !== config.allowedChatId) {
    return { kind: "ignore", reason: "unauthorized_chat" };
  }

  const chatId = message.chat.id as number;
  if (/^\/(start|help)(?:@niuzzu_bot)?(?:\s|$)/i.test(message.text.trim())) {
    return {
      kind: "help", chatId,
      reply: [
        "Ciao! FinanceTracker mostra un'anteprima dei tuoi movimenti.",
        "Esempi: 8,30 tabacco · ieri 12,50 spesa · 20 benzina isybank",
        "Usa /help per rivedere questi esempi.",
        "Nessun movimento viene salvato in questa versione.",
      ].join("\n"),
    };
  }

  const result = processMessage(message.text, now, config.messageConfig);

  if (!result.ok) {
    return {
      kind: "reject",
      chatId,
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
    chatId,
    transaction: result.value,
    reply: [
      "🧾 Anteprima movimento",
      `${amount} · ${result.value.account}`,
      `Data: ${result.value.date}`,
      "",
      "Il movimento NON è stato salvato.",
    ].join("\n"),
  };
}
