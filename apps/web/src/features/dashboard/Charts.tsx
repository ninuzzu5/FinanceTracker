import { categoryIcon } from "./category-icons";
import { categoryStyle } from "./category-colors";
import { labelForCategory, money, type statistics } from "./dashboard-model";

type Statistics = ReturnType<typeof statistics>;
const percentFormat = (percent: number) => (percent < 0.05 ? "<0,1" : percent.toFixed(1).replace(".", ",")) + "%";

function wedgePoint(angleDeg: number, radius: number) {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
}

// Trama a righe diagonali per le categorie che condividono un colore della tavolozza
// (category-colors.ts): la distinzione non si affida solo al colore.
function PieHatchDef() {
  return <pattern id="zine-pie-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1={0} y1={0} x2={0} y2={5} stroke="#111" strokeWidth={2.4} opacity={0.4} />
  </pattern>;
}

export function CategoryChart({ totals, onSelectCategory }: { totals: Statistics; onSelectCategory: (category: string | null) => void }) {
  const { expenses, categories } = totals;
  const segments = categories.map(({ category, cents, count }) => ({ category, amount: cents, count, icon: categoryIcon(category), ...categoryStyle(category) }));

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
    return { ...segment, share, path: `M50 50L${start.x.toFixed(2)} ${start.y.toFixed(2)}A48 48 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}Z`, labelPoint, percent };
  });
  // aria-label (non <title>) perché <title> sull'svg crea un tooltip nativo del browser
  // che copre la torta al passaggio del mouse; desc/aria-label restano per la lettura assistita.
  const pieLabel = `Spese per categoria: ${wedges.map(w => `${labelForCategory(w.category)} ${Math.round(w.percent)}%`).join(", ")}`;

  return <section className="zine-card" style={{ "--tilt": "-0.5deg", "--tape": "#8FE0A8cc" } as React.CSSProperties}>
    <div className="zine-card-body">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Dove vanno i soldi?</span></h2>
      {segments.length === 0 ? <p className="zine-chart-note">Nessuna spesa da ripartire nel periodo.</p> : <>
        <p className="zine-pie-headline">Hai speso {money(expenses)} in {categories.length} {categories.length === 1 ? "categoria" : "categorie"}</p>
        <div className="zine-pie-row">
          <div className="zine-pie-wrap">
            <svg className="zine-pie" viewBox="0 0 100 100" role="img" aria-label={pieLabel}>
              <defs><PieHatchDef /></defs>
              {wedges.map(wedge => <g key={wedge.category ?? "null"} role="button" tabIndex={0} className="zine-pie-wedge"
                aria-label={`${labelForCategory(wedge.category)}: ${money(wedge.amount)}, ${percentFormat(wedge.percent)}`}
                onClick={() => onSelectCategory(wedge.category)}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectCategory(wedge.category); } }}>
                <path d={wedge.path} fill={wedge.color} stroke="#111" strokeWidth={1.6} strokeLinejoin="round" />
                {wedge.hatched && <path d={wedge.path} fill="url(#zine-pie-hatch)" />}
                {wedge.percent >= 5 && <text x={wedge.labelPoint.x} y={wedge.labelPoint.y}
                  textAnchor="middle" dominantBaseline="central" fontFamily="Bowlby One" fontSize={8} fill="#fff" stroke="#111"
                  strokeWidth={2} paintOrder="stroke" strokeLinejoin="round">{Math.round(wedge.percent)}%</text>}
              </g>)}
            </svg>
          </div>
          <ul className="zine-legend" aria-label="Categorie di spesa">{wedges.map(wedge => <li key={wedge.category ?? "null"}>
            <button type="button" className="zine-legend-button" onClick={() => onSelectCategory(wedge.category)}>
              <i className={`zine-swatch ${wedge.hatched ? "is-hatched" : ""}`} style={{ background: wedge.color }} />
              <img className="zine-legend-icon" src={wedge.icon} alt="" />
              <span className="zine-legend-label">{labelForCategory(wedge.category)}</span>
              <span className="zine-legend-count">{wedge.count}×</span>
              <span className="zine-legend-amount">{money(wedge.amount)}</span>
              <span className="zine-legend-pct">{percentFormat(wedge.percent)}</span>
            </button>
          </li>)}</ul>
        </div>
      </>}
    </div>
  </section>;
}
