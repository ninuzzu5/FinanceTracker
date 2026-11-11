import { useState } from "react";
import { MovementsTable } from "./MovementsTable";
import type { Balance, Movement } from "./dashboard-model";

const filters = [
  { id: "all", label: "Tutti", test: () => true },
  { id: "income", label: "Entrate", test: (m: Movement) => m.type === "income" },
  { id: "expense", label: "Uscite", test: (m: Movement) => m.type === "expense" },
  { id: "transfer", label: "Trasferimenti", test: (m: Movement) => m.type === "transfer" },
] as const;

export function Movements({ entries, accounts }: { entries: Movement[]; accounts: Balance[] }) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const filtered = entries.filter(filters.find(f => f.id === filter)!.test);

  return <div className="zine-card" style={{ "--tilt": "-0.3deg", "--tape": "#2A9D8Fcc" } as React.CSSProperties}>
    <div className="zine-card-body zine-torn" id="movimenti">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Movimenti</span></h2>
      <div className="zine-filters" role="group" aria-label="Filtra per tipo">
        {filters.map(f => <button key={f.id} type="button" className="zine-link zine-link-sm" aria-pressed={filter === f.id}
          onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <p className="zine-chart-note" style={{ margin: "0 0 10px" }}>Trasferimenti e movimenti annullati restano qui, ma non entrano nei totali e nei grafici.</p>
      <MovementsTable key={filter} entries={filtered} accounts={accounts} />
    </div>
  </div>;
}
