import { parseAmountInput, parseDateInput, expenseCategoryIds, incomeCategoryIds, categoryLabels, type CategoryId } from '@finance-tracker/domain';
import { randomUUID } from 'node:crypto';
import { centsDecimal } from './reconciliation.js';
import { historyCents } from './money-view.js';
import { movementText, type HistoryMovement } from './history.js';
import { compactOperationKey, expandOperationKey } from './operation-key.js';
import type { InlineKeyboard } from './proposal-view.js';
import type { ProposalStore } from './proposals.js';
import type { FlowEffect } from './proposal-flow.js';
export interface ManagedAccount { id: string; name: string; currency: 'EUR'; active: boolean }
export interface ManagedMovement { id: string; type: 'expense'|'income'|'transfer'; amount: string; date: string; category: string|null; from_id: string|null; to_id: string|null; version: string; voided_at: string|null; voided_by: string|null }
export interface ManagedDetail { movement: ManagedMovement; accounts: ManagedAccount[] }
export interface ChangeRequest { requestId: string; transactionId: string; expectedVersion: string; action: 'edit'|'void'; values: ManagedMovement }
export interface ChangeReceipt { transaction_id: string; action: 'edit'|'void'; version: string }
export interface ManagementRepository {
  getMovement(id: string): Promise<ManagedDetail>;
  changeMovement(request: ChangeRequest): Promise<ChangeReceipt>;
  getChangeReceipt(requestId: string): Promise<ChangeReceipt|null>;
}
export class ManagementError extends Error {
  constructor(readonly code: 'changed'|'closed'|'invalid'|'access'|'unknown') { super(`Movement management: ${code}`); }
}
export interface ManagementState { kind: 'management'; id: string; revision: number; transactionId: string; step: 'loading'|'detail'|'edit'|'preview'|'saving'|'uncertain'|'success'; detail?: ManagedDetail; values?: ManagedMovement; action?: 'edit'|'void'; requestId: string; field: 'amount'|'date'|'category'|'from_id'|'to_id'|null }
export function managedHistory(row: ManagedMovement, accounts: ManagedAccount[]): HistoryMovement {
  const name = (id: string|null) => accounts.find(a => a.id === id)?.name ?? (id ? 'Conto non disponibile' : null);
  return {id:row.id,type:row.type,amount:row.amount,date:row.date,category:row.category,from:name(row.from_id),to:name(row.to_id),voided:row.voided_at !== null};
}
const categories = (type: string): readonly string[] => type === 'expense' ? expenseCategoryIds : type === 'income' ? incomeCategoryIds : [];
export function managementView(s: ManagementState): {text: string; keyboard: InlineKeyboard} {
  const button = (text: string, action: string) => ({text,callback_data:`c:${s.id}:${s.revision}:${action}`});
  const original = s.detail!.movement, accounts = s.detail!.accounts;
  const render = (m: ManagedMovement) => movementText(managedHistory(m,accounts));
  const exit = button('❌ Annulla operazione','cancel');
  if (s.step === 'success') return {text:`✅ ${s.action === 'void' ? 'Movimento annullato contabilmente' : 'Movimento modificato'}.\nStorico e saldi aggiornati; ricevuta conservata.`,keyboard:{inline_keyboard:[[button('📋 Torna ai movimenti','history')]]}};
  if (s.step === 'detail') return {text:`📋 Dettaglio movimento\n${render(original)}\nVersione: ${original.version}${original.voided_at ? '\nMovimento annullato: nessuna ulteriore modifica consentita.' : ''}`,keyboard:{inline_keyboard:[
    ...(!original.voided_at ? [[button('✏️ Modifica','edit')],[button('Annulla movimento','void')]] : []),[button('Torna ai movimenti','history')],[exit]]}};
  if (s.step === 'preview' || s.step === 'uncertain' || s.step === 'saving') return {text:`${s.action === 'void' ? 'Annullamento contabile' : 'Modifica movimento'}\n\nPrima:\n${render(original)}\n\nDopo:\n${s.action === 'void' ? 'Movimento annullato: escluso dai saldi, conservato nello storico.' : render(s.values!)}\n${s.step === 'uncertain' ? '\nEsito incerto: ritenta la stessa richiesta. Annulla operazione non annulla una scrittura riuscita.' : s.action === 'edit' ? '\n✅ Modifica pronta. Controlla il riepilogo e premi Conferma modifiche per salvarla.' : '\nConferma per annullare il movimento contabilmente.'}`,keyboard:{inline_keyboard:[
    [button(s.step === 'uncertain' ? '🔄 Riprova stessa richiesta' : s.action === 'edit' ? '✅ Conferma modifiche' : '✅ Conferma annullamento',`confirm:${compactOperationKey(s.requestId)}`)],
    ...(s.step === 'preview' && s.action === 'edit' ? [[button('Modifica ancora','back')]] : []),[exit]]}};
  let choices: ReturnType<typeof button>[][] = [];
  if (s.field === 'category') choices = categories(original.type).map(id => [button(categoryLabels[id as CategoryId],`set.category.${id}`)]);
  else if (s.field === 'from_id' || s.field === 'to_id') {
    const other = s.field === 'from_id' ? s.values!.to_id : s.values!.from_id;
    choices = accounts.flatMap((a,i) => a.active && a.id !== other ? [[button(a.name,`set.${s.field}.${i}`)]] : []);
  } else if (!s.field) choices = [[button('Importo','field.amount'),button('Data','field.date')],
    ...(original.type !== 'transfer' ? [[button('Categoria','field.category')]] : []),
    ...(original.type !== 'income' ? [[button('Conto di origine','field.from_id')]] : []),
    ...(original.type !== 'expense' ? [[button('Conto di destinazione','field.to_id')]] : []),[button('✅ Riepilogo e conferma','preview')]];
  return {text:`✏️ Modifica · tipo invariato\n${render(s.values!)}\n\n${s.field === 'amount' ? 'Scrivi il nuovo importo positivo.' : s.field === 'date' ? 'Scrivi la nuova data.' : 'Scegli il campo o il valore.'}`,keyboard:{inline_keyboard:[...choices,...(s.field ? [[button('Torna ai campi','back')]] : []),[exit]]}};
}
export function managementError(error: unknown): string {
  const code = error instanceof ManagementError ? error.code : 'unknown';
  if (code === 'closed') return 'La giornata Contanti è già riconciliata. Modifica o annullamento richiedono una riapertura, non disponibile. Nessuna correzione applicata.';
  if (code === 'changed') return 'Il movimento è cambiato o è già annullato, oppure la richiesta è incompatibile. Riapri /movimenti per una nuova anteprima.';
  if (code === 'access') return 'Movimento non disponibile o accesso non autorizzato. Riapri /movimenti.';
  if (code === 'invalid') return 'Dati non validi: verifica importo, data, categoria e conti attivi in EUR. Riapri /movimenti.';
  return 'Esito incerto. Usa lo stesso pulsante per recuperare la richiesta senza duplicarla.';
}
export class MovementManagement {
  constructor(private readonly store: ProposalStore, private readonly saving: Set<number>) {}
  open(chatId: number, transactionId: string): FlowEffect[] {
    const s = this.store.startManagement(transactionId,chatId);
    return [{kind:'loadMovement',chatId,stateId:s.id,transactionId}];
  }
  loaded(effect: Extract<FlowEffect,{kind:'loadMovement'}>, result?: ManagedDetail): FlowEffect[] {
    const s = this.store.getState(effect.chatId);
    if (s?.kind !== 'management' || s.id !== effect.stateId) return [];
    if (!result) { this.store.remove(effect.chatId); return [{kind:'send',chatId:effect.chatId,text:'Dettaglio non disponibile. Riapri /movimenti.'}]; }
    s.detail=result;s.values={...result.movement};s.step='detail';s.revision++;
    return [{kind:'send',chatId:effect.chatId,...managementView(s)}];
  }
  text(chatId: number, text: string, now: Date, timeZone: string): FlowEffect[]|null {
    const s=this.store.getState(chatId);if (s?.kind !== 'management') return null;
    const show = (text?: string): FlowEffect[] => [{kind:'send',chatId,...managementView(s),...(text ? {text} : {})}];
    if (s.step !== 'edit' || !s.values || !['amount','date'].includes(s.field ?? '')) return s.step === 'loading' ? [] : show();
    const value = s.field === 'amount' ? parseAmountInput(text) : parseDateInput(text,now,timeZone);
    if (value === null) return show('Valore non valido. Riprova con un importo positivo a centesimi o una data valida.');
    if (s.field === 'amount') s.values.amount=centsDecimal(historyCents(String(value))); else s.values.date=value as string;
    s.field=null;s.step='preview';s.revision++;return show();
  }
  callback(chatId: number,queryId: string,data: string): FlowEffect[] {
    const answer=(text=''): FlowEffect=>({kind:'answer',queryId,text});
    const match=/^c:([a-f0-9]{16}):(\d+):([\w.]+)(?::([A-Za-z0-9_-]{22}))?$/.exec(data);
    const key=match?.[4] ? expandOperationKey(match[4]) : null;
    const s=this.store.getState(chatId);
    if (!match || match[4] && (match[3] !== 'confirm' || !key)) return [answer('Pulsante non valido.')];
    if (s?.kind !== 'management' || s.id !== match[1] || s.revision !== Number(match[2])) return key ? [answer('Verifico la ricevuta.'),{kind:'recoverChange',chatId,requestId:key}] : [answer('Operazione scaduta o sostituita. Riapri /movimenti.')];
    if (s.step === 'loading') return [answer('Lettura in corso.')];
    const action=match[3];
    const show=(): FlowEffect[]=>{s.revision++;return [answer(),{kind:'send',chatId,...managementView(s)}];};
    if (action === 'cancel') {this.store.remove(chatId);return [answer(),{kind:'send',chatId,text:'Operazione chiusa. Non ho annullato eventuali correzioni già salvate.'}];}
    if (action === 'history' && (s.step === 'detail' || s.step === 'success')) return [answer(),{kind:'openHistory',chatId}];
    if (!s.detail || s.detail.movement.voided_at) return [answer('Movimento già annullato.')];
    if (['saving','uncertain'].includes(s.step) && action !== 'confirm') return [answer('Esito incerto: usa la stessa conferma o Annulla operazione.')];
    if (s.step === 'detail' && (action === 'edit' || action === 'void')) {
      s.action=action;s.requestId=randomUUID();s.step=action==='edit'?'edit':'preview';s.field=null;return show();
    }
    if (action === 'confirm' && (s.step === 'preview' || s.step === 'uncertain') && key === s.requestId) {
      s.step='saving';this.saving.add(chatId);
      return [answer('Salvataggio in corso.'),{kind:'manageMovement',chatId,stateId:s.id,request:{requestId:s.requestId,transactionId:s.transactionId,expectedVersion:s.detail.movement.version,action:s.action!,values:{...s.values!}}}];
    }
    if (action === 'back' && (s.step === 'edit' || s.step === 'preview')) {s.step='edit';s.field=null;return show();}
    if (s.step !== 'edit') return [answer('Usa il passaggio corrente.')];
    if (action === 'preview') {s.step='preview';s.field=null;return show();}
    const [verb,field,value]=action.split('.');
    const allowed=['amount','date',...(s.detail.movement.type !== 'transfer' ? ['category'] : []),...(s.detail.movement.type !== 'income' ? ['from_id'] : []),...(s.detail.movement.type !== 'expense' ? ['to_id'] : [])];
    if (verb === 'field' && allowed.includes(field)) {s.field=field as ManagementState['field'];return show();}
    if (verb === 'set' && field === s.field && s.values) {
      if (field === 'category' && categories(s.detail.movement.type).includes(value)) s.values.category=value;
      else if ((field === 'from_id' || field === 'to_id') && /^\d+$/.test(value)) {
        const account=s.detail.accounts[Number(value)],other=field==='from_id'?s.values.to_id:s.values.from_id;
        if (!account?.active || account.id === other) return [answer('Scegli un conto attivo distinto.')];
        s.values[field]=account.id;
      } else return [answer('Valore non valido.')];
      s.field=null;s.step='preview';return show();
    }
    return [answer('Pulsante non valido.')];
  }
  saved(effect: Extract<FlowEffect,{kind:'manageMovement'}>,receipt?: ChangeReceipt,error?: unknown): FlowEffect[] {
    this.saving.delete(effect.chatId);const s=this.store.getState(effect.chatId);
    if (receipt) {
      if (s?.kind==='management' && s.id===effect.stateId) {
        s.step='success';s.revision++;
        return [{kind:'send',chatId:effect.chatId,...managementView(s)}];
      }
      return [{kind:'send',chatId:effect.chatId,text:'✅ Operazione registrata. Usa /movimenti per consultare lo storico aggiornato.'}];
    }
    if(s?.kind!=='management'||s.id!==effect.stateId)return [];
    if(error instanceof ManagementError && error.code!=='unknown') {this.store.remove(effect.chatId);return [{kind:'send',chatId:effect.chatId,text:managementError(error)}];}
    s.step='uncertain';s.revision++;return [{kind:'send',chatId:effect.chatId,...managementView(s)}];
  }
}
