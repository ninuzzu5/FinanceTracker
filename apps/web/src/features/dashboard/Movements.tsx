import { useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowRightLeft, ArrowUpRight } from "lucide-react";
import { transactionTypeLabels } from "@finance-tracker/domain";
import { formatDay, labelForCategory, money, type Balance, type Movement, type Period } from "./dashboard-model";

const displayPageSize = 25;
const icons = { income: ArrowDownLeft, expense: ArrowUpRight, transfer: ArrowRightLeft };

export function Movements({ entries, accounts, period }: { entries: Movement[]; accounts: Balance[]; period: Period }) {
  const [visible, setVisible] = useState(displayPageSize);
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const nameOf = (id: string | null) => id ? accountNames.get(id) ?? "Conto non disponibile" : "—";

  return <section className="glass movements-panel" id="movimenti" aria-labelledby="movements-title">
    <div className="panel-heading"><h2 id="movements-title">Movimenti</h2><span className="period-tag">{period.label}</span></div>
    {entries.length === 0 ? <p className="quiet-label">Nessun movimento nel periodo.</p> : <>
      <div className="table-scroll" role="region" aria-label="Movimenti, scorrimento orizzontale" tabIndex={0}>
        <table id="movements-table"><caption className="sr-only">Movimenti · {period.label}</caption>
          <thead><tr><th scope="col">Data</th><th scope="col">Operazione</th><th scope="col">Categoria</th><th scope="col">Conto</th><th scope="col" className="amount-cell">Importo</th></tr></thead>
          <tbody>{entries.slice(0, visible).map(movement => {
            const Icon = icons[movement.type];
            return <tr key={movement.id} className={movement.voided ? "movement-voided" : undefined}>
              <td><time dateTime={movement.date}>{formatDay(movement.date)}</time></td>
              <td><span className="movement-description">
                <span className={`movement-icon ${movement.type === "income" ? "mint-icon" : movement.type === "transfer" ? "blue-icon" : ""}`}><Icon size={18} aria-hidden="true" /></span>
                {transactionTypeLabels[movement.type]}{movement.voided && <span className="voided-badge">Annullato</span>}
              </span></td>
              <td>{movement.type === "transfer" ? "—" : <span className="category-pill">{labelForCategory(movement.category)}</span>}</td>
              <td>{movement.type === "transfer" ? <span className="transfer-accounts">{nameOf(movement.from)}
                <ArrowRight size={12} aria-hidden="true" /><span className="sr-only">verso</span> {nameOf(movement.to)}</span>
                : nameOf(movement.type === "expense" ? movement.from : movement.to)}</td>
              <td className={`amount-cell amount-${movement.type}`}>{movement.type === "income" && "+"}{money(movement.type === "expense" ? -movement.cents : movement.cents)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {visible < entries.length && <button className="text-button dashboard-more" type="button" aria-controls="movements-table"
        onClick={() => setVisible(visible + displayPageSize)}>Mostra altri movimenti</button>}
    </>}
  </section>;
}
