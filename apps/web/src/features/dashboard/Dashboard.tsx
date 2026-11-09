import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, ChevronLeft, ChevronRight, Coins, LayoutDashboard, ListFilter, LogOut, Menu, ShieldCheck, Wallet, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Brand } from "../../components/Brand";
import { CategoryChart, SpendingChart } from "./Charts";
import { AccountLogo } from "./AccountLogo";
import { Movements } from "./Movements";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardAccessError, loadDashboard } from "./dashboard-data";
import {
  dashboardPeriod, firstDate, formatDay, money, periodModes, shiftPeriod, spendingHeadline,
  statistics, todayInRome, type Period, type PeriodMode,
} from "./dashboard-model";

const navigation = [
  { id: "dashboard", label: "Panoramica", Icon: LayoutDashboard },
  { id: "movimenti", label: "Movimenti", Icon: ListFilter },
  { id: "analisi", label: "Analisi", Icon: ChartNoAxesCombined },
  { id: "budget", label: "Budget", Icon: ShieldCheck },
  { id: "conti", label: "Conti", Icon: Wallet },
] as const;
const modeIds = Object.keys(periodModes) as PeriodMode[];
// Aggettivi per le etichette di entrate/uscite e dell'intestazione; la copy definitiva è un passo successivo (Zine).
const flowAdjective: Record<PeriodMode, string> = { year: "annue", month: "mensili", week: "settimanali", day: "del giorno" };
const periodAdjective: Record<PeriodMode, string> = { year: "annuale", month: "mensile", week: "settimanale", day: "giornaliero" };

type ReadAccess = { client: SupabaseClient; sessionSignal: AbortSignal };
type Progress = { pages: number; entries: number };
type LoadState = { status: "loading" | "error" | "denied" } |
  { status: "ready"; data: Awaited<ReturnType<typeof loadDashboard>> };

function DashboardData({ client, sessionSignal, period }: ReadAccess & { period: Period }) {
  const { retry } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ scope: AbortSignal; state: LoadState }>();
  const [progress, setProgress] = useState<Progress>();
  const state: LoadState = loaded?.scope === sessionSignal ? loaded.state : { status: "loading" };

  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([sessionSignal, request.signal]);
    setProgress(undefined);
    void loadDashboard(client, period, signal, (pages, entries) => {
      if (!signal.aborted) setProgress({ pages, entries });
    }).then(data => {
      if (!signal.aborted) setLoaded({ scope: sessionSignal, state: { status: "ready", data } });
    }).catch((error: unknown) => {
      if (signal.aborted) return;
      request.abort();
      setLoaded({ scope: sessionSignal, state: { status: error instanceof DashboardAccessError ? "denied" : "error" } });
    });
    return () => request.abort();
  }, [attempt, client, period, sessionSignal]);

  if (sessionSignal.aborted) return null;
  if (state.status === "loading") return <section className="glass dashboard-state" role="status" aria-busy="true">
    Caricamento dei dati in corso{progress && progress.pages > 1 ? ` (movimenti letti: ${progress.entries})` : "…"}
  </section>;
  if (state.status !== "ready") return <section className="glass dashboard-state">
    <p role="alert">{state.status === "denied" ? "Accesso ai dati non autorizzato o sessione scaduta." : "Impossibile caricare i dati del periodo."}</p>
    {state.status === "denied" ? <button className="text-button" onClick={retry}>Verifica la sessione</button> :
      <button className="text-button" onClick={() => { setLoaded(undefined); setAttempt(attempt + 1); }}>Riprova</button>}
  </section>;

  const { accounts, entries } = state.data;
  if (!accounts.length && !entries.length) return <section className="glass dashboard-state" role="status">Nessun dato disponibile per il periodo.</section>;

  const totals = statistics(entries, period);
  const hasCompleteBalance = accounts.length > 0 && accounts.every(account => account.cents !== null);
  const balance = hasCompleteBalance ? money(accounts.reduce((sum, account) => sum + (account.cents ?? 0n), 0n)) : "—";
  return <>
    <p className="dashboard-headline">{spendingHeadline(period, totals.expenses)}</p>
    <section className="summary-grid" aria-label="Riepilogo finanziario">
      <article className="glass summary-card summary-card-primary">
        <div className="summary-icon mint-icon"><Coins size={25} aria-hidden="true" /></div>
        <div className="summary-body"><h2>Saldo complessivo</h2><strong>{balance}</strong><p>{hasCompleteBalance ? `Al ${formatDay(period.to)}` : "Saldo complessivo non disponibile"}</p></div>
      </article>
      <article className="glass summary-card">
        <div className="summary-icon mint-icon"><ArrowDownLeft size={27} aria-hidden="true" /></div>
        <div className="summary-body"><h2>Entrate {flowAdjective[period.mode]}</h2><strong>{money(totals.income)}</strong><p>Movimenti contabilizzati</p></div>
      </article>
      <article className="glass summary-card">
        <div className="summary-icon coral-icon"><ArrowUpRight size={27} aria-hidden="true" /></div>
        <div className="summary-body"><h2>Uscite {flowAdjective[period.mode]}</h2><strong>{money(totals.expenses)}</strong><p>Movimenti contabilizzati</p></div>
      </article>
    </section>
    <div className="detail-grid">
      <SpendingChart totals={totals} period={period} /><CategoryChart totals={totals} period={period} />
      <section className="glass accounts-panel" id="conti" aria-labelledby="accounts-title">
        <div className="panel-heading"><h2 id="accounts-title">Conti</h2><span className="quiet-label">{accounts.length} {accounts.length === 1 ? "conto" : "conti"}</span></div>
        {accounts.length === 0 ? <p className="quiet-label">Nessun conto disponibile.</p> :
          <div className="accounts-list">{accounts.map(account => <div className="account-row" key={account.id}>
            <AccountLogo name={account.name} />
            <div className="account-info"><h3>{account.name}</h3>{!account.active && <p>Conto inattivo</p>}</div>
            <strong>{account.cents !== null ? money(account.cents) : account.status === "before_opening" ? "Prima dell’apertura" : "Saldo non configurato"}</strong>
          </div>)}</div>}
      </section>
    </div>
    <Movements accounts={accounts} entries={entries} period={period} />
  </>;
}

