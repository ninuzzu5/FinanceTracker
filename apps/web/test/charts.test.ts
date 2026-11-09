import { describe, expect, it } from "vitest";
import { isTruncatedBar } from "../src/features/dashboard/Charts";

describe("isTruncatedBar(): taglio oltre 2,2 volte il secondo valore", () => {
  it("non taglia quando il massimo è entro 2,2 volte il secondo", () => {
    expect(isTruncatedBar([100n, 50n, 10n])).toBe(false); // 2,0×
    expect(isTruncatedBar([109n, 50n])).toBe(false); // 2,18×
  });

  it("taglia quando il massimo supera 2,2 volte il secondo", () => {
    expect(isTruncatedBar([111n, 50n, 10n])).toBe(true); // 2,22×
    expect(isTruncatedBar([533n, 144n, 12n, 0n])).toBe(true); // esempio del mockup
  });

  it("non taglia con un solo valore o senza un secondo valore positivo", () => {
    expect(isTruncatedBar([500n])).toBe(false);
    expect(isTruncatedBar([500n, 0n, 0n])).toBe(false);
    expect(isTruncatedBar([])).toBe(false);
  });
});
