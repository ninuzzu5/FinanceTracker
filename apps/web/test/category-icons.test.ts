import { describe, expect, it } from "vitest";
import { expenseCategoryIds, incomeCategoryIds } from "@finance-tracker/domain";
import { cashIcon, categoryIcon, otherIcon, transferIcon } from "../src/features/dashboard/category-icons";

const allCategoryIds = [...new Set([...expenseCategoryIds, ...incomeCategoryIds])];

describe("categoryIcon()", () => {
  it("ha un'icona dedicata per ciascuna delle 15 categorie del dominio", () => {
    for (const id of allCategoryIds) {
      expect(categoryIcon(id)).not.toBe(otherIcon);
    }
  });

  it("usa l'icona 'altre categorie' per un identificatore sconosciuto o assente", () => {
    expect(categoryIcon(null)).toBe(otherIcon);
    expect(categoryIcon("non_esiste")).toBe(otherIcon);
  });

  it("ha icone distinte per Contanti e Trasferimento, separate dalle categorie", () => {
    expect(cashIcon).not.toBe(otherIcon);
    expect(transferIcon).not.toBe(otherIcon);
    expect(cashIcon).not.toBe(transferIcon);
  });
});
