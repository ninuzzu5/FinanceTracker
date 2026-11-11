import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Brand } from "../../components/Brand";
import { categoryIcon } from "./category-icons";
import { CategoryChart } from "./Charts";
import { Calendar } from "./Calendar";
import { TopSpending } from "./TopSpending";
import { AccountLogo } from "./AccountLogo";
import { Mascot } from "./Mascot";
import { Movements } from "./Movements";
import { MovementsTable } from "./MovementsTable";
import { DetailDialog } from "./DetailDialog";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardAccessError, loadDashboard } from "./dashboard-data";
import {
  amountSizeClass, dashboardPeriod, firstDate, formatDay, labelForCategory, money, periodModes, shiftPeriod, statistics,
  titlePieces, todayInRome, type Balance, type Movement, type Period, type PeriodMode,
} from "./dashboard-model";

const navigation = [
  { id: "dashboard", label: "Panoramica" },
  { id: "movimenti", label: "Movimenti" },
  { id: "analisi", label: "Analisi" },
  { id: "conti", label: "Conti" },
] as const;
// Ordine di lettura del selettore segmentato: dal periodo più corto al più lungo.
const modeOrder: PeriodMode[] = ["day", "week", "month", "year"];
const flowAdjective: Record<PeriodMode, string> = { year: "dell'anno", month: "del mese", week: "della settimana", day: "del giorno" };

type ReadAccess = { client: SupabaseClient; sessionSignal: AbortSignal };
type Progress = { pages: number; entries: number };
type LoadState = { status: "loading" | "error" | "denied" } |
  { status: "ready"; data: Awaited<ReturnType<typeof loadDashboard>> };
// Quale finestra di dettaglio è aperta: una sola alla volta, per scheda d'origine.
type OpenDialog = null | { kind: "balance" } | { kind: "income" } | { kind: "expense" } | { kind: "account"; id: string }
  | { kind: "category"; id: string | null } | { kind: "date"; from: string; to: string; label: string };

