import { describe, expect, it } from "vitest";
import { dashboardPeriod, shiftPeriod, statistics, type Movement } from "../src/features/dashboard/dashboard-model";

function movement(overrides: Partial<Movement> & { id: string }): Movement {
  return { date: "2026-11-01", type: "expense", cents: 100n, category: "food", from: null, to: null, voided: false, ...overrides };
}

describe("confini di mese e anno", () => {
  it("gestisce il passaggio di anno nello spostamento mensile", () => {
    expect(shiftPeriod("month", "2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftPeriod("month", "2026-01-01", -1)).toBe("2025-12-01");
  });

  it("chiude febbraio al 28 o al 29 in base all'anno bisestile", () => {
    expect(dashboardPeriod("month", "2026-02-10", "2026-03-01").to).toBe("2026-02-28");
    expect(dashboardPeriod("month", "2024-02-10", "2024-03-01").to).toBe("2024-02-29");
  });

  it("calcola l'anno intero e lo spostamento di anno", () => {
    expect(shiftPeriod("year", "2026-01-01", 1)).toBe("2027-01-01");
    expect(shiftPeriod("year", "2026-01-01", -1)).toBe("2025-01-01");
    expect(dashboardPeriod("year", "2025-06-15", "2026-11-09")).toMatchObject({ from: "2025-01-01", to: "2025-12-31", current: false });
    expect(dashboardPeriod("year", "2026-06-15", "2026-11-09")).toMatchObject({ from: "2026-01-01", to: "2026-11-09", current: true });
  });
});

describe("settimana ISO (lunedì-domenica)", () => {
  it("inizia di lunedì qualunque sia il giorno dell'ancora", () => {
    expect(dashboardPeriod("week", "2026-11-09", "2026-11-09")).toMatchObject({ from: "2026-11-09" }); // lunedì
    expect(dashboardPeriod("week", "2026-11-08", "2026-11-09")).toMatchObject({ from: "2026-11-02", to: "2026-11-08" }); // domenica -> settimana precedente
  });

  it("attraversa il cambio d'anno restando nella stessa settimana", () => {
    // 2026-01-01 è giovedì; la settimana ISO è 2025-12-29 (lun) - 2026-01-04 (dom).
    expect(dashboardPeriod("week", "2026-01-01", "2026-01-10")).toMatchObject({ from: "2025-12-29", to: "2026-01-04" });
    expect(shiftPeriod("week", "2025-12-29", 1)).toBe("2026-01-05");
  });
});

describe("statistics(): bucket giorno/mese", () => {
  it("usa un bucket per giorno nelle viste Giorno/Settimana/Mese e copre l'intero periodo", () => {
    const period = dashboardPeriod("month", "2026-02-10", "2026-03-01"); // febbraio 2026, non bisestile
    const totals = statistics([], period);
    expect(totals.buckets).toHaveLength(28);
    expect(totals.buckets[0].date).toBe("2026-02-01");
    expect(totals.buckets[27].date).toBe("2026-02-28");
  });

  it("usa un bucket per mese nella vista Anno e copre l'intero periodo", () => {
    const period = dashboardPeriod("year", "2025-06-15", "2026-11-09"); // anno 2025, già concluso
    const totals = statistics([], period);
    expect(totals.buckets).toHaveLength(12);
    expect(totals.buckets[0].date).toBe("2025-01-01");
    expect(totals.buckets[11].date).toBe("2025-12-01");
  });

  it("assegna entrate e uscite al bucket giusto, escludendo trasferimenti e movimenti annullati", () => {
    const period = dashboardPeriod("month", "2026-11-05", "2026-11-09");
    const movements = [
      movement({ id: "1", date: "2026-11-01", type: "expense", cents: 500n, category: "food" }),
      movement({ id: "2", date: "2026-11-01", type: "income", cents: 1000n, category: "salary" }),
      movement({ id: "3", date: "2026-11-02", type: "expense", cents: 300n, category: "food" }),
      movement({ id: "4", date: "2026-11-02", type: "transfer", cents: 9999n, category: null }),
      movement({ id: "5", date: "2026-11-03", type: "expense", cents: 700n, category: "rent", voided: true }),
    ];
    const totals = statistics(movements, period);
    expect(totals.income).toBe(1000n);
    expect(totals.expenses).toBe(800n);
    expect(totals.buckets.find(b => b.date === "2026-11-01")).toMatchObject({ income: 1000n, expenses: 500n });
    expect(totals.buckets.find(b => b.date === "2026-11-02")).toMatchObject({ income: 0n, expenses: 300n });
    expect(totals.buckets.find(b => b.date === "2026-11-03")).toMatchObject({ income: 0n, expenses: 0n });
    expect(totals.categories).toEqual([["food", 800n]]);
  });

  it("si riduce a un solo bucket nella vista Giorno", () => {
    const period = dashboardPeriod("day", "2026-11-09", "2026-11-09");
    const totals = statistics([movement({ id: "1", date: "2026-11-09", cents: 250n })], period);
    expect(totals.buckets).toHaveLength(1);
    expect(totals.expenses).toBe(250n);
  });
});

describe("robustezza all'ora legale Europe/Rome", () => {
  it("non salta né duplica giorni attraversando l'inizio dell'ora legale (29 marzo 2026)", () => {
    expect(shiftPeriod("day", "2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftPeriod("day", "2026-03-28", 2)).toBe("2026-03-30");
    expect(dashboardPeriod("week", "2026-03-29", "2026-04-05")).toMatchObject({ from: "2026-03-23", to: "2026-03-29" });
  });

  it("non salta né duplica giorni attraversando la fine dell'ora legale (25 ottobre 2026)", () => {
    expect(shiftPeriod("day", "2026-10-24", 1)).toBe("2026-10-25");
    expect(shiftPeriod("day", "2026-10-24", 2)).toBe("2026-10-26");
    expect(dashboardPeriod("week", "2026-10-25", "2026-11-01")).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
  });
});
