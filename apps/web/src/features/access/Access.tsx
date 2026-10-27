import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Brand } from "../../components/Brand";

export function Access() {
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState("");
  return <main className="access-page">
    <a className="preview-back" href="/"><ArrowLeft size={16} /> Torna alla panoramica</a>
    <section className="access-panel glass" aria-labelledby="access-title">
      <Brand large />
      <h1 id="access-title" className="access-tagline">Accesso</h1>
      <form noValidate onSubmit={event => {
        event.preventDefault();
        setNotice("L’accesso non è disponibile.");
      }}>
        <label htmlFor="email">Email</label>
        <div className="input-wrap"><Mail size={20} aria-hidden="true" /><input id="email" name="email" type="email" placeholder="nome@esempio.it" autoComplete="off" required /></div>
        <label htmlFor="password">Password</label>
        <div className="input-wrap"><LockKeyhole size={20} aria-hidden="true" /><input id="password" name="password" type={visible ? "text" : "password"} placeholder="Inserisci la tua password" autoComplete="off" required /><button className="icon-button" type="button" aria-label={visible ? "Nascondi password" : "Mostra password"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
        <div className="access-options"><button type="button" className="text-button" onClick={() => setNotice("Il recupero della password non è disponibile.")}>Password dimenticata?</button></div>
        <button className="primary-button" type="submit">Accedi <ArrowRight size={21} aria-hidden="true" /></button>
        <p className="access-notice" role="status">{notice || "Accesso non disponibile. Non inserire credenziali reali."}</p>
      </form>
      <div className="access-footer"><ShieldCheck size={23} aria-hidden="true" /><span>I dati inseriti non vengono inviati né salvati.</span></div>
    </section>
  </main>;
}
