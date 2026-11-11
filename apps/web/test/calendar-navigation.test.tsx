import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { AuthProvider } from "../src/auth/AuthProvider";
import { App } from "../src/App";
import { todayInRome } from "../src/features/dashboard/dashboard-model";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const user = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.invalid" } as User;
const session = (): Session => ({ access_token: "t", refresh_token: "r", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user });
const bank = "00000000-0000-4000-8000-000000000010";
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const ok = (data: unknown[]) => ({ data, count: data.length, status: 200, error: null });
const balanceRow = (date: unknown) => ({ account_id: bank, account_name: "Conto di verifica",
  is_active: true, as_of_date: date, status: "configured", balance: "10.00", currency: "EUR" });

function mockClient() {
  const verifiedFactor = { id: "x", factor_type: "totp", status: "verified", friendly_name: "A" };
  const auth = {
    mfa: {
      getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }),
      listFactors: () => Promise.resolve({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null }),
    },
    getSession: () => Promise.resolve({ data: { session: session() }, error: null }),
    getUser: () => Promise.resolve({ data: { user }, error: null }),
    signOut: () => Promise.resolve({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  };
  // Un solo movimento, il giorno 5 del mese richiesto: l'importo dipende dal mese, così si
  // distingue facilmente quale richiesta ha risposto cosa.
  const readRpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === "get_dashboard_balances") return ok([balanceRow(args.p_as_of)]);
    if (args.p_before_id) return ok([]);
    const from = String(args.p_from);
    const month = from.slice(5, 7);
    const day = `${from.slice(0, 8)}05`;
    if (day < from || day > String(args.p_to)) return ok([]);
    return ok([{ id: id(Number(month)), transaction_date: day, type: "expense", amount: `${Number(month)}.00`,
      category: "food", from_account_id: bank, to_account_id: null, voided: false }]);
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>, _options: { get: boolean; count?: string }) =>
    ({ abortSignal: (_signal: AbortSignal) => Promise.resolve(readRpc(name, args)) }));
  return { auth, rpc, readRpc, client: { auth, rpc } as unknown as SupabaseClient };
}

function mount(client: SupabaseClient) {
  return render(<StrictMode><AuthProvider client={client} webUserId={user.id}><App /></AuthProvider></StrictMode>);
}

describe("calendario navigabile", () => {
  it("compare anche nella vista Giorno, non solo a Mese", async () => {
    const mock = mockClient();
    mount(mock.client);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Giorno" }));
    await screen.findByRole("heading", { name: "Calendario del mese" });
  });

  it("il mese successivo del calendario è disabilitato quando si è già al mese corrente", async () => {
    const mock = mockClient();
    mount(mock.client);
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Mese del calendario successivo" })).toHaveProperty("disabled", true);
  });

  it("il click su un giorno con spesa apre la finestra di quel giorno", async () => {
    const mock = mockClient();
    mount(mock.client);
    await screen.findByRole("table");
    const currentMonth = Number(todayInRome().slice(5, 7));
    const calendar = await screen.findByRole("list", { name: "Spese giorno per giorno" });
    const cell = within(calendar).getByRole("button", { name: new RegExp(`${currentMonth},00`) });
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Cibo");
  });

  it("naviga ai mesi precedenti richiedendoli, e torna a quelli già visti senza richiederli di nuovo", async () => {
    const mock = mockClient();
    mount(mock.client);
    await screen.findByRole("table");
    const callsBefore = mock.readRpc.mock.calls.filter(c => c[0] === "get_dashboard_movements").length;
    fireEvent.click(screen.getByRole("button", { name: "Mese del calendario precedente" }));
    await waitFor(() => expect(mock.readRpc.mock.calls.filter(c => c[0] === "get_dashboard_movements").length).toBeGreaterThan(callsBefore));
    await screen.findByRole("list", { name: "Spese giorno per giorno" });
    const callsAfterPrev = mock.readRpc.mock.calls.filter(c => c[0] === "get_dashboard_movements").length;
    fireEvent.click(screen.getByRole("button", { name: "Mese del calendario successivo" }));
    // Il mese di partenza è già in cache: nessuna nuova richiesta.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mock.readRpc.mock.calls.filter(c => c[0] === "get_dashboard_movements").length).toBe(callsAfterPrev);
  });
});
