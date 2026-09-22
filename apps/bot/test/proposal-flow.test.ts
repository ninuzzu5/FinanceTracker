import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalFlow, type FlowEffect } from "../src/proposal-flow.js";
import { ProposalStore } from "../src/proposals.js";
import { deliverUpdate } from "../src/flow-delivery.js";

const config = { allowedChatId: "123456", messageConfig: { timeZone: "Europe/Rome", defaultAccount: "revolut" as const } };
const chatId = 123456; // Synthetic fixture, not a real chat.
const now = new Date("2026-09-18T12:00:00Z");
const message = (text: string, id = 1) => ({ update_id: id, message: { message_id: id, text, chat: { id: chatId, type: "private" } } });
const callback = (data: string, overrides: object = {}) => ({ update_id: 10, callback_query: {
  id: "synthetic-query", from: { id: chatId }, message: { message_id: 99, chat: { id: chatId, type: "private" } }, data, ...overrides,
} });
let flow: ProposalFlow;
const run = (update: unknown) => flow.handle(update, config, now);
const click = (action: string) => {
  const p = flow.store.get(chatId)!;
  return run(callback(`p:${p.id}:${p.revision}:${action}`));
};
const sent = (effects: FlowEffect[]) => effects.filter((e) => e.kind === "send");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  flow = new ProposalFlow(new ProposalStore(60_000));
});
afterEach(() => { flow.store.clear(); vi.useRealTimers(); });

