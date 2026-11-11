import { categoryIcon, otherIcon } from "./category-icons";
import { labelForCategory, money, type Period, type statistics } from "./dashboard-model";

type Statistics = ReturnType<typeof statistics>;
const wedgeColors = ["#E63946", "#FFE14D", "#1D4ED8", "#2A9D8F", "#FF9F43"];
const otherColor = "#BDB5A0";
const topCount = 5;

function wedgePoint(angleDeg: number, radius: number) {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
}

export function CategoryChart({ totals }: { totals: Statistics }) {
  const { expenses, categories } = totals;
  const top = categories.slice(0, topCount);
  const rest = categories.slice(topCount);
  const restTotal = rest.reduce((sum, { cents }) => sum + cents, 0n);
  const segments = [
    ...top.map(({ category, cents }, index) => ({ id: category, amount: cents, icon: categoryIcon(category), color: wedgeColors[index % wedgeColors.length] })),
    ...(restTotal > 0n ? [{ id: "__other__", amount: restTotal, icon: otherIcon, color: otherColor }] : []),
  ];

  let angle = -90;
  const wedges = segments.map(segment => {
    const share = Number(segment.amount) / Number(expenses);
    const sweep = share * 360;
    const start = wedgePoint(angle, 48);
    const end = wedgePoint(angle + sweep, 48);
    const large = sweep > 180 ? 1 : 0;
    const mid = angle + sweep / 2;
    const labelPoint = wedgePoint(mid, 30);
    angle += sweep;
    const percent = share * 100;
    return { ...segment, share, path: `M50 50L${start.x.toFixed(2)} ${start.y.toFixed(2)}A48 48 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}Z`, labelPoint, percent, mid };
  });
  const biggest = wedges[0];
  const badgePoint = biggest ? wedgePoint(biggest.mid, 60) : undefined;
  // aria-label (non <title>) perché <title> sull'svg crea un tooltip nativo del browser
  // che copre la torta al passaggio del mouse; desc/aria-label restano per la lettura assistita.
  const pieLabel = `Spese per categoria: ${wedges.map(w => `${labelForCategory(w.id === "__other__" ? null : w.id)} ${Math.round(w.percent)}%`).join(", ")}`;

  return <section className="zine-card zine-span-2" style={{ "--tilt": "-0.5deg", "--tape": "#8FE0A8cc" } as React.CSSProperties}>
    <div className="zine-card-body">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Dove vanno i soldi?</span></h2>
      {segments.length === 0 ? <p className="zine-chart-note">Nessuna spesa da ripartire nel periodo.</p> : <div className="zine-pie-row">
        <div className="zine-pie-wrap">
          <svg className="zine-pie" viewBox="0 0 100 100" role="img" aria-label={pieLabel}>
            {wedges.map(wedge => <path key={wedge.id} d={wedge.path} fill={wedge.color} stroke="#111" strokeWidth={1.6} strokeLinejoin="round" />)}
            {wedges.filter(w => w.percent >= 8).map(wedge => <text key={wedge.id} x={wedge.labelPoint.x} y={wedge.labelPoint.y}
              textAnchor="middle" dominantBaseline="central" fontFamily="Bowlby One" fontSize={8} fill="#fff" stroke="#111"
              strokeWidth={2} paintOrder="stroke" strokeLinejoin="round">{Math.round(wedge.percent)}%</text>)}
          </svg>
          {biggest && badgePoint && <span className="zine-pie-badge" style={{ "--bx": `${badgePoint.x}%`, "--by": `${badgePoint.y}%` } as React.CSSProperties}>la più grossa!</span>}
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <ul className="zine-legend">{wedges.map(wedge => <li className="zine-legend-row" key={wedge.id}>
            <i className="zine-swatch" style={{ background: wedge.color }} />
            <img className="zine-legend-icon" src={wedge.icon} alt="" />
            <span className="zine-legend-label">{wedge.id === "__other__" ? "Altre categorie" : labelForCategory(wedge.id)}</span>
            <span className="zine-legend-amount">{money(wedge.amount)}</span>
            <span className="zine-legend-pct">{wedge.percent < 0.5 ? "<1%" : `${Math.round(wedge.percent)}%`}</span>
          </li>)}</ul>
          {rest.length > 0 && <details className="zine-more">
            <summary>Mostra le altre {rest.length} categorie</summary>
            <ul className="zine-legend">{rest.map(({ category, cents }) => {
              const percent = Number(cents) / Number(expenses) * 100;
              return <li className="zine-legend-row is-compact" key={category ?? "null"}>
                <i className="zine-swatch" style={{ background: otherColor }} />
                <img className="zine-legend-icon" src={categoryIcon(category)} alt="" />
                <span className="zine-legend-label">{labelForCategory(category)}</span>
                <span className="zine-legend-amount">{money(cents)}</span>
                <span className="zine-legend-pct">{percent < 0.5 ? "<1%" : `${Math.round(percent)}%`}</span>
              </li>;
            })}</ul>
          </details>}
          {biggest && <p className="zine-chart-note">La fetta più grande è {labelForCategory(biggest.id === "__other__" ? null : biggest.id)}: {Math.round(biggest.percent)}% delle uscite.</p>}
        </div>
      </div>}
    </div>
  </section>;
}

