import { categoryLabels, transactionTypeLabels } from '@finance-tracker/domain';
import type { InlineKeyboard } from './proposal-view.js';
import { euro } from './money-view.js';
export { euro, historyCents } from './money-view.js';
export interface HistoryCursor { date: string; id: string }
export interface HistoryMovement { id: string; date: string; type: 'expense' | 'income' | 'transfer'; amount: string; category: string | null; from: string | null; to: string | null }
export interface HistoryPage { rows: HistoryMovement[]; next: HistoryCursor | null }
export interface HistoryRepository { getMovements(cursor: HistoryCursor | null): Promise<HistoryPage> }
export interface HistoryState { kind: 'history'; id: string; revision: number; page: number; cursors: (HistoryCursor | null)[]; next: HistoryCursor | null; loading: boolean }
export function movementText(row: HistoryMovement): string {
  return [
    `${transactionTypeLabels[row.type]} · ${euro(row.amount, row.type === 'income' ? '+' : row.type === 'expense' ? '−' : '')}`,
    `Data: ${row.date.split('-').reverse().join('/')}`,
    row.type === 'transfer' ? `${row.from} → ${row.to}` : `Conto: ${row.type === 'expense' ? row.from : row.to}`,
    ...(row.type === 'transfer' ? [] : [`Categoria: ${row.category ? categoryLabels[row.category as keyof typeof categoryLabels] ?? row.category : 'Non disponibile'}`]),
  ].join('\n');
}
export function historyView(state: HistoryState, page: HistoryPage): {text: string; keyboard: InlineKeyboard} {
  const navigation = [
    ...(state.page ? [{text:'⬅️ Indietro',callback_data:`h:${state.id}:${state.revision}:back`}] : []),
    ...(page.next ? [{text:'Avanti ➡️',callback_data:`h:${state.id}:${state.revision}:next`}] : []),
  ];
  return {
    text: page.rows.length
      ? `📋 Movimenti · pagina ${state.page + 1}\n\n${page.rows.map(movementText).join('\n\n')}\n\nLe rettifiche Contanti sono operazioni contabili separate e non compaiono in questo elenco.`
      : '📋 Movimenti\n\nNessun movimento registrato.',
    keyboard: { inline_keyboard: [
      ...(navigation.length ? [navigation] : []),
      [{text:'Menu principale',callback_data:`h:${state.id}:${state.revision}:menu`}],
    ] },
  };
}
