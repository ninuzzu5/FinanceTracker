import { accountIds, parseAmountInput, parseDateInput, type AccountId, type CategoryId, type TransactionDraft } from "@finance-tracker/domain";
import { readMessageConfig } from "./config.js";
import { categoriesFor, type ProposalStore } from "./proposals.js";
import { proposalKeyboard, proposalText } from "./proposal-view.js";
import type { FlowEffect } from "./proposal-flow.js";
import type { TelegramConfig } from "./telegram.js";
import { menuView, wizardView } from "./wizard-view.js";
import type { WizardState, WizardStep } from "./wizard-state.js";

const show = (chatId: number, w: WizardState, error?: string): FlowEffect[] => {
  const view = wizardView(w);
  return [{ kind: "send", chatId, ...view, text: error ? `${error}\n\n${view.text}` : view.text }];
};
const advance = (w: WizardState, step: WizardStep) => { w.history.push(w.step); w.step = step; w.revision++; };

/** Collects values only. Completion delegates to the existing proposal and confirmation flow. */
export class GuidedEntry {
  constructor(private readonly store: ProposalStore) {}

  menu(chatId: number): FlowEffect[] {
    const replaced = this.store.getState(chatId);
    const view = menuView(this.store.openMenu(chatId));
    return [{ kind: "send", chatId, ...view,
      text: replaced && replaced.kind !== "menu" ? `Ho chiuso il flusso precedente.\n\n${view.text}` : view.text }];
  }

  text(chatId: number, text: string, config: TelegramConfig, now: Date): FlowEffect[] | null {
    const w = this.store.getState(chatId);
    if (w?.kind !== "wizard") return null;
    if (w.step === "amount") {
      const amount = parseAmountInput(text);
      if (amount === null) return show(chatId, w, "Importo non valido: usa un numero positivo.");
      w.values.amount = amount;
      advance(w, w.values.mode === "transfer" ? "fromAccount" : "category");
      return show(chatId, w);
    }
    if (w.step === "customDate") {
      const date = parseDateInput(text, now, (config.messageConfig ?? readMessageConfig()).timeZone);
      if (!date) return show(chatId, w, "Data non valida. Riprova con una data supportata.");
      w.values.date = date;
      return this.complete(chatId, w);
    }
    return show(chatId, w, "Qui scegli un pulsante, bro. Per uscire usa /cancel o /menu.");
  }

  callback(chatId: number, queryId: string, data: string, config: TelegramConfig, now: Date): FlowEffect[] {
    const answer = (text = ""): FlowEffect => ({ kind: "answer", queryId, text });
    const state = this.store.getState(chatId);
    const menu = /^m:([a-f0-9]{16}):(movement|transfer)$/.exec(data);
    if (menu && state?.kind === "menu" && state.id === menu[1]) {
      return [answer(), ...show(chatId, this.store.startWizard(chatId, menu[2] as "movement" | "transfer"))];
    }
    const match = /^w:([a-f0-9]{16}):(\d+):([a-zA-Z_.]+)$/.exec(data);
    if (!match || state?.kind !== "wizard" || state.id !== match[1] || state.revision !== Number(match[2])) {
      return [answer("Menu o compilazione scaduti o sostituiti. Usa /menu.")];
    }
    const w = state;
    const action = match[3];
    if (action === "cancel") {
      this.store.remove(chatId);
      return [answer("Annullato."), { kind: "send", chatId, text: "❌ Compilazione annullata, bro. Scrivimi un movimento oppure usa /menu." }];
    }
    if (action === "back") {
      const previous = w.history.pop();
      if (!previous) return [answer("Sei già al primo passaggio.")];
      w.step = previous;
      w.revision++;
      return [answer(), ...show(chatId, w)];
    }
    const [field, value, extra] = action.split(".");
    if (extra || field !== w.step) return [answer("Scelta non valida per questo passaggio.")];
    const values = w.values;
    if (field === "type" && values.mode === "movement" && (value === "expense" || value === "income")) {
      values.type = value;
      if (!categoriesFor(value).includes(values.category as CategoryId)) values.category = null;
      advance(w, "amount");
    } else if (field === "category" && values.mode === "movement" && categoriesFor(values.type).includes(value as CategoryId)) {
      values.category = value as CategoryId;
      advance(w, "account");
    } else if (field === "account" && values.mode === "movement" && accountIds.includes(value as AccountId)) {
      values.account = value as AccountId;
      advance(w, "date");
    } else if (field === "fromAccount" && values.mode === "transfer" && accountIds.includes(value as AccountId)) {
      values.fromAccount = value as AccountId;
      if (values.toAccount === values.fromAccount) values.toAccount = null;
      advance(w, "toAccount");
    } else if (field === "toAccount" && values.mode === "transfer" && accountIds.includes(value as AccountId) && value !== values.fromAccount) {
      values.toAccount = value as AccountId;
      advance(w, "date");
    } else if (field === "date" && value === "custom") {
      advance(w, "customDate");
    } else if (field === "date" && (value === "today" || value === "yesterday")) {
      values.date = parseDateInput(value === "today" ? "oggi" : "ieri", now, (config.messageConfig ?? readMessageConfig()).timeZone);
      return [answer(), ...this.complete(chatId, w)];
    } else return [answer("Scelta non valida, categoria incompatibile o conti uguali.")];
    return [answer(), ...show(chatId, w)];
  }

  private complete(chatId: number, w: WizardState): FlowEffect[] {
    const v = w.values;
    if (v.amount === null || !v.date) return show(chatId, w, "Completa importo e data.");
    let draft: TransactionDraft;
    if (v.mode === "transfer") {
      if (!v.fromAccount || !v.toAccount || v.fromAccount === v.toAccount) return show(chatId, w, "Scegli conti diversi.");
      draft = { amount: v.amount, date: v.date, type: "transfer", fromAccount: v.fromAccount, toAccount: v.toAccount };
    } else {
      if (!v.type || !v.account || !v.category || !categoriesFor(v.type).includes(v.category)) return show(chatId, w, "Completa tipo, conto e categoria.");
      draft = { amount: v.amount, date: v.date, type: v.type, account: v.account, category: v.category };
    }
    const p = this.store.create(chatId, null, draft);
    return [{ kind: "send", chatId, text: proposalText(p, "Ecco il movimento, bro 👌"), keyboard: proposalKeyboard(p) }];
  }
}
