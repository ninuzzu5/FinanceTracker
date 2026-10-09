import { accountIds, parseAmountInput, parseDateInput, transactionTypes, type AccountId, type CategoryId, type TransactionType } from "@finance-tracker/domain";
import { readMessageConfig } from "./config.js";
import { decideUpdate, isRecord, updateId, type TelegramConfig } from "./telegram.js";
import { ProposalStore, categoriesFor, type Proposal } from "./proposals.js";
import { backKeyboard, choicesKeyboard, fieldKeyboard, proposalKeyboard, proposalText, type InlineKeyboard } from "./proposal-view.js";
import { PersistenceError, persistenceMessage } from "./persistence.js";
import { cashInput, reconciliationView, reconciliationMessage, ReconciliationError, type CashPreview, type CashReceipt, type CashRequest } from "./reconciliation.js";
import { GuidedEntry } from "./wizard.js";

export type FlowEffect =
  | { kind: "send"; chatId: number; text: string; keyboard?: InlineKeyboard }
  | { kind: "answer"; queryId: string; text: string }
  | { kind: "persist"; chatId: number; messageId: number; proposal: Proposal }
  | { kind: "loadCash"; chatId: number; stateId: string; date: string }
  | { kind: "reconcileCash"; chatId: number; messageId: number; stateId: string; request: CashRequest }
  | { kind: "clearButtons"; chatId: number; messageId: number };

const stale = "Proposta scaduta, chiusa o sostituita. Usa l'ultima anteprima o invia un nuovo messaggio.";
const send = (chatId: number, text: string, keyboard?: InlineKeyboard): FlowEffect => ({ kind: "send", chatId, text, keyboard });
const preview = (chatId: number, p: Proposal, title?: string) => send(chatId, proposalText(p, title), proposalKeyboard(p));

export class ProposalFlow {
  private readonly guided: GuidedEntry;
  private readonly saving = new Set<number>();
  constructor(readonly store = new ProposalStore()) { this.guided = new GuidedEntry(store); }

  handle(update: unknown, config: TelegramConfig, now = new Date()): FlowEffect[] {
    if (!isRecord(update) || updateId(update) === undefined) return [];
    if ("callback_query" in update) return this.callback(update.callback_query, config, now);
    const decision = decideUpdate(update, config, now);
    if (decision.kind === "ignore") return [];
    if (this.saving.has(decision.chatId)) return [send(decision.chatId, "Salvataggio in corso, bro. Aspetta la conferma.")];
    const message = (update.message ?? update.edited_message) as { message_id: number; text: string };
    const command = /^\/(start|menu|cancel|riconcilia)(?:@niuzzu_bot)?(?:\s|$)/i.exec(message.text.trim());
    if (command) {
      if (command[1].toLowerCase() === "riconcilia") return [send(decision.chatId, ...this.cashViewArgs(decision.chatId, true))];
      if (command[1].toLowerCase() !== "cancel") return this.guided.menu(decision.chatId);
      const wasUncertain = this.store.getState(decision.chatId)?.kind === "reconciliation" && (this.store.getState(decision.chatId) as { step?: string }).step === "uncertain";
      this.store.remove(decision.chatId);
      if (wasUncertain) return [send(decision.chatId, "Flusso chiuso. L'esito resta incerto: non ho annullato eventuali rettifiche nel database.")];
      return [send(decision.chatId, "❌ Flusso annullato, bro. Scrivimi un movimento oppure usa /menu.")];
    }
    if (decision.kind === "help") return [send(decision.chatId, decision.reply)];
    const cash = this.store.getState(decision.chatId);
    if (cash?.kind === "reconciliation") {
      if (cash.step !== "amount") return [send(decision.chatId, "Usa i pulsanti della riconciliazione o /cancel.")];
      const amount = cashInput(message.text);
      if (amount === null) return [send(decision.chatId, "Saldo reale non valido: scrivi un importo non negativo con massimo due decimali, per esempio 12,50 oppure 0.")];
      cash.observed = amount;
      cash.step = "preview";
      cash.revision++;
      const view = reconciliationView(cash);
      return [send(decision.chatId, view.text, view.keyboard)];
    }
    const wizardReply = this.guided.text(decision.chatId, message.text, config, now);
    if (wizardReply) return wizardReply;
    const p = this.store.get(decision.chatId);
    // Text replies edit a field; Telegram edits of the source message reparse the proposal.
    if (p?.editing && "message" in update) {
      const value = p.editing === "amount" ? parseAmountInput(message.text)
        : parseDateInput(message.text, now, (config.messageConfig ?? readMessageConfig()).timeZone);
      if (value === null) return [send(decision.chatId,
        p.editing === "amount" ? "Importo non valido, bro. Scrivi solo il valore, per esempio 12,50."
          : "Data non valida, bro. Scrivi una data, per esempio 18/09/2026 oppure ieri.", backKeyboard(p))];
      if (p.editing === "amount") p.amount = value as number;
      else p.date = value as string;
      p.editing = null;
      p.revision++;
      return [preview(decision.chatId, p)];
    }
    if (decision.kind === "reject") {
      // An invalid edit of the active source must not leave its old values confirmable.
      if ("edited_message" in update && p?.sourceMessageId === message.message_id) this.store.remove(decision.chatId);
      return [send(decision.chatId, decision.reply)];
    }
    const transaction = decision.transaction;
    const { amount, date } = transaction;
    const proposal = this.store.create(decision.chatId, message.message_id, transaction.type === "transfer"
      ? { amount, date, type: "transfer", fromAccount: transaction.fromAccount, toAccount: transaction.toAccount }
      : { amount, date, account: transaction.account, type: transaction.type, category: transaction.category });
    const title = "edited_message" in update ? "Anteprima aggiornata, bro 👌" : "Ci sono, bro 👌";
    return [preview(decision.chatId, proposal, p ? `${title}\nQuesta proposta sostituisce la precedente.` : title)];
  }

