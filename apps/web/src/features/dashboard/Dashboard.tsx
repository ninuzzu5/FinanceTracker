import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronRight, Coins, FlaskConical, LayoutDashboard, ListFilter, LogIn, Menu, ShieldCheck, Wallet, X } from "lucide-react";
import { accountLabels } from "@finance-tracker/domain";
import { Brand } from "../../components/Brand";
import { demo, demoAccounts } from "../../data/demo";
import { CategoryChart, SpendingChart } from "./Charts";
import { Movements } from "./Movements";

const navigation = [
  { id: "dashboard", label: "Panoramica", Icon: LayoutDashboard },
  { id: "movimenti", label: "Movimenti", Icon: ListFilter },
  { id: "analisi", label: "Analisi", Icon: ChartNoAxesCombined },
  { id: "budget", label: "Budget", Icon: ShieldCheck },
  { id: "conti", label: "Conti", Icon: Wallet },
] as const;

function MiniChart({ bars = false, muted = false }: { bars?: boolean; muted?: boolean }) {
  return <svg className={`mini-chart${muted ? " muted-chart" : ""}`} viewBox="0 0 106 52" aria-hidden="true">{bars ? <g fill="currentColor"><rect x="4" y="35" width="6" height="14" rx="1" /><rect x="17" y="23" width="6" height="26" rx="1" /><rect x="30" y="29" width="6" height="20" rx="1" /><rect x="43" y="12" width="6" height="37" rx="1" /><rect x="56" y="4" width="6" height="45" rx="1" /><rect x="69" y="19" width="6" height="30" rx="1" /><rect x="82" y="27" width="6" height="22" rx="1" /><rect x="95" y="16" width="6" height="33" rx="1" /></g> : <><path d="M2 45L15 37L25 39L36 26L47 23L59 29L70 18L82 19L93 10L102 6" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="102" cy="6" r="3" fill="currentColor" /></>}</svg>;
}

export function Dashboard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState("dashboard");
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);
  return <div className="dashboard-shell" id="dashboard">
    <a href="#contenuto" className="skip-link">Vai al contenuto principale</a>
    <div className="mobile-bar"><Brand /><button ref={menuButton} type="button" className="icon-button" aria-label={menuOpen ? "Chiudi menu" : "Apri menu"} aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
    {menuOpen && <button className="menu-overlay" aria-label="Chiudi menu di navigazione" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar glass${menuOpen ? " sidebar-open" : ""}`} id="sidebar" aria-label="Navigazione principale">
      <a href="/" className="brand-link" aria-label="FinanceTracker, panoramica"><Brand /></a>
      <span className="sidebar-section-label">Navigazione</span>
      <nav>{navigation.map(({ id, label, Icon }) => id === "budget" ? <div className="nav-unavailable" key={id}><button type="button" disabled title="Budget non disponibile" aria-describedby="budget-hint"><Icon size={20} />{label}</button><span id="budget-hint" className="sr-only">Budget non disponibile.</span></div> : <a className={`nav-link${active === id ? " active" : ""}`} href={`#${id}`} key={id} aria-current={active === id ? "location" : undefined} onClick={() => { setActive(id); setMenuOpen(false); }}><Icon size={20} aria-hidden="true" />{label}</a>)}</nav>
      <div className="sidebar-bottom">
        <a className="access-link" href="/accesso"><LogIn size={18} aria-hidden="true" />Accesso<ArrowRight size={15} aria-hidden="true" /></a>
        <div className="sidebar-footer">FinanceTracker</div>
      </div>
    </aside>
    <main className="dashboard-main" id="contenuto" tabIndex={-1}>
      <header className="dashboard-header"><div><p className="eyebrow">Riepilogo mensile</p><h1>Panoramica</h1></div><div className="header-tools"><span className="date-chip"><CalendarDays size={16} aria-hidden="true" />{demo.period}</span><div className="profile-avatar" aria-label="FinanceTracker">F</div></div></header>
      <div className="demo-banner"><span><FlaskConical size={16} aria-hidden="true" /><strong>Dati di esempio</strong></span></div>
      <section className="summary-grid" aria-label="Riepilogo finanziario">
        <article className="glass summary-card summary-card-primary"><div className="summary-icon mint-icon"><Coins size={25} aria-hidden="true" /></div><div className="summary-body"><h2>Patrimonio totale</h2><strong>{demo.netWorth}</strong><p><span className="positive"><ArrowUpRight size={13} aria-hidden="true" />{demo.netWorthChange}</span><span>rispetto al mese scorso</span></p></div><MiniChart /></article>
        <article className="glass summary-card"><div className="summary-icon mint-icon"><ArrowDownLeft size={27} aria-hidden="true" /></div><div className="summary-body"><h2>Entrate mensili</h2><strong>{demo.income}</strong><p><span className="positive"><ArrowUpRight size={13} aria-hidden="true" />{demo.incomeChange}</span><span>rispetto al mese scorso</span></p></div><MiniChart bars /></article>
        <article className="glass summary-card"><div className="summary-icon coral-icon"><ArrowUpRight size={27} aria-hidden="true" /></div><div className="summary-body"><h2>Uscite mensili</h2><strong>{demo.expenses}</strong><p><span className="positive"><ArrowDownLeft size={13} aria-hidden="true" />{demo.expensesChange}</span><span>rispetto al mese scorso</span></p></div><MiniChart bars muted /></article>
      </section>
      <div className="detail-grid">
        <SpendingChart /><CategoryChart />
        <section className="glass accounts-panel" id="conti" aria-labelledby="accounts-title"><div className="panel-heading"><h2 id="accounts-title">Conti</h2><span className="quiet-label">3 conti</span></div><div className="accounts-list">{demoAccounts.map(account => <div className="account-row" key={account.id}><span className={`account-logo account-${account.id}`} aria-hidden="true">{account.monogram || <Wallet size={23} />}</span><div className="account-info"><h3>{accountLabels[account.id]}</h3><p>{account.description}</p></div><strong>{account.balance}</strong></div>)}</div></section>
      </div>
      <Movements />
      <footer className="dashboard-footer"><span>FinanceTracker</span><a href="/accesso">Accesso<ChevronRight size={14} aria-hidden="true" /></a></footer>
    </main>
  </div>;
}
