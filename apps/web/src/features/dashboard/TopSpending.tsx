import { categoryIcon } from "./category-icons";
import { formatDay, labelForCategory, money, type Balance, type Movement } from "./dashboard-model";

const topCount = 5;

export function TopSpending({ entries, accounts }: { entries: readonly Movement[]; accounts: readonly Balance[] }) {
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const top = entries
    .filter(entry => entry.type === "expense" && !entry.voided)
    .sort((a, b) => (a.cents > b.cents ? -1 : a.cents < b.cents ? 1 : 0))
    .slice(0, topCount);
  const max = top[0]?.cents ?? 1n;

  return <section className="zine-card" style={{ "--tilt": "0.6deg", "--tape": "#8FE0A8cc" } as React.CSSProperties}>
    <div className="zine-card-body">
      <h2 className="zine-heading zine-heading-md"><span className="zine-highlight">Le 5 spese più grosse</span></h2>
      {top.length === 0 ? <p className="zine-chart-note">Nessuna spesa nel periodo.</p> : <ol className="zine-top-list">
        {top.map((movement, index) => {
          const share = Number(movement.cents * 1000n / max) / 10;
          return <li className="zine-top-row" key={movement.id}>
            <span className="zine-top-rank zine-heading" style={{ fontFamily: "'Bowlby One'" }}>{index + 1}</span>
            <img className="zine-top-icon" src={categoryIcon(movement.category)} alt="" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="zine-top-title">{labelForCategory(movement.category)}</div>
              <div className="zine-top-sub">{formatDay(movement.date)} · {accountNames.get(movement.from ?? "") ?? "Conto non disponibile"}</div>
              <div className="zine-top-bar"><i style={{ width: `${share}%` }} /></div>
            </div>
            <b className="zine-top-amount">{money(movement.cents)}</b>
          </li>;
        })}
      </ol>}
    </div>
  </section>;
}