const chartWidth = 480;
const chartHeight = 320;
const topMargin = 22;
const bottomMargin = 32;
const leftMargin = 10;
const rightMargin = 10;
const plotHeight = chartHeight - topMargin - bottomMargin;
// Meno spazio tra le barre quando sono tante (vista Mese/Anno), per tenerle larghe e leggibili.
const barGapFor = (n: number) => n > 20 ? 3 : n > 10 ? 5 : 10;
// Con pochi punti la linea mostra anche i marker; con molti (es. un mese intero) restano solo
// la linea e le barre, per non affollare il grafico.
const showDotsThreshold = 10;

// Oltre 2,2 volte il secondo valore la barra viene troncata, per non schiacciare le altre
// (Specifiche.dc.html: "barra tagliata ... oltre 2,2×"). Esportata per i test.
export function isTruncatedBar(values: readonly bigint[]): boolean {
  const sortedDesc = [...values].sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  const max = sortedDesc[0] ?? 0n;
  const second = sortedDesc[1] ?? 0n;
  return second > 0n && max > (second * 22n) / 10n;
}

export function SpendingChart({ totals, period }: { totals: Statistics; period: Period }) {
  const { buckets } = totals;
  const total = totals.expenses;
  const n = buckets.length;
  const title = period.mode === "year" ? "Spese mese per mese" : "Spese giorno per giorno";

  const values = buckets.map(b => b.expenses);
  const sortedDesc = [...values].sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  const max = sortedDesc[0] ?? 0n;
  const second = sortedDesc[1] ?? 0n;
  const truncated = isTruncatedBar(values);
  const scaleMax = truncated && second > 0n ? (second * 13n) / 10n : max;
  const barGap = barGapFor(n);
  const barWidth = n > 0 ? (chartWidth - leftMargin - rightMargin - barGap * (n - 1)) / n : 0;
  const x = (i: number) => leftMargin + i * (barWidth + barGap);
  const showDots = n <= showDotsThreshold;
  const barHeight = (value: bigint) => {
    if (scaleMax === 0n) return 0;
    const capped = value > scaleMax ? scaleMax : value;
    return Number(capped * BigInt(Math.round(plotHeight * 100)) / scaleMax) / 100;
  };
  let running = 0n;
  const cumulative = values.map(v => running += v);
  const cumulativeMax = cumulative.length > 0 ? cumulative[cumulative.length - 1] : 0n;
  const lineScaleMax = cumulativeMax > scaleMax ? cumulativeMax : scaleMax;
  const lineY = (value: bigint) => lineScaleMax === 0n ? chartHeight - bottomMargin
    : chartHeight - bottomMargin - Number(value * BigInt(Math.round(plotHeight * 100)) / lineScaleMax) / 100;
  const ticks = n > 0 ? [...new Set([0, Math.floor((n - 1) / 2), n - 1])] : [];

  return <section className="zine-card" style={{ "--tilt": "0.6deg", "--tape": "#FF9FB2cc" } as React.CSSProperties}>
    <div className="zine-card-body zine-chart-card">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">{title}</span></h2>
      {total === 0n ? <p className="zine-chart-note">Nessuna spesa contabilizzata nel periodo.</p> : <>
        <div className="zine-chart-fill">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}
          role="img" aria-label={`${title}. Totale ${money(total)}.`}>
          {buckets.map((bucket, i) => {
            const height = barHeight(bucket.expenses);
            const isTruncated = truncated && bucket.expenses === max;
            const barX = x(i);
            const barY = chartHeight - bottomMargin - height;
            return <g key={bucket.date}>
              <rect className="zine-bar" x={barX} y={barY} width={barWidth} height={Math.max(height, 1)}
                fill={isTruncated ? "#E63946" : "#FFE14D"} stroke="#111" strokeWidth={2.4}>
                <title>{`${bucket.label}: ${money(bucket.expenses)}`}</title>
              </rect>
              {isTruncated && <>
                <path d={`M${barX} ${barY + 10} l${barWidth / 3} -6 l${barWidth / 3} 12 l${barWidth / 3} -6`} fill="none" stroke="#fff" strokeWidth={5} />
                <path d={`M${barX} ${barY + 10} l${barWidth / 3} -6 l${barWidth / 3} 12 l${barWidth / 3} -6`} fill="none" stroke="#111" strokeWidth={2} />
                <text x={barX + barWidth / 2} y={barY - 6} textAnchor="middle" fontFamily="Bowlby One" fontSize={11}>{money(bucket.expenses)}</text>
              </>}
            </g>;
          })}
          <path className="zine-line" d={cumulative.map((amount, i) => `${i === 0 ? "M" : "L"}${x(i) + barWidth / 2} ${lineY(amount)}`).join(" ")}
            fill="none" stroke="#1D4ED8" strokeWidth={3} strokeLinejoin="round" />
          {showDots && cumulative.map((amount, i) => <circle key={buckets[i].date} cx={x(i) + barWidth / 2} cy={lineY(amount)} r={3.5} fill="#fff" stroke="#1D4ED8" strokeWidth={2.4} />)}
          {ticks.map(i => <text key={i} x={x(i) + barWidth / 2} y={chartHeight - 6} textAnchor="middle" fontFamily="Caveat" fontWeight={700} fontSize={16}>{buckets[i].label}</text>)}
        </svg>
        </div>
        <p className="zine-key"><i style={{ background: "#FFE14D" }} />spesa del periodo<i style={{ background: "#1D4ED8", marginLeft: 14 }} />totale cumulato</p>
        {truncated && <p className="zine-chart-note">Il valore più alto è tagliato per far vedere anche gli altri.</p>}
      </>}
    </div>
  </section>;
}
