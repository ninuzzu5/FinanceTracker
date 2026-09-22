import { describe, expect, it } from "vitest";
import { decideUpdate, secretsMatch, type TelegramUpdate } from "../src/index.js";

const config = {
  allowedChatId: "123456",
  webhookSecret: "a-secure-test-secret",
};

function messageUpdate(text: string, chatId = 123456): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 2,
      text,
      chat: { id: chatId, type: "private" },
    },
  };
}

describe("secretsMatch", () => {
  it("accepts only an exact secret", () => {
    expect(secretsMatch("a-secure-test-secret", config.webhookSecret)).toBe(true);
    expect(secretsMatch("wrong-secret", config.webhookSecret)).toBe(false);
    expect(secretsMatch(undefined, config.webhookSecret)).toBe(false);
  });
});

describe("decideUpdate", () => {
  it("previews a transfer without category or single account", () => {
    const result = decideUpdate(messageUpdate("ieri 100 da revolut a isybank"), config, new Date("2026-09-18T12:00:00Z"));
    expect(result).toMatchObject({ kind: "preview", transaction: { type: "transfer", amount: 100, date: "2026-09-17", fromAccount: "revolut", toAccount: "isybank" } });
    if (result.kind !== "preview") throw new Error("Expected preview");
    expect(result.reply).toContain("Tipo: Trasferimento");
    expect(result.reply).toContain("Da: Revolut");
    expect(result.reply).toContain("A: Isybank");
    expect(result.reply).not.toContain("Categoria:");
    expect(result.transaction).not.toHaveProperty("account");
  });
  it("explains identical transfer accounts", () => {
    expect(decideUpdate(messageUpdate("100 da revolut a revolut"), config)).toMatchObject({
      kind: "reject", reason: "same_transfer_accounts", reply: expect.stringContaining("devono essere diversi"),
    });
  });
  it.each([
    ["8,30 tabacco", "Uscita", "Tabacco"],
    ["50 regalo ricevuto", "Entrata", "Regali"],
    ["50 regalo", "da confermare", "Regali"],
    ["12 eskere", "da confermare", "da confermare"],
  ])("includes classification without rejecting a valid preview: %s", (text, type, category) => {
    const result = decideUpdate(messageUpdate(text), config, new Date("2026-09-18T12:00:00Z"));
    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") throw new Error("Expected preview");
    expect(result.reply).toContain(`Tipo: ${type}`);
    expect(result.reply).toContain(`Categoria: ${category}`);
    expect(result.reply).toContain("18/09/2026");
    expect(result.reply).toContain("Revolut");
    expect(result.reply).toContain("non ho salvato nulla");
  });
  it("recalculates an edited message including its new account", () => {
    const original = messageUpdate("mercoledì barbiere 34€");
    const edited = { update_id: 2, edited_message: { ...original.message, text: "mercoledì barbiere 34€ isybank" } };
    const result = decideUpdate(edited, config, new Date("2026-09-18T12:00:00Z"));
    expect(result).toMatchObject({ kind: "preview", transaction: { amount: 34, date: "2026-09-16", account: "isybank" } });
    if (result.kind !== "preview") throw new Error("Expected edited preview");
    expect(result.reply).toContain("Anteprima aggiornata");
    expect(result.reply).toContain("Categoria: Personal Care");
    expect(result.reply).toContain("non ho salvato nulla");
  });
  it.each(["message", "edited_message"])("rejects missing amounts in %s", (field) => {
    const result = decideUpdate({ update_id: 2, [field]: messageUpdate("eskere").message }, config, new Date("2026-09-18T12:00:00Z"));
    expect(result).toMatchObject({ kind: "reject", reason: "missing_or_invalid_amount", reply: expect.stringContaining("importo") });
    expect(result).not.toHaveProperty("transaction");
  });
  it.each([
    { edited_message: null }, { edited_message: {} },
    { edited_message: messageUpdate("12", 999).message },
    { edited_message: { message_id: 2, text: "12", chat: { id: 123456, type: "group" } } },
    { message: messageUpdate("12").message, edited_message: messageUpdate("34").message },
    { edited_channel_post: messageUpdate("12").message },
  ])("ignores malformed, unsupported or unauthorized edits %#", (payload) => {
    expect(decideUpdate({ update_id: 2, ...payload }, config).kind).toBe("ignore");
  });
  it.each([
    ["31/02/2026 spesa 12", "invalid_or_ambiguous_date", "data"],
    ["12 revolut isybank", "ambiguous_account", "conto"],
  ])("explains why %s cannot produce a preview", (text, reason, explanation) => {
    expect(decideUpdate(messageUpdate(text), config)).toMatchObject({ kind: "reject", reason, reply: expect.stringContaining(explanation) });
  });
  it.each(["/start", "/help", "/start@niuzzu_bot", "/help@niuzzu_bot", "/start welcome"])("responds to %s", (command) => {
    expect(decideUpdate(messageUpdate(command), config)).toMatchObject({
      kind: "help", reply: expect.stringContaining("8,30 tabacco"),
    });
  });

  it.each([null, undefined, [], {}, { update_id: 1 },
    { update_id: 1, message: null }, { update_id: 1, message: { text: "8,30" } },
    { update_id: 1, message: { message_id: 1, text: 12, chat: { id: 123456, type: "private" } } },
    { ...messageUpdate("8,30"), update_id: -1 },
    { ...messageUpdate("8,30"), update_id: 1.5 },
    messageUpdate(""),
  ])("ignores malformed or unsupported payload %#", (update) => {
    expect(decideUpdate(update, config).kind).toBe("ignore");
  });

  it.each(["group", "supergroup", "channel", undefined])("rejects chat type %s even with the allowed ID", (type) => {
    const update = messageUpdate("/start");
    expect(decideUpdate({ ...update, message: { ...update.message, chat: { id: 123456, type } } }, config).kind).toBe("ignore");
  });

  it("uses the configured timezone and default account in its preview", () => {
    const result = decideUpdate(messageUpdate("8,30 tabacco"), {
      allowedChatId: "123456", messageConfig: { timeZone: "America/New_York", defaultAccount: "isybank" },
    }, new Date("2026-09-18T01:00:00Z"));
    expect(result).toMatchObject({ kind: "preview", transaction: { date: "2026-09-17", account: "isybank" } });
    if (result.kind !== "preview") throw new Error("Expected preview");
    expect(result.reply).toContain("8,30");
    expect(result.reply).toContain("€");
    expect(result.reply).toContain("non ho salvato nulla");
    expect(result.reply).toContain("17/09/2026");
    expect(result.reply).toContain("Isybank");
  });
  it("ignores messages from chats outside the whitelist", () => {
    expect(decideUpdate(messageUpdate("8,30 tabacco", 999), config)).toEqual({
      kind: "ignore",
      reason: "unauthorized_chat",
    });
  });

  it("returns a useful error for a missing amount", () => {
    expect(decideUpdate(messageUpdate("ciao bot"), config)).toMatchObject({
      kind: "reject",
      reason: "missing_or_invalid_amount",
      chatId: 123456,
    });
  });

  it("creates a preview without persisting anything", () => {
    expect(
      decideUpdate(
        messageUpdate("ieri 8,30 tabacco"),
        config,
        new Date("2026-09-18T12:00:00Z"),
      ),
    ).toMatchObject({
      kind: "preview",
      chatId: 123456,
      transaction: {
        amount: 8.3,
        date: "2026-09-17",
        account: "revolut",
      },
    });
  });
});
