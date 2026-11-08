import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Brand } from "../../components/Brand";
import { useAuth } from "../../auth/AuthProvider";

export function Access() {
  const { state, signIn } = useAuth();
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const configured = state.status !== "configuration-error";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || !configured) return;
    const form = event.currentTarget;
    const email = form.elements.namedItem("email") as HTMLInputElement;
    const password = form.elements.namedItem("password") as HTMLInputElement;
    email.value = email.value.trim();
    if (!email.value || !email.validity.valid || !password.value) {
      setNotice("Inserisci un indirizzo email valido e la password.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setNotice("");
    const request = signIn(email.value, password.value);
    // Svuota subito la password, senza conservarla nello stato o nello storage.
    password.value = "";
    setVisible(false);
    try {
      const error = await request;
      if (error) setNotice(error);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const message = !configured ? "Accesso non configurato. Imposta URL, chiave pubblica e identificativo dell’account web dedicato."
    : notice || (state.status === "anonymous" ? state.message : "");
  return <main className="access-page">
    <section className="access-panel glass" aria-labelledby="access-title">
      <Brand large />
      <h1 id="access-title" className="access-tagline">Accesso</h1>
      <form noValidate onSubmit={event => { void submit(event); }} aria-busy={pending}>
        <label htmlFor="email">Email</label>
        <div className="input-wrap"><Mail size={20} aria-hidden="true" /><input id="email" name="email" type="email" placeholder="nome@esempio.it" autoComplete="username" required disabled={pending || !configured} /></div>
        <label htmlFor="password">Password</label>
        <div className="input-wrap"><LockKeyhole size={20} aria-hidden="true" /><input id="password" name="password" type={visible ? "text" : "password"} placeholder="Inserisci la tua password" autoComplete="current-password" required disabled={pending || !configured} /><button className="icon-button" type="button" aria-label={visible ? "Nascondi password" : "Mostra password"} aria-pressed={visible} disabled={pending || !configured} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
        <div className="access-options"><button type="button" className="text-button" disabled title="Recupero password non ancora disponibile">Password dimenticata? Non disponibile</button></div>
        <button className="primary-button" type="submit" disabled={pending || !configured}>{pending ? "Accesso in corso…" : "Accedi"} <ArrowRight size={21} aria-hidden="true" /></button>
        <p className="access-notice" role="status">{message || "Accedi con il tuo account autorizzato."}</p>
      </form>
      <div className="access-footer"><ShieldCheck size={23} aria-hidden="true" /><span>Accesso con Supabase e verifica in due passaggi.</span></div>
    </section>
  </main>;
}
