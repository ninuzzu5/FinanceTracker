import { useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowRightLeft, ArrowUpRight, Banknote, Music2, ShoppingBasket, TrainFront, Utensils, Clapperboard } from "lucide-react";
import { accountLabels, categoryLabels, transactionTypeLabels } from "@finance-tracker/domain";
import { demoMovements } from "../../data/demo";

export function Movements() {
  const [expanded, setExpanded] = useState(false);
  const movements = expanded ? demoMovements : demoMovements.slice(0, 5);
  return <section className="glass movements-panel" id="movimenti" aria-labelledby="movements-title">
    <div className="panel-heading"><div><h2 id="movements-title">Ultimi movimenti</h2></div><button className="text-button" type="button" aria-expanded={expanded} aria-controls="movements-table" onClick={() => setExpanded(!expanded)}>{expanded ? "Mostra meno" : "Mostra tutti"}<ArrowRight size={16} aria-hidden="true" /></button></div>
    <div className="table-scroll" role="region" aria-label="Movimenti, scorrimento orizzontale" tabIndex={0}>
      <table id="movements-table"><caption className="sr-only">Movimenti di ottobre 2026. I trasferimenti non contribuiscono a entrate e uscite.</caption><thead><tr><th scope="col">Data</th><th scope="col">Descrizione</th><th scope="col">Categoria</th><th scope="col">Conto</th><th scope="col" className="amount-cell">Importo</th></tr></thead>
        <tbody>{movements.map(movement => {
          const Icon = movement.type === "transfer" ? ArrowRightLeft : movement.type === "income" ? Banknote : movement.category === "subscriptions" ? Music2 : movement.category === "groceries" ? ShoppingBasket : movement.category === "public_transport" ? TrainFront : movement.category === "food" ? Utensils : Clapperboard;
          return <tr key={movement.id}>
            <td><time dateTime={movement.date}>{movement.dateLabel}</time></td>
            <td><span className="movement-description"><span className={`movement-icon ${movement.type === "income" ? "mint-icon" : movement.type === "transfer" ? "blue-icon" : ""}`}><Icon size={18} aria-hidden="true" /></span>{movement.description}</span></td>
            <td>{movement.type === "transfer" ? <span className="category-pill transfer-pill">Trasferimento</span> : <span className={`category-pill category-${movement.category}`}>{categoryLabels[movement.category]}</span>}</td>
            <td>{movement.type === "transfer" ? <span className="transfer-accounts">{accountLabels[movement.fromAccount]} <ArrowRight size={12} aria-hidden="true" /><span className="sr-only">verso</span> {accountLabels[movement.toAccount]}</span> : accountLabels[movement.account]}</td>
            <td className={`amount-cell amount-${movement.type}`}><span className="sr-only">{transactionTypeLabels[movement.type]}: </span>{movement.type === "income" ? <ArrowDownLeft size={14} aria-hidden="true" /> : movement.type === "expense" ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowRightLeft size={14} aria-hidden="true" />}{movement.amount}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
