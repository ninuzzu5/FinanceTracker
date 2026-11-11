import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import { AuthProvider } from "../src/auth/AuthProvider";
import { App } from "../src/App";

// jsdom non implementa <dialog>.showModal()/close(): un minimo polyfill (solo per i test)
// che replica l'effetto osservabile usato da DetailDialog (attributo "open" + evento "close").
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const user = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.invalid" } as User;
const session = (): Session => ({ access_token: "synthetic-token", refresh_token: "synthetic-refresh",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user });
// Le finestre di dettaglio restano nel DOM anche chiuse (<dialog> senza l'attributo "open"):
// le query di testo più generiche la escludono esplicitamente, restando sul contenuto a schermo.
const onlyVisible = { ignore: "dialog:not([open]) *" } as const;

function mockClient() {
  const verifiedFactor = { id: "synthetic-totp", factor_type: "totp", status: "verified", friendly_name: "Authenticator" };
  const auth = {
    mfa: {
      getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }),
      listFactors: () => Promise.resolve({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null }),
    },
    getSession: () => Promise.resolve({ data: { session: session() }, error: null }),
    getUser: () => Promise.resolve({ data: { user }, error: null }),
    signOut: () => Promise.resolve({ error: null }),
    onAuthStateChange: (_listener: (event: AuthChangeEvent, session: Session | null) => void) =>
      ({ data: { subscription: { unsubscribe: () => {} } } }),
  };
  type ReadRpc = (name: string, args: Record<string, unknown>) => { data: unknown[]; count: number; status: number; error: { code: string } | null };
  let impl: ReadRpc = () => ({ data: [], count: 0, status: 200, error: null });
  const rpc = (name: string, args: Record<string, unknown>, _options: { get: boolean; count?: string }) =>
    ({ abortSignal: (_signal: AbortSignal) => Promise.resolve(impl(name, args)) });
  return { auth, rpc, client: { auth, rpc } as unknown as SupabaseClient, setImpl: (next: ReadRpc) => { impl = next; } };
}

function mount(client: SupabaseClient) {
  return render(<StrictMode><AuthProvider client={client} webUserId={user.id}><App /></AuthProvider></StrictMode>);
}

const bank = "00000000-0000-4000-8000-000000000010";
const cash = "00000000-0000-4000-8000-000000000011";
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const ok = (data: unknown[]) => ({ data, count: data.length, status: 200, error: null });
const balanceRow = (date: unknown) => ({ account_id: bank, account_name: "Conto di verifica",
  is_active: true, as_of_date: date, status: "configured", balance: "-20.12", currency: "EUR" });

describe("finestre di dettaglio della dashboard", () => {
  function withData(client: ReturnType<typeof mockClient>) {
    client.setImpl((name, args) => {
      if (name === "get_dashboard_balances") return ok([balanceRow(args.p_as_of),
        { ...balanceRow(args.p_as_of), account_id: cash, account_name: "Contanti di verifica", balance: "5.00" }]);
      if (args.p_before_id) return ok([]);
      const base = { transaction_date: args.p_from, voided: false };
      return ok([
        { ...base, id: id(4), type: "income", amount: "100.00", category: "salary", from_account_id: null, to_account_id: bank },
        { ...base, id: id(3), type: "transfer", amount: "5.00", category: null, from_account_id: bank, to_account_id: cash },
        { ...base, id: id(2), type: "expense", amount: "30.00", category: "groceries", from_account_id: bank, to_account_id: null },
        { ...base, id: id(1), type: "expense", amount: "10.00", category: "food", from_account_id: bank, to_account_id: null },
      ]);
    });
  }

  it("la finestra Saldo complessivo elenca i conti e il totale, il click sullo sfondo la chiude e restituisce il focus", async () => {
    const mock = mockClient();
    withData(mock);
    mount(mock.client);
    const trigger = await screen.findByRole("button", { name: /Saldo complessivo/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Conto di verifica");
    expect(dialog.textContent).toContain("Contanti di verifica");
    expect(dialog.textContent).toContain("Totale");
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("la finestra Uscite mostra la scomposizione per categoria e i movimenti", async () => {
    const mock = mockClient();
    withData(mock);
    mount(mock.client);
    const summary = await screen.findByRole("region", { name: "Riepilogo finanziario" });
    fireEvent.click(within(summary).getByRole("button", { name: /^Uscite/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Spesa");
    expect(dialog.textContent).toContain("Cibo");
    expect(dialog.textContent).toMatch(/30,00\s€.*75%/s);
    expect(dialog.textContent).toMatch(/10,00\s€.*25%/s);
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("la finestra di un conto mostra il trasferimento dal suo punto di vista, con segno e controparte", async () => {
    const mock = mockClient();
    withData(mock);
    mount(mock.client);
    fireEvent.click(await screen.findByRole("button", { name: /^Contanti di verifica/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Trasferimento");
    expect(dialog.textContent).toContain("Conto di verifica");
    expect(dialog.textContent).toMatch(/\+5,00\s€/);
    expect(screen.queryByText("Nessun movimento nel periodo.", onlyVisible)).toBeNull();
  });

  it("non mostra categorie nella finestra Entrate se il periodo non ha entrate", async () => {
    const mock = mockClient();
    mock.setImpl((name, args) => name === "get_dashboard_balances" ? ok([balanceRow(args.p_as_of)]) : ok([]));
    mount(mock.client);
    const summary = await screen.findByRole("region", { name: "Riepilogo finanziario" });
    fireEvent.click(within(summary).getByRole("button", { name: /^Entrate/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/0,00\s€/);
    expect(dialog.textContent).toContain("Nessun movimento nel periodo.");
  });
});