function DashboardData({ client, sessionSignal, period, today }: ReadAccess & { period: Period; today: string }) {
  const { retry } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ scope: AbortSignal; state: LoadState }>();
  const [progress, setProgress] = useState<Progress>();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
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

  if (state.status === "loading") return <section className="zine-card" style={{ "--tape": "#FFE14Dcc" } as React.CSSProperties}>
    <div className="zine-card-body zine-state" role="status" aria-busy="true">
      <div className="zine-state-text">
        <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Caricamento</span></h2>
        <p style={{ margin: "0 0 14px" }}>Caricamento dei dati in corso{progress && progress.pages > 1 ? ` (movimenti letti: ${progress.entries})` : "…"}</p>
        <div className="zine-progress" />
      </div>
      <Mascot state="flip" />
    </div>
  </section>;

  if (state.status !== "ready") {
    const denied = state.status === "denied";
    return <section className="zine-card" style={{ "--tape": denied ? "#E63946aa" : "#1D4ED8aa" } as React.CSSProperties}>
      <div className="zine-card-body zine-state">
        <div className="zine-state-text">
          <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">{denied ? "Accesso negato" : "Errore"}</span></h2>
          <p role="alert" style={{ margin: "0 0 16px" }}>{denied ? "Accesso ai dati non autorizzato o sessione scaduta." : "Impossibile caricare i dati del periodo."}</p>
          {denied ? <button className="zine-button zine-button-alt" onClick={retry}>Verifica la sessione</button>
            : <button className="zine-button" onClick={() => { setLoaded(undefined); setAttempt(attempt + 1); }}>Riprova</button>}
        </div>
        <Mascot state={denied ? "lock" : "dead"} />
      </div>
    </section>;
  }

  const { accounts, entries } = state.data;
  if (!accounts.length && !entries.length) return <section className="zine-card" style={{ "--tape": "#E63946aa", "--card-bg": "var(--yellow)" } as React.CSSProperties}>
    <div className="zine-card-body zine-state">
      <div className="zine-state-text">
        <span className="zine-stamp">NESSUN DATO</span>
        <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Nessun dato</span></h2>
        <p role="status" style={{ margin: 0 }}>Nessun dato disponibile per il periodo.</p>
      </div>
      <Mascot state="sleep" />
    </div>
  </section>;

  const totals = statistics(entries, period);
  const hasCompleteBalance = accounts.length > 0 && accounts.every(account => account.cents !== null);
  const totalCents = accounts.reduce((sum, account) => sum + (account.cents ?? 0n), 0n);
  const inRed = hasCompleteBalance && totalCents < 0n;
  const balance = hasCompleteBalance ? money(totalCents) : "—";
  const summaryTexts = [balance, money(totals.income), money(totals.expenses)];
  const summarySize = amountSizeClass(summaryTexts);
  const accountTexts = accounts.map(a => a.cents !== null ? money(a.cents) : "").filter(Boolean);
  const accountSize = amountSizeClass(accountTexts);
  const title = titlePieces(period, totals.expenses);

  return <>
    <h2 className="zine-title" aria-live="polite">
      <span className="sr-only">{title.map(p => p.text).join(" ")}</span>
      {title.map((piece, i) => <span key={i} aria-hidden="true" className="zine-title-piece"
        style={{ background: piece.background, color: piece.color, transform: `rotate(${piece.angle}deg)` }}>{piece.text}</span>)}
    </h2>
    <section className="zine-grid zine-summary" aria-label="Riepilogo finanziario">
      <section className="zine-card" style={{ "--tilt": "-0.5deg", "--card-bg": inRed ? "#FFC2C7" : "#8FE0A8" } as React.CSSProperties}>
        <button type="button" className="zine-card-body zine-card-trigger" onClick={() => setOpenDialog({ kind: "balance" })}>
          <h2 className="zine-label">Saldo complessivo</h2>
          <div className={`zine-amount ${summarySize} ${inRed ? "zine-negative" : ""}`}>{balance}</div>
          <p className="zine-sub">{hasCompleteBalance ? `Al ${formatDay(period.to)}` : "Saldo complessivo non disponibile"}
            {inRed && <span className="zine-chip-static" style={{ background: "#fff" }}>IN ROSSO</span>}</p>
          <span className="zine-card-details">Dettagli ›</span>
        </button>
      </section>
      <section className="zine-card" style={{ "--tilt": "0.5deg" } as React.CSSProperties}>
        <button type="button" className="zine-card-body zine-card-trigger" onClick={() => setOpenDialog({ kind: "income" })}>
          <h2 className="zine-label">Entrate {flowAdjective[period.mode]}</h2>
          <div className={`zine-amount ${summarySize}`}>{money(totals.income)}</div>
          <p className="zine-sub">Movimenti contabilizzati</p>
          <span className="zine-card-details">Dettagli ›</span>
        </button>
      </section>
      <section className="zine-card" style={{ "--tilt": "-0.4deg", "--card-bg": "var(--yellow)" } as React.CSSProperties}>
        <button type="button" className="zine-card-body zine-card-trigger" onClick={() => setOpenDialog({ kind: "expense" })}>
          <h2 className="zine-label">Uscite {flowAdjective[period.mode]}</h2>
          <div className={`zine-amount ${summarySize}`}>{money(totals.expenses)}</div>
          <p className="zine-sub">Movimenti contabilizzati</p>
          <span className="zine-card-details">Dettagli ›</span>
        </button>
      </section>
    </section>
    <div className="zine-accounts">
      <div className="zine-section-heading"><h2 className="zine-heading zine-heading-lg" id="conti"><span className="zine-highlight">Conti</span></h2>
        <span className="zine-count">{accounts.length} {accounts.length === 1 ? "conto" : "conti"}</span></div>
      {accounts.length === 0 ? <p className="zine-chart-note">Nessun conto disponibile.</p> : <div className="zine-grid">
        {accounts.map((account, i) => <section className="zine-card zine-account-card" key={account.id} style={{ "--tilt": `${(i % 2 === 0 ? -1 : 1) * 0.4}deg` } as React.CSSProperties}>
          <button type="button" className="zine-card-body zine-card-trigger" onClick={() => setOpenDialog({ kind: "account", id: account.id })}>
            <div className="zine-account-head"><AccountLogo name={account.name} />
              {!account.active && <span className="zine-chip-static zine-inactive-chip">CONTO INATTIVO</span>}</div>
            <div className={`zine-amount ${accountSize}`}>
              {account.cents !== null ? money(account.cents) : account.status === "before_opening" ? "Prima dell'apertura" : "Saldo non configurato"}
            </div>
            <span className="zine-card-details">Dettagli ›</span>
          </button>
        </section>)}
      </div>}
    </div>
    <div id="analisi">
      <CategoryChart totals={totals} onSelectCategory={category => setOpenDialog({ kind: "category", id: category })} />
    </div>
    <div className="zine-grid">
      <Calendar key={period.to.slice(0, 7)} client={client} sessionSignal={sessionSignal} initialMonth={period.to.slice(0, 7)} today={today}
        onSelectDay={date => setOpenDialog({ kind: "date", ...dashboardPeriod("day", date, today) })} />
      {(period.mode === "month" || period.mode === "week") && <TopSpending entries={entries} accounts={accounts} />}
    </div>
    <Movements accounts={accounts} entries={entries} />
    <BalanceDialog open={openDialog?.kind === "balance"} onClose={() => setOpenDialog(null)}
      accounts={accounts} totalCents={hasCompleteBalance ? totalCents : null} dateLabel={`Al ${formatDay(period.to)}`} />
    <FlowDialog open={openDialog?.kind === "income"} onClose={() => setOpenDialog(null)}
      type="income" title={`Entrate ${flowAdjective[period.mode]}`} total={totals.income} categories={totals.incomeCategories}
      entries={entries.filter(e => e.type === "income")} accounts={accounts} />
    <FlowDialog open={openDialog?.kind === "expense"} onClose={() => setOpenDialog(null)}
      type="expense" title={`Uscite ${flowAdjective[period.mode]}`} total={totals.expenses} categories={totals.categories}
      entries={entries.filter(e => e.type === "expense")} accounts={accounts} />
    {accounts.map(account => <AccountDialog key={account.id} open={openDialog?.kind === "account" && openDialog.id === account.id}
      onClose={() => setOpenDialog(null)} account={account} period={period} entries={entries} accounts={accounts} />)}
    {totals.categories.map(row => <CategoryDialog key={row.category ?? "null"}
      open={openDialog?.kind === "category" && openDialog.id === row.category} onClose={() => setOpenDialog(null)}
      category={row.category} amount={row.cents} count={row.count} expensesTotal={totals.expenses} entries={entries} accounts={accounts} />)}
    <DateDialog open={openDialog?.kind === "date"} onClose={() => setOpenDialog(null)}
      label={openDialog?.kind === "date" ? openDialog.label : ""} from={openDialog?.kind === "date" ? openDialog.from : ""}
      to={openDialog?.kind === "date" ? openDialog.to : ""} entries={entries} accounts={accounts} />
  </>;
}