  private cashViewArgs(chatId: number, start = false): [string, InlineKeyboard] {
    const state = start ? this.store.startReconciliation(chatId) : this.store.getState(chatId);
    if (state?.kind !== "reconciliation") throw new Error("Missing cash state");
    const view = reconciliationView(state);
    return [view.text, view.keyboard];
  }

  completeCashLoad(effect: Extract<FlowEffect, { kind: "loadCash" }>, result?: CashPreview, error?: unknown): FlowEffect[] {
    this.saving.delete(effect.chatId);
    const state = this.store.getState(effect.chatId);
    if (state?.kind !== "reconciliation" || state.id !== effect.stateId) return [];
    if (error !== undefined || !result) {
      this.store.remove(effect.chatId);
      return [send(effect.chatId, reconciliationMessage(error))];
    }
    state.accountId = result.accountId; state.theoretical = result.theoretical; state.step = "amount"; state.revision++;
    return [send(effect.chatId, ...this.cashViewArgs(effect.chatId))];
  }

  completeCashSave(effect: Extract<FlowEffect, { kind: "reconcileCash" }>, result?: CashReceipt, error?: unknown): FlowEffect[] {
    this.saving.delete(effect.chatId);
    const state = this.store.getState(effect.chatId);
    if (error !== undefined || !result) {
      if (state?.kind !== "reconciliation" || state.id !== effect.stateId) return [send(effect.chatId, reconciliationMessage(error))];
      if (!(error instanceof ReconciliationError) || error.code === "unknown") {
        state.step = "uncertain"; state.revision++;
        return [send(effect.chatId, reconciliationMessage(error)), send(effect.chatId, ...this.cashViewArgs(effect.chatId))];
      }
      this.store.remove(effect.chatId);
      return [send(effect.chatId, reconciliationMessage(error))];
    }
    if (state?.kind === "reconciliation" && state.id === effect.stateId) this.store.remove(effect.chatId);
    return [{ kind: "clearButtons", chatId: effect.chatId, messageId: effect.messageId }, send(effect.chatId, `✅ Contanti riconciliati al ${effect.request.date}. Rettifica: ${result.delta} €. Saldo dichiarato: ${result.observed} €. Giornata chiusa.`)];
  }

