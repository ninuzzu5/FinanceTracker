import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalFlow, type FlowEffect } from "../src/proposal-flow.js";
import { ProposalStore } from "../src/proposals.js";

const chatId = 123456;
const config = { allowedChatId: String(chatId), messageConfig: { timeZone: "Europe/Rome", defaultAccount: "revolut" as const } };
const now = new Date("2026-09-18T12:00:00Z");
let flow: ProposalFlow;
// Unit flow fixtures simulate successful completion; delivery tests cover async persistence.
const run = (update: unknown) => {
  const effects = flow.handle(update, config, now);
  return effects.flatMap(effect => effect.kind === "persist" ? flow.completeSave(effect) : [effect]);
};
const text = (value: string) => run({ update_id: 1, message: { message_id: 1, text: value, chat: { id: chatId, type: "private" } } });
const callback = (data: string, overrides: object = {}) => run({ update_id: 2, callback_query: {
  id: "synthetic-query", from: { id: chatId }, message: { message_id: 2, chat: { id: chatId, type: "private" } }, data, ...overrides,
} });
const click = (action: string) => {
  const state = flow.store.getState(chatId)!;
  const data = state.kind === "menu" ? `m:${state.id}:${action}` : state.kind === "wizard"
    ? `w:${state.id}:${state.revision}:${action}` : `p:${state.proposal.id}:${state.proposal.revision}:${action}`;
  return callback(data);
};
const sent = (effects: FlowEffect[]) => effects.filter((e) => e.kind === "send");
const labels = (effects: FlowEffect[]) => sent(effects)[0].keyboard!.inline_keyboard.flat().map((b) => b.text);
const start = (mode = "movement") => { text("/start"); return click(mode); };
const movementToDate = (type: "expense" | "income") => {
  start(); click(`type.${type}`); text("12,50"); click(`category.${type === "expense" ? "food" : "salary"}`); click("account.revolut");
};

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  flow = new ProposalFlow(new ProposalStore(60_000));
});
afterEach(() => { flow.store.clear(); vi.useRealTimers(); });

