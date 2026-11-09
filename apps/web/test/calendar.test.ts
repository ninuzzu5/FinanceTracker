import { describe, expect, it } from "vitest";
import { intensity, weekdayIndex } from "../src/features/dashboard/Calendar";

describe("weekdayIndex(): lunedì = 0", () => {
  it("mappa tutti i giorni della settimana", () => {
    expect(weekdayIndex("2026-11-09")).toBe(0); // lunedì
    expect(weekdayIndex("2026-11-10")).toBe(1); // martedì
    expect(weekdayIndex("2026-11-15")).toBe(6); // domenica
  });
});

describe("intensity(): 4 gradi sui soli giorni con spesa", () => {
  it("non colora i giorni senza spesa", () => {
    expect(intensity(0n, [0n, 100n])).toBeUndefined();
  });

  it("assegna il rosso più intenso al giorno più caro e il più chiaro al meno caro", () => {
    const days = [10n, 20n, 30n, 40n, 50n, 60n, 70n]; // 7 giorni con spesa
    expect(intensity(70n, days)).toBe("#E63946"); // rango 0 -> rosso
    expect(intensity(10n, days)).toBe("#FFF3B0"); // ultimo rango -> il più chiaro
  });

  it("con un solo giorno con spesa lo colora con il grado più intenso", () => {
    expect(intensity(42n, [42n])).toBe("#E63946");
  });
});
