import { useState } from "react";
import { MovementsTable } from "./MovementsTable";
import { labelForCategory, type Balance, type Movement } from "./dashboard-model";

const filters = [
  { id: "all", label: "Tutti", test: () => true },
  { id: "income", label: "Entrate", test: (m: Movement) => m.type === "income" },
  { id: "expense", label: "Uscite", test: (m: Movement) => m.type === "expense" },
  { id: "transfer", label: "Trasferimenti", test: (m: Movement) => m.type === "transfer" },
] as const;

const allValue = "all";
const noCategory = "__none__";
const categoryKey = (category: string | null) => category ?? noCategory;

export function Movements({ entries, accounts }: { entries: Movement[]; accounts: Balance[] }) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [account, setAccount] = useState(allValue);
  const [category, setCategory] = useState(allValue);

  // Solo le categorie presenti nel periodo, con quanti movimenti hanno. I trasferimenti non hanno categoria.
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.type !== "transfer") counts.set(categoryKey(entry.category), (counts.get(categoryKey(entry.category)) ?? 0) + 1);
  const categoryLabel = (key: string) => labelForCategory(key === noCategory ? null : key);
  const categoryOptions = [...counts].sort((a, b) => b[1] - a[1] || categoryLabel(a[0]).localeCompare(categoryLabel(b[0]), "it"));
  // Se il periodo cambia e la categoria scelta non esiste più, il filtro torna su "Tutte".
  const activeCategory = counts.has(category) ? category : allValue;
  const activeAccount = account === allValue || accounts.some(a => a.id === account) ? account : allValue;

  const filtered = entries.filter(filters.find(f => f.id === filter)!.test)
    .filter(entry => activeAccount === allValue || entry.from === activeAccount || entry.to === activeAccount)
    .filter(entry => activeCategory === allValue || entry.type !== "transfer" && categoryKey(entry.category) === activeCategory);
  const filtering = filter !== "all" || activeAccount !== allValue || activeCategory !== allValue;
  const reset = () => { setFilter("all"); setAccount(allValue); setCategory(allValue); };

  return <div className="zine-card" style={{ "--tilt": "-0.3deg", "--tape": "#2A9D8Fcc" } as React.CSSProperties}>
    <div className="zine-card-body zine-torn" id="movimenti">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Movimenti</span></h2>
      <div className="zine-filters" role="group" aria-label="Filtra per tipo">
        {filters.map(f => <button key={f.id} type="button" className="zine-link zine-link-sm" aria-pressed={filter === f.id}
          onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <div className="zine-filters">
        <select className="zine-select" aria-label="Filtra per conto" value={activeAccount} onChange={event => setAccount(event.target.value)}>
          <option value={allValue}>Tutti i conti</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="zine-select" aria-label="Filtra per categoria" value={activeCategory} onChange={event => setCategory(event.target.value)}>
          <option value={allValue}>Tutte le categorie</option>
          {categoryOptions.map(([key, count]) => <option key={key} value={key}>{categoryLabel(key)} ({count})</option>)}
        </select>
      </div>
      <div className="zine-filter-summary">
        <p className="zine-chart-note" aria-live="polite">{filtered.length} {filtered.length === 1 ? "movimento" : "movimenti"}</p>
        {filtering && <button type="button" className="zine-link zine-link-sm" onClick={reset}>Azzera filtri</button>}
      </div>
      <p className="zine-chart-note" style={{ margin: "0 0 10px" }}>Trasferimenti e movimenti annullati restano qui, ma non entrano nei totali e nei grafici.</p>
      <MovementsTable key={`${filter}|${activeAccount}|${activeCategory}`} entries={filtered} accounts={accounts} />
    </div>
  </div>;
}
