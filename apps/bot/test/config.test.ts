import { describe, expect, it } from "vitest";
import { readBotConfig } from "../src/config.js";

const env = { TELEGRAM_BOT_TOKEN: "123456:synthetic_test_token_abcdefghijkl", TELEGRAM_ALLOWED_CHAT_ID: "123456" };

describe("configuration", () => {
  it("applies defaults without requiring webhook or database configuration", () => {
    expect(readBotConfig(env)).toMatchObject({ timeZone: "Europe/Rome", defaultAccount: "revolut" });
  });
  it("supports configured defaults", () => {
    expect(readBotConfig({ ...env, APP_TIMEZONE: "UTC", DEFAULT_ACCOUNT: "isybank" })).toMatchObject({ timeZone: "UTC", defaultAccount: "isybank" });
  });
  it("supports Contanti as the configured default", () => {
    expect(readBotConfig({ ...env, DEFAULT_ACCOUNT: "contanti" })).toMatchObject({ defaultAccount: "contanti" });
  });
  it.each([
    ["TELEGRAM_BOT_TOKEN", undefined], ["TELEGRAM_BOT_TOKEN", "private-invalid-token"],
    ["TELEGRAM_ALLOWED_CHAT_ID", undefined], ["TELEGRAM_ALLOWED_CHAT_ID", "-123"],
    ["TELEGRAM_ALLOWED_CHAT_ID", "1.5"], ["TELEGRAM_ALLOWED_CHAT_ID", "9007199254740992"],
    ["APP_TIMEZONE", "private-invalid-zone"], ["DEFAULT_ACCOUNT", "private-invalid-account"],
  ])("rejects invalid %s without including its value", (key, value) => {
    try {
      readBotConfig({ ...env, [key]: value });
      throw new Error("Should reject");
    } catch (error) {
      expect((error as Error).message).toContain(key);
      if (value) expect((error as Error).message).not.toContain(value);
    }
  });
});
