import { formatDay, money, shiftPeriod, type statistics } from "./dashboard-model";

type Statistics = ReturnType<typeof statistics>;
const dayHeads = ["L", "M", "M", "G", "V", "S", "D"];
const levelColors = ["#FFF3B0", "#FFE14D", "#FF9F43", "#E63946"];

export function weekdayIndex(day: string): number {
  return (new Date(day).getUTCDay() + 6) % 7; // 0 = lunedì
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

export function Calendar({ totals, monthStart, today }: { totals: Statistics; monthStart: string; today: string }) {
  const nextMonth = shiftPeriod("month", monthStart, 1);
  const byDate = new Map(totals.buckets.map(bucket => [bucket.date, bucket.expenses]));
  const spentDays = totals.buckets.map(bucket => bucket.expenses).filter(amount => amount > 0n);
  const leading = weekdayIndex(monthStart);
  const cells: { date: string; future: boolean }[] = [];
  for (let date = monthStart; date < nextMonth; date = shiftPeriod("day", date, 1)) cells.push({ date, future: date > today });

  return <section className="zine-card" style={{ "--tilt": "-0.4deg", "--tape": "#9CC4FFcc" } as React.CSSProperties}>
    <div className="zine-card-body">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Calendario del mese</span></h2>
      <ul className="zine-calendar" aria-label="Spese giorno per giorno">
        {dayHeads.map((head, i) => <li className="zine-heading" key={i} aria-hidden="true" style={{ fontSize: 14 }}>{head}</li>)}
        {Array.from({ length: leading }, (_, i) => <li key={`pad-${i}`} aria-hidden="true" />)}
        {cells.map(cell => {
          const amount = byDate.get(cell.date);
          const day = Number(cell.date.slice(-2));
          if (cell.future || amount === undefined) return <li key={cell.date} className="zine-calendar-cell is-future">
            <span aria-hidden="true">{day}</span><span className="sr-only">{formatDay(cell.date)}: nessun dato</span>
          </li>;
          const background = intensity(amount, spentDays);
          return <li key={cell.date} className="zine-calendar-cell" tabIndex={0} style={background ? { background } : undefined}>
            <span aria-hidden="true">{day}</span>
            <span className="zine-calendar-tip" role="tooltip">{formatDay(cell.date)}: {money(amount)}</span>
          </li>;
        })}
      </ul>
      <p className="zine-key" style={{ marginTop: 14 }}>poco <i style={{ background: levelColors[0] }} /><i style={{ background: levelColors[1] }} />
        <i style={{ background: levelColors[2] }} /><i style={{ background: levelColors[3] }} /> tanto</p>
    </div>
  </section>;
}
