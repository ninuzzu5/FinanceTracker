import { setTimeout as delay } from "node:timers/promises";
import { isRecord } from "./telegram.js";
import type { InlineKeyboard } from "./proposal-view.js";

export class TelegramError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryAfterMs = 0) {
    super(message);
  }
}

export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;
export const sleep: Sleep = async (milliseconds, signal) => {
  await delay(milliseconds, undefined, { signal });
};

export interface TransportOptions {
  fetch?: typeof fetch;
  sleep?: Sleep;
  timeoutMs?: number;
  maxAttempts?: number;
  onRetry?: () => void;
}

function apiError(code: number, retryAfter: unknown): TelegramError {
  if (code === 401) return new TelegramError("Telegram ha rifiutato le credenziali. Controlla TELEGRAM_BOT_TOKEN.");
  if (code === 409) return new TelegramError("Conflitto Telegram: verifica il webhook o un'altra istanza di polling già attiva.");
  if (code === 429) {
    // Telegram's retry_after is in seconds. Never retry before that interval.
    const seconds = typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter : 1;
    if (seconds > 86_400) return new TelegramError("Rate limit Telegram prolungato: riprova più tardi.");
    return new TelegramError("Rate limit Telegram.", true, Math.ceil(seconds * 1000));
  }
  if (code >= 500) return new TelegramError("Telegram temporaneamente non disponibile.", true);
  return new TelegramError("Richiesta rifiutata da Telegram. Controlla configurazione e permessi del bot.");
}

export class TelegramClient {
  constructor(private readonly token: string, private readonly options: TransportOptions = {}) {}

  async call(method: "getUpdates" | "getWebhookInfo" | "sendMessage" | "answerCallbackQuery" | "editMessageReplyMarkup", body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const ancillary = method === "answerCallbackQuery" || method === "editMessageReplyMarkup";
    const attempts = ancillary ? 1 : this.options.maxAttempts ?? 5;
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal?.throwIfAborted();
      try {
        const timeout = AbortSignal.timeout(Math.min(this.options.timeoutMs ?? 40_000, ancillary ? 5000 : 40_000));
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await (this.options.fetch ?? fetch)(`https://api.telegram.org/bot${this.token}/${method}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body), signal: requestSignal,
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || (isRecord(data) && data.ok === false)) {
          const code = isRecord(data) && typeof data.error_code === "number" ? data.error_code : response.status;
          const parameters = isRecord(data) && isRecord(data.parameters) ? data.parameters : {};
          throw apiError(code, parameters.retry_after);
        }
        if (!isRecord(data) || data.ok !== true || !("result" in data)) {
          throw new TelegramError("Risposta Telegram non valida.", true);
        }
        return data.result;
      } catch (error) {
        signal?.throwIfAborted();
        // Raw fetch exceptions and Telegram descriptions can include secrets or user text.
        const safeError = error instanceof TelegramError ? error : new TelegramError("Problema di rete o timeout Telegram.", true);
        if (!safeError.retryable || attempt + 1 >= attempts) throw safeError;
        this.options.onRetry?.();
        await (this.options.sleep ?? sleep)(Math.max(safeError.retryAfterMs, Math.min(1000 * 2 ** attempt, 30_000)), signal);
      }
    }
    throw new TelegramError("Tentativi Telegram esauriti.");
  }

  async sendMessage(chatId: number, text: string, signal?: AbortSignal, keyboard?: InlineKeyboard): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text, ...(keyboard ? { reply_markup: keyboard } : {}) }, signal);
  }
}
