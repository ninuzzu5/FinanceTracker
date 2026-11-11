import { describe, expect, it } from "vitest";
import { categoryStyle } from "../src/features/dashboard/category-colors";

describe("categoryStyle(): colore stabile per categoria", () => {
  it("assegna sempre lo stesso colore alla stessa categoria", () => {
    expect(categoryStyle("food")).toEqual(categoryStyle("food"));
    expect(categoryStyle("groceries").color).not.toBe(categoryStyle("food").color);
  });

  it("usa una trama (hatched) quando la tavolozza non basta a distinguere tutte le categorie", () => {
    const styles = new Map<string, { color: string; hatched: boolean }[]>();
    for (const category of ["groceries", "public_transport", "flights", "tobacco", "sport", "leisure", "food", "rent",
      "personal_care", "gifts", "subscriptions", "holidays", "unexpected", null]) {
      const style = categoryStyle(category);
      styles.set(style.color, [...(styles.get(style.color) ?? []), style]);
    }
    // Ogni colore ripetuto ha al più una versione non trattata e il resto trattato,
    // così due categorie con lo stesso colore non sono mai identiche a vista.
    for (const entries of styles.values()) {
      expect(entries.filter(e => !e.hatched).length).toBeLessThanOrEqual(1);
    }
    expect([...styles.values()].some(entries => entries.length > 1)).toBe(true);
  });

  it("una categoria sconosciuta riceve comunque un colore valido", () => {
    expect(categoryStyle("mai-vista").color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
