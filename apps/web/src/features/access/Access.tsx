import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { Mascot } from "../dashboard/Mascot";
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
  return <main className="zine-page zine-access-page">
    <section className="zine-card zine-access-card" style={{ "--tilt": "-0.6deg", "--tape": "#FFE14Dcc" } as React.CSSProperties} aria-labelledby="access-title">
      <div className="zine-card-body">
        <div className="zine-access-head">
          <h1 id="access-title" className="zine-heading" style={{ fontSize: 40, margin: 0 }}><span className="zine-highlight">Accedi</span></h1>
          <Mascot state="happy" size={64} />
        </div>
        <p className="zine-access-note">Area riservata: solo l’account web dedicato.</p>
        <form noValidate onSubmit={event => { void submit(event); }} aria-busy={pending}>
          <label className="zine-field" htmlFor="email"><span className="zine-label">Email</span>
            <div className="zine-input-wrap"><input className="zine-input" id="email" name="email" type="email" placeholder="nome@esempio.it" autoComplete="username" required disabled={pending || !configured} />
              <Mail size={18} aria-hidden="true" className="zine-input-eye" /></div>
          </label>
          <label className="zine-field" htmlFor="password"><span className="zine-label">Password</span>
            <div className="zine-input-wrap"><input className="zine-input" id="password" name="password" type={visible ? "text" : "password"} placeholder="la tua password" autoComplete="current-password" required disabled={pending || !configured} />
              <LockKeyhole size={18} aria-hidden="true" className="zine-input-eye" />
              <button className="zine-input-eye" type="button" aria-label={visible ? "Nascondi password" : "Mostra password"} aria-pressed={visible} disabled={pending || !configured} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          </label>
          <p className="zine-access-recovery"><button type="button" className="zine-link zine-link-sm" disabled title="Recupero password non ancora disponibile">Password dimenticata? Non disponibile</button></p>
          <p style={{ margin: "22px 0 0" }}><button className="zine-button zine-button-wide" type="submit" disabled={pending || !configured}>{pending ? "Accesso in corso…" : "Accedi"} <ArrowRight size={19} aria-hidden="true" /></button></p>
          <p className="zine-access-notice" role="status">{message || "Accedi con il tuo account autorizzato."}</p>
        </form>
        <p className="zine-access-note">Niente registrazione né recupero password: l’account si crea dalla console.</p>
      </div>
    </section>
  </main>;
}