function BalanceDialog({ open, onClose, accounts, totalCents, dateLabel }: {
  open: boolean; onClose: () => void; accounts: readonly Balance[]; totalCents: bigint | null; dateLabel: string;
}) {
  return <DetailDialog open={open} onClose={onClose} title="Saldo complessivo">
    <ul className="zine-dialog-accounts">
      {accounts.map(account => <li key={account.id} className="zine-dialog-account-row">
        <AccountLogo name={account.name} />
        {!account.active && <span className="zine-chip-static zine-inactive-chip">CONTO INATTIVO</span>}
        <strong>{account.cents !== null ? money(account.cents) : account.status === "before_opening" ? "Prima dell'apertura" : "Saldo non configurato"}</strong>
      </li>)}
    </ul>
    <div className="zine-dialog-total"><span>Totale</span><strong>{totalCents !== null ? money(totalCents) : "—"}</strong></div>
    <p className="zine-chart-note">{dateLabel}</p>
  </DetailDialog>;
}

function CategoryBars({ categories, total }: { categories: readonly { category: string | null; cents: bigint; count: number }[]; total: bigint }) {
  if (categories.length === 0) return null;
  return <ul className="zine-dialog-bars">
    {categories.map(row => {
      const percent = total > 0n ? Number(row.cents) / Number(total) * 100 : 0;
      return <li key={row.category ?? "null"} className="zine-dialog-bar-row">
        <img src={categoryIcon(row.category)} alt="" className="zine-top-icon" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="zine-dialog-bar-label"><span>{labelForCategory(row.category)}</span>
            <span>{money(row.cents)} · {percent < 0.5 ? "<1%" : `${Math.round(percent)}%`}</span></div>
          <div className="zine-top-bar"><i style={{ width: `${percent}%` }} /></div>
        </div>
      </li>;
    })}
  </ul>;
}

