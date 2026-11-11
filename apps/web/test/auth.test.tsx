import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import { AuthProvider } from "../src/auth/AuthProvider";
import { App } from "../src/App";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.invalid" } as User;
const session = (): Session => ({ access_token: "synthetic-token", refresh_token: "synthetic-refresh",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
// Le finestre di dettaglio restano nel DOM anche chiuse (<dialog> senza l'attributo "open"),
// per questo possono duplicare un testo già visibile nella pagina: le query di testo più
// generiche la escludono esplicitamente, restando sul contenuto davvero a schermo.
const onlyVisible = { ignore: "dialog:not([open]) *" } as const;
function mockClient(initial: Session | null = null) {
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const unsubscribe = vi.fn();
  const verifiedFactor = { id: "synthetic-totp", factor_type: "totp", status: "verified", friendly_name: "Authenticator" };
  const auth = {
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }),
      listFactors: vi.fn().mockResolvedValue({ data: { all: [verifiedFactor], totp: [verifiedFactor] }, error: null }),
      enroll: vi.fn().mockResolvedValue({ data: { id: "new-totp", type: "totp", totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>', secret: "synthetic-secret" } }, error: null }),
      challengeAndVerify: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
    getSession: vi.fn().mockResolvedValue({ data: { session: initial }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: session(), user }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn((listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => { unsubscribe(); listeners.delete(listener); } } } };
    }),
  };
  const readRpc = vi.fn((_name: string, _args: Record<string, unknown>, _signal: AbortSignal): unknown =>
    ({ data: [], count: 0, status: 200, error: null }));
  const rpc = vi.fn((name: string, args: Record<string, unknown>, _options: { get: boolean; count?: string }) =>
    ({ abortSignal: (signal: AbortSignal) => Promise.resolve(readRpc(name, args, signal)) }));
  return { auth, rpc, readRpc, client: { auth, rpc } as unknown as SupabaseClient, unsubscribe,
    emit: (event: AuthChangeEvent, value: Session | null) => act(() => { for (const listener of listeners) listener(event, value); }),
  };
}
function mount(client: SupabaseClient | null) {
  return render(<StrictMode><AuthProvider client={client} webUserId={user.id}><App /></AuthProvider></StrictMode>);
}
async function loginForm() {
  await screen.findByRole("button", { name: "Accedi" });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "synthetic-password" } });
  return screen.getByRole("button", { name: "Accedi" }).closest("form")!;
}
const dashboard = () => screen.queryByRole("heading", { name: "Panoramica" });

