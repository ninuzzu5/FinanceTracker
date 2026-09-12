import { describe, expect, it } from "vitest";
import { processMessage } from "../src/index.js";

describe("processMessage", () => {
  it("accepts a valid financial message", () => {
    expect(processMessage("8,30 tabacco", new Date("2026-07-19T12:00:00Z"))).toMatchObject({
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
