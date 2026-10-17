import type { BalancesRepository } from './balances.js';
import type { ManagementRepository } from './management.js';
import type { ReconciliationRepository } from './reconciliation.js';
import type { TransactionRepository } from './persistence.js';
import type { HistoryRepository } from './history.js';
import { supabaseRepository } from './supabase.js';
import { commandName } from './commands.js';
import { sourceOperationKey } from './operation-key.js';
import { parseAmountInput } from '@finance-tracker/domain';
import { decideUpdate, isRecord, type TelegramConfig } from './telegram.js';
import { ProposalFlow, type FlowEffect } from './proposal-flow.js';
import type { TelegramClient } from './transport.js';
import type { ConversationState } from './proposals.js';
const token = (state: ConversationState | undefined) => state?.kind === 'proposal' ? state.proposal.id : state?.id;

export async function deliverUpdate(
  flow: ProposalFlow, client: Pick<TelegramClient, 'call' | 'sendMessage'>,
  update: unknown, config: TelegramConfig, signal?: AbortSignal, repository: TransactionRepository = supabaseRepository,
  reconciliation: ReconciliationRepository = supabaseRepository, history: HistoryRepository = supabaseRepository, balances: BalancesRepository = supabaseRepository, management: ManagementRepository = supabaseRepository,
): Promise<void> {
  const decision = decideUpdate(update, config);
  const authorized = decision.kind !== 'ignore';
  const message = isRecord(update) ? update.message ?? update.edited_message : undefined;
  const chatId = authorized ? decision.chatId : isRecord(update) && isRecord(update.callback_query) && isRecord(update.callback_query.message) && isRecord(update.callback_query.message.chat)
    && update.callback_query.message.chat.type === 'private' && String(update.callback_query.message.chat.id) === config.allowedChatId
    && isRecord(update.callback_query.from) && String(update.callback_query.from.id) === config.allowedChatId ? Number(config.allowedChatId) : undefined;
  if (chatId === undefined) return;
  const before = flow.store.getState(chatId);
  const beforeToken = token(before);
  let panel = flow.panels.get(chatId);
  if (isRecord(update) && isRecord(update.callback_query) && isRecord(update.callback_query.message) && typeof update.callback_query.data === 'string' && before?.kind !== 'balances' && beforeToken && update.callback_query.data.split(':')[1] === beforeToken && Number.isSafeInteger(update.callback_query.message.message_id)) {
    const callbackParts = update.callback_query.data.split(':');
    const revision = before?.kind === 'proposal' ? before.proposal.revision : before && 'revision' in before ? before.revision : undefined;
    if (revision === undefined || Number(callbackParts[2]) === revision) {
      panel = {messageId:update.callback_query.message.message_id as number,token:beforeToken};
      flow.panels.set(chatId,panel);
    }
  }
  let effects: FlowEffect[] | undefined;
  let noticeOnly = false;
  const fieldReply = isRecord(update) && !('edited_message' in update) && (before?.kind === 'management' || before?.kind === 'reconciliation' || before?.kind === 'proposal' && before.proposal.editing !== null || before?.kind === 'wizard' && isRecord(message) && typeof message.text === 'string' && parseAmountInput(message.text) !== null);
  if (!flow.isSaving(chatId) && authorized && isRecord(message) && typeof message.text === 'string' && !fieldReply && (decision.kind === 'preview' || isRecord(update) && 'edited_message' in update || ['start','menu'].includes(commandName(message.text) ?? ''))) {
    const sourceId = message.message_id as number;
    const requestId = sourceOperationKey(chatId,sourceId);
    // B1 receipts are the sole persistent authority. Fail closed if they cannot be checked.
    let receipt;
    try { receipt = await repository.getTransactionReceipt(requestId); }
    catch {
      const current = flow.store.get(chatId);
      if (current?.requestId === requestId && !current.submitted) flow.store.remove(chatId);
      noticeOnly = true;
      effects = [{kind:'send',chatId,text:'Non riesco a verificare se questo movimento è già registrato. Riprova più tardi; non ho creato una nuova anteprima.'}];
    }
    if (receipt) {
      const current = flow.store.getState(chatId);
      if (current?.kind === 'proposal' && current.proposal.requestId === requestId || current && 'requestId' in current && current.requestId === requestId) flow.store.remove(chatId);
      noticeOnly = true;
      effects = [{kind:'send',chatId,text:'✅ Questo movimento risulta già registrato. Non è stata creata una nuova anteprima e il movimento salvato non è stato modificato.'}];
    } else if (!effects) {
      const version = isRecord(update) ? update.update_id as number : 0;
      const previous = flow.sourceVersions.get(sourceId);
      // A superseded unsaved source cannot replace a newer session, even if an edit
      // arrives late. Committed sources are handled above via durable B1 receipts.
      if (sourceId < flow.latestSourceId && flow.store.get(chatId)?.sourceMessageId !== sourceId) return;
      if (previous !== undefined && version <= previous) return;
      flow.latestSourceId = Math.max(flow.latestSourceId, sourceId);
      flow.sourceVersions.set(sourceId,version);
      if (flow.sourceVersions.size > 1024) flow.sourceVersions.delete(flow.sourceVersions.keys().next().value!);
      const current = flow.store.get(chatId);
      if (isRecord(update) && 'edited_message' in update && commandName(message.text) && current?.requestId === requestId && !current.submitted) flow.store.remove(chatId);
      effects = flow.handle(update,config);
    }
  } else effects = flow.handle(update, config);
  if (isRecord(update) && isRecord(update.callback_query) && isRecord(update.callback_query.message) && typeof update.callback_query.data === 'string' && !update.callback_query.data.startsWith('b:') && update.callback_query.data.split(':')[1] !== token(flow.store.getState(chatId))) {
    try { await client.call('editMessageReplyMarkup',{chat_id:chatId,message_id:update.callback_query.message.message_id,reply_markup:{inline_keyboard:[]}},signal); }
    catch { signal?.throwIfAborted(); }
  }
  const after = flow.store.getState(chatId);
  noticeOnly = noticeOnly && after !== undefined;
  const isCallback = isRecord(update) && 'callback_query' in update;
  const sameSession = before && after && (beforeToken === token(after) || isCallback || before.kind === 'wizard' && after.kind === 'proposal' || before.kind === 'proposal' && after.kind === 'proposal' && before.proposal.requestId === after.proposal.requestId);
  let target = !noticeOnly && panel && (sameSession || !after && before) ? panel.messageId : undefined;
  const edit = async (messageId: number, text: string, keyboard?: import('./proposal-view.js').InlineKeyboard): Promise<boolean> => {
    try { await client.call('editMessageText',{chat_id:chatId,message_id:messageId,text,reply_markup:keyboard ?? {inline_keyboard:[]}},signal); return true; }
    catch {
      signal?.throwIfAborted();
      try { await client.call('editMessageReplyMarkup',{chat_id:chatId,message_id:messageId,reply_markup:{inline_keyboard:[]}},signal); } catch { signal?.throwIfAborted(); }
      return false;
    }
  };
  if (!noticeOnly && panel && target === undefined && (!before || after && !sameSession)) {
    await edit(panel.messageId,!before ? 'Sessione scaduta. Usa /menu per iniziare.' : 'Proposta sostituita. Usa il messaggio più recente.');
    flow.panels.delete(chatId);panel=undefined;
  }
  for (const effect of effects!) {
    if(effect.kind==='openHistory') {effects!.push(...flow.openHistory(effect.chatId));continue;}
    if(effect.kind==='loadBalances') {
      try {effects!.push(...flow.completeBalances(effect,await balances.getBalances(effect.date)));}
      catch {effects!.push(...flow.completeBalances(effect));} continue;
    }
    if(effect.kind==='loadMovement') {
      try {effects!.push(...flow.management.loaded(effect,await management.getMovement(effect.transactionId)));}
      catch {effects!.push(...flow.management.loaded(effect));} continue;
    }
    if(effect.kind==='manageMovement') {
      try {effects!.push(...flow.management.saved(effect,await management.changeMovement(effect.request)));}
      catch(error) {effects!.push(...flow.management.saved(effect,undefined,error));} continue;
    }
    if(effect.kind==='recoverChange') {
      let text='Non riesco a verificare la ricevuta. Riprova lo stesso pulsante; nessuna nuova correzione inviata.';
      try {text=await management.getChangeReceipt(effect.requestId) ? '✅ Correzione già registrata. Ricevuta recuperata, nessuna nuova modifica.' : 'Operazione scaduta. Nessuna ricevuta disponibile; questa verifica non modifica movimenti.';} catch {}
      await client.sendMessage(effect.chatId,text,signal);continue;
    }
    if (effect.kind === 'loadHistory') {
      const state = flow.store.getState(effect.chatId);
      if (state?.kind !== 'history' || state.id !== effect.stateId || state.revision !== effect.revision) continue;
      try { effects!.push(...flow.completeHistory(effect,await history.getMovements(state.cursors[state.page]))); }
      catch { effects!.push(...flow.completeHistory(effect)); }
      continue;
    }
    if (effect.kind === 'recoverMovement') {
      try {
        const receipt = await repository.getTransactionReceipt(effect.requestId);
        await client.sendMessage(effect.chatId,receipt ? '✅ Operazione già registrata. Ricevuta recuperata; nessun nuovo movimento creato.' : 'Proposta scaduta o sostituita. Nessuna ricevuta disponibile; questa verifica non inserisce movimenti.',signal);
      } catch { await client.sendMessage(effect.chatId,'Non riesco a verificare la ricevuta. Riprova lo stesso pulsante; questa verifica non inserisce movimenti.',signal); }
      continue;
    }
    if (effect.kind === 'loadCash' || effect.kind === 'reconcileCash') {
      try {
        if (effect.kind === 'loadCash') effects!.push(...flow.completeCashLoad(effect,await reconciliation.previewCash(effect.date)));
        else effects!.push(...flow.completeCashSave(effect,await reconciliation.reconcileCash(effect.request)));
      } catch (error) { const failure=error ?? new Error('Cash operation failed'); effects!.push(...(effect.kind === 'loadCash' ? flow.completeCashLoad(effect,undefined,failure) : flow.completeCashSave(effect,undefined,failure))); }
      continue;
    }
    if (effect.kind === 'persist') {
      let failure: unknown;
      try { await repository.saveTransaction(effect.proposal,effect.proposal.requestId); }
      catch (error) { failure=error ?? new Error('Persistence failed'); }
      effects!.push(...flow.completeSave(effect,failure)); continue;
    }
    if (effect.kind === 'send') {
      if (effect.persistent) {
        // Balance observations never enter the mutable panel map and are never edited.
        // One send attempt avoids duplicating a snapshot after an uncertain Telegram response.
        if (panel) {
          if (flow.panels.get(effect.chatId)?.token === panel.token) flow.panels.delete(effect.chatId);
          await edit(panel.messageId,'Sessione precedente chiusa. Usa /menu per iniziare.');
        }
        panel=undefined;target=undefined;
        try {await client.sendMessage(effect.chatId,effect.text,signal,effect.keyboard,true);}
        catch {signal?.throwIfAborted();console.warn('Invio saldi incerto. Usa /saldi per una nuova consultazione.');}
        continue;
      }
      // /help keeps an active session; a source edited into /help closes it instead.
      const separateHelp = noticeOnly || authorized && isRecord(message) && typeof message.text === 'string' && commandName(message.text) === 'help' && isRecord(update) && !('edited_message' in update);
      const active = flow.store.getState(effect.chatId);
      const rendered = !separateHelp && target !== undefined && await edit(target,effect.text,effect.keyboard);
      if (!rendered) {
        const messageId=await client.sendMessage(effect.chatId,effect.text,signal,effect.keyboard);
        if (!separateHelp && typeof messageId === 'number') target=messageId;
      }
      if (!separateHelp && active && target !== undefined) flow.panels.set(effect.chatId,{messageId:target,token:token(active)!});
      else if (!active) flow.panels.delete(effect.chatId);
    } else if (effect.kind === 'answer') {
      try { await client.call('answerCallbackQuery',{callback_query_id:effect.queryId,text:effect.text},signal); } catch { signal?.throwIfAborted(); }
    } else {
      try { await client.call('editMessageReplyMarkup',{chat_id:effect.chatId,message_id:effect.messageId,reply_markup:{inline_keyboard:[]}},signal); } catch { signal?.throwIfAborted(); }
    }
  }
}
