import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/index.js";

const now = new Date("2026-09-18T12:00:00Z");

describe("parseMessage", () => {
  it("extracts a decimal amount and applies defaults", () => {
    expect(parseMessage("8,30 tabacco", { now })).toMatchObject({
      amount: 8.3,
      date: "2026-09-18",
      account: "revolut",
    });
  });

  it("supports yesterday", () => {
    expect(parseMessage("ieri 12,50 spesa", { now }).date).toBe("2026-09-17");
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

describe("reported regressions (Friday 18 September 2026, Europe/Rome)", () => {
  it.each([
    ["10-09-2026 tabacco 12€", 12, "2026-09-10", "revolut"],
    ["l'altro ieri mozzarelle 2", 2, "2026-09-16", "revolut"],
    ["mercoledì barbiere 34€ isybank", 34, "2026-09-16", "isybank"],
    ["eskere", null, "2026-09-18", "revolut"],
  ])("parses %s", (input, amount, date, account) => {
    expect(parseMessage(input, { now, timeZone: "Europe/Rome" })).toMatchObject({ amount, date, account });
  });
});

describe("explicit date grammar", () => {
  it.each([
    ["oggi", "2026-09-18"], ["ieri", "2026-09-17"],
    ["l'altro ieri", "2026-09-16"], ["l’altro ieri", "2026-09-16"],
    ["altro ieri", "2026-09-16"], ["avantieri", "2026-09-16"],
    ["0 giorni fa", "2026-09-18"], ["2 giorni fa", "2026-09-16"],
    ["20 giorni fa", "2026-08-29"], ["una settimana fa", "2026-09-11"],
    ["lunedì", "2026-09-14"], ["lunedi", "2026-09-14"],
    ["martedì", "2026-09-15"], ["martedi", "2026-09-15"],
    ["mercoledì", "2026-09-16"], ["mercoledi", "2026-09-16"],
    ["giovedì", "2026-09-17"], ["giovedi", "2026-09-17"],
    ["venerdì", "2026-09-18"], ["venerdi", "2026-09-18"],
    ["sabato", "2026-09-12"], ["domenica", "2026-09-13"],
    ["mercoledì scorso", "2026-09-16"], ["mercoledì prossimo", "2026-09-23"],
    ["venerdì scorso", "2026-09-11"], ["venerdì prossimo", "2026-09-25"],
    ["sabato scorso", "2026-09-12"], ["sabato prossimo", "2026-09-19"],
    ["10/09", "2026-09-10"], ["10-09", "2026-09-10"],
    ["10/09/2026", "2026-09-10"], ["10-09-2026", "2026-09-10"],
    ["2026-09-10", "2026-09-10"], ["10 settembre 2026", "2026-09-10"],
    ["10 settembre", "2026-09-10"], ["1/2", "2026-02-01"],
    ["31/12", "2026-12-31"], ["10/09/26", "2026-09-10"],
    ["29 febbraio 2024", "2024-02-29"], ["29/02/2024", "2024-02-29"],
    ["MERCOLEDÌ", "2026-09-16"],
  ])("resolves %s without mistaking its numbers for money", (expression, date) => {
    expect(parseMessage(`${expression} spesa 12€`, { now, timeZone: "Europe/Rome" })).toMatchObject({ amount: 12, date });
    expect(parseMessage(`12€ spesa ${expression}`, { now, timeZone: "Europe/Rome" })).toMatchObject({ amount: 12, date });
    expect(parseMessage(expression, { now }).amount).toBeNull();
  });

  it.each([
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
  ])("recognizes the Italian month %s", (month) => {
    const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    expect(parseMessage(`10 ${month} 2026 spesa 12`, { now }).date).toBe(`2026-${String(months.indexOf(month) + 1).padStart(2, "0")}-10`);
  });

  it.each([
    "31/02/2026", "29/02", "29 febbraio 2026", "2026-02-29", "31 aprile",
    "00/09", "10/00", "10/13", "32/09", "10/09-2026", "10/09/202", "2026-13-10",
    "10/09/0000", "10000-09-10", "999999999999999999 giorni fa", "-2 giorni fa",
    "oggi ieri", "10/09 11/09", "mercoledì 10 settembre 2026",
  ])("rejects impossible, malformed or ambiguous dates: %s", (expression) => {
    expect(parseMessage(`${expression} spesa 12€`, { now })).toMatchObject({ date: null, amount: 12 });
  });

  it.each([
    ["2026-01-01T12:00:00Z", "ieri", "2025-12-31"],
    ["2026-01-01T12:00:00Z", "31/12", "2026-12-31"],
    ["2026-01-01T12:00:00Z", "mercoledì", "2025-12-31"],
    ["2024-03-01T12:00:00Z", "ieri", "2024-02-29"],
    ["2026-03-30T00:30:00Z", "ieri", "2026-03-29"],
    ["2026-03-30T00:30:00Z", "2 giorni fa", "2026-03-28"],
    ["2026-10-26T00:30:00Z", "ieri", "2026-10-25"],
  ])("uses calendar days across year/leap/DST boundaries %#", (reference, expression, date) => {
    expect(parseMessage(`${expression} spesa 12`, { now: new Date(reference), timeZone: "Europe/Rome" }).date).toBe(date);
  });

  it("uses the configured timezone instead of the host timezone", () => {
    const reference = new Date("2026-09-18T22:30:00Z");
    expect(parseMessage("oggi 12", { now: reference, timeZone: "Europe/Rome" }).date).toBe("2026-09-19");
    expect(parseMessage("oggi 12", { now: reference, timeZone: "America/New_York" }).date).toBe("2026-09-18");
    expect(parseMessage("sabato 12", { now: reference, timeZone: "Europe/Rome" }).date).toBe("2026-09-19");
    expect(parseMessage("sabato 12", { now: reference, timeZone: "America/New_York" }).date).toBe("2026-09-12");
  });
});

describe("amounts and accounts", () => {
  it.each(["12", "12€", "12 €", "€12", "€ 12", "12 eur", "EUR 12", "12EUR", "12,00", "12.00"])("accepts %s", (amount) => {
    expect(parseMessage(`spesa ${amount}`, { now }).amount).toBe(12);
  });
  it.each(["0", "-12", "−12", "+12", "12,345", "1.234,56", "10000000", "12 34", "12abc", "abc12", "1,2,3"])("does not invent amounts from %s", (amount) => {
    expect(parseMessage(`spesa ${amount}`, { now }).amount).toBeNull();
  });
  it("preserves cents and supports amounts before the date", () => {
    expect(parseMessage("0,01€ spesa 10 settembre 2026", { now }).amount).toBe(0.01);
    expect(parseMessage("34€ mercoledì barbiere isybank", { now })).toMatchObject({ amount: 34, date: "2026-09-16", account: "isybank" });
  });
  it.each(["isybank", "ISYBANK", "isy", "isy bank"])("recognizes alias %s", (account) => {
    expect(parseMessage(`12 ${account}`, { now, defaultAccount: "revolut" }).account).toBe("isybank");
  });
  it("honors the configured default and an explicit override", () => {
    expect(parseMessage("12 spesa", { now, defaultAccount: "isybank" }).account).toBe("isybank");
    expect(parseMessage("12 spesa revolut", { now, defaultAccount: "isybank" }).account).toBe("revolut");
    expect(parseMessage("12 spesa isybanker", { now, defaultAccount: "revolut" }).account).toBe("revolut");
    expect(parseMessage("12 revolut isybank", { now }).account).toBeNull();
  });
});


describe("cash account aliases", () => {
  it.each(["contanti", "cash", "in contanti", "liquidi", "CONTANTI", "Cash"])("recognizes %s", alias => {
    expect(parseMessage(`ieri 12 pranzo ${alias}`, { now })).toMatchObject({ account: "contanti", amount: 12, date: "2026-09-17", type: null });
  });
  it.each(["cashback", "contantissimo", "liquidità", "cash_foo"])("does not match substrings in %s", alias => {
    expect(parseMessage(`12 pranzo ${alias}`, { now }).account).toBe("revolut");
  });
  it.each(["contanti revolut", "isybank cash", "cash contanti revolut"])("rejects multiple distinct accounts in %s", accounts => {
    expect(parseMessage(`12 pranzo ${accounts}`, { now }).account).toBeNull();
  });
  it("deduplicates aliases of the same account and supports Contanti as default", () => {
    expect(parseMessage("12 pranzo contanti cash liquidi", { now }).account).toBe("contanti");
    expect(parseMessage("12 pranzo", { now, defaultAccount: "contanti" }).account).toBe("contanti");
    expect(parseMessage("12 pranzo isybank", { now, defaultAccount: "contanti" }).account).toBe("isybank");
  });
});

// Calendar dates are local accounting days; timestamps remain instants in UTC.
describe("Rome midnight and DST boundaries", () => {
  it.each([
    ["2026-07-09T21:59:59Z", "2026-07-09"],
    ["2026-07-09T22:00:00Z", "2026-07-10"],
    ["2026-01-09T22:59:59Z", "2026-01-09"],
    ["2026-01-09T23:00:00Z", "2026-01-10"],
    ["2026-03-28T23:30:00Z", "2026-03-29"],
    ["2026-03-29T00:59:59Z", "2026-03-29"],
    ["2026-03-29T01:00:00Z", "2026-03-29"],
    ["2026-10-25T00:30:00Z", "2026-10-25"],
    ["2026-10-25T01:30:00Z", "2026-10-25"],
  ])("uses the local day at %s", (instant, expected) => {
    expect(parseMessage("12 pranzo oggi", { now: new Date(instant), timeZone: "Europe/Rome" }).date).toBe(expected);
    expect(parseMessage("12 pranzo", { now: new Date(instant), timeZone: "Europe/Rome" }).date).toBe(expected);
  });
  it.each([
    ["2026-10-09T17:08:00Z", "19:08"],
    ["2026-01-09T17:08:00Z", "18:08"],
    ["2026-03-29T00:59:00Z", "01:59"],
    ["2026-03-29T01:00:00Z", "03:00"],
    ["2026-10-25T00:30:00Z", "02:30"],
    ["2026-10-25T01:30:00Z", "02:30"],
  ])("interprets UTC timestamp %s without changing the stored instant", (instant, display) => {
    const date = new Date(instant);
    expect(new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(date)).toBe(display);
    expect(date.toISOString()).toBe(instant.replace("Z", ".000Z"));
  });
});
