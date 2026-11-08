import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { readWebUserId } from "./config";
import { getBrowserSupabase } from "./supabase";
import { normalizeMfaQr } from "./mfa-qr";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; message?: string }
  | { status: "authenticated"; user: User; client: SupabaseClient; signal: AbortSignal }
  | { status: "mfa"; user: User; mode: "enroll" | "challenge"; factors: { id: string; name: string }[]; factorId: string | null; qrCode?: string }
  | { status: "verification-error" }
  | { status: "configuration-error" }
  | { status: "logout-error" };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  retry: () => void;
  startMfa: () => Promise<string | null>;
  verifyMfa: (factorId: string, code: string) => Promise<string | null>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const loginError = "Accesso non riuscito. Controlla email e password e riprova.";

export function AuthProvider({ children, client = getBrowserSupabase(), webUserId = readWebUserId(import.meta.env.VITE_SUPABASE_WEB_USER_ID) }: {
  children: ReactNode; client?: SupabaseClient | null; webUserId?: string | null;
}) {
  const [state, setState] = useState<AuthState>({ status: client && webUserId ? "loading" : "configuration-error" });
  const verify = useRef<(session: Session | null) => void>(() => {});
  const invalidate = useRef<() => void>(() => {});
  const signingOut = useRef(false);
  const signingIn = useRef(false);
  const loginCancelled = useRef(false);
  const mounted = useRef(false);
  const restoreSession = useRef<() => void>(() => {});
  const mfaBusy = useRef(false);
  const actionRevision = useRef(0);
  const enrollment = useRef<{ userId: string; id: string; qrCode: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    if (!client || !webUserId) {
      setState({ status: "configuration-error" });
      return () => { mounted.current = false; };
    }
    let active = true;
    let revision = 0;
    let verificationTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let dashboardAccess: AbortController | undefined;
    const cancel = () => {
      revision++;
      dashboardAccess?.abort();
      dashboardAccess = undefined;
      clearTimeout(verificationTimer);
      clearTimeout(expiryTimer);
    };
    invalidate.current = cancel;
    const anonymous = (message?: string) => {
      enrollment.current = null;
      actionRevision.current++;
      setState({ status: "anonymous", message });
    };

    const check = (session: Session | null) => {
      if (!active || signingOut.current) return;
      cancel();
      actionRevision.current++;
      if (!session) {
        anonymous();
        return;
      }
      const current = revision;
      setState({ status: "loading" });
      // Le chiamate Auth restano fuori dal callback per non attendere il lock del SDK.
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
            if (data.user.id !== webUserId || data.user.is_anonymous) {
              enrollment.current = null;
              anonymous("Account non abilitato alla dashboard. Usa l’account web dedicato, distinto dal bot.");
              return;
            }
            const [assurance, factors] = await Promise.all([
              client.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token),
              client.auth.mfa.listFactors(),
            ]);
            if (!active || current !== revision || signingOut.current) return;
            if (assurance.error || factors.error || !assurance.data || !factors.data) {
              enrollment.current = null;
              setState({ status: "verification-error" });
              return;
            }
            if (session.expires_at * 1000 <= Date.now()) { void restore(); return; }
            const verified = factors.data.totp.filter(factor => factor.status === "verified");
            if (assurance.data.currentLevel === "aal2" && verified.length > 0) {
              enrollment.current = null;
              dashboardAccess = new AbortController();
              setState({ status: "authenticated", user: data.user, client, signal: dashboardAccess.signal });
            } else {
              const saved = enrollment.current;
              const pending = factors.data.all.find(factor => factor.factor_type === "totp" && factor.status === "unverified");
              const ownEnrollment = saved?.userId === data.user.id && factors.data.all.some(factor => factor.id === saved.id) ? saved : null;
              if (!ownEnrollment) enrollment.current = null;
              setState({ status: "mfa", user: data.user, mode: verified.length ? "challenge" : "enroll",
                factors: verified.map(factor => ({ id: factor.id, name: factor.friendly_name || "Authenticator" })),
                factorId: verified[0]?.id ?? ownEnrollment?.id ?? pending?.id ?? null,
                qrCode: ownEnrollment?.qrCode });
            }
            // Se il rinnovo automatico fallisce, nasconde il contenuto alla scadenza.
            expiryTimer = setTimeout(() => { void restore(); }, Math.min(session.expires_at * 1000 - Date.now(), 2_147_483_647));
          } catch {
            if (active && current === revision) { enrollment.current = null; setState({ status: "verification-error" }); }
          }
        })();
      }, 0);
    };
    const restore = async () => {
      cancel();
      actionRevision.current++;
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
    restoreSession.current = () => { void restore(); };
    verify.current = check;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") loginCancelled.current = true;
      if (session && signingIn.current && loginCancelled.current) return;
      check(session);
    });
    void restore();
    return () => {
      active = false;
      actionRevision.current++;
      enrollment.current = null;
      mounted.current = false;
      cancel();
      subscription.unsubscribe();
    };
  }, [client, webUserId]);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (!client || !webUserId) return "Configurazione di accesso non disponibile.";
    if (signingIn.current || signingOut.current) return "Operazione già in corso. Attendi e riprova.";
    signingIn.current = true;
    loginCancelled.current = false;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return loginError;
      if (!mounted.current) return null;
      if (loginCancelled.current || signingOut.current) {
        const stored = await client.auth.getSession();
        // Rimuove solo la sessione prodotta dal login arrivato dopo l’uscita.
        if (stored.error || stored.data.session?.access_token === data.session.access_token) await signOut();
        return "Accesso interrotto. Accedi nuovamente.";
      }
      verify.current(data.session);
      return null;
    } catch {
      if (loginCancelled.current && mounted.current) {
        await signOut();
        return "Accesso interrotto. Accedi nuovamente.";
      }
      return "Accesso non disponibile. Controlla la connessione e riprova.";
    } finally {
      signingIn.current = false;
    }
  };

  const signOut = async () => {
    if (!client) return;
    signingOut.current = true;
    loginCancelled.current = true;
    invalidate.current();
    actionRevision.current++;
    enrollment.current = null;
    // Nasconde il contenuto anche se l’uscita è lenta o fallisce.
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

  const mfaAction = async (operation: "enroll" | "verify", factorId?: string, code?: string): Promise<string | null> => {
    if (!client || !webUserId || state.status !== "mfa" || signingOut.current || mfaBusy.current) return "Operazione non disponibile. Attendi e riprova.";
    if (operation === "verify" && (!factorId || !/^\d{6}$/.test(code ?? ""))) return "Inserisci il codice di sei cifre dell’app Authenticator.";
    if (operation === "enroll" && state.mode !== "enroll") return "Usa il fattore già configurato.";
    mfaBusy.current = true;
    const current = actionRevision.current;
    const valid = () => mounted.current && current === actionRevision.current && !signingOut.current;
    try {
      const identity = await client.auth.getUser();
      if (!valid()) return null;
      if (identity.error || identity.data.user?.id !== webUserId || identity.data.user.id !== state.user.id) {
        enrollment.current = null;
        setState({ status: "verification-error" });
        return null;
      }
      const factors = await client.auth.mfa.listFactors();
      if (!valid()) return null;
      if (factors.error || !factors.data) return "Impossibile verificare i fattori. Riprova.";
      if (operation === "enroll") {
        if (factors.data.totp.some(factor => factor.status === "verified")) { restoreSession.current(); return null; }
        const result = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `FinanceTracker ${crypto.randomUUID()}`, issuer: "FinanceTracker" });
        if (!valid()) return null;
        if (result.error || !result.data || result.data.type !== "totp") return "Attivazione non riuscita. Riprova o controlla la configurazione MFA con l’amministratore.";
        const qrCode = normalizeMfaQr(result.data.totp.qr_code);
        if (!qrCode) {
          enrollment.current = null;
          setState({ ...state, factorId: result.data.id, qrCode: undefined });
          return "QR code non disponibile. Il fattore è stato creato ma non è ancora verificato. Genera un nuovo QR.";
        }
        enrollment.current = { userId: state.user.id, id: result.data.id, qrCode };
        setState({ ...state, factorId: result.data.id, qrCode });
      } else {
        const factor = factors.data.all.find(item => item.id === factorId && item.factor_type === "totp");
        if (!factor) { restoreSession.current(); return "Fattore non disponibile. Verifica nuovamente la sessione."; }
        const result = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code! });
        if (!valid()) return null;
        if (result.error) return "Codice non valido o scaduto. Attendi un nuovo codice e riprova.";
        enrollment.current = null;
        // Il successo della verifica non basta: ricontrolla utente e AAL del nuovo token.
        restoreSession.current();
      }
      return null;
    } catch {
      return valid() ? "Servizio di autenticazione non disponibile. Controlla la connessione e riprova." : null;
    } finally {
      mfaBusy.current = false;
    }
  };

  return <AuthContext.Provider value={{ state, signIn, signOut, retry: () => restoreSession.current(),
    startMfa: () => mfaAction("enroll"), verifyMfa: (factorId, code) => mfaAction("verify", factorId, code) }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider mancante");
  return value;
}
