import { useRef, useState, type FormEvent } from "react";
import { Brand } from "../../components/Brand";
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
  return <main className="access-page"><section className="access-panel glass mfa-panel" aria-labelledby="mfa-title">
    <Brand large />
    <h1 id="mfa-title" className="access-tagline">{state.mode === "enroll" ? "Attiva Authenticator" : "Verifica a due fattori"}</h1>
    {state.mode === "enroll" && <>
      <p>Configura un’app Authenticator per proteggere il tuo account web dedicato. Non usare l’account del bot Telegram.</p>
      {state.qrCode ? <>
        <p>1. Scansiona il QR con l’app Authenticator. 2. Inserisci il codice per confermare l’attivazione.</p>
        <img className="mfa-qr" src={state.qrCode} alt="QR per configurare Authenticator" referrerPolicy="no-referrer" />
        <p>Non condividere questo QR: contiene il segreto del secondo fattore.</p>
      </> : <>
        {factorId && <p>È presente una configurazione incompleta. Se hai già scansionato il QR, usa il relativo codice. Altrimenti genera un nuovo QR; nessun fattore esistente verrà rimosso.</p>}
        <button className="primary-button" type="button" disabled={pending} onClick={() => { void perform(startMfa); }}>{pending ? "Attendi…" : "Genera QR per Authenticator"}</button>
      </>}
    </>}
    {state.factors.length > 1 && <label>Authenticator<select value={factorId ?? ""} disabled={pending} onChange={event => setSelection(event.target.value)}>{state.factors.map(factor => <option key={factor.id} value={factor.id}>{factor.name}</option>)}</select></label>}
    {factorId && <form noValidate onSubmit={submit} aria-busy={pending}>
      <label htmlFor="mfa-code">Codice Authenticator</label>
      <div className="input-wrap"><input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={pending} /></div>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? "Verifica in corso…" : "Verifica codice"}</button>
    </form>}
    <p className="access-notice" role="status">{notice || "La dashboard resta bloccata fino al completamento della verifica."}</p>
    <p>Dispositivo perso? Usa un altro Authenticator già associato oppure contatta l’amministratore per il recupero verificato dell’account.</p>
    <button className="text-button" type="button" onClick={() => { void signOut(); }}>Esci</button>
  </section></main>;
}
