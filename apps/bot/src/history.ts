import { categoryLabels, transactionTypeLabels } from '@finance-tracker/domain';
import type { InlineKeyboard } from './proposal-view.js';
import { euro } from './money-view.js';
export { euro, historyCents } from './money-view.js';
export interface HistoryCursor { date: string; id: string }
export interface HistoryMovement { id: string; date: string; type: 'expense' | 'income' | 'transfer'; amount: string; category: string | null; from: string | null; to: string | null; voided?: boolean }
export interface HistoryPage { rows: HistoryMovement[]; next: HistoryCursor | null }
export interface HistoryRepository { getMovements(cursor: HistoryCursor | null): Promise<HistoryPage> }
export interface HistoryState { kind: 'history'; id: string; revision: number; page: number; cursors: (HistoryCursor | null)[]; next: HistoryCursor | null; loading: boolean; rows?: HistoryMovement[] }
export function movementText(row: HistoryMovement): string {
  return [
    `${row.voided ? "❌ ANNULLATO · " : ""}${transactionTypeLabels[row.type]} · ${euro(row.amount, row.type === 'income' ? '+' : row.type === 'expense' ? '−' : '')}`,
    `Data: ${row.date.split('-').reverse().join('/')}`,
    row.type === 'transfer' ? `${row.from} → ${row.to}` : `Conto: ${row.type === 'expense' ? row.from : row.to}`,
    ...(row.type === 'transfer' ? [] : [`Categoria: ${row.category ? categoryLabels[row.category as keyof typeof categoryLabels] ?? row.category : 'Non disponibile'}`]),
  ].join('\n');
}
// A conservative text budget keeps labels readable on mobile. Callback identity stays positional
// within the versioned page; shortening a label never changes which transaction is selected.
const shortLabel = (text: string, max: number): string => {
  const chars = Array.from(text.replace(/\s+/g,' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0,max-1).join('')}…`;
};
export function historyButtonLabel(row: HistoryMovement, index: number): string {
  const amount = shortLabel(euro(row.amount),28);
  const date = row.date.slice(5).split('-').reverse().join('/');
  const icon = row.voided ? '❌' : row.type === 'transfer' ? '↔️' : '✏️';
  const prefix = `${index+1}. ${icon} ${amount} · `, suffix = ` · ${date}`;
  const budget = 64 - Array.from(prefix+suffix).length;
  const description = row.type === 'transfer'
    ? `${shortLabel(row.from ?? 'Origine',Math.floor((budget-3)/2))} → ${shortLabel(row.to ?? 'Destinazione',Math.floor((budget-3)/2))}`
    : row.category ? categoryLabels[row.category as keyof typeof categoryLabels] ?? (row.from ?? row.to ?? 'Movimento') : row.from ?? row.to ?? 'Movimento';
  return `${prefix}${shortLabel(description,budget)}${suffix}`;
}
export function historyView(state: HistoryState, page: HistoryPage): {text: string; keyboard: InlineKeyboard} {
  const navigation = [
    ...(state.page ? [{text:'⬅️ Indietro',callback_data:`h:${state.id}:${state.revision}:back`}] : []),
    ...(page.next ? [{text:'Avanti ➡️',callback_data:`h:${state.id}:${state.revision}:next`}] : []),
  ];
  return {
    text: page.rows.length
      ? `📋 Movimenti · pagina ${state.page + 1}\n\n${page.rows.map((row,i) => `${i+1}. ${movementText(row)}`).join('\n\n')}\n\nLe rettifiche Contanti sono operazioni contabili separate e non compaiono in questo elenco.`
      : '📋 Movimenti\n\nNessun movimento registrato.',
    keyboard: { inline_keyboard: [
      ...page.rows.map((row,i) => [{text:historyButtonLabel(row,i),callback_data:`h:${state.id}:${state.revision}:select.${i}`}]),
      ...(navigation.length ? [navigation] : []),
      [{text:'Menu principale',callback_data:`h:${state.id}:${state.revision}:menu`}],
    ] },
  };
}
