import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabase";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; message?: string }
  | { status: "authenticated"; user: User }
  | { status: "configuration-error" }
  | { status: "logout-error" };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const loginError = "Accesso non riuscito. Controlla email e password e riprova.";

export function AuthProvider({ children, client = getBrowserSupabase() }: {
  children: ReactNode; client?: SupabaseClient | null;
}) {
  const [state, setState] = useState<AuthState>({ status: client ? "loading" : "configuration-error" });
  const verify = useRef<(session: Session | null) => void>(() => {});
  const invalidate = useRef<() => void>(() => {});
  const signingOut = useRef(false);
  const signingIn = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!client) {
      setState({ status: "configuration-error" });
      return () => { mounted.current = false; };
    }
    let active = true;
    let revision = 0;
    let verificationTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      revision++;
      clearTimeout(verificationTimer);
      clearTimeout(expiryTimer);
    };
    invalidate.current = cancel;
    const anonymous = (message?: string) => setState({ status: "anonymous", message });

    const check = (session: Session | null) => {
      if (!active || signingOut.current) return;
      cancel();
      if (!session) { anonymous(); return; }
      const current = revision;
      setState({ status: "loading" });
      // Supabase calls listeners under its Auth lock: never await Auth in the callback.
      verificationTimer = setTimeout(() => {
        void (async () => {
          try {
            const { data, error } = await client.auth.getUser(session.access_token);
            if (!active || current !== revision || signingOut.current) return;
            if (error || !data.user || data.user.id !== session.user.id
              || !session.expires_at || session.expires_at * 1000 <= Date.now()) {
              anonymous("Sessione non valida o scaduta. Accedi nuovamente.");
              return;
            }
            setState({ status: "authenticated", user: data.user });
            // The SDK refreshes proactively. Recheck at expiry if refresh fails/offline.
            expiryTimer = setTimeout(() => { void restore(); }, Math.min(session.expires_at * 1000 - Date.now(), 2_147_483_647));
          } catch {
            if (active && current === revision) anonymous("Impossibile verificare la sessione. Accedi nuovamente.");
          }
        })();
      }, 0);
    };
    const restore = async () => {
      cancel();
      const current = revision;
      setState({ status: "loading" });
      try {
        const { data, error } = await client.auth.getSession();
        if (!active || current !== revision || signingOut.current) return;
        if (error) anonymous("Sessione non disponibile. Accedi nuovamente.");
        else check(data.session);
      } catch {
        if (active && current === revision && !signingOut.current) anonymous("Impossibile verificare la sessione. Accedi nuovamente.");
      }
    };
    verify.current = check;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => check(session));
    void restore();
    return () => {
      active = false;
      mounted.current = false;
      cancel();
      subscription.unsubscribe();
    };
  }, [client]);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (!client) return "Configurazione di accesso non disponibile.";
    if (signingIn.current || signingOut.current) return "Operazione già in corso. Attendi e riprova.";
    signingIn.current = true;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return loginError;
      verify.current(data.session);
      return null;
    } catch {
      return "Accesso non disponibile. Controlla la connessione e riprova.";
    } finally {
      signingIn.current = false;
    }
  };

  const signOut = async () => {
    if (!client) return;
    signingOut.current = true;
    invalidate.current();
    // Unmount all dashboard content immediately, including on a slow/failed logout.
    setState({ status: "loading" });
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (!mounted.current) return;
      if (error) { setState({ status: "logout-error" }); return; }
      signingOut.current = false;
      setState({ status: "anonymous" });
    } catch {
      if (mounted.current) setState({ status: "logout-error" });
    }
  };

  return <AuthContext.Provider value={{ state, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider mancante");
  return value;
}
