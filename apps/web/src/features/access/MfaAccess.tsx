import { useRef, useState, type FormEvent } from "react";
import { Mascot } from "../dashboard/Mascot";
import { useAuth } from "../../auth/AuthProvider";

export function MfaAccess() {
  const { state, startMfa, verifyMfa, signOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState("");
  const busy = useRef(false);
  if (state.status !== "mfa") return null;
  const factorId = state.factors.some(factor => factor.id === selection) ? selection : state.factorId;
  const perform = async (action: () => Promise<string | null>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setNotice("");
    try { setNotice(await action() ?? ""); }
    finally { busy.current = false; setPending(false); }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || !factorId) return;
    const input = event.currentTarget.elements.namedItem("code") as HTMLInputElement;
    const code = input.value.trim();
    input.value = "";
    if (!/^\d{6}$/.test(code)) { setNotice("Inserisci il codice di sei cifre dell’app Authenticator."); return; }
    void perform(() => verifyMfa(factorId, code));
  };
  return <main className="zine-page zine-access-page">
    <section className="zine-card zine-access-card" style={{ "--tilt": "0.5deg", "--tape": "#E63946aa", "--card-bg": state.mode === "enroll" ? "var(--yellow)" : "#fff" } as React.CSSProperties} aria-labelledby="mfa-title">
      <div className="zine-card-body">
        <div className="zine-access-head">
          <h1 id="mfa-title" className="zine-heading" style={{ fontSize: 34, margin: 0 }}>
            <span className="zine-highlight">{state.mode === "enroll" ? "Attiva Authenticator" : "Verifica a due fattori"}</span>
          </h1>
          <Mascot state="happy" size={56} />
        </div>
        {state.mode === "enroll" && <>
          <p className="zine-access-note">Configura un’app Authenticator per proteggere il tuo account web dedicato. Non usare l’account del bot Telegram.</p>
          {state.qrCode ? <>
            <p className="zine-access-note">1. Scansiona il QR con l’app Authenticator. 2. Inserisci il codice per confermare l’attivazione.</p>
            <img className="zine-mfa-qr" src={state.qrCode} alt="QR per configurare Authenticator" referrerPolicy="no-referrer" />
            <p className="zine-access-note">Non condividere questo QR: contiene il segreto del secondo fattore.</p>
          </> : <>
            {factorId && <p className="zine-access-note">È presente una configurazione incompleta. Se hai già scansionato il QR, usa il relativo codice. Altrimenti genera un nuovo QR; nessun fattore esistente verrà rimosso.</p>}
            <p style={{ margin: "18px 0 0" }}><button className="zine-button" type="button" disabled={pending} onClick={() => { void perform(startMfa); }}>{pending ? "Attendi…" : "Genera QR per Authenticator"}</button></p>
          </>}
        </>}
        {state.factors.length > 1 && <label className="zine-field"><span className="zine-label">Authenticator</span>
          <select className="zine-input" value={factorId ?? ""} disabled={pending} onChange={event => setSelection(event.target.value)}>
            {state.factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
          </select></label>}
        {factorId && <form noValidate onSubmit={submit} aria-busy={pending}>
          <label className="zine-field" htmlFor="mfa-code"><span className="zine-label">Codice Authenticator</span>
            <input className="zine-input" id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={pending} />
          </label>
          <p style={{ margin: "22px 0 0" }}><button className="zine-button" type="submit" disabled={pending}>{pending ? "Verifica in corso…" : "Verifica codice"}</button></p>
        </form>}
        <p className="zine-access-notice" role="status">{notice || "La dashboard resta bloccata fino al completamento della verifica."}</p>
        <p className="zine-access-note">Dispositivo perso? Usa un altro Authenticator già associato oppure contatta l’amministratore per il recupero verificato dell’account.</p>
        <p style={{ margin: "10px 0 0" }}><button className="zine-chip zine-chip-sm" type="button" onClick={() => { void signOut(); }}>Esci</button></p>
      </div>
    </section>
  </main>;
}