export function Dashboard({ client, sessionSignal }: ReadAccess) {
  const { signOut } = useAuth();
  const today = todayInRome();
  const [period, setPeriod] = useState(() => dashboardPeriod("month", today, today));
  const selectPeriod = (offset: number) => setPeriod(dashboardPeriod(period.mode, shiftPeriod(period.mode, period.from, offset), today));
  const selectMode = (mode: PeriodMode) => { if (mode !== period.mode) setPeriod(dashboardPeriod(mode, today, today)); };
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
        <button className="access-link logout-button" type="button" onClick={() => { void signOut(); }}><LogOut size={18} aria-hidden="true" />Esci</button>
        <div className="sidebar-footer">FinanceTracker</div>
      </div>
    </aside>
    <main className="dashboard-main" id="contenuto" tabIndex={-1}>
      <header className="dashboard-header">
        <div><p className="eyebrow">Riepilogo {periodAdjective[period.mode]}</p><h1>Panoramica</h1></div>
        <div className="header-tools">
          <div className="view-modes" role="group" aria-label="Scala temporale">
            {modeIds.map(mode => <button key={mode} type="button" className="text-button" aria-pressed={period.mode === mode}
              onClick={() => selectMode(mode)}>{periodModes[mode]}</button>)}
          </div>
          <div className="date-chip" role="group" aria-label="Periodo del riepilogo">
            <button className="icon-button" type="button" aria-label={`${periodModes[period.mode]} precedente`} disabled={period.from <= firstDate} onClick={() => selectPeriod(-1)}><ChevronLeft size={16} /></button>
            <span aria-live="polite">{period.label}</span>
            <button className="icon-button" type="button" aria-label={`${periodModes[period.mode]} successivo`} disabled={period.current} onClick={() => selectPeriod(1)}><ChevronRight size={16} /></button>
          </div>
        </div>
      </header>
      <DashboardData key={`${period.mode}:${period.from}:${period.to}`} client={client} sessionSignal={sessionSignal} period={period} />
      <footer className="dashboard-footer"><span>FinanceTracker</span><button className="logout-button" type="button" onClick={() => { void signOut(); }}>Esci<LogOut size={14} aria-hidden="true" /></button></footer>
    </main>
  </div>;
}
