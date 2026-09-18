import type { BotConfig } from "./config.js";
import { decideUpdate, isRecord, updateId } from "./telegram.js";
import { TelegramError, sleep, type Sleep, type TelegramClient } from "./transport.js";

export async function runPolling(
  client: Pick<TelegramClient, "call" | "sendMessage">,
  config: BotConfig,
  signal: AbortSignal,
  options: { sleep?: Sleep; onReady?: () => void } = {},
): Promise<void> {
  const webhook = await client.call("getWebhookInfo", {}, signal);
  if (!isRecord(webhook) || typeof webhook.url !== "string") {
    throw new TelegramError("Impossibile verificare la configurazione webhook Telegram.");
  }
  if (webhook.url) {
    throw new TelegramError("Webhook Telegram già configurato: polling non avviato. Disattivalo esplicitamente prima di riprovare; non è stato modificato.");
  }
  options.onReady?.();
  let offset = 0;
  while (!signal.aborted) {
    const updates = await client.call("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] }, signal);
    if (!Array.isArray(updates)) throw new TelegramError("Elenco aggiornamenti Telegram non valido.");
    for (const update of updates) {
      signal.throwIfAborted();
      const id = updateId(update);
      if (id === undefined || id < offset) continue;
      const decision = decideUpdate(update, { allowedChatId: config.allowedChatId, messageConfig: config });
      if (decision.kind !== "ignore") await client.sendMessage(decision.chatId, decision.reply, signal);
      // Session-only cursor, advanced only after processing (or deliberately ignoring) an update.
      offset = id + 1;
    }
    // Also bounds the request rate if Telegram returns immediately with empty/invalid batches.
    await (options.sleep ?? sleep)(250, signal);
  }
}
