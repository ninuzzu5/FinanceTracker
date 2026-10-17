import { euro, historyCents } from './money-view.js';
import type { InlineKeyboard } from './proposal-view.js';
export interface AccountBalance { id: string; name: string; active: boolean; status: 'configured' | 'not_configured' | 'before_opening'; balance: string | null }
export interface BalancesRepository { getBalances(date: string): Promise<AccountBalance[]> }
export interface BalancesState { kind: 'balances'; id: string; revision: number; date: string; loading: boolean; observedAt?: string }
export function balancesView(state: BalancesState, rows?: AccountBalance[]): {text: string; keyboard: InlineKeyboard} {
  const observation = state.observedAt ? `Consultazione: ${new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'medium'}).format(new Date(state.observedAt))} (Europe/Rome)` : '';
  const names = ['Revolut','Isybank','Contanti'];
  const absent = names.filter(name => !rows?.some(r => r.name.trim().toLowerCase() === name.toLowerCase()));
  const lines = rows?.map(r => `${r.name}${r.active ? '' : ' (inattivo)'}: ${r.status === 'configured' ? euro(r.balance!) : r.status === 'not_configured' ? 'apertura non configurata' : 'data precedente all’apertura'}`) ?? [];
  let total = 'Patrimonio totale: non disponibile';
  if (rows?.length && !absent.length && rows.every(r => r.status === 'configured')) {
    const cents = rows.reduce((sum,r) => sum + historyCents(r.balance!),0n);
    const abs = cents < 0n ? -cents : cents;
    total = `Patrimonio totale: ${euro(`${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2,'0')}`)}`;
  }
  const button = (text: string, action: string) => ({text,callback_data:`b:${state.id}:${state.revision}:${action}`});
  return {text: rows ? [`💰 Saldi teorici · ${state.date.split('-').reverse().join('/')}`, ...(observation ? [observation] : []), ...lines,...absent.map(name => `${name}: conto non disponibile`),'',total,'Calcolati dai movimenti e dalle rettifiche Contanti.'].join('\n')
    : 'Saldi non disponibili. Riprova con Aggiorna o riapri /saldi.',
    keyboard:{inline_keyboard:[[button('🔄 Aggiorna','refresh')],[button('Menu principale','menu')]]}};
}
