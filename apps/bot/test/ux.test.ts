import {afterEach,describe,expect,it,vi} from 'vitest';
import {ProposalFlow} from '../src/proposal-flow.js';
import {ProposalStore} from '../src/proposals.js';
import {deliverUpdate} from '../src/flow-delivery.js';
import {telegramCommands,registerCommands} from '../src/commands.js';
import {sourceOperationKey} from '../src/operation-key.js';
import {euro,historyView,type HistoryMovement} from '../src/history.js';
import {proposalKeyboard} from '../src/proposal-view.js';
const chat=123456,config={allowedChatId:String(chat)},flows:ProposalFlow[]=[];
const message=(text:string,id=1)=>({update_id:id,message:{message_id:id,text,chat:{id:chat,type:'private'}}});
function fixture(store=new ProposalStore()) {
 const flow=new ProposalFlow(store);flows.push(flow);let sent=100;
 const client={call:vi.fn().mockResolvedValue(true),sendMessage:vi.fn(async()=>++sent)};
 const repo={getTransactionReceipt:vi.fn().mockResolvedValue(null),saveTransaction:vi.fn().mockResolvedValue({id:'saved'})};
 const cash={previewCash:vi.fn().mockResolvedValue({accountId:'cash',theoretical:'12.00'}),reconcileCash:vi.fn().mockResolvedValue({id:'adjustment',observed:'12.00',delta:'0.00'})};
 const history={getMovements:vi.fn().mockResolvedValue({rows:[],next:null})};
 const deliver=(update:unknown)=>deliverUpdate(flow,client,update,config,undefined,repo,cash,history);
 const click=(action:string)=> {
  const state=flow.store.getState(chat)!;const id=state.kind==='proposal'?state.proposal.id:state.id;
  const revision=state.kind==='proposal'?state.proposal.revision:'revision' in state?state.revision:0;
  const prefix=state.kind==='proposal'?'p':state.kind==='wizard'?'w':state.kind==='menu'?'m':state.kind==='history'?'h':'r';
  const data=prefix==='p'&&action==='confirm'?proposalKeyboard((state as any).proposal).inline_keyboard[0][0].callback_data:prefix==='m'?`${prefix}:${id}:${action}`:`${prefix}:${id}:${revision}:${action}`;
  return {update_id:999,callback_query:{id:'query',from:{id:chat},data,message:{message_id:flow.panels.get(chat)?.messageId??101,chat:{id:chat,type:'private'}}}};
 };
 return {flow,client,repo,cash,history,deliver,click};
}
afterEach(()=>{flows.splice(0).forEach(f=>f.store.clear());vi.restoreAllMocks();});
const row=(id:string,type:'expense'|'income'|'transfer'='expense'):HistoryMovement=>({id,date:'2026-10-09',type,amount:'12.50',category:type==='expense'?'food':type==='income'?'salary':null,from:type==='income'?null:'Revolut',to:type==='expense'?null:'Contanti'});
describe('UX1 native commands',()=>{
 it('registers the seven implemented commands once per startup with a restricted scope',async()=>{
  const client={call:vi.fn().mockResolvedValue(true)};await registerCommands(client,String(chat));
  expect(telegramCommands.map(c=>c.command)).toEqual(['start','menu','saldi','movimenti','riconcilia','help','cancel']);
  expect(client.call).toHaveBeenCalledWith('setMyCommands',{commands:telegramCommands,scope:{type:'chat',chat_id:String(chat)}},undefined);
 });
 it('contains registration failure without logging secrets',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  await expect(registerCommands({call:vi.fn().mockRejectedValue(new Error('secret'))},String(chat))).resolves.toBeUndefined();
  expect(warn.mock.calls.flat().join('')).not.toContain('secret');
 });
 it('does not swallow an explicit shutdown during registration',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(registerCommands({call:vi.fn().mockRejectedValue(new Error())},String(chat),controller.signal)).rejects.toThrow();
 });
});
describe('UX2 history',()=>{
 it('shows an empty history without writes',async()=>{
  const s=fixture();await s.deliver(message('/movimenti'));
  expect(s.client.sendMessage).toHaveBeenCalledWith(chat,expect.stringContaining('Nessun movimento'),undefined,expect.anything());
  expect((s.client.sendMessage.mock.calls[0][3] as any).inline_keyboard.every((row:any[])=>row.length>0)).toBe(true);
  expect(s.repo.saveTransaction).not.toHaveBeenCalled();expect(s.cash.reconcileCash).not.toHaveBeenCalled();
 });
 it('paginates using database cursors, goes back and rejects obsolete callbacks',async()=>{
  const s=fixture();const cursor={date:'2026-10-09',id:'uuid-5'};
  s.history.getMovements.mockResolvedValueOnce({rows:[1,2,3,4,5].map(i=>row(String(i))),next:cursor} as never).mockResolvedValueOnce({rows:[row('6','transfer')],next:null} as never).mockResolvedValueOnce({rows:[row('1')],next:cursor} as never);
  await s.deliver(message('/movimenti'));const next=s.click('next');await s.deliver(next);
  expect(s.history.getMovements.mock.calls[1]).toEqual([cursor]);
  expect(s.client.call).toHaveBeenCalledWith('editMessageText',expect.objectContaining({text:expect.stringContaining('Revolut → Contanti')}),undefined);
  await s.deliver(next);expect(s.history.getMovements).toHaveBeenCalledTimes(2);
  await s.deliver(s.click('back'));expect(s.history.getMovements.mock.calls[2]).toEqual([null]);
  expect(s.client.sendMessage).toHaveBeenCalledTimes(1);
 });
 it('formats EUR exactly and displays a transfer once without a category',()=>{
  const text=historyView({kind:'history',id:'a',revision:0,page:0,cursors:[null],next:null,loading:false},{rows:[row('a','transfer')],next:null}).text;
  expect(text.match(/Revolut → Contanti/g)).toHaveLength(1);expect(text).not.toContain('Categoria:');expect(text).toContain('12,50 €');
  expect(euro('9007199254740992.290')).toBe('9.007.199.254.740.992,29 €');
  expect(euro('0.01','−')).toBe('−0,01 €');expect(()=>euro('0.001')).toThrow();
 });
 it('handles database errors and an empty later page',async()=>{
  const s=fixture();s.history.getMovements.mockRejectedValueOnce(new Error('private'));
  await s.deliver(message('/movimenti'));expect(s.flow.store.getState(chat)).toBeUndefined();
  expect(s.client.sendMessage.mock.calls.flat().join('')).not.toContain('private');
  s.history.getMovements.mockResolvedValueOnce({rows:[row('1')],next:{date:'2026-10-09',id:'a'}} as never);
  await s.deliver(message('/movimenti',2));await s.deliver(s.click('next'));expect(s.flow.store.getState(chat)).toBeUndefined();
 });
 it('ignores unauthorized history commands and callbacks, and old callbacks after restart',async()=>{
  const s=fixture();const unauthorized=message('/movimenti');unauthorized.message.chat.id=9;
  await s.deliver(unauthorized);expect(s.history.getMovements).not.toHaveBeenCalled();
  await s.deliver(message('/movimenti'));const old=s.click('menu');old.callback_query.from.id=9;
  await s.deliver(old);expect(s.flow.store.getState(chat)?.kind).toBe('history');
  old.callback_query.from.id=chat;s.flow.store.clear();await s.deliver(old);expect(s.history.getMovements).toHaveBeenCalledTimes(1);
 });
 it('does not accept paging while a page is loading',async()=>{
  const s=fixture();let finish!:(page:any)=>void;s.history.getMovements.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=s.deliver(message('/movimenti'));await vi.waitFor(()=>expect(s.history.getMovements).toHaveBeenCalledTimes(1));
  await s.deliver(s.click('next'));expect(s.history.getMovements).toHaveBeenCalledTimes(1);finish({rows:[],next:null});await pending;
 });
});
describe('UX3/4 message lifecycle',()=>{
 it('uses one message for wizard steps, field edits and the final receipt',async()=>{
  const s=fixture();await s.deliver(message('/menu'));await s.deliver(s.click('movement'));await s.deliver(s.click('type.expense'));
  await s.deliver(message('12,50',2));await s.deliver(s.click('category.food'));await s.deliver(s.click('account.contanti'));
  await s.deliver(s.click('date.today'));await s.deliver(s.click('field.amount'));await s.deliver(message('13,25',3));const confirm=s.click('confirm');
  await s.deliver(confirm);expect(s.repo.saveTransaction).toHaveBeenCalledTimes(1);expect(s.client.sendMessage).toHaveBeenCalledTimes(1);
  const receipt=s.client.call.mock.calls.filter(([m])=>m==='editMessageText').at(-1)![1] as any;
  expect(receipt.text).toContain('Transazione registrata');expect(receipt.text).toContain('−13,25 €');expect(receipt.text).not.toContain('Esito da verificare');expect(receipt.reply_markup.inline_keyboard).toEqual([]);
  s.repo.getTransactionReceipt.mockResolvedValueOnce({id:'saved'} as never);await s.deliver(confirm);expect(s.repo.saveTransaction).toHaveBeenCalledTimes(1);
 });
 it('menu shortcuts open history and cash, and back uses the same message',async()=>{
  const s=fixture();await s.deliver(message('/start'));await s.deliver(s.click('history'));await s.deliver(s.click('menu'));await s.deliver(s.click('cash'));
  expect(s.flow.store.getState(chat)?.kind).toBe('reconciliation');expect(s.client.sendMessage).toHaveBeenCalledTimes(1);
 });
 it('back and cancel navigate the wizard without writes',async()=>{
  const s=fixture();await s.deliver(message('/menu'));await s.deliver(s.click('movement'));await s.deliver(s.click('type.income'));
  await s.deliver(s.click('back'));expect(s.flow.store.getState(chat)).toMatchObject({step:'type'});
  await s.deliver(s.click('cancel'));expect(s.flow.store.getState(chat)).toBeUndefined();expect(s.repo.saveTransaction).not.toHaveBeenCalled();
 });
 it('free text replaces a wizard and invalidates the old buttons',async()=>{
  const s=fixture();await s.deliver(message('/menu'));await s.deliver(s.click('transfer'));const old=s.click('fromAccount.revolut');
  await s.deliver(message('12 pranzo contanti',2));expect(s.flow.store.get(chat)).toMatchObject({type:'expense',account:'contanti'});
  await s.deliver(old);expect(s.repo.saveTransaction).not.toHaveBeenCalled();expect(s.flow.store.get(chat)?.account).toBe('contanti');
 });
 it('updates an edited source and ignores duplicate or older source updates',async()=>{
  const s=fixture();const original=message('12 pranzo');await s.deliver(original);const old=s.click('confirm');
  const edited={update_id:3,edited_message:{...original.message,text:'13 pranzo contanti'}};await s.deliver(edited);
  expect(s.flow.store.get(chat)?.amount).toBe(13);const id=s.flow.store.get(chat)?.id;
  await s.deliver(original);await s.deliver(edited);expect(s.flow.store.get(chat)?.id).toBe(id);
  await s.deliver(old);expect(s.repo.saveTransaction).not.toHaveBeenCalled();
 });
 it('ignores edits of an unsaved source superseded by a newer operation',async()=>{
  const s=fixture();await s.deliver(message('12 pranzo'));await s.deliver(message('14 pranzo',2));const fresh=s.flow.store.get(chat);
  await s.deliver({update_id:3,edited_message:message('13 pranzo').message});expect(s.flow.store.get(chat)).toBe(fresh);
 });
 it('a slower receipt lookup cannot reinstate an older source',async()=>{
  const s=fixture();let finish!:(value:null)=>void;s.repo.getTransactionReceipt.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const older=s.deliver(message('12 pranzo'));await s.deliver(message('14 pranzo',2));finish(null);await older;
  expect(s.flow.store.get(chat)?.amount).toBe(14);
 });
 it('an edit to /help invalidates the proposal and its confirm button',async()=>{
  const s=fixture();await s.deliver(message('12 pranzo'));const old=s.click('confirm');
  await s.deliver({update_id:2,edited_message:message('/help').message});await s.deliver(old);
  expect(s.flow.store.get(chat)).toBeUndefined();expect(s.repo.saveTransaction).not.toHaveBeenCalled();
 });
 it('editing the root of a guided proposal into a command invalidates its confirmation',async()=>{
  const s=fixture();await s.deliver(message('/menu'));await s.deliver(s.click('movement'));await s.deliver(s.click('type.expense'));
  await s.deliver(message('12',2));await s.deliver(s.click('category.food'));await s.deliver(s.click('account.revolut'));await s.deliver(s.click('date.today'));
  const old=s.click('confirm');await s.deliver({update_id:3,edited_message:message('/help').message});await s.deliver(old);
  expect(s.flow.store.get(chat)).toBeUndefined();expect(s.repo.saveTransaction).not.toHaveBeenCalled();
 });
 it('checks durable B1 receipts before preview after restart, including edits to commands',async()=>{
  const s=fixture();s.repo.getTransactionReceipt.mockResolvedValue({id:'saved'} as never);
  await s.deliver(message('12 pranzo'));await s.deliver({update_id:2,edited_message:message('13 pranzo').message});await s.deliver({update_id:3,edited_message:message('/help').message});
  expect(s.flow.store.get(chat)).toBeUndefined();expect(s.repo.getTransactionReceipt).toHaveBeenCalledWith(sourceOperationKey(chat,1));
  expect(s.repo.saveTransaction).not.toHaveBeenCalled();expect(s.client.sendMessage.mock.calls.every(call=>call[3]===undefined)).toBe(true);
 });
 it('a confirmed old source notice does not replace a different active proposal',async()=>{
  const s=fixture();await s.deliver(message('14 pranzo',2));const fresh=s.flow.store.get(chat);
  s.repo.getTransactionReceipt.mockResolvedValueOnce({id:'saved'} as never);
  await s.deliver({update_id:3,edited_message:message('12 pranzo').message});expect(s.flow.store.get(chat)).toBe(fresh);
  expect(s.flow.panels.get(chat)?.messageId).toBe(101);
 });
 it('a delayed receipt notice cannot remove a newer operation',async()=>{
  const s=fixture();await s.deliver(message('12 pranzo'));let finish!:(value:any)=>void;
  s.repo.getTransactionReceipt.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const older=s.deliver({update_id:3,edited_message:message('13 pranzo').message});
  await s.deliver(message('14 pranzo',2));const fresh=s.flow.store.get(chat);const panel=s.flow.panels.get(chat);
  finish({id:'saved'});await older;expect(s.flow.store.get(chat)).toBe(fresh);expect(s.flow.panels.get(chat)).toBe(panel);
 });
 it('receipt read failure while uncertain preserves the original retry key and frozen values',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});const s=fixture();await s.deliver(message('12 pranzo'));const old=s.click('confirm');
  s.repo.saveTransaction.mockRejectedValueOnce(new Error('timeout'));await s.deliver(old);const p=s.flow.store.get(chat)!;
  s.repo.getTransactionReceipt.mockRejectedValueOnce(new Error('unavailable'));
  await s.deliver({update_id:2,edited_message:message('13 pranzo').message});expect(s.flow.store.get(chat)).toBe(p);expect(p.amount).toBe(12);
  await s.deliver(old);expect(s.repo.saveTransaction.mock.calls[0][1]).toBe(s.repo.saveTransaction.mock.calls[1][1]);
 });
 it('fails closed if durable receipt lookup fails',async()=>{
  const s=fixture();s.repo.getTransactionReceipt.mockRejectedValue(new Error('private details'));await s.deliver(message('12 pranzo'));
  expect(s.flow.store.get(chat)).toBeUndefined();expect(s.repo.saveTransaction).not.toHaveBeenCalled();
 });
 it('expires a proposal on activity and never writes from the old confirmation',async()=>{
  let time=0;const s=fixture(new ProposalStore(1000,()=>time));await s.deliver(message('12 pranzo'));const old=s.click('confirm');time=1001;
  await s.deliver(old);expect(s.repo.saveTransaction).not.toHaveBeenCalled();
  expect(s.client.call).toHaveBeenCalledWith('editMessageText',expect.objectContaining({text:expect.stringContaining('scaduta'),reply_markup:{inline_keyboard:[]}}),undefined);
 });
 it('falls back to a new bot message when editing is forbidden, with old revisions invalid',async()=>{
  const s=fixture();await s.deliver(message('12 pranzo'));const old=s.click('confirm');
  s.client.call.mockImplementation(async method=>{if(method==='editMessageText')throw new Error('forbidden');return true;});
  await s.deliver(s.click('field.amount'));await s.deliver(message('13',2));await s.deliver(old);
  expect(s.repo.saveTransaction).not.toHaveBeenCalled();expect(s.flow.store.get(chat)?.amount).toBe(13);expect(s.client.sendMessage.mock.calls.length).toBeGreaterThan(1);
 });
 it('two distinct sources with identical content remain separate logical operations',async()=>{
  const s=fixture();await s.deliver(message('12 pranzo'));await s.deliver(s.click('confirm'));await s.deliver(message('12 pranzo',2));await s.deliver(s.click('confirm'));
  expect(s.repo.saveTransaction).toHaveBeenCalledTimes(2);expect(s.repo.saveTransaction.mock.calls[0][1]).not.toBe(s.repo.saveTransaction.mock.calls[1][1]);
 });
});
