import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadDashboard } from "../src/features/dashboard/dashboard-data";
import { dashboardPeriod, money, parseCents, todayInRome } from "../src/features/dashboard/dashboard-model";

const period = dashboardPeriod("2026-10", "2026-11-08");
const id = "00000000-0000-4000-8000-000000000001";
const row = { id, transaction_date: "2026-10-31", type: "income", amount: "0.01", category: "salary",
  from_account_id: null, to_account_id: id, voided: false, ledger_version: 1 };
const json = (data: unknown[], range?: string) => new Response(JSON.stringify(data), {
  headers: { "Content-Type": "application/json", ...(range ? { "Content-Range": range } : {}) },
});

function fakeDataApi(handler: (url: URL) => Response) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    handler(new URL(input instanceof Request ? input.url : input)));
  const client = createClient("https://example.invalid", "test-publishable-key", {
    accessToken: async () => "test-access-token",
    global: { fetch },
  });
  return { client, fetch };
}

describe("contratto Data API", () => {
  it("usa GET autenticati e omette il cursore iniziale, continuando dopo una pagina corta", async () => {
    const { client, fetch } = fakeDataApi(url => {
      if (url.pathname.endsWith("/get_dashboard_balances")) return json([], "*/0");
      return json(url.searchParams.has("p_before_id") ? [] : [row]);
    });
    const signal = new AbortController().signal;
    const result = await loadDashboard(client, period, signal);
    expect(result.entries[0]?.cents).toBe(1n);
    const pages = fetch.mock.calls.filter(([url]) => String(url).includes("/get_dashboard_movements"));
    expect(pages).toHaveLength(2);
    expect(Object.fromEntries(new URL(String(pages[0][0])).searchParams)).toEqual({
      p_from: "2026-10-01", p_to: "2026-10-31", p_limit: "50",
    });
    expect(new URL(String(pages[1][0])).searchParams.get("p_before_date")).toBe("2026-10-31");
    expect(new URL(String(pages[1][0])).searchParams.get("p_before_id")).toBe(id);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(init?.signal).toBe(signal);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-access-token");
    }
  });

  it("rifiuta una pagina ripetuta e non restituisce dati parziali", async () => {
    const { client } = fakeDataApi(url => url.pathname.endsWith("/get_dashboard_balances") ? json([], "*/0") : json([row]));
    await expect(loadDashboard(client, period, new AbortController().signal)).rejects.toThrow("Risposta contabile non valida");
  });

  it("rifiuta saldi troncati dalla Data API", async () => {
    const { client } = fakeDataApi(url => url.pathname.endsWith("/get_dashboard_balances") ? json([], "*/2") : json([]));
    await expect(loadDashboard(client, period, new AbortController().signal)).rejects.toThrow("Risposta contabile non valida");
  });
});

describe("date e importi del ledger", () => {
  it("usa la data civile di Roma e rispetta il termine del mese selezionato", () => {
    const today = todayInRome(new Date("2026-10-31T23:30:00Z"));
    expect(today).toBe("2026-11-01");
    expect(dashboardPeriod("2026-11", today).to).toBe(today);
    expect(dashboardPeriod("2024-02", today).to).toBe("2024-02-29");
  });

  it("mantiene i centesimi oltre la precisione di Number e conserva il segno", () => {
    expect(parseCents("90071992547409.93") + parseCents("0.01")).toBe(9007199254740994n);
    expect(money(9007199254740994n)).toMatch(/^90\.071\.992\.547\.409,94\s€/);
    expect(money(-1n)).toMatch(/^-0,01\s€/);
    expect(() => parseCents("0.001")).toThrow("Importo non valido");
  });
});
