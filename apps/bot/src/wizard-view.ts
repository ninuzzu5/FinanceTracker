import { categoryLabels } from "@finance-tracker/domain";
import { categoriesFor } from "./proposals.js";
import type { InlineKeyboard } from "./proposal-view.js";
import type { MenuState, WizardState } from "./wizard-state.js";

export function menuView(menu: MenuState): { text: string; keyboard: InlineKeyboard } {
  return {
    text: "FinanceTracker 👋\n\nCome vuoi inserire un movimento, bro?\nPuoi anche scrivermi direttamente: ieri 8,30 tabacco isybank",
    keyboard: { inline_keyboard: [[{ text: "➕ Nuovo movimento", callback_data: `m:${menu.id}:movement` }],
      [{ text: "💸 Trasferimento", callback_data: `m:${menu.id}:transfer` }]] },
  };
}

export function wizardView(w: WizardState): { text: string; keyboard: InlineKeyboard } {
  const button = (text: string, action: string) => ({ text, callback_data: `w:${w.id}:${w.revision}:${action}` });
  let text: string;
  let choices: [string, string][] = [];
  switch (w.step) {
    case "type": text = "Che movimento inseriamo, bro?"; choices = [["💸 Spesa", "type.expense"], ["💰 Entrata", "type.income"]]; break;
    case "amount": text = "Inserisci l'importo, bro. Per esempio: 12,50"; break;
    case "category": text = "Scegli la categoria:"; choices = categoriesFor(w.values.type).map((id) => [categoryLabels[id], `category.${id}`]); break;
    case "account": case "fromAccount": case "toAccount":
      text = w.step === "account" ? "Scegli il conto:" : w.step === "fromAccount" ? "Da quale conto?" : "Verso quale conto?";
      choices = (["revolut", "isybank"] as const)
        .filter((id) => w.step !== "toAccount" || w.values.mode !== "transfer" || id !== w.values.fromAccount)
        .map((id) => [id === "revolut" ? "Revolut" : "Isybank", `${w.step}.${id}`]);
      break;
    case "date": text = "Quando è avvenuto il movimento?"; choices = [["Oggi", "date.today"], ["Ieri", "date.yesterday"], ["📅 Altra data", "date.custom"]]; break;
    case "customDate": text = "Scrivi la data, bro: per esempio 18/09/2026 oppure mercoledì."; break;
  }
  return { text, keyboard: { inline_keyboard: [
    ...choices.map(([label, action]) => [button(label, action)]),
    [...(w.history.length ? [button("⬅️ Indietro", "back")] : []), button("❌ Annulla", "cancel")],
  ] } };
}
