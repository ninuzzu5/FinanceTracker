import { useState } from "react";
import { categoryIcon, transferIcon } from "./category-icons";
import { AccountLogo } from "./AccountLogo";
import { formatDay, labelForCategory, money, type Balance, type Movement } from "./dashboard-model";

const defaultPageSize = 9;

// Tabella + paginazione "Mostra altri N", condivisa dalla tabella Movimenti e da tutte le
// finestre di dettaglio: un'unica riga per movimento, mai duplicata.
// `perspectiveAccountId`, se presente, mostra i trasferimenti dal punto di vista di quel
// conto: un solo badge (la controparte) e il segno +/- invece della coppia origine→destinazione.
export function MovementsTable({ entries, accounts, perspectiveAccountId, pageSize = defaultPageSize }: {
  entries: readonly Movement[]; accounts: readonly Balance[]; perspectiveAccountId?: string; pageSize?: number;
}) {
  const [visible, setVisible] = useState(pageSize);
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const nameOf = (id: string | null) => id ? accountNames.get(id) ?? "Conto non disponibile" : "—";

  if (entries.length === 0) return <p className="zine-chart-note">Nessun movimento nel periodo.</p>;

  return <>
    <div className="zine-table-scroll">
      <table className="zine-table">
        <caption className="sr-only">Movimenti</caption>
        <colgroup><col className="c1" /><col className="c2" /><col className="c3" /><col className="c4" /></colgroup>
        <thead><tr><th scope="col">Data</th><th scope="col">Categoria</th><th scope="col">Conto</th><th scope="col" style={{ textAlign: "right" }}>Importo</th></tr></thead>
        <tbody>{entries.slice(0, visible).map(movement => {
          const transfer = movement.type === "transfer";
          const icon = transfer ? transferIcon : categoryIcon(movement.category);
          const label = transfer ? "Trasferimento" : labelForCategory(movement.category);
          // Dal punto di vista del conto: un'uscita verso la controparte è negativa, un'entrata è positiva.
          const outgoing = transfer && perspectiveAccountId ? movement.from === perspectiveAccountId : movement.type === "expense";
          const counterpart = transfer && perspectiveAccountId
            ? (movement.from === perspectiveAccountId ? movement.to : movement.from)
            : (movement.type === "expense" ? movement.from : movement.to);
          return <tr key={movement.id} className={movement.voided ? "zine-void" : undefined}>
            <td className="zine-date-cell"><time dateTime={movement.date}>{formatDay(movement.date)}</time>{movement.voided && <div><span className="zine-chip-static">ANNULLATO</span></div>}</td>
            <td><span className="zine-category-cell"><img src={icon} alt="" />
              <span className={movement.voided ? "zine-strike" : undefined}>{label}</span></span></td>
            <td>{transfer && !perspectiveAccountId
              ? <span className="zine-route"><AccountLogo name={nameOf(movement.from)} /><span aria-hidden="true">→</span><span className="sr-only">verso</span><AccountLogo name={nameOf(movement.to)} /></span>
              : <AccountLogo name={nameOf(counterpart)} />}</td>
            <td className="zine-amount-cell" style={transfer && !perspectiveAccountId ? { color: "#1D4ED8" } : !outgoing ? { color: "#0B7A57" } : undefined}>
              {!outgoing && "+"}{money(outgoing ? -movement.cents : movement.cents)}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {visible < entries.length && <div className="zine-more-button">
      <button className="zine-button" type="button" onClick={() => setVisible(count => count + pageSize)}>
        Mostra altri {Math.min(pageSize, entries.length - visible)} movimenti
      </button>
    </div>}
  </>;
}
