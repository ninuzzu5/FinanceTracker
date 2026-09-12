import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/index.js";

const now = new Date("2026-07-19T12:00:00Z");

describe("parseMessage", () => {
  it("extracts a decimal amount and applies defaults", () => {
    expect(parseMessage("8,30 tabacco", { now })).toMatchObject({
      amount: 8.3,
      date: "2026-07-19",
      account: "revolut",
    });
  });

  it("supports yesterday", () => {
    expect(parseMessage("ieri 12,50 spesa", { now }).date).toBe("2026-07-18");
  });

  it("does not treat an explicit date as the amount", () => {
    expect(parseMessage("15/07 20 benzina isybank", { now })).toMatchObject({
      amount: 20,
      date: "2026-07-15",
      account: "isybank",
    });
  });

  it("rejects zero and missing amounts", () => {
    expect(parseMessage("0 tabacco", { now }).amount).toBeNull();
    expect(parseMessage("solo una nota", { now }).amount).toBeNull();
  });

  it("normalizes accents and whitespace without changing the original", () => {
    expect(parseMessage("  9,50   Caffè  ", { now })).toMatchObject({
      originalText: "  9,50   Caffè  ",
      normalizedText: "9,50 caffe",
      amount: 9.5,
    });
  });
});
