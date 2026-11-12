import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Movements } from "../src/features/dashboard/Movements";
import type { Balance, Movement } from "../src/features/dashboard/dashboard-model";

const isy = "00000000-0000-4000-8000-000000000010";
const rev = "00000000-0000-4000-8000-000000000011";
const accounts: Balance[] = [
  { id: isy, name: "Isybank", active: true, status: "configured", cents: 0n },
  { id: rev, name: "Revolut", active: true, status: "configured", cents: 0n },
];
const base = { date: "2026-11-02", voided: false };
const entries: Movement[] = [
  { ...base, id: "3", type: "transfer", cents: 500n, category: null, from: isy, to: rev },
  { ...base, id: "2", type: "expense", cents: 300n, category: "food", from: rev, to: null },
  { ...base, id: "1", type: "expense", cents: 100n, category: "groceries", from: isy, to: null },
];
const counter = () => screen.getByText(/^\d+ moviment[oi]$/).textContent;

describe("filtri della tabella movimenti", () => {
  it("elenca solo le categorie presenti, con il numero di movimenti", () => {
    render(<Movements entries={entries} accounts={accounts} />);
    const select = screen.getByLabelText("Filtra per categoria");
    expect([...select.querySelectorAll("option")].map(o => o.textContent)).toEqual(["Tutte le categorie", "Cibo (1)", "Spesa (1)"]);
    expect(counter()).toBe("3 movimenti");
  });

  it("il filtro conto vale per entrambi i lati di un trasferimento", () => {
    render(<Movements entries={entries} accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Filtra per conto"), { target: { value: rev } });
    expect(counter()).toBe("2 movimenti");
  });

  it("combina conto, categoria e tipo, e Azzera filtri li riporta a Tutti", () => {
    render(<Movements entries={entries} accounts={accounts} />);
    expect(screen.queryByRole("button", { name: "Azzera filtri" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Filtra per categoria"), { target: { value: "food" } });
    expect(counter()).toBe("1 movimento");
    fireEvent.change(screen.getByLabelText("Filtra per conto"), { target: { value: isy } });
    expect(counter()).toBe("0 movimenti");
    fireEvent.click(screen.getByRole("button", { name: "Azzera filtri" }));
    expect(counter()).toBe("3 movimenti");
    expect(screen.queryByRole("button", { name: "Azzera filtri" })).toBeNull();
  });

  it("torna su Tutte le categorie se la categoria scelta non esiste più", () => {
    const { rerender } = render(<Movements entries={entries} accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Filtra per categoria"), { target: { value: "food" } });
    rerender(<Movements entries={entries.filter(e => e.category !== "food")} accounts={accounts} />);
    expect((screen.getByLabelText("Filtra per categoria") as HTMLSelectElement).value).toBe("all");
    expect(counter()).toBe("2 movimenti");
  });
});
