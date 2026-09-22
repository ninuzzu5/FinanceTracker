import { describe, expect, it } from "vitest";
import { processMessage } from "../src/index.js";

describe("processMessage", () => {
  it.each([
    ["100 da revolut a revolut", "same_transfer_accounts"],
    ["100 da revolut", "incomplete_transfer"],
    ["100 a isybank", "incomplete_transfer"],
    ["100 da n26 a isybank", "incomplete_transfer"],
    ["0 da revolut a isybank", "missing_or_invalid_amount"],
    ["eskere", "missing_or_invalid_amount"],
    ["2 giorni fa spesa", "missing_or_invalid_amount"],
    ["31/02/2026 spesa 12€", "invalid_or_ambiguous_date"],
    ["ieri oggi spesa 12€", "invalid_or_ambiguous_date"],
    ["12€ revolut isybank", "ambiguous_account"],
  ])("rejects %s without inventing a preview", (text, reason) => {
    expect(processMessage(text, new Date("2026-09-18T12:00:00Z"), { timeZone: "Europe/Rome", defaultAccount: "revolut" })).toEqual({ ok: false, reason });
  });
  it("accepts a valid financial message", () => {
    expect(processMessage("8,30 tabacco", new Date("2026-09-18T12:00:00Z"))).toMatchObject({
      ok: true,
      value: { amount: 8.3, account: "revolut" },
    });
  });

  it("rejects text without a valid amount", () => {
    expect(processMessage("ciao bot")).toEqual({
      ok: false,
      reason: "missing_or_invalid_amount",
    });
  });
});
