import type { TransactionRepository } from "./persistence.js";
import { supabaseRepository } from "./supabase.js";
import type { TelegramConfig } from "./telegram.js";
import { ProposalFlow } from "./proposal-flow.js";
import type { TelegramClient } from "./transport.js";

export async function deliverUpdate(
  flow: ProposalFlow, client: Pick<TelegramClient, "call" | "sendMessage">,
  update: unknown, config: TelegramConfig, signal?: AbortSignal, repository: TransactionRepository = supabaseRepository,
): Promise<void> {
  const effects = flow.handle(update, config);
  for (const effect of effects) {
    if (effect.kind === "persist") {
      let failure: unknown;
      try { await repository.saveTransaction(effect.proposal); }
      catch (error) { failure = error ?? new Error("Persistence failed"); }
      effects.push(...flow.completeSave(effect, failure));
      continue;
    }
    if (effect.kind === "send") await client.sendMessage(effect.chatId, effect.text, signal, effect.keyboard);
    else if (effect.kind === "answer") {
      // Callback acknowledgements can expire; they must not suppress the actual reply.
      try { await client.call("answerCallbackQuery", { callback_query_id: effect.queryId, text: effect.text }, signal); }
      catch { signal?.throwIfAborted(); }
    } else {
      // Old buttons are already invalidated in memory even if Telegram cannot remove them.
      try { await client.call("editMessageReplyMarkup", {
        chat_id: effect.chatId, message_id: effect.messageId, reply_markup: { inline_keyboard: [] },
      }, signal); } catch { signal?.throwIfAborted(); }
    }
  }
}
