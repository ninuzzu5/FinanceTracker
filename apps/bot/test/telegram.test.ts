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
      chat: { id: chatId },
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
