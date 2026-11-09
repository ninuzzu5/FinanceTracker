import { useState } from "react";
import { categoryIcon, transferIcon } from "./category-icons";
import { AccountLogo } from "./AccountLogo";
import { formatDay, labelForCategory, money, type Balance, type Movement } from "./dashboard-model";

const displayPageSize = 9;
const filters = [
  { id: "all", label: "Tutti", test: () => true },
  { id: "income", label: "Entrate", test: (m: Movement) => m.type === "income" },
  { id: "expense", label: "Uscite", test: (m: Movement) => m.type === "expense" },
  { id: "transfer", label: "Trasferimenti", test: (m: Movement) => m.type === "transfer" },
] as const;

export function Movements({ entries, accounts }: { entries: Movement[]; accounts: Balance[] }) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [visible, setVisible] = useState(displayPageSize);
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const nameOf = (id: string | null) => id ? accountNames.get(id) ?? "Conto non disponibile" : "—";
  const filtered = entries.filter(filters.find(f => f.id === filter)!.test);

  return <div className="zine-card" style={{ "--tilt": "-0.3deg", "--tape": "#2A9D8Fcc" } as React.CSSProperties}>
    <div className="zine-card-body zine-torn" id="movimenti">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Movimenti</span></h2>
      <div className="zine-filters" role="group" aria-label="Filtra per tipo">
        {filters.map(f => <button key={f.id} type="button" className="zine-link zine-link-sm" aria-pressed={filter === f.id}
          onClick={() => { setFilter(f.id); setVisible(displayPageSize); }}>{f.label}</button>)}
      </div>
      <p className="zine-chart-note" style={{ margin: "0 0 10px" }}>Trasferimenti e movimenti annullati restano qui, ma non entrano nei totali e nei grafici.</p>
      {filtered.length === 0 ? <p className="zine-chart-note">Nessun movimento nel periodo.</p> : <>
        <div className="zine-table-scroll">
          <table className="zine-table">
            <caption className="sr-only">Movimenti del periodo selezionato</caption>
            <colgroup><col className="c1" /><col className="c2" /><col className="c3" /><col className="c4" /></colgroup>
            <thead><tr><th scope="col">Data</th><th scope="col">Categoria</th><th scope="col">Conto</th><th scope="col" style={{ textAlign: "right" }}>Importo</th></tr></thead>
            <tbody>{filtered.slice(0, visible).map(movement => {
              const transfer = movement.type === "transfer";
              const icon = transfer ? transferIcon : categoryIcon(movement.category);
              const label = transfer ? "Trasferimento" : labelForCategory(movement.category);
              return <tr key={movement.id} className={movement.voided ? "zine-void" : undefined}>
                <td className="zine-date-cell"><time dateTime={movement.date}>{formatDay(movement.date)}</time>{movement.voided && <div><span className="zine-chip-static">ANNULLATO</span></div>}</td>
                <td><span className="zine-category-cell"><img src={icon} alt="" />
                  <span className={movement.voided ? "zine-strike" : undefined}>{label}</span></span></td>
                <td>{transfer
                  ? <span className="zine-route"><AccountLogo name={nameOf(movement.from)} /><span aria-hidden="true">→</span><span className="sr-only">verso</span><AccountLogo name={nameOf(movement.to)} /></span>
                  : <AccountLogo name={nameOf(movement.type === "expense" ? movement.from : movement.to)} />}</td>
                <td className="zine-amount-cell" style={transfer ? { color: "#1D4ED8" } : movement.type === "income" ? { color: "#0B7A57" } : undefined}>
                  {movement.type === "income" && "+"}{money(movement.type === "expense" ? -movement.cents : movement.cents)}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {visible < filtered.length && <div className="zine-more-button">
          <button className="zine-button" type="button" onClick={() => setVisible(count => count + displayPageSize)}>
            Mostra altri {Math.min(displayPageSize, filtered.length - visible)} movimenti
          </button>
        </div>}
      </>}
    </div>
  </div>;
}
