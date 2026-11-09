import { labelForCategory, money, type Period, type statistics } from "./dashboard-model";

type Statistics = ReturnType<typeof statistics>;
const colors = ["#76c8ab", "#9ab9d2", "#dfb68e", "#b6a4cc", "#e3a99d", "#bac787"];

export function SpendingChart({ totals, period }: { totals: Statistics; period: Period }) {
  const { expenses, buckets } = totals;
  let running = 0n;
  const cumulative = buckets.map(bucket => running += bucket.expenses);
  const n = buckets.length;
  const x = (index: number) => 72 + 382 * (index + 1) / n;
  const y = (amount: bigint) => 200 - Number(amount * 18_000n / expenses) / 100;
  const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const periodNoun = period.mode === "year" ? "dall'inizio dell'anno" : period.mode === "month" ? "da inizio mese"
    : period.mode === "week" ? "da inizio settimana" : "oggi";

  return <section className="glass chart-panel" id="analisi" aria-labelledby="spending-title">
    <div className="panel-heading"><h2 id="spending-title">Andamento delle spese</h2><span className="period-tag">{period.label}</span></div>
    {expenses === 0n ? <p className="quiet-label">Nessuna spesa contabilizzata nel periodo.</p> : <>
      <div className="chart-summary"><strong>{money(expenses)}</strong><span>Spese {periodNoun}</span></div>
      <svg className="spending-chart" viewBox="0 0 480 232" role="img" aria-labelledby="spending-svg-title spending-svg-description">
        <title id="spending-svg-title">Andamento delle spese · {period.label}</title>
        <desc id="spending-svg-description">{ticks.map(i => `${buckets[i].label} · ${money(cumulative[i])}`).join(". ")}</desc>
        <g className="chart-grid"><path d="M72 20H454M72 65H454M72 110H454M72 155H454M72 200H454" /></g>
        <g className="chart-labels">
          <text x="0" y="24">{money(expenses)}</text><text x="0" y="204">{money(0n)}</text>
          {ticks.map(i => <text key={i} x={x(i)} y="225" textAnchor="end">{buckets[i].label}</text>)}
        </g>
        <polyline className="spending-line" points={[`${x(-1)},200`, ...cumulative.map((amount, index) => `${x(index)},${y(amount)}`)].join(" ")} fill="none" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </>}
    <p className="panel-footnote">Trasferimenti e movimenti annullati esclusi</p>
  </section>;
}

export function CategoryChart({ totals, period }: { totals: Statistics; period: Period }) {
  const { expenses, categories } = totals;
  let start = 0n;
  const segments = categories.map(([category, amount], index) => {
    const end = start + amount;
    const offset = Number(start * 10_000n / expenses) / 100;
    const length = Number(end * 10_000n / expenses) / 100 - offset;
    start = end;
    return { category, amount, offset, length, color: colors[index % colors.length],
      share: (amount * 100n + expenses / 2n) / expenses };
  });
  return <section className="glass category-panel" aria-labelledby="categories-title">
    <div className="panel-heading"><h2 id="categories-title">Spese per categoria</h2><span className="period-tag">{period.label}</span></div>
    {segments.length === 0 ? <p className="quiet-label">Nessuna spesa da ripartire nel periodo.</p> : <>
      <div className="category-content">
        <div className="donut-wrap" role="img" aria-label={`Uscite totali ${money(expenses)}. Ripartizione nella legenda.`}>
          <div className="donut">
            <svg className="donut-svg" viewBox="0 0 200 200" aria-hidden="true">
              <circle className="donut-track" cx="100" cy="100" r="83" fill="none" strokeWidth="17" />
              {segments.map(segment => <circle key={segment.category} className="donut-segment" cx="100" cy="100" r="83" pathLength="100"
                fill="none" stroke={segment.color} strokeDasharray={`${segment.length} ${100 - segment.length}`} strokeDashoffset={-segment.offset} />)}
            </svg>
            <div className="donut-center"><span>Uscite totali</span><strong>{money(expenses)}</strong></div>
          </div>
        </div>
        <ul className="category-legend">{segments.map(segment => <li key={segment.category}>
          <span className="legend-dot" style={{ background: segment.color }} aria-hidden="true" />
          <span>{labelForCategory(segment.category)}</span><strong>{segment.share.toString()}%</strong><span className="sr-only">, {money(segment.amount)}</span>
        </li>)}</ul>
      </div>
      <p className="panel-footnote">Quote arrotondate</p>
    </>}
  </section>;
}
