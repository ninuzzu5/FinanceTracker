import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session, SupabaseClient, User } from "@supabase/supabase-js";
import { AuthProvider } from "../src/auth/AuthProvider";
import { App } from "../src/App";

const user = { id: "synthetic-user", email: "person@example.invalid" } as User;
const session = (): Session => ({ access_token: "synthetic-token", refresh_token: "synthetic-refresh",
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mockClient(initial: Session | null = null) {
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const unsubscribe = vi.fn();
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: initial }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: session(), user }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn((listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => { unsubscribe(); listeners.delete(listener); } } } };
    }),
  };
  return { auth, client: { auth } as unknown as SupabaseClient, unsubscribe,
    emit: (event: AuthChangeEvent, value: Session | null) => act(() => { for (const listener of listeners) listener(event, value); }),
  };
}
function mount(client: SupabaseClient | null) {
  return render(<StrictMode><AuthProvider client={client}><App /></AuthProvider></StrictMode>);
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
    expect(window.location.pathname).toBe("/accesso");
    expect(dashboard()).toBeNull();
    expect(mock.auth.getUser).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Password dimenticata/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("signs in, verifies the user and redirects to the demo dashboard", async () => {
    const mock = mockClient();
    mount(mock.client);
    fireEvent.submit(await loginForm());
    await screen.findByRole("heading", { name: "Panoramica" });
    expect(mock.auth.signInWithPassword).toHaveBeenCalledWith({ email: "person@example.invalid", password: "synthetic-password" });
    expect(mock.auth.getUser).toHaveBeenCalledWith("synthetic-token");
    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("Dati di esempio")).toBeTruthy();
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
    expect(screen.queryByText("Patrimonio totale")).toBeNull();
    expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    await act(async () => { request.resolve({ error: null }); });
    await screen.findByRole("button", { name: "Accedi" });
    expect(window.location.pathname).toBe("/accesso");
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