describe("guided entry and menu", () => {
  it.each(["/start", "/menu", "/start@niuzzu_bot"])("opens the minimal menu with %s", (command) => {
    expect(labels(text(command))).toEqual(["➕ Nuovo movimento", "💸 Trasferimento"]);
    expect(flow.store.getState(chatId)?.kind).toBe("menu");
  });

  it.each(["expense", "income"] as const)("completes a %s wizard through the existing confirmation flow", (type) => {
    movementToDate(type);
    const result = click("date.today");
    expect(flow.store.getState(chatId)?.kind).toBe("proposal");
    expect(flow.store.get(chatId)).toMatchObject({ amount: 12.5, type, category: type === "expense" ? "food" : "salary", account: "revolut", date: "2026-09-18", editing: null });
    expect(labels(result)).toEqual(["✅ Conferma", "✏️ Modifica", "❌ Annulla"]);
    expect(sent(click("confirm"))[0].text).toContain("Transazione registrata");
    expect(flow.store.getState(chatId)).toBeUndefined();
  });

  it("completes a transfer, only offering a different destination", () => {
    start("transfer"); text("100");
    const destinations = click("fromAccount.revolut");
    expect(labels(destinations)).toEqual(["Isybank", "Contanti", "⬅️ Indietro", "❌ Annulla"]);
    expect(click("toAccount.revolut")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("conti uguali") });
    expect(flow.store.getState(chatId)).toMatchObject({ step: "toAccount", values: { toAccount: null } });
    click("toAccount.isybank");
    const result = click("date.yesterday");
    expect(flow.store.get(chatId)).toMatchObject({ type: "transfer", fromAccount: "revolut", toAccount: "isybank", amount: 100, date: "2026-09-17" });
    expect(flow.store.get(chatId)).not.toHaveProperty("category");
    expect(sent(result)[0].text).not.toContain("Categoria:");
    click("cancel");
    expect(flow.store.getState(chatId)).toBeUndefined();
  });

  it("keeps invalid amounts and dates at the same step", () => {
    start(); click("type.expense");
    for (const value of ["zero", "-12", "12 pizza"]) {
      expect(sent(text(value))[0].text).toContain("Importo non valido");
      expect(flow.store.getState(chatId)).toMatchObject({ step: "amount", values: { amount: null } });
    }
    text("12.50"); click("category.food"); click("account.isybank"); click("date.custom");
    for (const value of ["eskere", "31/02/2026"]) {
      expect(sent(text(value))[0].text).toContain("Data non valida");
      expect(flow.store.getState(chatId)).toMatchObject({ step: "customDate" });
    }
    text("mercoledì");
    expect(flow.store.get(chatId)).toMatchObject({ amount: 12.5, date: "2026-09-16", account: "isybank" });
  });

  it("filters categories and rejects incompatible or out-of-step callbacks", () => {
    start(); click("type.income");
    expect(labels(text("50"))).toEqual(["Stipendio", "Regali", "Progetti personali", "⬅️ Indietro", "❌ Annulla"]);
    expect(click("category.tobacco")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("incompatibile") });
    expect(click("account.revolut")[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("passaggio") });
    expect(flow.store.getState(chatId)).toMatchObject({ step: "category", values: { category: null } });
  });

  it("goes back while retaining values, then clears a category incompatible with the new type", () => {
    start(); click("type.expense"); text("12"); click("category.tobacco");
    click("back");
    expect(flow.store.getState(chatId)).toMatchObject({ step: "category", values: { amount: 12, category: "tobacco" } });
    click("back"); click("back"); click("type.income");
    expect(flow.store.getState(chatId)).toMatchObject({ step: "amount", values: { amount: 12, category: null, type: "income" } });
    text("20"); click("category.gifts"); click("account.revolut"); click("date.custom"); click("back");
    expect(flow.store.getState(chatId)).toMatchObject({ step: "date" });
    click("date.today");
    expect(flow.store.get(chatId)).toMatchObject({ type: "income", category: "gifts", amount: 20 });
  });

  it("going back and changing origin does not retain an equal destination", () => {
    start("transfer"); text("100"); click("fromAccount.revolut"); click("toAccount.isybank");
    click("back"); click("back"); click("fromAccount.isybank");
    expect(flow.store.getState(chatId)).toMatchObject({ step: "toAccount", values: { fromAccount: "isybank", toAccount: null } });
    click("toAccount.revolut"); click("date.today");
    expect(flow.store.get(chatId)).toMatchObject({ fromAccount: "isybank", toAccount: "revolut" });
  });

  it("cancels the wizard and accepts free text again", () => {
    start(); click("cancel");
    expect(flow.store.getState(chatId)).toBeUndefined();
    expect(labels(text("20 pizza revolut"))).toEqual(["✅ Conferma", "✏️ Modifica", "❌ Annulla"]);
    expect(flow.store.get(chatId)).toMatchObject({ amount: 20, account: "revolut" });
  });

  it("uses the same proposal structure as free text", () => {
    movementToDate("expense"); click("date.today");
    const guided = flow.store.get(chatId)!;
    text("12,50 ristorante revolut");
    const natural = flow.store.get(chatId)!;
    expect(Object.keys(guided).sort()).toEqual(Object.keys(natural).sort());
    for (const key of ["amount", "date", "type", "account", "category"] as const) expect(guided[key]).toBe(natural[key]);
    expect(guided.sourceMessageId).toBeNull();
  });

  it("handles commands predictably with active wizard/proposal state", () => {
    start(); click("type.expense");
    text("/help");
    expect(flow.store.getState(chatId)).toMatchObject({ step: "amount" });
    expect(sent(text("/menu"))[0].text).toContain("chiuso il flusso precedente");
    expect(flow.store.getState(chatId)?.kind).toBe("menu");
    text("20 pizza revolut");
    expect(flow.store.getState(chatId)?.kind).toBe("proposal");
    text("/cancel");
    expect(flow.store.getState(chatId)).toBeUndefined();
    start(); text("/cancel");
    expect(flow.store.getState(chatId)).toBeUndefined();
  });

  it("rejects obsolete/expired buttons, enforces the whitelist and bounds callback payloads", () => {
    const menu = sent(text("/menu"))[0].keyboard!;
    const data = menu.inline_keyboard[0][0].callback_data;
    expect(callback(data, { from: { id: 999 } })).toEqual([]);
    click("movement");
    expect(callback(data)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("scaduti") });
    click("type.expense");
    const state = flow.store.getState(chatId)!;
    if (state.kind !== "wizard") throw new Error("Expected wizard");
    const old = `w:${state.id}:${state.revision}:back`;
    for (const row of sent(text("12"))[0].keyboard!.inline_keyboard) {
      for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }
    expect(callback(old)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("scaduti") });
    vi.advanceTimersByTime(60_000);
    expect(flow.store.getState(chatId)).toBeUndefined();
    const unauthorized = { update_id: 1, message: { message_id: 1, text: "/start", chat: { id: 999, type: "private" } } };
    expect(run(unauthorized)).toEqual([]);
  });
});


describe("cash guided entry", () => {
  it.each(["expense", "income"] as const)("collects a cash %s", type => {
    start(); click(`type.${type}`); text("25");
    const accounts = click(`category.${type === "expense" ? "food" : "salary"}`);
    expect(labels(accounts)).toEqual(["Revolut", "Isybank", "Contanti", "⬅️ Indietro", "❌ Annulla"]);
    click("account.contanti");
    const preview = click("date.today");
    expect(flow.store.get(chatId)).toMatchObject({ type, account: "contanti", amount: 25 });
    expect(sent(preview)[0].text).toContain("🏦 Contanti");
    expect(flow.store.get(chatId)).not.toHaveProperty("description");
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });

  it.each([
    ["revolut", "contanti"], ["contanti", "revolut"],
    ["isybank", "contanti"], ["contanti", "isybank"],
  ])("collects a transfer from %s to %s", (from, to) => {
    start("transfer"); text("100");
    const destinations = click(`fromAccount.${from}`);
    expect(labels(destinations)).not.toContain(from === "contanti" ? "Contanti" : from === "revolut" ? "Revolut" : "Isybank");
    expect(click(`toAccount.${from}`)[0]).toMatchObject({ kind: "answer", text: expect.stringContaining("conti uguali") });
    click(`toAccount.${to}`);
    const preview = click("date.today");
    expect(flow.store.get(chatId)).toMatchObject({ type: "transfer", fromAccount: from, toAccount: to });
    expect(sent(preview)[0].text).toContain("Contanti");
    expect(sent(preview)[0].text).not.toContain("Categoria:");
    click("confirm");
    expect(flow.store.get(chatId)).toBeUndefined();
  });
});
