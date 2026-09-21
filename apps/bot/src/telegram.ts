import { timingSafeEqual } from "node:crypto";
import { processMessage, type ProcessMessageResult } from "./process-message.js";
import { readMessageConfig, type MessageConfig } from "./config.js";

const accountLabels = { revolut: "Revolut", isybank: "Isybank" } as const;

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: {
    id: number;
    type: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramConfig {
  allowedChatId: string;
  messageConfig?: MessageConfig;
}

export type UpdateDecision =
  | { kind: "ignore"; reason: "unsupported_update" | "unauthorized_chat" }
  | { kind: "help"; chatId: number; reply: string }
  | { kind: "reject"; chatId: number; reason: Extract<ProcessMessageResult, { ok: false }>["reason"]; reply: string }
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
  if (updateId(update) === undefined || !isRecord(update) || ("message" in update && "edited_message" in update)) {
    return { kind: "ignore", reason: "unsupported_update" };
  }
  const edited = "edited_message" in update;
  const message = edited ? update.edited_message : update.message;
  if (!isRecord(message) || !Number.isSafeInteger(message.message_id) || !isRecord(message.chat) ||
      !Number.isSafeInteger(message.chat.id) || typeof message.text !== "string" || !message.text.trim()) {
    return { kind: "ignore", reason: "unsupported_update" };
  }

  if (message.chat.type !== "private" || String(message.chat.id) !== config.allowedChatId) {
    return { kind: "ignore", reason: "unauthorized_chat" };
  }

  const chatId = message.chat.id as number;
  const command = /^\/(start|help)(?:@niuzzu_bot)?(?:\s|$)/i.exec(message.text.trim());
  if (command) {
    const { defaultAccount } = config.messageConfig ?? readMessageConfig();
    return {
      kind: "help", chatId,
      reply: [
        command[1].toLowerCase() === "start" ? "Eccoti, bro 👋" : "Promemoria al volo, bro 👇",
        "",
        "Scrivimi importo e due parole, al resto ci penso io:",
        "• 8,30 tabacco",
        "• ieri 12,50 spesa",
        "• 20 benzina isybank",
        "• mercoledì barbiere 34€ isybank",
        "",
        `Senza data uso oggi, senza conto uso ${accountLabels[defaultAccount]}.`,
        "Con /help ritrovi questi esempi.",
        "Se modifichi un messaggio, ti mando una nuova anteprima.",
        "",
        "Per ora ti mostro solo un'anteprima: non salvo ancora nulla.",
      ].join("\n"),
    };
  }

  const result = processMessage(message.text, now, config.messageConfig);

  if (!result.ok) {
    return {
      kind: "reject",
      chatId,
      reason: result.reason,
      reply: result.reason === "invalid_or_ambiguous_date"
        ? "Bro, questa data non è valida oppure ne vedo più di una 👀\nScrivine una sola, per esempio: 10 settembre 2026 tabacco 12€"
        : result.reason === "ambiguous_account"
          ? "Bro, qui vedo sia Revolut sia Isybank 👀\nIndicami un solo conto, per esempio: 12€ tabacco isybank"
          : [
            "Bro, qui manca un importo valido oppure ne vedo più di uno 👀",
            "",
            "Scrivimelo così: 8,30 tabacco",
            "Va bene anche: ieri 12,50 spesa",
          ].join("\n"),
    };
  }

  const amount = result.value.amount.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
  const date = result.value.date.split("-").reverse().join("/");

  return {
    kind: "preview",
    chatId,
    transaction: result.value,
    reply: [
      edited ? "Anteprima aggiornata, bro 👌" : "Ci sono, bro 👌",
      "",
      `💶 ${amount}`,
      `🏦 ${accountLabels[result.value.account]}`,
      `📅 ${date}`,
      "",
      "Solo anteprima: non ho salvato nulla.",
    ].join("\n"),
  };
}