function FlowDialog({ open, onClose, title, total, categories, entries, accounts }: {
  open: boolean; onClose: () => void; type: "income" | "expense"; title: string; total: bigint;
  categories: readonly { category: string | null; cents: bigint; count: number }[]; entries: readonly Movement[]; accounts: readonly Balance[];
}) {
  return <DetailDialog open={open} onClose={onClose} title={title}>
    <p className="zine-dialog-total"><strong className={`zine-amount s1`}>{money(total)}</strong></p>
    <CategoryBars categories={categories} total={total} />
    <MovementsTable entries={entries} accounts={accounts} />
  </DetailDialog>;
}

function AccountDialog({ open, onClose, account, period, entries, accounts }: {
  open: boolean; onClose: () => void; account: Balance; period: Period; entries: readonly Movement[]; accounts: readonly Balance[];
}) {
  const accountEntries = entries.filter(e => e.from === account.id || e.to === account.id);
  const totals = statistics(accountEntries, period);
  return <DetailDialog open={open} onClose={onClose} title={account.name}>
    <div className="zine-dialog-row">
      <span className="zine-label">Saldo</span>
      <strong className="zine-amount s1">{account.cents !== null ? money(account.cents) : account.status === "before_opening" ? "Prima dell'apertura" : "Saldo non configurato"}</strong>
    </div>
    <div className="zine-dialog-row"><span className="zine-label">Entrate del periodo</span><strong>{money(totals.income)}</strong></div>
    <div className="zine-dialog-row"><span className="zine-label">Uscite del periodo</span><strong>{money(totals.expenses)}</strong></div>
    <MovementsTable entries={accountEntries} accounts={accounts} perspectiveAccountId={account.id} />
  </DetailDialog>;
}

function CategoryDialog({ open, onClose, category, amount, count, expensesTotal, entries, accounts }: {
  open: boolean; onClose: () => void; category: string | null; amount: bigint; count: number; expensesTotal: bigint;
  entries: readonly Movement[]; accounts: readonly Balance[];
}) {
  const percent = expensesTotal > 0n ? Number(amount) / Number(expensesTotal) * 100 : 0;
  const categoryEntries = entries.filter(e => e.type === "expense" && e.category === category);
  return <DetailDialog open={open} onClose={onClose} title={labelForCategory(category)}>
    <div className="zine-dialog-row"><span className="zine-label">Totale</span><strong className="zine-amount s1">{money(amount)}</strong></div>
    <div className="zine-dialog-row"><span className="zine-label">Quota sulle uscite</span><strong>{percent.toFixed(1).replace(".", ",")}%</strong></div>
    <div className="zine-dialog-row"><span className="zine-label">Movimenti</span><strong>{count}</strong></div>
    <MovementsTable entries={categoryEntries} accounts={accounts} />
  </DetailDialog>;
}

// Finestra di un giorno (click su una cella del calendario): totale, categorie e movimenti.
function DateDialog({ open, onClose, label, from, to, entries, accounts }: {
  open: boolean; onClose: () => void; label: string; from: string; to: string; entries: readonly Movement[]; accounts: readonly Balance[];
}) {
  // Quando non è la finestra aperta, from/to sono vuoti (nessuna data in corso): niente da
  // calcolare, il contenuto non è comunque visibile dietro il <dialog> chiuso.
  const rangeEntries = from ? entries.filter(e => e.date >= from && e.date <= to) : [];
  const totals = from ? statistics(rangeEntries, { mode: "day", from, to, label, current: false })
    : { income: 0n, expenses: 0n, buckets: [], categories: [], incomeCategories: [] };
  return <DetailDialog open={open} onClose={onClose} title={label}>
    <p className="zine-dialog-total"><strong className="zine-amount s1">{money(totals.expenses)}</strong></p>
    <CategoryBars categories={totals.categories} total={totals.expenses} />
    <MovementsTable entries={rangeEntries} accounts={accounts} />
  </DetailDialog>;
}

