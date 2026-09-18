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
    expect(result.reply).toContain("NON è stato salvato");
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
        new Date("2026-07-19T12:00:00Z"),
      ),
    ).toMatchObject({
      kind: "preview",
      chatId: 123456,
      transaction: {
        amount: 8.3,
        date: "2026-07-18",
        account: "revolut",
      },
    });
  });
});
