import { categoryLabels } from "@finance-tracker/domain";
import { demo, demoCategories, demoSpendingChart } from "../../data/demo";

export function SpendingChart() {
  return <section className="glass chart-panel" id="analisi" aria-labelledby="spending-title">
    <div className="panel-heading"><h2 id="spending-title">Andamento delle spese</h2><span className="period-tag">Ottobre</span></div>
    <div className="chart-summary"><strong>{demo.expenses}</strong><span>Spese da inizio mese</span></div>
    <svg className="spending-chart" viewBox="0 0 480 232" role="img" aria-labelledby="spending-svg-title spending-svg-description">
      <title id="spending-svg-title">Andamento delle spese a ottobre 2026</title>
      <desc id="spending-svg-description">{demoSpendingChart.description}</desc>
      <defs><linearGradient id="spending-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-accent)" stopOpacity=".15" /><stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" /></linearGradient></defs>
      <g className="chart-grid"><path d="M48 20H454M48 65H454M48 110H454M48 155H454M48 200H454" /><path className="vertical-grid" d="M48 20V200M146 20V200M244 20V200M342 20V200M454 20V200" /></g>
      <g className="chart-labels"><text x="0" y="24">2.000 €</text><text x="0" y="69">1.500 €</text><text x="0" y="114">1.000 €</text><text x="7" y="159">500 €</text><text x="20" y="204">0 €</text><text x="48" y="225">1 ott</text><text x="135" y="225">8 ott</text><text x="230" y="225">15 ott</text><text x="328" y="225">22 ott</text><text x="426" y="225">30 ott</text></g>
      <path d={demoSpendingChart.area} fill="url(#spending-fill)" />
      <path className="spending-line-underlay" d={demoSpendingChart.line} fill="none" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
      <path className="spending-line" d={demoSpendingChart.line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="454" cy="25.204" r="7" fill="var(--color-accent)" opacity=".08" /><circle cx="454" cy="25.204" r="3" fill="var(--color-accent)" stroke="#d3f3e7" strokeWidth="1" />
    </svg>
    <p className="panel-footnote">Trasferimenti esclusi</p>
  </section>;
}

export function CategoryChart() {
  return <section className="glass category-panel" aria-labelledby="categories-title">
    <div className="panel-heading"><h2 id="categories-title">Spese per categoria</h2><span className="period-tag">Questo mese</span></div>
    <div className="category-content">
      <div className="donut-wrap" role="img" aria-label={`Spese totali: ${demo.expenses}. La ripartizione completa è elencata di seguito.`}>
        <div className="donut">
          <svg className="donut-svg" viewBox="0 0 200 200" aria-hidden="true">
            <circle className="donut-track" cx="100" cy="100" r="83" fill="none" strokeWidth="17" />
            {demoCategories.map(category => <circle key={category.id} className="donut-segment" cx="100" cy="100" r="83" pathLength="100" fill="none" stroke={category.color} strokeDasharray={category.arc} strokeDashoffset={category.offset} />)}
          </svg>
          <div className="donut-center"><span>Uscite totali</span><strong>{demo.expenses}</strong></div>
        </div>
      </div>
      <ul className="category-legend">{demoCategories.map(category => <li key={category.id}><span className="legend-dot" style={{ background: category.color }} aria-hidden="true" /><span>{categoryLabels[category.id]}</span><strong>{category.share}</strong><span className="sr-only">, {category.amount}</span></li>)}</ul>
    </div>
    <p className="panel-footnote">Quote arrotondate</p>
  </section>;
}