export function Dashboard({ client, sessionSignal }: ReadAccess) {
  const { signOut } = useAuth();
  const [today, setToday] = useState(todayInRome);
  const [period, setPeriod] = useState(() => dashboardPeriod("month", today, today));

  useEffect(() => {
    const updateDate = () => setToday(todayInRome());
    const timer = window.setInterval(updateDate, 60_000);
    document.addEventListener("visibilitychange", updateDate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateDate);
    };
  }, []);

  const selectPeriod = (offset: number) => setPeriod(dashboardPeriod(period.mode, shiftPeriod(period.mode, period.from, offset), today));
  const selectMode = (mode: PeriodMode) => { if (mode !== period.mode) setPeriod(dashboardPeriod(mode, today, today)); };

  return <div className="zine-page" id="dashboard">
    <a href="#contenuto" className="skip-link">Vai al contenuto principale</a>
    <div className="zine-wrap">
      <div className="zine-topbar">
        <a href="#dashboard" className="brand" aria-label="FinanceTracker, panoramica"><Brand /></a>
        <nav className="zine-nav" aria-label="Navigazione principale">
          {navigation.map(({ id, label }) => <a key={id} className="zine-link" href={`#${id}`} aria-current={id === "dashboard" ? "page" : undefined}>{label}</a>)}
        </nav>
        <button className="zine-link zine-link-sm" type="button" onClick={() => { void signOut(); }}><LogOut size={14} aria-hidden="true" />Esci</button>
      </div>
      <main id="contenuto" tabIndex={-1}>
        <h1 className="sr-only">Panoramica</h1>
        <DashboardContent client={client} sessionSignal={sessionSignal} period={period} today={today} selectPeriod={selectPeriod} selectMode={selectMode} />
      </main>
      <footer className="zine-footer"><Mascot state="happy" size={44} /><span>FinanceTracker · dati dal bot Telegram · sola lettura</span></footer>
    </div>
  </div>;
}

function DashboardContent({ client, sessionSignal, period, today, selectPeriod, selectMode }: ReadAccess & {
  period: Period; today: string; selectPeriod: (offset: number) => void; selectMode: (mode: PeriodMode) => void;
}) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
    <PeriodControls period={period} selectPeriod={selectPeriod} selectMode={selectMode} />
    <DashboardData key={`${period.mode}:${period.from}:${period.to}`} client={client} sessionSignal={sessionSignal} period={period} today={today} />
  </div>;
}

function PeriodControls({ period, selectPeriod, selectMode }: {
  period: Period; selectPeriod: (offset: number) => void; selectMode: (mode: PeriodMode) => void;
}) {
  return <div className="zine-period-row">
    <div className="zine-segmented zine-period-modes" role="group" aria-label="Scala temporale">
      {modeOrder.map(mode => <button key={mode} type="button" className="zine-segmented-item" aria-pressed={period.mode === mode}
        onClick={() => selectMode(mode)}>{periodModes[mode]}</button>)}
    </div>
    <div className="zine-period-bar" role="group" aria-label="Navigazione del periodo">
      <button className="zine-icon-button" type="button" aria-label={`${periodModes[period.mode]} precedente`}
        disabled={period.from <= firstDate} onClick={() => selectPeriod(-1)}><ChevronLeft size={18} /></button>
      <span className="zine-period-label" aria-live="polite">{period.label}</span>
      <button className="zine-icon-button" type="button" aria-label={`${periodModes[period.mode]} successivo`}
        disabled={period.current} onClick={() => selectPeriod(1)}><ChevronRight size={18} /></button>
    </div>
  </div>;
}
