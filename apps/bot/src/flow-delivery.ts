import type { ReconciliationRepository } from "./reconciliation.js";
import type { TransactionRepository } from "./persistence.js";
import { supabaseRepository } from "./supabase.js";
import type { TelegramConfig } from "./telegram.js";
import { ProposalFlow } from "./proposal-flow.js";
import type { TelegramClient } from "./transport.js";

export async function deliverUpdate(
  flow: ProposalFlow, client: Pick<TelegramClient, "call" | "sendMessage">,
  update: unknown, config: TelegramConfig, signal?: AbortSignal, repository: TransactionRepository = supabaseRepository, reconciliation: ReconciliationRepository = supabaseRepository,
): Promise<void> {
  const effects = flow.handle(update, config);
  for (const effect of effects) {
    if (effect.kind === "recoverMovement") {
      try {
        const receipt = await repository.getTransactionReceipt(effect.requestId);
        await client.sendMessage(effect.chatId, receipt
          ? "✅ Operazione già registrata nel database. Ricevuta recuperata; nessun nuovo movimento creato."
          : "Nessuna ricevuta disponibile: il salvataggio può essere ancora in corso o la proposta è scaduta. Riprova questo pulsante; questa verifica non inserisce movimenti.", signal);
      } catch { await client.sendMessage(effect.chatId, "Non riesco a verificare la ricevuta. Riprova lo stesso pulsante; questa verifica non inserisce movimenti.", signal); }
      continue;
    }
    if (effect.kind === "loadCash" || effect.kind === "reconcileCash") {
      try {
        if (effect.kind === "loadCash") effects.push(...flow.completeCashLoad(effect, await reconciliation.previewCash(effect.date)));
        else effects.push(...flow.completeCashSave(effect, await reconciliation.reconcileCash(effect.request)));
      } catch (error) {
        const failure = error ?? new Error("Cash operation failed");
        effects.push(...(effect.kind === "loadCash" ? flow.completeCashLoad(effect, undefined, failure) : flow.completeCashSave(effect, undefined, failure)));
      }
      continue;
    }
    if (effect.kind === "persist") {
      let failure: unknown;
      try { await repository.saveTransaction(effect.proposal, effect.proposal.requestId); }
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