describe("web authentication", () => {
  it("redirects an unauthenticated visitor without showing the dashboard", async () => {
    const mock = mockClient();
    mount(mock.client);
    expect(dashboard()).toBeNull();
    await screen.findByRole("button", { name: "Accedi" });
    await waitFor(() => expect(window.location.pathname).toBe("/accesso"));
    expect(dashboard()).toBeNull();
    expect(mock.auth.getUser).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Password dimenticata/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("apre la dashboard vuota solo dopo avere verificato l’identità e aal2", async () => {
    const mock = mockClient();
    mount(mock.client);
    fireEvent.submit(await loginForm());
    await screen.findByRole("heading", { name: "Panoramica" });
    expect(mock.auth.signInWithPassword).toHaveBeenCalledWith({ email: "person@example.invalid", password: "synthetic-password" });
    expect(mock.auth.getUser).toHaveBeenCalledWith("synthetic-token");
    expect(window.location.pathname).toBe("/");
    await screen.findByText("Nessun dato disponibile per il periodo.");
    expect(mock.rpc).toHaveBeenCalledWith("get_dashboard_balances", { p_as_of: expect.any(String) }, { get: true, count: "exact" });
    expect(screen.queryByRole("heading", { name: "Saldo complessivo" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Dati di esempio")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates fields before sending credentials", async () => {
    const mock = mockClient();
    mount(mock.client);
    const form = await loginForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid" } });
    fireEvent.submit(form);
    expect(mock.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/Inserisci un indirizzo email valido/)).toBeTruthy();
  });

  it("blocks duplicate submissions, clears the password and reports failure safely", async () => {
    const mock = mockClient();
    const request = deferred<unknown>();
    mock.auth.signInWithPassword.mockReturnValue(request.promise);
    mount(mock.client);
    const form = await loginForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mock.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Password", { exact: true }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: /Accesso in corso/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { request.resolve({ data: { session: null }, error: { message: "private-auth-details" } }); });
    await screen.findByText(/Accesso non riuscito/);
    expect(screen.queryByText(/private-auth-details/)).toBeNull();
    expect(dashboard()).toBeNull();
    expect(window.location.pathname).toBe("/accesso");
    expect(localStorage.length).toBe(0);
  });

  it("restores a session after refresh only after remote user verification", async () => {
    const mock = mockClient(session());
    const request = deferred<unknown>();
    mock.auth.getUser.mockReturnValue(request.promise);
    mount(mock.client);
    await waitFor(() => expect(mock.auth.getUser).toHaveBeenCalled());
    expect(dashboard()).toBeNull();
    expect(screen.getByText("Verifica della sessione…")).toBeTruthy();
    await act(async () => { request.resolve({ data: { user }, error: null }); });
    await screen.findByRole("heading", { name: "Panoramica" });
  });

  it("rejects an unverified or revoked session", async () => {
    const mock = mockClient(session());
    mock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "revoked" } });
    mount(mock.client);
    await screen.findByText(/Sessione non valida o scaduta/);
    expect(dashboard()).toBeNull();
    expect(window.location.pathname).toBe("/accesso");
  });

  it("signs out locally and removes dashboard content before the request finishes", async () => {
    const mock = mockClient(session());
    const request = deferred<unknown>();
    mock.auth.signOut.mockReturnValue(request.promise);
    mount(mock.client);
    await screen.findByRole("heading", { name: "Panoramica" });
    fireEvent.click(screen.getAllByRole("button", { name: "Esci" })[0]);
    expect(dashboard()).toBeNull();
    expect(screen.queryByText("Saldo complessivo")).toBeNull();
    expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    await act(async () => { request.resolve({ error: null }); });
    await screen.findByRole("button", { name: "Accedi" });
    await waitFor(() => expect(window.location.pathname).toBe("/accesso"));
  });

  it("keeps content hidden and allows retry when signOut fails", async () => {
    const mock = mockClient(session());
    mock.auth.signOut.mockResolvedValueOnce({ error: { message: "private-error" } });
    mount(mock.client);
    await screen.findByRole("heading", { name: "Panoramica" });
    fireEvent.click(screen.getAllByRole("button", { name: "Esci" })[0]);
    const retry = await screen.findByRole("button", { name: "Riprova a uscire" });
    expect(dashboard()).toBeNull();
    mock.emit("SIGNED_IN", session());
    expect(dashboard()).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole("button", { name: "Accedi" });
  });

  it("shows a clear error and disables login when public configuration is missing", () => {
    mount(null);
    expect(screen.getByText(/Accesso non configurato/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Accedi" }) as HTMLButtonElement).disabled).toBe(true);
    expect(dashboard()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles session termination from another tab", async () => {
    const mock = mockClient(session());
    mount(mock.client);
    await screen.findByRole("heading", { name: "Panoramica" });
    mock.emit("SIGNED_OUT", null);
    await screen.findByRole("button", { name: "Accedi" });
    expect(dashboard()).toBeNull();
    expect(window.location.pathname).toBe("/accesso");
  });

  it("rechecks the session at token expiry even when no refresh event arrives", async () => {
    vi.useFakeTimers();
    const stored = session();
    stored.expires_at = Math.floor(Date.now() / 1000) + 2;
    const mock = mockClient(stored);
    mount(mock.client);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(dashboard()).toBeTruthy();
    mock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(dashboard()).toBeNull();
    expect(window.location.pathname).toBe("/accesso");
  });

  it("verifies refreshed tokens outside the Auth callback", async () => {
    const mock = mockClient(session());
    mount(mock.client);
    await screen.findByRole("heading", { name: "Panoramica" });
    mock.auth.getUser.mockClear();
    mock.emit("TOKEN_REFRESHED", { ...session(), access_token: "refreshed-synthetic" });
    expect(mock.auth.getUser).not.toHaveBeenCalled();
    expect(dashboard()).toBeNull();
    await screen.findByRole("heading", { name: "Panoramica" });
    expect(mock.auth.getUser).toHaveBeenCalledWith("refreshed-synthetic");
  });

  it("ignores a stale verification that finishes after SIGNED_OUT", async () => {
    const mock = mockClient(session());
    const request = deferred<unknown>();
    mock.auth.getUser.mockReturnValue(request.promise);
    mount(mock.client);
    await waitFor(() => expect(mock.auth.getUser).toHaveBeenCalled());
    mock.emit("SIGNED_OUT", null);
    await act(async () => { request.resolve({ data: { user }, error: null }); });
    expect(dashboard()).toBeNull();
    expect(window.location.pathname).toBe("/accesso");
  });

  it("does not redirect-loop for an authenticated visitor to /accesso and cleans subscriptions", async () => {
    window.history.replaceState(null, "", "/accesso");
    const mock = mockClient(session());
    const view = mount(mock.client);
    await screen.findByRole("heading", { name: "Panoramica" });
    expect(window.location.pathname).toBe("/");
    act(() => { window.history.replaceState(null, "", "/accesso"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(window.location.pathname).toBe("/");
    view.unmount();
    expect(mock.unsubscribe).toHaveBeenCalledTimes(mock.auth.onAuthStateChange.mock.calls.length);
  });
});

function requireMfa(mock: ReturnType<typeof mockClient>, enrolled = true) {
  mock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: enrolled ? "aal2" : "aal1" }, error: null });
  if (!enrolled) mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
}
async function enterCode(code = "123456") {
  const input = await screen.findByLabelText("Codice Authenticator");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest("form")!);
  return input as HTMLInputElement;
}

describe("MFA TOTP", () => {
  it("blocca aal1 e richiede Authenticator anche dopo il ripristino", async () => {
    const mock = mockClient(session());
    requireMfa(mock);
    const view = mount(mock.client);
    await screen.findByRole("heading", { name: "Verifica a due fattori" });
    expect(dashboard()).toBeNull();
    expect(mock.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledWith("synthetic-token");
    view.unmount();
    mount(mock.client);
    await screen.findByRole("heading", { name: "Verifica a due fattori" });
    expect(dashboard()).toBeNull();
    expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("richiede il secondo fattore dopo email e password", async () => {
    const mock = mockClient();
    requireMfa(mock);
    mount(mock.client);
    fireEvent.submit(await loginForm());
    await screen.findByRole("heading", { name: "Verifica a due fattori" });
    expect(dashboard()).toBeNull();
  });

  it("propone l’attivazione senza creare fattori automaticamente", async () => {
    const mock = mockClient(session());
    requireMfa(mock, false);
    mount(mock.client);
    await screen.findByRole("button", { name: "Genera QR per Authenticator" });
    expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
    expect(dashboard()).toBeNull();
  });

  it("genera un QR come immagine isolata e impedisce invii duplicati", async () => {
    const mock = mockClient(session());
    requireMfa(mock, false);
    const request = deferred<unknown>();
    mock.auth.mfa.enroll.mockReturnValue(request.promise);
    mount(mock.client);
    const button = await screen.findByRole("button", { name: "Genera QR per Authenticator" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mock.auth.mfa.enroll).toHaveBeenCalledTimes(1));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { request.resolve({ data: { id: "new-totp", type: "totp", totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } }, error: null }); });
    const image = await screen.findByRole("img", { name: "QR per configurare Authenticator" });
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(document.querySelector("svg[xmlns]")).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(dashboard()).toBeNull();
  });

  it("non considera aal2 senza TOTP verificato una configurazione completa", async () => {
    const mock = mockClient(session());
    mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
    mount(mock.client);
    await screen.findByRole("heading", { name: "Attiva Authenticator" });
    expect(dashboard()).toBeNull();
  });

  it("completa l’attivazione e ricontrolla aal2 prima della dashboard", async () => {
    const mock = mockClient(session());
    requireMfa(mock, false);
    mount(mock.client);
    fireEvent.click(await screen.findByRole("button", { name: "Genera QR per Authenticator" }));
    await screen.findByLabelText("Codice Authenticator");
    mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [{ id: "new-totp", factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    mock.auth.mfa.challengeAndVerify.mockImplementation(async () => {
      const factor = { id: "new-totp", factor_type: "totp", status: "verified" };
      mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [factor], totp: [factor] }, error: null });
      mock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
      return { data: {}, error: null };
    });
    await enterCode();
    await screen.findByRole("heading", { name: "Panoramica" });
    expect(mock.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "new-totp", code: "123456" });
    expect(screen.queryByRole("img", { name: "QR per configurare Authenticator" })).toBeNull();
  });

  it("rifiuta codici errati o scaduti senza mostrare dettagli e li svuota", async () => {
    const mock = mockClient(session());
    requireMfa(mock);
    mock.auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "private-code-details" } });
    mount(mock.client);
    const input = await enterCode();
    expect(input.value).toBe("");
    await screen.findByText(/Codice non valido o scaduto/);
    expect(screen.queryByText(/private-code-details/)).toBeNull();
    expect(dashboard()).toBeNull();
  });

  it("valida il formato del codice senza chiamare le API", async () => {
    const mock = mockClient(session());
    requireMfa(mock);
    mount(mock.client);
    await enterCode("abc");
    expect(screen.getByText(/Inserisci il codice di sei cifre/)).toBeTruthy();
    expect(mock.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("non autorizza il solo successo di challengeAndVerify se il token resta aal1", async () => {
    const mock = mockClient(session());
    requireMfa(mock);
    mount(mock.client);
    await enterCode();
    await waitFor(() => expect(mock.auth.mfa.getAuthenticatorAssuranceLevel.mock.calls.length).toBeGreaterThan(1));
    await screen.findByRole("heading", { name: "Verifica a due fattori" });
    expect(dashboard()).toBeNull();
  });

  it("completa la verifica di un fattore esistente senza nuova attivazione", async () => {
    const mock = mockClient(session());
    requireMfa(mock);
    mock.auth.mfa.challengeAndVerify.mockImplementation(async () => {
      mock.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
      mock.emit("MFA_CHALLENGE_VERIFIED", session());
      return { data: {}, error: null };
    });
    mount(mock.client);
    await enterCode();
    await screen.findByRole("heading", { name: "Panoramica" });
    expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("non consente attivazioni con un account diverso da quello web dedicato", async () => {
    const mock = mockClient(session());
    mock.auth.getUser.mockResolvedValue({ data: { user: { ...user, id: "other-synthetic-user" } }, error: null });
    const otherSession = { ...session(), user: { ...user, id: "other-synthetic-user" } };
    mock.auth.getSession.mockResolvedValue({ data: { session: otherSession }, error: null });
    mount(mock.client);
    await screen.findByText(/Account non abilitato/);
    expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
    expect(mock.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(mock.auth.signOut).not.toHaveBeenCalled();
  });

  it.each(["getAuthenticatorAssuranceLevel", "listFactors"] as const)("blocca il contenuto se %s fallisce e consente il retry", async method => {
    const mock = mockClient(session());
    mock.auth.mfa[method].mockResolvedValueOnce({ data: null, error: { message: "private-error" } });
    mount(mock.client);
    const button = await screen.findByRole("button", { name: "Riprova la verifica" });
    expect(dashboard()).toBeNull();
    fireEvent.click(button);
    await screen.findByRole("heading", { name: "Panoramica" });
  });

  it("dopo refresh riprende un fattore incompleto senza conservare il QR nello storage", async () => {
    const mock = mockClient(session());
    requireMfa(mock, false);
    mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [{ id: "pending-totp", factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    mount(mock.client);
    await screen.findByLabelText("Codice Authenticator");
    expect(screen.getByText(/È presente una configurazione incompleta/)).toBeTruthy();
    expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
    expect(dashboard()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("gestisce una sessione precedente all’attivazione e gli eventi concorrenti", async () => {
    const mock = mockClient(session());
    requireMfa(mock);
    const pending = deferred<unknown>();
    mock.auth.mfa.getAuthenticatorAssuranceLevel.mockReturnValueOnce(pending.promise);
    mount(mock.client);
    await waitFor(() => expect(mock.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalled());
    mock.emit("SIGNED_OUT", null);
    await act(async () => { pending.resolve({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }); });
    expect(dashboard()).toBeNull();
    expect(screen.getByRole("button", { name: "Accedi" })).toBeTruthy();
  });

  it("ignora un QR arrivato dopo il logout", async () => {
    const mock = mockClient(session());
    requireMfa(mock, false);
    const request = deferred<unknown>();
    mock.auth.mfa.enroll.mockReturnValue(request.promise);
    mount(mock.client);
    fireEvent.click(await screen.findByRole("button", { name: "Genera QR per Authenticator" }));
    await waitFor(() => expect(mock.auth.mfa.enroll).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Esci" }));
    await screen.findByRole("button", { name: "Accedi" });
    await act(async () => { request.resolve({ data: { id: "new-totp", type: "totp", totp: { qr_code: "<svg></svg>" } }, error: null }); });
    expect(screen.queryByRole("img", { name: "QR per configurare Authenticator" })).toBeNull();
    expect(dashboard()).toBeNull();
  });
});

it("impedisce verifiche TOTP duplicate e cancella subito il codice", async () => {
  const mock = mockClient(session());
  requireMfa(mock);
  const request = deferred<unknown>();
  mock.auth.mfa.challengeAndVerify.mockReturnValue(request.promise);
  mount(mock.client);
  const input = await enterCode();
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(mock.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1));
  expect(input.value).toBe("");
  expect((screen.getByRole("button", { name: "Verifica in corso…" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { request.resolve({ data: null, error: { message: "synthetic-error" } }); });
  await screen.findByText(/Codice non valido o scaduto/);
  expect(dashboard()).toBeNull();
});

it("nasconde gli errori imprevisti delle API MFA", async () => {
  const mock = mockClient(session());
  requireMfa(mock);
  mock.auth.mfa.challengeAndVerify.mockRejectedValue(new Error("private-api-details"));
  mount(mock.client);
  await enterCode();
  await screen.findByText(/Servizio di autenticazione non disponibile/);
  expect(screen.queryByText(/private-api-details/)).toBeNull();
  expect(dashboard()).toBeNull();
});

it("rifiuta un QR remoto o un URI non previsto", async () => {
  const mock = mockClient(session());
  requireMfa(mock, false);
  mock.auth.mfa.enroll.mockResolvedValue({ data: { id: "new-totp", type: "totp", totp: { qr_code: "https://untrusted.example.invalid/qr" } }, error: null });
  mount(mock.client);
  fireEvent.click(await screen.findByRole("button", { name: "Genera QR per Authenticator" }));
  await screen.findByText(/QR code non disponibile/);
  expect(screen.queryByRole("img", { name: "QR per configurare Authenticator" })).toBeNull();
});

it("ignora una verifica di identità iniziale che termina dopo SIGNED_OUT", async () => {
  const mock = mockClient(session());
  const pending = deferred<unknown>();
  mock.auth.getSession.mockReturnValue(pending.promise);
  mount(mock.client);
  mock.emit("SIGNED_OUT", null);
  await act(async () => { pending.resolve({ data: { session: session() }, error: null }); });
  expect(dashboard()).toBeNull();
  expect(mock.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
});

it("non riapre la dashboard se il login termina dopo un evento SIGNED_OUT", async () => {
  const mock = mockClient();
  const request = deferred<unknown>();
  mock.auth.signInWithPassword.mockReturnValue(request.promise);
  mount(mock.client);
  fireEvent.submit(await loginForm());
  mock.emit("SIGNED_OUT", null);
  mock.auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  mock.emit("SIGNED_IN", session());
  await act(async () => { request.resolve({ data: { session: session(), user }, error: null }); });
  await screen.findByRole("button", { name: "Accedi" });
  expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(mock.auth.getUser).not.toHaveBeenCalled();
  expect(dashboard()).toBeNull();
});

const svgWithDeclaration = '<?xml version="1.0"?>\n<!-- QR sintetico -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';
it.each([
  svgWithDeclaration,
  `data:image/svg+xml;utf-8,${svgWithDeclaration}`,
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgWithDeclaration)}`,
])("mostra il QR con dichiarazione XML nel formato SVG o data URI %#", async qrCode => {
  const mock = mockClient(session());
  requireMfa(mock, false);
  mock.auth.mfa.enroll.mockResolvedValue({ data: { id: "xml-totp", type: "totp", totp: { qr_code: qrCode } }, error: null });
  mount(mock.client);
  fireEvent.click(await screen.findByRole("button", { name: "Genera QR per Authenticator" }));
  const image = await screen.findByRole("img", { name: "QR per configurare Authenticator" });
  const source = image.getAttribute("src")!;
  expect(source).toMatch(/^data:image\/svg\+xml,/);
  const document = new DOMParser().parseFromString(decodeURIComponent(source.split(",")[1]), "image/svg+xml");
  expect(document.documentElement.localName).toBe("svg");
  expect(document.querySelector("path")).toBeTruthy();
  expect(screen.queryByText(/QR code non disponibile/)).toBeNull();
  expect(mock.auth.mfa.enroll).toHaveBeenCalledTimes(1);
  expect(dashboard()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("genera un QR per un nuovo fattore senza rimuovere quello incompleto e verifica il nuovo ID", async () => {
  const mock = mockClient(session());
  requireMfa(mock, false);
  const oldFactor = { id: "old-pending-totp", factor_type: "totp", status: "unverified" };
  mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [oldFactor], totp: [] }, error: null });
  mock.auth.mfa.enroll.mockResolvedValue({ data: { id: "xml-totp", type: "totp", totp: { qr_code: `data:image/svg+xml;utf-8,${svgWithDeclaration}` } }, error: null });
  mount(mock.client);
  await screen.findByText(/È presente una configurazione incompleta/);
  expect(mock.auth.mfa.enroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Genera QR per Authenticator" }));
  await screen.findByRole("img", { name: "QR per configurare Authenticator" });
  expect(screen.queryByText(/È presente una configurazione incompleta/)).toBeNull();
  mock.auth.mfa.listFactors.mockResolvedValue({ data: { all: [oldFactor, { id: "xml-totp", factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
  await enterCode();
  await waitFor(() => expect(mock.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "xml-totp", code: "123456" }));
  expect(oldFactor.status).toBe("unverified");
  expect(mock.auth.mfa.enroll).toHaveBeenCalledTimes(1);
  expect(dashboard()).toBeNull();
});

it("mostra subito lo stato incompleto se il fattore è creato ma il QR è malformato", async () => {
  const mock = mockClient(session());
  requireMfa(mock, false);
  mock.auth.mfa.enroll.mockResolvedValue({ data: { id: "bad-qr-totp", type: "totp", totp: { qr_code: "data:image/svg+xml,%invalid" } }, error: null });
  mount(mock.client);
  fireEvent.click(await screen.findByRole("button", { name: "Genera QR per Authenticator" }));
  await screen.findByText(/Il fattore è stato creato ma non è ancora verificato/);
  expect(screen.getByText(/È presente una configurazione incompleta/)).toBeTruthy();
  expect(screen.getByLabelText("Codice Authenticator")).toBeTruthy();
  expect(mock.auth.mfa.enroll).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("img", { name: "QR per configurare Authenticator" })).toBeNull();
  expect(dashboard()).toBeNull();
});

describe("dati della dashboard", () => {
  const bank = "00000000-0000-4000-8000-000000000010";
  const cash = "00000000-0000-4000-8000-000000000011";
  const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const ok = (data: unknown[]) => ({ data, count: data.length, status: 200, error: null });
  const balance = (date: unknown) => ({ account_id: bank, account_name: "Conto di verifica",
    is_active: true, as_of_date: date, status: "configured", balance: "-20.12", currency: "EUR" });
  const expenses = (date: unknown) => ({ id: id(4), transaction_date: date, type: "expense", amount: "0.10",
    category: "food", from_account_id: bank, to_account_id: null, voided: false, ledger_version: 1 });

  it("usa tutti i movimenti per i totali e distingue trasferimenti e annullamenti", async () => {
    const mock = mockClient(session());
    mock.readRpc.mockImplementation((name, args) => {
      if (name === "get_dashboard_balances") return ok([balance(args.p_as_of),
        { ...balance(args.p_as_of), account_id: cash, account_name: "Contanti di verifica", balance: "0.01", is_active: false }]);
      const first = expenses(args.p_from);
      if (!args.p_before_id) return ok([first,
        { ...first, id: id(3), type: "transfer", category: null, to_account_id: cash, amount: "25.00" },
        { ...first, id: id(2), voided: true, amount: "42.90" }]);
      if (args.p_before_id === id(2)) return ok([{ ...first, id: id(1), amount: "0.20" },
        { ...first, id: id(0), type: "income", amount: "1.05", category: "salary", from_account_id: null, to_account_id: bank }]);
      return ok([]);
    });
    mount(mock.client);
    await screen.findByRole("table");
    const summary = screen.getByRole("region", { name: "Riepilogo finanziario" });
    expect(summary.textContent).toContain("-20,11");
    expect(summary.textContent).toMatch(/Uscite del mese0,30/);
    expect(summary.textContent).toMatch(/Entrate del mese1,05/);
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByText("ANNULLATO", onlyVisible)).toBeTruthy();
    expect(screen.getByText("Trasferimento", onlyVisible)).toBeTruthy();
    expect(screen.getByText("CONTO INATTIVO", onlyVisible)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Spese giorno per giorno/ })).toBeTruthy();
    expect(mock.rpc).toHaveBeenCalledWith("get_dashboard_movements", {
      p_from: expect.any(String), p_to: expect.any(String), p_limit: 50,
      p_before_date: expect.any(String), p_before_id: id(2),
    }, { get: true });
    expect(localStorage.length).toBe(0);
  });

  it("nasconde i dati parziali quando una pagina fallisce e permette di riprovare", async () => {
    const mock = mockClient(session());
    let failing = true;
    mock.readRpc.mockImplementation((name, args) => {
      if (name === "get_dashboard_balances") return ok([balance(args.p_as_of)]);
      if (!args.p_before_id) return ok([expenses(args.p_from)]);
      return failing ? { data: null, error: { code: "XX000", message: "dettagli riservati" }, status: 500 } : ok([]);
    });
    mount(mock.client);
    expect((await screen.findByRole("alert")).textContent).toBe("Impossibile caricare i dati del periodo.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Conto di verifica")).toBeNull();
    expect(screen.queryByText(/dettagli riservati/)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));
    await screen.findByRole("table");
  });

  it.each([401, 403])("tratta HTTP %i come sessione o autorizzazione da ricontrollare", async (status) => {
    const mock = mockClient(session());
    mock.readRpc.mockReturnValue({ data: null, error: { code: "PGRST301" }, status });
    mount(mock.client);
    expect((await screen.findByRole("alert")).textContent).toMatch(/sessione scaduta/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Verifica la sessione" })).toBeTruthy();
  });

  it("interrompe le richieste al logout e scarta le risposte della sessione precedente", async () => {
    const mock = mockClient(session());
    const pending = deferred<unknown>();
    mock.readRpc.mockReturnValue(pending.promise);
    mount(mock.client);
    await screen.findByText("Caricamento dei dati in corso…");
    await waitFor(() => expect(mock.readRpc).toHaveBeenCalled());
    const signals = mock.readRpc.mock.calls.map(call => call[2]);
    fireEvent.click(screen.getAllByRole("button", { name: "Esci" })[0]);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await screen.findByRole("button", { name: "Accedi" });
    mock.readRpc.mockReturnValue(ok([]));
    fireEvent.submit(await loginForm());
    await screen.findByText("Nessun dato disponibile per il periodo.");
    await act(async () => { pending.resolve(ok([balance("2026-01-01")])); });
    expect(screen.queryByText("Conto di verifica")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rimuove i dati già caricati al cambio di account", async () => {
    const mock = mockClient(session());
    mock.readRpc.mockImplementation((name, args) => name === "get_dashboard_balances"
      ? ok([balance(args.p_as_of)]) : ok([]));
    mount(mock.client);
    await screen.findByText("Conto di verifica", onlyVisible);
    const calls = mock.rpc.mock.calls.length;
    const otherUser = { ...user, id: id(99) };
    mock.auth.getUser.mockResolvedValue({ data: { user: otherUser }, error: null });
    mock.emit("SIGNED_IN", { ...session(), user: otherUser });
    expect(screen.queryByText("Conto di verifica")).toBeNull();
    await screen.findByText(/Account non abilitato/);
    expect(mock.rpc).toHaveBeenCalledTimes(calls);
  });

  it("mostra altri movimenti senza alterare i totali mensili", async () => {
    const mock = mockClient(session());
    mock.readRpc.mockImplementation((name, args) => {
      if (name === "get_dashboard_balances" || args.p_before_id) return ok([]);
      return ok(Array.from({ length: 26 }, (_, index) => ({ ...expenses(args.p_from), id: id(26 - index) })));
    });
    mount(mock.client);
    await screen.findByRole("table");
    const summary = screen.getByRole("region", { name: "Riepilogo finanziario" });
    expect(summary.textContent).toMatch(/Uscite del mese2,60/);
    expect(screen.getAllByRole("row")).toHaveLength(10); // 9 righe iniziali + intestazione
    fireEvent.click(screen.getByRole("button", { name: /Mostra altri \d+ movimenti/ }));
    expect(screen.getAllByRole("row")).toHaveLength(19); // altre 9 righe rivelate
    expect(summary.textContent).toMatch(/Uscite del mese2,60/);
  });

  it("interrompe le richieste del mese precedente quando si cambia periodo", async () => {
    const mock = mockClient(session());
    const pending = deferred<unknown>();
    mock.readRpc.mockReturnValue(pending.promise);
    mount(mock.client);
    await screen.findByText("Caricamento dei dati in corso…");
    await waitFor(() => expect(mock.readRpc).toHaveBeenCalled());
    const calls = mock.readRpc.mock.calls.slice();
    const currentAsOf = calls.find(call => call[0] === "get_dashboard_balances")?.[1].p_as_of;
    mock.readRpc.mockReturnValue(ok([]));
    fireEvent.click(screen.getByRole("button", { name: "Mese precedente" }));
    await screen.findByText("Nessun dato disponibile per il periodo.");
    expect(calls.every(call => call[2].aborted)).toBe(true);
    const previousAsOf = mock.readRpc.mock.calls.filter(call => call[0] === "get_dashboard_balances").at(-1)?.[1].p_as_of;
    expect(typeof previousAsOf === "string" && typeof currentAsOf === "string" && previousAsOf < currentAsOf).toBe(true);
    await act(async () => { pending.resolve(ok([balance(currentAsOf)])); });
    expect(screen.queryByText("Conto di verifica")).toBeNull();
  });

  it("non mostra un saldo complessivo parziale se un conto è senza apertura", async () => {
    const mock = mockClient(session());
    mock.readRpc.mockImplementation((name, args) => name === "get_dashboard_balances"
      ? ok([balance(args.p_as_of), { ...balance(args.p_as_of), account_id: cash, account_name: "Contanti di verifica",
        balance: null, status: "not_configured" }]) : ok([]));
    mount(mock.client);
    await screen.findByText("Saldo complessivo non disponibile");
    expect(screen.getByText("Saldo non configurato", onlyVisible)).toBeTruthy();
    expect(screen.getByText("Nessun movimento nel periodo.", onlyVisible)).toBeTruthy();
  });
});