  completeSave(effect: Extract<FlowEffect, { kind: "persist" }>, error?: unknown): FlowEffect[] {
    this.saving.delete(effect.chatId);
    if (error !== undefined) {
      // Log only an application code, never SDK errors or financial payloads.
      console.error("Transaction persistence failed", error instanceof PersistenceError ? error.code : "unexpected");
      const current = this.store.get(effect.chatId);
      return [send(effect.chatId, persistenceMessage(error)), ...(current ? [preview(effect.chatId, current)] : [])];
    }
    this.store.remove(effect.chatId);
    return [{ kind: "clearButtons", chatId: effect.chatId, messageId: effect.messageId },
      send(effect.chatId, "✅ Transazione registrata, bro. Salvata nel database.")];
  }

  private callback(query: unknown, config: TelegramConfig, now: Date): FlowEffect[] {
    if (!isRecord(query) || typeof query.id !== "string" || !isRecord(query.from) ||
        !isRecord(query.message) || !isRecord(query.message.chat) || typeof query.data !== "string" ||
        !Number.isSafeInteger(query.message.message_id) || !Number.isSafeInteger(query.from.id)) return [];
    const chat = query.message.chat;
    if (chat.type !== "private" || String(chat.id) !== config.allowedChatId ||
        String(query.from.id) !== config.allowedChatId || !Number.isSafeInteger(chat.id)) return [];
    const chatId = chat.id as number;
    if (this.saving.has(chatId)) return [{ kind: "answer", queryId: query.id, text: "Salvataggio in corso." }];
    if (query.data.startsWith("r:")) {
      const state = this.store.getState(chatId);
      const match = /^r:([a-f0-9]{16}):(\d+):(today|yesterday|confirm|edit|cancel)$/.exec(query.data);
      const answer = (text: string): FlowEffect => ({ kind: "answer", queryId: query.id as string, text });
      if (!match || state?.kind !== "reconciliation" || state.id !== match[1] || state.revision !== Number(match[2])) return [answer(stale)];
      const action = match[3];
      if (action === "cancel") {
        const uncertain = state.step === "uncertain";
        this.store.remove(chatId);
        return [answer("Flusso chiuso."), { kind: "clearButtons", chatId, messageId: query.message.message_id as number }, send(chatId, uncertain ? "Flusso chiuso: l'esito resta incerto; nessuna rettifica nel database è stata annullata." : "Riconciliazione annullata: nessuna rettifica salvata.")];
      }
      if (state.step === "date" && (action === "today" || action === "yesterday")) {
        state.date = parseDateInput(action === "today" ? "oggi" : "ieri", now, "Europe/Rome");
        state.step = "loading"; state.revision++; this.saving.add(chatId);
        return [answer("Leggo Contanti."), { kind: "loadCash", chatId, stateId: state.id, date: state.date! }];
      }
      if (state.step === "preview" && action === "edit") {
        state.step = "amount"; state.revision++;
        return [answer(""), send(chatId, ...this.cashViewArgs(chatId))];
      }
      if ((state.step === "preview" || state.step === "uncertain") && action === "confirm") {
        state.step = "saving"; this.saving.add(chatId);
        return [answer("Salvataggio in corso."), { kind: "reconcileCash", chatId, stateId: state.id, messageId: query.message.message_id as number,
          request: { accountId: state.accountId!, date: state.date!, expected: state.theoretical!, observed: state.observed!, requestId: state.requestId } }];
      }
      return [answer("Usa il pulsante del passaggio corrente.")];
    }
    if (query.data.startsWith("m:") || query.data.startsWith("w:")) return this.guided.callback(chatId, query.id, query.data, config, now);
    const answer = (text: string): FlowEffect[] => [{ kind: "answer", queryId: query.id as string, text }];
    const match = /^p:([a-f0-9]{16}):(\d+):([a-zA-Z_.]+)$/.exec(query.data);
    let p = this.store.get(chatId);
    if (!match || !p || match[1] !== p.id || Number(match[2]) !== p.revision) return answer(stale);
    const action = match[3];
    if (action === "confirm" || action === "cancel") {
      if (action === "confirm" && p.type === "transfer" && (!p.fromAccount || !p.toAccount || p.fromAccount === p.toAccount)) {
        return [...answer("Scegli origine e destinazione diverse da Modifica."), preview(chatId, p)];
      }
      if (action === "confirm" && p.type !== "transfer" && (!p.type || !p.account || !categoriesFor(p.type).includes(p.category as CategoryId))) {
        return [...answer("Scegli prima conto, tipo e categoria da Modifica."), preview(chatId, p)];
      }
      if (action === "confirm") {
        this.saving.add(chatId);
        return [{ kind: "answer", queryId: query.id, text: "Salvataggio in corso." },
          { kind: "persist", chatId, messageId: query.message.message_id as number, proposal: { ...p } }];
      }
      this.store.remove(chatId);
      return [
        ...answer("Annullata."),
        { kind: "clearButtons", chatId, messageId: query.message.message_id as number },
        send(chatId, "❌ Proposta annullata, bro."),
      ];
    }
    if (action === "swap") {
      if (p.type !== "transfer" || !p.fromAccount || !p.toAccount || p.fromAccount === p.toAccount) return answer("Scegli prima entrambi i conti, diversi tra loro.");
      [p.fromAccount, p.toAccount] = [p.toAccount, p.fromAccount];
      p.revision++;
      p.editing = null;
      return [...answer(""), preview(chatId, p)];
    }
    if (action === "edit" || action === "back") {
      p.editing = null;
      p.revision++;
      return [...answer(""), action === "back" ? preview(chatId, p) : send(chatId, "Cosa cambiamo, bro?", fieldKeyboard(p))];
    }
    const [verb, field, value] = action.split(".");
    if (verb === "field" && ["amount", "date", "account", "fromAccount", "toAccount", "type", "category"].includes(field)) {
      if ((p.type === "transfer" && field === "account") || (p.type !== "transfer" && ["fromAccount", "toAccount"].includes(field))) return answer("Campo non disponibile per questo tipo.");
      if (field === "category" && !categoriesFor(p.type).length) return answer(p.type === "transfer"
        ? "I trasferimenti non hanno categoria."
        : "Scegli prima il tipo di movimento.");
      p.revision++;
      p.editing = field === "amount" || field === "date" ? field : null;
      return [...answer(""), p.editing
        ? send(chatId, field === "amount" ? "Scrivi il nuovo importo, bro: per esempio 12,50."
          : "Scrivi la nuova data, bro: per esempio 18/09/2026 oppure ieri.", backKeyboard(p))
        : send(chatId, "Scegli il nuovo valore:", choicesKeyboard(p, field as "account" | "fromAccount" | "toAccount" | "type" | "category"))];
    }
    if (verb === "set") {
      if (field === "account" && p.type !== "transfer" && accountIds.includes(value as AccountId)) p.account = value as AccountId;
      else if ((field === "fromAccount" || field === "toAccount") && p.type === "transfer" && accountIds.includes(value as AccountId)) {
        const other = field === "fromAccount" ? p.toAccount : p.fromAccount;
        if (other === value) return answer("Origine e destinazione devono essere diverse. Per invertire la direzione usa Scambia conti.");
        p[field] = value as AccountId;
      }
      else if (field === "type" && transactionTypes.includes(value as TransactionType)) {
        if (value !== p.type) {
          const common = { amount: p.amount, date: p.date };
          p = this.store.replaceValues(chatId, value === "transfer"
            ? { ...common, type: "transfer", fromAccount: null, toAccount: null }
            : { ...common, type: value as "expense" | "income", account: p.type === "transfer" ? null : p.account,
              category: p.type !== "transfer" && categoriesFor(value as TransactionType).includes(p.category as CategoryId) ? p.category : null });
        }
      } else if (field === "category" && p.type !== "transfer" && categoriesFor(p.type).includes(value as CategoryId)) p.category = value as CategoryId;
      else return answer("Scelta non valida o categoria incompatibile con il tipo.");
      p.editing = null;
      p.revision++;
      return [...answer(""), preview(chatId, p)];
    }
    return answer("Pulsante non riconosciuto.");
  }
}
