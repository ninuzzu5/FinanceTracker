import { describe, expect, it } from "vitest";
import { amountInCents } from "../src/money.js";

describe("exact monetary validation", () => {
  it.each([[0, 0], [0.01, 1], [0.29, 29], [1.1, 110], [12.5, 1250], [9999999.99, 999999999]])(
    "represents %s as %s cents without multiplication artifacts", (amount, cents) => {
      expect(amountInCents(amount)).toBe(cents);
    },
  );
  it.each([NaN, Infinity, -Infinity, -1, 0.001, 12.345, 0.1 + 0.2, 1e30, 9007199254740991])(
    "rejects %s without rounding", amount => {
      expect(amountInCents(amount)).toBeNull();
    },
  );
});