describe("temporary proposal flow", () => {
  it("creates a minimal proposal and inline actions", () => {
    const effects = run(message("ieri 8,30 tabacco isybank"));
    expect(flow.store.get(chatId)).toMatchObject({ amount: 8.3, date: "2026-09-17", account: "isybank", type: "expense", category: "tobacco" });
    expect(flow.store.get(chatId)).not.toHaveProperty("originalText");
    expect(sent(effects)[0].keyboard?.inline_keyboard[0].map((b) => b.text)).toEqual(["✅ Conferma", "✏️ Modifica", "❌ Annulla"]);
    for (const row of sent(effects)[0].keyboard!.inline_keyboard) {
      for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it.each(["confirm", "cancel"])("closes and removes the proposal on %s; duplicate clicks are stale", (action) => {
    run(message("8,30 tabacco"));
    const p = flow.store.get(chatId)!;
    const data = `p:${p.id}:${p.revision}:${action}`;
    const result = run(callback(data));
    expect(flow.store.get(chatId)).toBeUndefined();
    expect(result).toContainEqual({ kind: "clearButtons", chatId, messageId: 99 });
    expect(sent(result)[0].text).toContain(action === "confirm" ? "Nessun salvataggio reale" : "annullata");
    expect(run(callback(data))).toEqual([{ kind: "answer", queryId: "synthetic-query", text: expect.stringContaining("scaduta") }]);
  });

  it("expires automatically and rejects callback after expiry or process restart", () => {
    run(message("8,30 tabacco"));
    const p = flow.store.get(chatId)!;
    const query = callback(`p:${p.id}:0:confirm`);
    vi.advanceTimersByTime(60_000);
    expect(flow.store.get(chatId)).toBeUndefined();
    expect(run(query)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("scaduta") });
    expect(new ProposalFlow().handle(query, config)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("scaduta") });
  });

  it.each([
    ["amount", "zero", "12,50", "amount", 12.5],
    ["date", "eskere", "mercoledì", "date", "2026-09-16"],
    ["date", "31/02/2026", "10 settembre 2026", "date", "2026-09-10"],
  ])("validates %s edits and keeps waiting after invalid input", (field, invalid, valid, key, value) => {
    run(message("8,30 tabacco"));
    click("edit");
    click(`field.${field}`);
    expect(sent(run(message(invalid, 2)))[0].text).toContain("non valid");
    expect(flow.store.get(chatId)?.editing).toBe(field);
    const result = run(message(valid, 3));
    expect(flow.store.get(chatId)).toMatchObject({ [key]: value, editing: null, category: "tobacco" });
    expect(sent(result)[0].keyboard?.inline_keyboard[0]).toHaveLength(3);
  });

  it("offers existing accounts/types, filters categories and clears incompatible ones", () => {
    run(message("8,30 tabacco"));
    const accounts = sent(click("field.account"))[0].keyboard!.inline_keyboard.flat().map((b) => b.text);
    expect(accounts).toEqual(["Revolut", "Isybank", "↩️ Anteprima", "❌ Annulla"]);
    click("set.account.isybank");
    expect(flow.store.get(chatId)?.account).toBe("isybank");
    const types = sent(click("field.type"))[0].keyboard!.inline_keyboard.flat().map((b) => b.text);
    expect(types).toContain("Trasferimento");
    click("set.type.income");
    expect(flow.store.get(chatId)).toMatchObject({ type: "income", category: null });
    const categories = sent(click("field.category"))[0].keyboard!.inline_keyboard.flat();
    expect(categories.map((b) => b.text)).toEqual(["Stipendio", "Regali", "Progetti personali", "↩️ Anteprima", "❌ Annulla"]);
    expect(categories.every((b) => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
    expect(click("set.category.tobacco")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("incompatibile") });
    click("set.category.salary");
    expect(flow.store.get(chatId)?.category).toBe("salary");
    const result = click("set.type.transfer");
    expect(flow.store.get(chatId)).toMatchObject({ type: "transfer", fromAccount: null, toAccount: null });
    expect(flow.store.get(chatId)).not.toHaveProperty("category");
    expect(sent(result)[0].text).toContain("Da: da confermare");
    expect(click("set.category.salary")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("incompatibile") });
    expect(click("field.category")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("non hanno categoria") });
    click("set.fromAccount.revolut");
    click("set.toAccount.isybank");
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it("requires resolving unknown type/category before confirmation", () => {
    const result = run(message("12 eskere"));
    expect(sent(result)[0].text).toContain("da confermare");
    expect(click("confirm")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("Scegli prima") });
    expect(flow.store.get(chatId)).toBeDefined();
    click("set.type.expense");
    click("set.category.groceries");
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it("creates and confirms an explicit transfer without any category", () => {
    const effects = run(message("ieri 50 da isybank a revolut"));
    expect(flow.store.get(chatId)).toMatchObject({ type: "transfer", fromAccount: "isybank", toAccount: "revolut", date: "2026-09-17" });
    expect(flow.store.get(chatId)).not.toHaveProperty("category");
    expect(flow.store.get(chatId)).not.toHaveProperty("account");
    expect(sent(effects)[0].text).not.toContain("Categoria:");
    const buttons = sent(click("edit"))[0].keyboard!.inline_keyboard.flat().map((b) => b.text);
    expect(buttons).toContain("Conto di origine");
    expect(buttons).toContain("Conto di destinazione");
    expect(buttons).not.toContain("Categoria");
    click("back");
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it.each(["expense", "income"])("requires both accounts when changing %s to transfer", (type) => {
    run(message(type === "expense" ? "8,30 tabacco" : "100 stipendio"));
    click("set.type.transfer");
    expect(flow.store.get(chatId)).toMatchObject({ type: "transfer", fromAccount: null, toAccount: null });
    expect(flow.store.get(chatId)).not.toHaveProperty("account");
    expect(flow.store.get(chatId)).not.toHaveProperty("category");
    expect(click("confirm")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("origine e destinazione") });
    const fromChoices = sent(click("field.fromAccount"))[0].keyboard!.inline_keyboard.flat().map((b) => b.text);
    expect(fromChoices).toEqual(["Revolut", "Isybank", "↩️ Anteprima", "❌ Annulla"]);
    click("set.fromAccount.revolut");
    // Changing origin while destination is still unchosen is safe.
    click("set.fromAccount.isybank");
    expect(flow.store.get(chatId)?.fromAccount).toBe("isybank");
    click("field.toAccount");
    expect(click("set.toAccount.isybank")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("devono essere diverse") });
    expect(flow.store.get(chatId)?.toAccount).toBeNull();
    click("set.toAccount.revolut");
    expect(flow.store.get(chatId)?.toAccount).toBe("revolut");
    expect(click("set.fromAccount.revolut")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("devono essere diverse") });
    click("swap");
    expect(flow.store.get(chatId)).toMatchObject({ fromAccount: "revolut", toAccount: "isybank" });
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it.each(["expense", "income"])("cleans transfer fields when changing to %s", (type) => {
    run(message("100 da revolut a isybank"));
    click(`set.type.${type}`);
    expect(flow.store.get(chatId)).toMatchObject({ type, account: null, category: null });
    expect(flow.store.get(chatId)).not.toHaveProperty("fromAccount");
    expect(flow.store.get(chatId)).not.toHaveProperty("toAccount");
    expect(click("set.fromAccount.revolut")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("non valida") });
    click("set.account.revolut");
    click(`set.category.${type === "expense" ? "groceries" : "salary"}`);
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it("retains transfer accounts when editing amount and date; invalid textual routes create no proposal", () => {
    expect(sent(run(message("100 da revolut")))[0].text).toContain("entrambi i conti");
    expect(flow.store.get(chatId)).toBeUndefined();
    run(message("100 da revolut a isybank"));
    click("field.amount");
    run(message("120", 2));
    click("field.date");
    run(message("ieri", 3));
    expect(flow.store.get(chatId)).toMatchObject({ type: "transfer", fromAccount: "revolut", toAccount: "isybank", amount: 120, date: "2026-09-17" });
    expect(click("set.account.revolut")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("non valida") });
  });

  it("rejects old revision/replaced proposal buttons without changing the current proposal", () => {
    run(message("8,30 tabacco"));
    const p = flow.store.get(chatId)!;
    const query = callback(`p:${p.id}:0:confirm`);
    click("edit");
    expect(run(query)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("scaduta") });
    run(message("34 barbiere", 2));
    expect(run(query)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("scaduta") });
    expect(flow.store.get(chatId)?.amount).toBe(34);
  });

  it("can leave text editing and reparse edited source messages", () => {
    run(message("8,30 tabacco"));
    click("field.amount");
    click("back");
    expect(flow.store.get(chatId)?.editing).toBeNull();
    const edited = { update_id: 3, edited_message: message("34 barbiere isybank").message };
    expect(sent(run(edited))[0].text).toContain("Anteprima aggiornata");
    expect(flow.store.get(chatId)).toMatchObject({ amount: 34, category: "personal_care" });
    run({ update_id: 4, edited_message: message("eskere").message });
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it("ignores malformed and unauthorized callbacks and text", () => {
    run(message("8,30 tabacco"));
    const p = flow.store.get(chatId)!;
    const data = `p:${p.id}:0:confirm`;
    expect(run(callback(data, { from: { id: 999 } }))).toEqual([]);
    expect(run(callback(data, { message: { message_id: 99, chat: { id: chatId, type: "group" } } }))).toEqual([]);
    expect(run({ update_id: 5, callback_query: null })).toEqual([]);
    expect(run({ update_id: 5, message: { message_id: 5, text: "12", chat: { id: 999, type: "private" } } })).toEqual([]);
    expect(flow.store.get(chatId)?.id).toBe(p.id);
  });

  it("delivers inline keyboards, answers callbacks and clears terminal buttons through mocks", async () => {
    const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) };
    await deliverUpdate(flow, client, message("8,30 tabacco"), config);
    expect(client.sendMessage.mock.calls[0][3]).toHaveProperty("inline_keyboard");
    const p = flow.store.get(chatId)!;
    await deliverUpdate(flow, client, callback(`p:${p.id}:0:confirm`), config);
    expect(client.call).toHaveBeenCalledWith("answerCallbackQuery", expect.objectContaining({ callback_query_id: "synthetic-query" }), undefined);
    expect(client.call).toHaveBeenCalledWith("editMessageReplyMarkup", expect.objectContaining({ reply_markup: { inline_keyboard: [] } }), undefined);
    expect(client.sendMessage).toHaveBeenLastCalledWith(chatId, expect.stringContaining("Nessun salvataggio reale"), undefined, undefined);
  });
});
