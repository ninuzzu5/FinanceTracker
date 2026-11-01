import { useEffect } from "react";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Access } from "./features/access/Access";
import { Brand } from "./components/Brand";
import { useAuth } from "./auth/AuthProvider";

export function App() {
  const { state, signOut } = useAuth();
  const authenticated = state.status === "authenticated";
  useEffect(() => {
    const syncLocation = () => {
      if (state.status === "loading") return;
      const target = authenticated ? "/" : "/accesso";
      if (window.location.pathname !== target) window.history.replaceState(null, "", target);
      document.title = `FinanceTracker · ${authenticated ? "Panoramica" : "Accesso"}`;
    };
    syncLocation();
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, [authenticated, state.status]);

  if (state.status === "loading" || state.status === "logout-error") {
    return <main className="access-page"><section className="access-panel glass auth-state" aria-live="polite" aria-busy={state.status === "loading"}>
      <Brand large />
      <p role="status">{state.status === "loading" ? "Verifica della sessione…" : "Uscita non riuscita. Controlla la connessione e riprova."}</p>
      {state.status === "logout-error" && <button className="primary-button" onClick={() => { void signOut(); }}>Riprova a uscire</button>}
    </section></main>;
  }
  return state.status === "authenticated" ? <Dashboard key={state.user.id} /> : <Access />;
}
