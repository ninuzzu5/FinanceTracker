import { normalizeText, parseAmountInput, amountInCents } from '@finance-tracker/domain';
import type { InlineKeyboard } from './proposal-view.js';

export interface ReconciliationState {
  kind: 'reconciliation'; id: string; revision: number; requestId: string;
  step: 'date' | 'loading' | 'amount' | 'preview' | 'saving' | 'uncertain';
  date: string | null; accountId: string | null; theoretical: string | null; observed: string | null;
}
export interface CashPreview { accountId: string; theoretical: string }
export interface CashRequest { accountId: string; date: string; observed: string; expected: string; requestId: string }
export interface CashReceipt { id: string; delta: string; observed: string }
export interface ReconciliationRepository {
  previewCash(date: string): Promise<CashPreview>;
  reconcileCash(request: CashRequest): Promise<CashReceipt>;
}
export class ReconciliationError extends Error {
  constructor(readonly code: 'unconfigured' | 'closed' | 'changed' | 'account' | 'invalid' | 'access' | 'unknown') { super(`Cash reconciliation failed: ${code}`); }
}
export function decimalCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new ReconciliationError('invalid');
  return BigInt(`${match[2]}${(match[3] ?? '').padEnd(2, '0')}`) * (match[1] ? -1n : 1n);
}
export function centsDecimal(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function cashInput(text: string): string | null {
  const normalized = normalizeText(text);
  if (/^(?:(?:€|eur)\s*)?0+(?:[.,]0{1,2})?(?:\s*(?:€|eur))?$/.test(normalized)) return '0.00';
  const value = parseAmountInput(text);
  if (value === null) return null;
  const cents = amountInCents(value);
  return cents === null ? null : centsDecimal(BigInt(cents));
}
export function reconciliationMessage(error: unknown): string {
  const code = error instanceof ReconciliationError ? error.code : 'unknown';
  if (code === 'unconfigured') return 'Contanti non ha un saldo iniziale e una data di apertura validi per questa giornata. Configurali prima di riconciliare.';
  if (code === 'closed') return 'La giornata Contanti è già riconciliata. Questa operazione richiede una riapertura, non ancora disponibile.';
  if (code === 'changed') return 'Il saldo è cambiato o la richiesta è incompatibile. Avvia /riconcilia per una nuova anteprima.';
  if (code === 'account') return 'Serve un solo conto Contanti attivo in EUR nel database.';
  if (code === 'invalid') return 'Dati non validi per la riconciliazione. Avvia /riconcilia e riprova.';
  if (code === 'access') return 'Non riesco ad accedere alla riconciliazione. Controlla autenticazione e migrazione 005.';
  return 'Esito del salvataggio incerto. Riprova con lo stesso pulsante: la richiesta conserva la stessa chiave e non crea duplicati. Annulla chiude solo il flusso Telegram.';
}
export function reconciliationView(state: ReconciliationState): { text: string; keyboard: InlineKeyboard } {
  const button = (text: string, action: string) => ({ text, callback_data: `r:${state.id}:${state.revision}:${action}` });
  const cancel = button('❌ Annulla', 'cancel');
  if (state.step === 'date') return {
    text: 'Riconcilia Contanti a fine giornata (Europe/Rome). Hai registrato tutti i movimenti del giorno? Dopo la conferma il giorno sarà chiuso, anche per i trasferimenti.',
    keyboard: { inline_keyboard: [[button('Contanti · Oggi, fine giornata', 'today')], [button('Contanti · Ieri, fine giornata', 'yesterday')], [cancel]] },
  };
  if (state.step === 'amount') return {
    text: `Contanti · fine giornata ${state.date}\nSaldo teorico: ${state.theoretical} €\nScrivi il denaro realmente disponibile, anche 0.`,
    keyboard: { inline_keyboard: [[cancel]] },
  };
  return {
    text: `Riconciliazione Contanti · fine giornata ${state.date}\nSaldo teorico: ${state.theoretical} €\nSaldo dichiarato: ${state.observed} €\nRettifica: ${centsDecimal(decimalCents(state.observed!) - decimalCents(state.theoretical!))} €\nNon è una spesa o entrata. Confermando chiudi questa giornata e quelle precedenti.`,
    keyboard: { inline_keyboard: [[button(state.step === 'uncertain' ? '🔄 Riprova stessa richiesta' : '✅ Conferma', 'confirm')], ...(state.step === 'preview' ? [[button('✏️ Cambia saldo', 'edit')]] : []), [cancel]] },
  };
}
