import { describe, expect, it } from "vitest";
import { classifyMessage, parseMessage } from "../src/index.js";

const options = { now: new Date("2026-09-18T12:00:00Z"), timeZone: "Europe/Rome", defaultAccount: "isybank" as const };

describe("personal account transfers", () => {
  it.each([
    ["100 da revolut a isybank", 100, "revolut", "isybank", "2026-09-18"],
    ["trasferimento 100 da revolut a isybank", 100, "revolut", "isybank", "2026-09-18"],
    ["50 da isybank a revolut", 50, "isybank", "revolut", "2026-09-18"],
    ["ieri 50 da isybank a revolut", 50, "isybank", "revolut", "2026-09-17"],
    ["10/09/2026 12,50€ DA ISY BANK A REVOLUT", 12.5, "isybank", "revolut", "2026-09-10"],
  ])("parses %s with explicit accounts", (text, amount, fromAccount, toAccount, date) => {
    const parsed = parseMessage(text, options);
    expect(parsed).toMatchObject({ type: "transfer", amount, fromAccount, toAccount, date });
    expect(parsed).not.toHaveProperty("account");
    expect(parsed).not.toHaveProperty("category");
    expect(classifyMessage(text)).toEqual({ type: "transfer", category: null, confidence: 0.98, source: "rule" });
  });

  it.each([
    ["100 da revolut", "revolut", null],
    ["100 a isybank", null, "isybank"],
    ["100 da n26 a isybank", null, "isybank"],
    ["trasferimento 100", null, null],
    ["100 da revolut a revolut", "revolut", "revolut"],
    ["100 da revolut a isybank da isybank a revolut", null, null],
  ])("preserves incomplete/invalid route without inventing accounts: %s", (text, fromAccount, toAccount) => {
    expect(parseMessage(text, options)).toMatchObject({ type: "transfer", fromAccount, toAccount });
    expect(classifyMessage(text)).toMatchObject({ type: "transfer", category: null, source: "unknown" });
  });

  it("gives a clear route precedence over expense/income aliases", () => {
    expect(classifyMessage("100 da revolut a isybank stipendio")).toMatchObject({ type: "transfer", category: null });
  });

  it("preserves ordinary parsing and gift/income classification", () => {
    expect(parseMessage("ieri 8,30 tabacco isybank", options)).toMatchObject({ account: "isybank", amount: 8.3, date: "2026-09-17" });
    expect(classifyMessage("8,30 tabacco isybank")).toMatchObject({ type: "expense", category: "tobacco" });
    expect(parseMessage("50 regalo da Marco", options)).toMatchObject({ type: null, account: "isybank" });
    expect(classifyMessage("50 regalo da Marco")).toMatchObject({ type: "income", category: "gifts" });
  });
});


describe("cash transfer routes", () => {
  it.each(["contanti", "cash", "liquidi"])("recognizes %s in both directions and keeps transfer classification", alias => {
    for (const bank of ["revolut", "isybank"]) {
      expect(parseMessage(`ieri 100 da ${bank} a ${alias} stipendio`, options)).toMatchObject({ type: "transfer", fromAccount: bank, toAccount: "contanti", amount: 100, date: "2026-09-17" });
      expect(parseMessage(`100 da ${alias} a ${bank} spesa`, options)).toMatchObject({ type: "transfer", fromAccount: "contanti", toAccount: bank });
      expect(classifyMessage(`100 da ${bank} a ${alias} stipendio`)).toMatchObject({ type: "transfer", category: null });
      expect(classifyMessage(`100 da ${alias} a ${bank} spesa`)).toMatchObject({ type: "transfer", category: null });
    }
  });
  it("does not infer a missing counterparty or accept repeated routes", () => {
    expect(parseMessage("100 da cash", options)).toMatchObject({ type: "transfer", fromAccount: "contanti", toAccount: null });
    expect(parseMessage("100 a liquidi", options)).toMatchObject({ type: "transfer", fromAccount: null, toAccount: "contanti" });
    expect(parseMessage("100 da cash a contanti", options)).toMatchObject({ type: "transfer", fromAccount: "contanti", toAccount: "contanti" });
    expect(parseMessage("100 da cash a revolut da liquidi a isybank", options)).toMatchObject({ type: "transfer", fromAccount: null, toAccount: null });
  });
});
