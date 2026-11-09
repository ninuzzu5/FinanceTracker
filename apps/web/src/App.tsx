import { useEffect } from "react";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Access } from "./features/access/Access";
import { Mascot } from "./features/dashboard/Mascot";
import { useAuth } from "./auth/AuthProvider";
import { MfaAccess } from "./features/access/MfaAccess";

export function App() {
  const { state, signOut, retry } = useAuth();
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

  if (state.status === "mfa") return <MfaAccess key={state.user.id} />;
  if (state.status === "loading" || state.status === "logout-error" || state.status === "verification-error") {
    return <main className="zine-page zine-access-page"><section className="zine-card zine-access-card" style={{ "--tilt": "-0.3deg" } as React.CSSProperties}>
      <div className="zine-card-body zine-state" aria-live="polite" aria-busy={state.status === "loading"}>
        <div className="zine-state-text">
          <p role="status" style={{ margin: "0 0 14px" }}>{state.status === "loading" ? "Verifica della sessione…" : state.status === "verification-error" ? "Impossibile verificare l’autenticazione. Il contenuto resta protetto." : "Uscita non riuscita. Controlla la connessione e riprova."}</p>
          {state.status === "loading" && <div className="zine-progress" />}
          {state.status === "verification-error" && <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="zine-button" onClick={retry}>Riprova la verifica</button>
            <button className="zine-chip" onClick={() => { void signOut(); }}>Esci</button>
          </p>}
          {state.status === "logout-error" && <button className="zine-button" onClick={() => { void signOut(); }}>Riprova a uscire</button>}
        </div>
        <Mascot state={state.status === "loading" ? "flip" : "dead"} />
      </div>
    </section></main>;
  }
  return state.status === "authenticated" ? <Dashboard key={state.user.id} client={state.client} sessionSignal={state.signal} /> : <Access />;
}
