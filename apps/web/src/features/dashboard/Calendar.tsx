import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMovements } from "./dashboard-data";
import { formatDay, money, monthLabel, shiftPeriod, statistics, type Movement } from "./dashboard-model";

const dayHeads = ["L", "M", "M", "G", "V", "S", "D"];
const levelColors = ["#FFF3B0", "#FFE14D", "#FF9F43", "#E63946"];

export function weekdayIndex(day: string): number {
  return (new Date(day).getUTCDay() + 6) % 7; // 0 = lunedì
}

// Ultimo giorno del mese "YYYY-MM", a differenza del Period del periodo principale non va
// mai troncato a oggi: il calendario mostra tutti i giorni del mese, solo quelli futuri
// restano disabilitati.
function monthEnd(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

// 4 gradi d'intensità sui soli giorni con spesa, a quartili di rango: il giorno più caro
// (ultimo quartile) è sempre il rosso più intenso. I giorni senza spesa restano bianchi,
// fuori dalla scala (Specifiche.dc.html: "Calendario · intensità in 4 gradi").
export function intensity(amount: bigint, spentDays: readonly bigint[]): string | undefined {
  if (amount === 0n) return undefined;
  const sorted = [...spentDays].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const rank = sorted.findIndex(value => value === amount);
  const group = Math.min(3, Math.floor((rank * 4) / sorted.length));
  return levelColors[3 - group];
}

type MonthState = { status: "loading" } | { status: "error" } | { status: "ready"; movements: Movement[] };

// Calendario con una propria navigazione mese per mese, indipendente dal periodo scelto in
// alto: i mesi già fuori dai dati caricati vengono letti da soli (con una cache in memoria,
// per non richiederli di nuovo quando si torna indietro e avanti).
export function Calendar({ client, sessionSignal, initialMonth, today, onSelectDay }: {
  client: SupabaseClient; sessionSignal: AbortSignal; initialMonth: string; today: string; onSelectDay: (date: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const cache = useRef(new Map<string, MonthState>());
  const [, setTick] = useState(0);
  const rerender = () => setTick(tick => tick + 1);

  useEffect(() => {
    if (cache.current.has(month)) return;
    const request = new AbortController();
    const signal = AbortSignal.any([sessionSignal, request.signal]);
    cache.current.set(month, { status: "loading" });
    rerender();
    void loadMovements(client, { from: `${month}-01`, to: monthEnd(month) }, signal).then(movements => {
      if (signal.aborted) return;
      cache.current.set(month, { status: "ready", movements });
      rerender();
    }).catch(() => {
      if (signal.aborted) return;
      cache.current.set(month, { status: "error" });
      rerender();
    });
    return () => {
      request.abort();
      // Due invocazioni dell'effetto (StrictMode in sviluppo) possono interrompere questa
      // richiesta prima che risponda: senza questo, il mese resterebbe bloccato su "loading"
      // per sempre, perché la cache lo marca già come richiesto.
      if (cache.current.get(month)?.status === "loading") cache.current.delete(month);
    };
  }, [client, month, sessionSignal]);

  const state = cache.current.get(month) ?? { status: "loading" };
  const monthStart = `${month}-01`;
  const canGoNext = month < today.slice(0, 7);
  const retry = () => { cache.current.delete(month); rerender(); };

  return <section className="zine-card" style={{ "--tilt": "-0.4deg", "--tape": "#9CC4FFcc" } as React.CSSProperties}>
    <div className="zine-card-body">
      <div className="zine-calendar-head">
        <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Calendario del mese</span></h2>
        <div className="zine-period-bar" role="group" aria-label="Navigazione del calendario">
          <button className="zine-icon-button" type="button" aria-label="Mese del calendario precedente" onClick={() => setMonth(m => shiftPeriod("month", `${m}-01`, -1).slice(0, 7))}>
            <ChevronLeft size={18} />
          </button>
          <span className="zine-period-label" aria-live="polite" style={{ fontSize: 17 }}>{monthLabel(monthStart)}</span>
          <button className="zine-icon-button" type="button" aria-label="Mese del calendario successivo" disabled={!canGoNext}
            onClick={() => setMonth(m => shiftPeriod("month", `${m}-01`, 1).slice(0, 7))}><ChevronRight size={18} /></button>
        </div>
      </div>
      {state.status === "loading" && <p role="status" style={{ margin: "14px 0 0" }}>Caricamento dei dati in corso…</p>}
      {state.status === "error" && <div style={{ margin: "14px 0 0" }}>
        <p role="alert" style={{ margin: "0 0 12px" }}>Impossibile caricare i dati del periodo.</p>
        <button className="zine-button" type="button" onClick={retry}>Riprova</button>
      </div>}
      {state.status === "ready" && <CalendarGrid movements={state.movements} monthStart={monthStart} today={today} onSelectDay={onSelectDay} />}
    </div>
  </section>;
}

function CalendarGrid({ movements, monthStart, today, onSelectDay }: {
  movements: readonly Movement[]; monthStart: string; today: string; onSelectDay: (date: string) => void;
}) {
  const nextMonth = shiftPeriod("month", monthStart, 1);
  const totals = statistics(movements, { mode: "day", from: monthStart, to: shiftPeriod("day", nextMonth, -1), label: "", current: false });
  const byDate = new Map(totals.buckets.map(bucket => [bucket.date, bucket.expenses]));
  const spentDays = totals.buckets.map(bucket => bucket.expenses).filter(amount => amount > 0n);
  const leading = weekdayIndex(monthStart);
  const cells: { date: string; future: boolean }[] = [];
  for (let date = monthStart; date < nextMonth; date = shiftPeriod("day", date, 1)) cells.push({ date, future: date > today });

  return <>
    <ul className="zine-calendar" aria-label="Spese giorno per giorno">
      {dayHeads.map((head, i) => <li className="zine-heading" key={i} aria-hidden="true" style={{ fontSize: 14 }}>{head}</li>)}
      {Array.from({ length: leading }, (_, i) => <li key={`pad-${i}`} aria-hidden="true" />)}
      {cells.map(cell => {
        const amount = byDate.get(cell.date);
        const day = Number(cell.date.slice(-2));
        const column = weekdayIndex(cell.date);
        const edge = column === 0 ? "is-tip-left" : column === 6 ? "is-tip-right" : "";
        if (cell.future || amount === undefined) return <li key={cell.date} className="zine-calendar-cell is-future">
          <span aria-hidden="true">{day}</span><span className="sr-only">{formatDay(cell.date)}: nessun dato</span>
        </li>;
        const background = intensity(amount, spentDays);
        return <li key={cell.date}>
          <button type="button" className={`zine-calendar-cell ${edge}`} style={background ? { background } : undefined} onClick={() => onSelectDay(cell.date)}>
            <span aria-hidden="true">{day}</span>
            <span className="zine-calendar-tip" role="tooltip">{formatDay(cell.date)}: {money(amount)}</span>
          </button>
        </li>;
      })}
    </ul>
    <p className="zine-key" style={{ marginTop: 14 }}>poco <i style={{ background: levelColors[0] }} /><i style={{ background: levelColors[1] }} />
      <i style={{ background: levelColors[2] }} /><i style={{ background: levelColors[3] }} /> tanto</p>
    <p className="zine-chart-note">Il colore indica quanto hai speso quel giorno rispetto agli altri del periodo: dal giallo chiaro (poco) al rosso (il giorno più caro).</p>
  </>;
}
