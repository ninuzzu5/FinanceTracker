import { describe, expect, it } from "vitest";
import { classifyMessage, parseMessage } from "../src/index.js";

describe("deterministic classification", () => {
  it.each([
    ["25 conad", "expense", "groceries"],
    ["2 metro", "expense", "public_transport"],
    ["80 ryanair", "expense", "flights"],
    ["8,30 tabacco", "expense", "tobacco"],
    ["30 padel", "expense", "sport"],
    ["12 cinema", "expense", "leisure"],
    ["20 ristorante", "expense", "food"],
    ["500 canone di locazione", "expense", "rent"],
    ["34 barbiere", "expense", "personal_care"],
    ["50 regalo per Marco", "expense", "gifts"],
    ["10 netflix", "expense", "subscriptions"],
    ["100 hotel", "expense", "holidays"],
    ["70 riparazione imprevista", "expense", "unexpected"],
    ["1500 busta paga", "income", "salary"],
    ["50 regalo ricevuto", "income", "gifts"],
    ["300 pagamento cliente", "income", "personal_projects"],
  ])("classifies %s", (text, type, category) => {
    expect(classifyMessage(text)).toEqual({ type, category, confidence: 0.98, source: "rule" });
  });

  it("distinguishes groceries from eating out and does not absorb flights into holidays", () => {
    expect(classifyMessage("spesa supermercato").category).toBe("groceries");
    expect(classifyMessage("pranzo al bar").category).toBe("food");
    expect(classifyMessage("volo per vacanza").category).toBe("flights");
    expect(classifyMessage("vacanza hotel").category).toBe("holidays");
  });

  it("normalizes punctuation, case, accents and apostrophes without substring matches", () => {
    expect(classifyMessage("CONAD, spésa!").category).toBe("groceries");
    expect(classifyMessage("cena da McDonald’s").category).toBe("food");
    expect(classifyMessage("da McDonald's").category).toBe("food");
    expect(classifyMessage("barca cooperativa metronomo camelia")).toEqual({ type: null, category: null, confidence: 0, source: "unknown" });
  });

  it("prefers specific overlapping phrases without discarding independent conflicts", () => {
    expect(classifyMessage("abbonamento palestra").category).toBe("sport");
    expect(classifyMessage("spesa al ristorante").category).toBe("food");
    expect(classifyMessage("abbonamento palestra e netflix")).toEqual({ type: "expense", category: null, confidence: 0, source: "unknown" });
    expect(classifyMessage("stipendio e supermercato")).toEqual({ type: null, category: null, confidence: 0, source: "unknown" });
  });

  it("uses directional gift context, including the object bought or received", () => {
    for (const phrase of ["comprato regalo", "regalo per Marco", "comprato un regalo netflix"]) {
      expect(classifyMessage(phrase)).toMatchObject({ type: "expense", category: "gifts", source: "rule" });
    }
    for (const phrase of ["regalo ricevuto", "mi hanno regalato", "regalo da Marco"]) {
      expect(classifyMessage(phrase)).toMatchObject({ type: "income", category: "gifts", source: "rule" });
    }
    for (const phrase of ["regalo 50", "regalo ricevuto e comprato regalo"]) {
      expect(classifyMessage(phrase)).toEqual({ type: null, category: "gifts", confidence: 0, source: "unknown" });
    }
  });

  it("does not default unknown descriptions to expense or unexpected", () => {
    for (const text of ["", "50 eskere", "50 giroconto"]) {
      expect(classifyMessage(text)).toEqual({ type: null, category: null, confidence: 0, source: "unknown" });
    }
  });

  it("leaves existing amount, date and account parsing unchanged", () => {
    const parsed = parseMessage("mercoledì barbiere 34€ isybank", {
      now: new Date("2026-09-18T12:00:00Z"), timeZone: "Europe/Rome",
    });
    expect(parsed).toMatchObject({ amount: 34, date: "2026-09-16", account: "isybank" });
    expect(classifyMessage(parsed.normalizedText)).toMatchObject({ type: "expense", category: "personal_care" });
  });
});
