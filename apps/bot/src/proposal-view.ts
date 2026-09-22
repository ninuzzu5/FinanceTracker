import { categoryLabels, transactionTypeLabels } from "@finance-tracker/domain";
import { categoriesFor, type Proposal } from "./proposals.js";

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };
const button = (p: Proposal, text: string, action: string) => ({ text, callback_data: `p:${p.id}:${p.revision}:${action}` });

export function proposalKeyboard(p: Proposal): InlineKeyboard {
  return { inline_keyboard: [[button(p, "✅ Conferma", "confirm"), button(p, "✏️ Modifica", "edit"), button(p, "❌ Annulla", "cancel")]] };
}

export function backKeyboard(p: Proposal): InlineKeyboard {
  return { inline_keyboard: [[button(p, "↩️ Anteprima", "back"), button(p, "❌ Annulla", "cancel")]] };
}

export function fieldKeyboard(p: Proposal): InlineKeyboard {
  return { inline_keyboard: [
    [button(p, "Importo", "field.amount"), button(p, "Data", "field.date")],
    ...(p.type === "transfer" ? [
      [button(p, "Conto di origine", "field.fromAccount"), button(p, "Conto di destinazione", "field.toAccount")],
      [button(p, "Scambia conti", "swap"), button(p, "Tipo", "field.type")],
    ] : [[button(p, "Conto", "field.account"), button(p, "Tipo", "field.type"), button(p, "Categoria", "field.category")]]),
    ...backKeyboard(p).inline_keyboard,
  ] };
}

export function choicesKeyboard(p: Proposal, field: "account" | "fromAccount" | "toAccount" | "type" | "category"): InlineKeyboard {
  const choices = ["account", "fromAccount", "toAccount"].includes(field) ? [["revolut", "Revolut"], ["isybank", "Isybank"]]
    : field === "type" ? Object.entries(transactionTypeLabels)
      : categoriesFor(p.type).map((id) => [id, categoryLabels[id]]);
  return { inline_keyboard: [
    ...choices.map(([id, label]) => [button(p, label, `set.${field}.${id}`)]),
    ...backKeyboard(p).inline_keyboard,
  ] };
}

export function proposalText(p: Proposal, title = "Anteprima aggiornata, bro 👌"): string {
  return [
    title, "",
    `💶 ${p.amount.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}`,
    ...(p.type === "transfer" ? [
      `Da: ${p.fromAccount === null ? "da confermare" : p.fromAccount === "revolut" ? "Revolut" : "Isybank"}`,
      `A: ${p.toAccount === null ? "da confermare" : p.toAccount === "revolut" ? "Revolut" : "Isybank"}`,
    ] : [`🏦 ${p.account === null ? "da confermare" : p.account === "revolut" ? "Revolut" : "Isybank"}`]),
    `📅 ${p.date.split("-").reverse().join("/")}`,
    `↔️ Tipo: ${p.type ? transactionTypeLabels[p.type] : "da confermare"}`,
    ...(p.type === "transfer" ? [] : [`🏷️ Categoria: ${p.category ? categoryLabels[p.category] : "da confermare"}`]),
    "", "Solo anteprima: non ho salvato nulla.",
  ].join("\n");
}
