import {afterEach,describe,expect,it,vi} from 'vitest';
import {ProposalFlow} from '../src/proposal-flow.js';
import {ProposalStore} from '../src/proposals.js';
import {deliverUpdate} from '../src/flow-delivery.js';
import {historyView,euro} from '../src/history.js';
import {balancesView,type AccountBalance} from '../src/balances.js';
import {ManagementError,type ManagedDetail,type ChangeRequest} from '../src/management.js';
import {SupabaseTransactionRepository} from '../src/supabase.js';
import {createClient} from '@supabase/supabase-js';
const chat=123456, config={allowedChatId:String(chat)}, flows:ProposalFlow[]=[];
const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const balance=(name:string,n:number,value='0.00'):AccountBalance=>({id:uuid(n),name,active:true,status:'configured',balance:value});
const detail=():ManagedDetail=>({movement:{id:uuid(9),type:'expense',amount:'12.50',date:'2026-10-09',category:'food',from_id:uuid(1),to_id:null,version:'1',voided_at:null,voided_by:null},accounts:[{id:uuid(1),name:'Revolut',currency:'EUR',active:true},{id:uuid(2),name:'Isybank',currency:'EUR',active:true},{id:uuid(3),name:'Contanti',currency:'EUR',active:true}]});
function fixture(store=new ProposalStore()) {
 const flow=new ProposalFlow(store);flows.push(flow);let sequence=0,sent=99;let view:any={};
 const client={call:vi.fn(async(method:string,body:any)=>{if(method==='editMessageText')view=body;return true;}),sendMessage:vi.fn(async(_chat:number,text:string,_signal?:unknown,keyboard?:unknown)=>{view={text,reply_markup:keyboard};return ++sent;})};
 const repo={getTransactionReceipt:vi.fn().mockResolvedValue(null),saveTransaction:vi.fn().mockResolvedValue({id:uuid(9)})};
 const cash={previewCash:vi.fn(),reconcileCash:vi.fn()};
 const history={getMovements:vi.fn().mockResolvedValue({rows:[{id:uuid(9),type:'expense',amount:'12.50',date:'2026-10-09',category:'food',from:'Revolut',to:null}],next:null})};
 const balances={getBalances:vi.fn().mockResolvedValue([balance('Revolut',1,'-10.20'),balance('Isybank',2,'20.30'),balance('Contanti',3)])};
 const management={getMovement:vi.fn().mockImplementation(async()=>detail()),changeMovement:vi.fn(async(r:ChangeRequest)=>({transaction_id:r.transactionId,action:r.action,version:'2'})),getChangeReceipt:vi.fn().mockResolvedValue(null)};
 const deliver=(update:unknown)=>deliverUpdate(flow,client,update,config,undefined,repo,cash,history,balances,management);
 const message=(text:string)=>deliver({update_id:++sequence,message:{message_id:sequence,text,chat:{id:chat,type:'private'}}});
 const button=(action:string)=>{
  const s=flow.store.getState(chat)!;const prefix=s.kind==='management'?'c':s.kind==='balances'?'b':s.kind==='history'?'h':'m';
  return {update_id:++sequence,callback_query:{id:'query',from:{id:chat},data:`${prefix}:${'id' in s?s.id:''}:${'revision' in s?s.revision+':':''}${action}`,message:{message_id:flow.panels.get(chat)?.messageId??sent,chat:{id:chat,type:'private'}}}};
 };
 const lastView=()=>view;
 const confirm=()=>deliver({...button('confirm'),callback_query:{...button('confirm').callback_query,data:lastView().reply_markup.inline_keyboard.flat().find((b:any)=>b.text.includes('Conferma')||b.text.includes('Riprova')).callback_data}});
 const open=async()=>{await message('/movimenti');await deliver(button('select.0'));};
 return {flow,client,repo,cash,history,balances,management,deliver,message,button,lastView,confirm,open};
}
afterEach(()=>{flows.splice(0).forEach(f=>f.store.clear());vi.restoreAllMocks();});
describe('B exact balances',()=>{
 it('displays all accounts, negative bank, zero cash, inactive accounts and exact total',()=>{
  const rows=[balance('Revolut',1,'-0.29'),balance('Isybank',2,'9007199254740992.30'),balance('Contanti',3),{...balance('Riserva',4,'0.01'),active:false}];
  const v=balancesView({kind:'balances',id:'x',revision:0,date:'2026-10-17',loading:false},rows);
  expect(v.text).toContain('−0,29 €');expect(v.text).toContain('Contanti: 0,00 €');expect(v.text).toContain('Riserva (inattivo)');expect(v.text).toContain('Patrimonio totale: 9.007.199.254.740.992,02 €');
 });
 it.each(['not_configured','before_opening'] as const)('never presents partial total when %s',status=>{
  const rows=[balance('Revolut',1,'10'),balance('Isybank',2),{...balance('Contanti',3),status,balance:null}];
  const text=balancesView({kind:'balances',id:'x',revision:0,date:'2026-10-17',loading:false},rows).text;
  expect(text).toContain('Patrimonio totale: non disponibile');expect(text).not.toContain('Contanti: 0,00');
 });
 it('reports missing accounts, empty result and safe RPC failure',async()=>{
  const s=fixture();s.balances.getBalances.mockRejectedValueOnce(new Error('private'));
  await s.message('/saldi');expect(s.lastView().text).toContain('Saldi non disponibili');expect(s.lastView().text).not.toContain('private');
  s.balances.getBalances.mockResolvedValueOnce([]);await s.deliver(s.button('refresh'));expect(s.lastView().text).toContain('Contanti: conto non disponibile');
  expect(s.lastView().text).toContain('Patrimonio totale: non disponibile');
 });
 it('opens directly or via menu, creates a fresh snapshot and rejects replay/stale callbacks',async()=>{
  const s=fixture();await s.message('/saldi');const old=s.button('refresh');await s.deliver(old);await s.deliver(old);
  expect(s.balances.getBalances).toHaveBeenCalledTimes(2);expect(s.client.sendMessage).toHaveBeenCalledTimes(2);
  await s.deliver(s.button('menu'));await s.deliver(s.button('balances'));expect(s.flow.store.getState(chat)?.kind).toBe('balances');
  s.flow.store.clear();await s.deliver(old);expect(s.balances.getBalances).toHaveBeenCalledTimes(3);
 });
 it('uses Europe/Rome near midnight and serializes rapid refreshes',async()=>{
  const flow=new ProposalFlow();flows.push(flow);
  const update={update_id:1,message:{message_id:1,text:'/saldi',chat:{id:chat,type:'private'}}};
  expect(flow.handle(update,config,new Date('2026-07-09T22:05:00Z'))).toContainEqual(expect.objectContaining({kind:'loadBalances',date:'2026-07-10'}));
  const s=fixture();await s.message('/saldi');let finish!:(value:AccountBalance[])=>void;
  s.balances.getBalances.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=s.deliver(s.button('refresh'));await vi.waitFor(()=>expect(s.balances.getBalances).toHaveBeenCalledTimes(2));
  await s.deliver(s.button('refresh'));expect(s.balances.getBalances).toHaveBeenCalledTimes(2);finish([]);await pending;
 });
});
describe('C historical flow',()=>{
 it('selects detail, edits amount/date/category/account and confirms before/after explicitly',async()=>{
  const s=fixture();await s.open();expect(s.lastView().text).toContain('Dettaglio movimento');
  await s.deliver(s.button('edit'));await s.deliver(s.button('field.amount'));await s.message('0.001');expect(s.management.changeMovement).not.toHaveBeenCalled();
  await s.message('13,29');await s.deliver(s.button('back'));await s.deliver(s.button('field.date'));await s.message('10/10/2026');await s.deliver(s.button('back'));
  await s.deliver(s.button('field.category'));await s.deliver(s.button('set.category.tobacco'));await s.deliver(s.button('back'));
  await s.deliver(s.button('field.from_id'));await s.deliver(s.button('set.from_id.1'));
  await s.deliver(s.button('preview'));expect(s.lastView().text).toContain('Prima:');expect(s.lastView().text).toContain('Dopo:');expect(s.lastView().text).toContain('13,29 €');
  await s.confirm();expect(s.management.changeMovement).toHaveBeenCalledWith(expect.objectContaining({expectedVersion:'1',action:'edit',values:expect.objectContaining({amount:'13.29',date:'2026-10-10',category:'tobacco',from_id:uuid(2)})}));
  expect(s.repo.saveTransaction).not.toHaveBeenCalled();expect(s.lastView().text).toContain('Movimento modificato');
 });
 it('edits transfer legs without category/type mutation and rejects equal accounts',async()=>{
  const s=fixture();s.management.getMovement.mockResolvedValueOnce({...detail(),movement:{...detail().movement,type:'transfer',category:null,to_id:uuid(2)}});
  await s.open();await s.deliver(s.button('edit'));await s.deliver(s.button('field.category'));expect(s.lastView().text).not.toContain('Categoria:');
  await s.deliver(s.button('field.from_id'));await s.deliver(s.button('set.from_id.1'));
  const state=s.flow.store.getState(chat);expect(state?.kind==='management'&&state.values?.from_id).toBe(uuid(1));
  await s.deliver(s.button('set.from_id.2'));await s.deliver(s.button('preview'));await s.confirm();
  expect(s.management.changeMovement).toHaveBeenCalledWith(expect.objectContaining({values:expect.objectContaining({type:'transfer',from_id:uuid(3),to_id:uuid(2),category:null})}));
 });
 it.each(['expense','income','transfer'] as const)('cancels %s only after explicit confirmation',async type=>{
  const s=fixture();s.management.getMovement.mockResolvedValueOnce({...detail(),movement:{...detail().movement,type,category:type==='transfer'?null:type==='income'?'salary':'food',from_id:type==='income'?null:uuid(1),to_id:type==='expense'?null:uuid(2)}});
  await s.open();await s.deliver(s.button('void'));expect(s.lastView().text).toContain('escluso dai saldi');expect(s.management.changeMovement).not.toHaveBeenCalled();
  await s.confirm();expect(s.management.changeMovement).toHaveBeenCalledWith(expect.objectContaining({action:'void'}));expect(s.lastView().text).toContain('annullato contabilmente');
 });
 it('exit means no accounting cancellation; cancelled entries remain read-only',async()=>{
  const s=fixture();await s.open();await s.deliver(s.button('void'));await s.deliver(s.button('cancel'));expect(s.management.changeMovement).not.toHaveBeenCalled();
  s.management.getMovement.mockResolvedValueOnce({...detail(),movement:{...detail().movement,voided_at:'2026-10-17T10:00:00Z',voided_by:uuid(99)}});
  await s.open();expect(s.lastView().text).toContain('ANNULLATO');await s.deliver(s.button('edit'));expect(s.management.changeMovement).not.toHaveBeenCalled();
 });
 it.each(['closed','changed','invalid','access'] as const)('fails clearly and safely on %s without retrying incompatible data',async code=>{
  const s=fixture();s.management.changeMovement.mockRejectedValueOnce(new ManagementError(code));await s.open();await s.deliver(s.button('void'));await s.confirm();
  expect(s.flow.store.getState(chat)).toBeUndefined();expect(s.management.changeMovement).toHaveBeenCalledTimes(1);expect(s.lastView().text).not.toContain('Movement management:');
 });
 it('freezes payload/key on timeout, blocks double confirm, recovers receipt after restart',async()=>{
  const s=fixture();let finish!:(v:any)=>void;s.management.changeMovement.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await s.open();await s.deliver(s.button('void'));const confirm=s.lastView().reply_markup.inline_keyboard[0][0].callback_data;
  const frozen=s.button('confirm');const click=()=>s.deliver({...frozen,callback_query:{...frozen.callback_query,data:confirm}});
  const pending=click();await vi.waitFor(()=>expect(s.management.changeMovement).toHaveBeenCalledTimes(1));await click();expect(s.management.changeMovement).toHaveBeenCalledTimes(1);
  finish(undefined);await pending;const original=s.management.changeMovement.mock.calls[0][0];
  await s.deliver(s.button('field.amount'));await s.message('100');await s.confirm();
  expect(s.management.changeMovement.mock.calls[1][0]).toEqual(original);
  s.flow.store.clear();s.management.getChangeReceipt.mockResolvedValueOnce({transaction_id:uuid(9),version:'2',action:'void'} as never);await click();
  expect(s.management.changeMovement).toHaveBeenCalledTimes(2);expect(s.management.getChangeReceipt).toHaveBeenCalledWith(original.requestId);
 });
 it('does not let expired, superseded or unauthorized selection mutate financial data',async()=>{
  let clock=0;const s=fixture(new ProposalStore(30,()=>clock));await s.open();await s.deliver(s.button('void'));const old=s.button('cancel');clock=31;await s.deliver(old);
  expect(s.flow.store.getState(chat)).toBeUndefined();expect(s.management.changeMovement).not.toHaveBeenCalled();
  await s.message('/movimenti');const foreign=s.button('select.0');foreign.callback_query.from.id=999;await s.deliver(foreign);expect(s.management.getMovement).toHaveBeenCalledTimes(1);
 });
});
function repository(data:unknown,error:unknown=null) {
 const user=uuid(90),query={select:vi.fn().mockReturnThis(),then:(resolve:(v:unknown)=>void)=>resolve({data,error})};
 const sdk={rpc:vi.fn(()=>query),auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:user},access_token:'synthetic',expires_at:Date.now()/1000+3600}}}),getUser:vi.fn().mockResolvedValue({data:{user:{id:user}}})}};
 return {repo:new SupabaseTransactionRepository(()=>({url:'https://synthetic.invalid',anonKey:'synthetic',email:'test@example.invalid',password:'synthetic'}),(()=>sdk) as never),sdk,query};
}
const rpcBalance=()=>({account_id:uuid(1),account_name:'Revolut',currency:'EUR',is_active:true,as_of_date:'2026-10-17',status:'configured',balance:'9007199254740992.29'});
describe('B/C repository contracts',()=>{
 it('uses existing balances RPC with textual numeric projection and no transaction download',async()=>{
  const s=repository([rpcBalance()]);expect((await s.repo.getBalances('2026-10-17'))[0].balance).toBe('9007199254740992.29');
  expect(s.sdk.rpc).toHaveBeenCalledWith('get_account_balances',{p_as_of:'2026-10-17'});expect(s.query.select).toHaveBeenCalledWith(expect.stringContaining('balance::text'));
 });
 it.each([{balance:1.2},{balance:'0.001'},{balance:'NaN'},{balance:'Infinity'},{currency:'USD'},{status:'unexpected'},{status:'not_configured',balance:'0'},{status:'configured',balance:null},{as_of_date:'infinity'}])('rejects unexpected balances %s',async change=>{
  await expect(repository([{...rpcBalance(),...change}]).repo.getBalances('2026-10-17')).rejects.toThrow();
 });
 it('accepts explicit unconfigured NULL and rejects duplicate account rows',async()=>{
  expect((await repository([{...rpcBalance(),status:'not_configured',balance:null}]).repo.getBalances('2026-10-17'))[0].balance).toBeNull();
  await expect(repository([rpcBalance(),rpcBalance()]).repo.getBalances('2026-10-17')).rejects.toThrow();
 });
 it('verifies the actual SDK produces PostgREST text casts on an RPC read',async()=>{
  let url='';const client=createClient('https://synthetic.invalid','synthetic',{global:{fetch:async(input)=>{url=String(input);return new Response(JSON.stringify([rpcBalance()]),{headers:{'content-type':'application/json'}});}}});
  await client.rpc('get_account_balances',{p_as_of:'2026-10-17'}).select('balance::text');expect(decodeURIComponent(url)).toContain('select=balance::text');
 });
 it('loads exact management snapshot, validates type/category/accounts and never casts amount to Number',async()=>{
  const d=detail(),s=repository(d);expect((await s.repo.getMovement(uuid(9))).movement.amount).toBe('12.50');
  await expect(repository({...d,movement:{...d.movement,amount:'0.001'}}).repo.getMovement(uuid(9))).rejects.toThrow();
  await expect(repository({...d,movement:{...d.movement,category:'salary'}}).repo.getMovement(uuid(9))).rejects.toThrow();
 });
 it('maps closed/conflict errors and uses canonical null financial fields for cancellation',async()=>{
  const request:ChangeRequest={requestId:uuid(8),transactionId:uuid(9),expectedVersion:'1',action:'void',values:detail().movement};
  await expect(repository(null,{code:'PT423',message:'secret'}).repo.changeMovement(request)).rejects.toMatchObject({code:'closed'});
  const s=repository({transaction_id:uuid(9),action:'void',version:'2'});await s.repo.changeMovement(request);
  expect(s.sdk.rpc).toHaveBeenCalledWith('manage_transaction_once',expect.objectContaining({p_request_id:uuid(8),p_action:'void',p_amount:null,p_date:null,p_category:null,p_from_account:null,p_to_account:null}));
 });
});

describe('B/C UX refinement',()=>{
 it('labels and numbers every history row and button without changing callback identity',()=>{
  const rows=[{id:uuid(9),type:'expense' as const,amount:'15.00',date:'2026-10-17',category:'food',from:'Revolut',to:null},
   {id:uuid(10),type:'expense' as const,amount:'13.00',date:'2026-10-16',category:'tobacco',from:'Contanti',to:null,voided:true},
   {id:uuid(11),type:'transfer' as const,amount:'2.50',date:'2026-10-15',category:null,from:'Isybank',to:'Revolut'}];
  const view=historyView({kind:'history',id:'a'.repeat(16),revision:7,page:0,cursors:[null],next:null,loading:false},{rows,next:null});
  const buttons=view.keyboard.inline_keyboard.slice(0,3).flat();
  expect(buttons[0].text).toBe('1. ✏️ 15,00 € · Cibo · 17/10');
  expect(buttons[1].text).toBe('2. ❌ 13,00 € · Tabacco · 16/10');
  expect(buttons[2].text).toContain('Isybank → Revolut');expect(buttons[2].text).toContain('15/10');
  expect(view.text).toContain('1. Uscita');expect(view.text).toContain('2. ❌ ANNULLATO');
  buttons.forEach((b,i)=>{expect(b.callback_data).toBe(`h:${'a'.repeat(16)}:7:select.${i}`);expect(b.text).not.toContain(rows[i].id);expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);});
 });
 it('bounds long Unicode account/amount labels and retains the full value in the detail text',()=>{
  const row={id:uuid(9),type:'transfer' as const,amount:'90071992547409929999999999999999999999999.29',date:'2026-10-17',category:null,from:'💶 Conto lunghissimo '.repeat(20),to:'Riserva '.repeat(20)};
  const view=historyView({kind:'history',id:'a'.repeat(16),revision:0,page:0,cursors:[null],next:null,loading:false},{rows:[row],next:null});
  const text=view.keyboard.inline_keyboard[0][0].text;
  expect(Array.from(text).length).toBeLessThanOrEqual(64);expect(text).toContain('…');expect(text).toContain('17/10');expect(text).toContain('→');expect(view.text).toContain(euro(row.amount));
 });
 it('selects the actual transaction from the current page and rejects a previous-page selection',async()=>{
  const s=fixture(),cursor={date:'2026-10-16',id:uuid(8)};
  const row=(id:string)=>({id,type:'expense',amount:'15.00',date:'2026-10-17',category:'food',from:'Revolut',to:null});
  s.history.getMovements.mockResolvedValueOnce({rows:[row(uuid(9)),row(uuid(10))],next:cursor} as never).mockResolvedValueOnce({rows:[row(uuid(11))],next:null} as never);
  await s.message('/movimenti');const old=s.button('select.1');await s.deliver(s.button('next'));await s.deliver(old);
  expect(s.management.getMovement).not.toHaveBeenCalled();
  s.management.getMovement.mockResolvedValueOnce({...detail(),movement:{...detail().movement,id:uuid(11)}});
  await s.deliver(s.button('select.0'));expect(s.management.getMovement).toHaveBeenCalledWith(uuid(11));expect(s.history.getMovements.mock.calls[1]).toEqual([cursor]);
 });
 it('keeps cancelled rows visible and consultable without edit/void actions',async()=>{
  const s=fixture();s.history.getMovements.mockResolvedValueOnce({rows:[{id:uuid(9),type:'expense',amount:'15.00',date:'2026-10-17',category:'food',from:'Revolut',to:null,voided:true}],next:null} as never);
  s.management.getMovement.mockResolvedValueOnce({...detail(),movement:{...detail().movement,voided_at:'2026-10-17T12:00:00Z',voided_by:uuid(90)}});
  await s.message('/movimenti');expect(s.lastView().text).toContain('❌ ANNULLATO');expect(s.lastView().reply_markup.inline_keyboard[0][0].text).toContain('❌');
  await s.deliver(s.button('select.0'));const labels=s.lastView().reply_markup.inline_keyboard.flat().map((b:any)=>b.text);
  expect(labels).not.toContain('✏️ Modifica');expect(labels).not.toContain('Annulla movimento');expect(s.management.changeMovement).not.toHaveBeenCalled();
 });
 it('moves a valid amount directly to before/after, never writes before explicit confirmation',async()=>{
  const s=fixture();await s.open();await s.deliver(s.button('edit'));
  expect(s.lastView().reply_markup.inline_keyboard.flat().map((b:any)=>b.text)).toContain('✅ Riepilogo e conferma');
  await s.deliver(s.button('field.amount'));await s.message('-€12');expect(s.flow.store.getState(chat)).toMatchObject({step:'edit',field:'amount'});
  await s.message('15');expect(s.flow.store.getState(chat)).toMatchObject({step:'preview'});
  expect(s.lastView().text).toContain('✅ Modifica pronta.');expect(s.lastView().text).toContain('Prima:');expect(s.lastView().text).toContain('12,50 €');expect(s.lastView().text).toContain('15,00 €');
  const buttons=s.lastView().reply_markup.inline_keyboard.flat();expect(buttons.map((b:any)=>b.text)).toEqual(['✅ Conferma modifiche','Modifica ancora','❌ Annulla operazione']);
  expect(s.management.changeMovement).not.toHaveBeenCalled();buttons.forEach((b:any)=>expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64));
  await s.deliver(s.button('back'));expect(s.flow.store.getState(chat)).toMatchObject({step:'edit'});
  await s.deliver(s.button('preview'));await s.confirm();expect(s.management.changeMovement).toHaveBeenCalledTimes(1);
 });
 it.each(['date','category','from_id'] as const)('moves %s changes directly to the preview',async field=>{
  const s=fixture();await s.open();await s.deliver(s.button('edit'));await s.deliver(s.button(`field.${field}`));
  if(field==='date')await s.message('16/10/2026');else await s.deliver(s.button(field==='category'?'set.category.tobacco':'set.from_id.1'));
  expect(s.flow.store.getState(chat)).toMatchObject({step:'preview',field:null});expect(s.management.changeMovement).not.toHaveBeenCalled();
 });
 it('success provides a protected return to refreshed history and old confirm only recovers receipt',async()=>{
  const s=fixture();await s.open();await s.deliver(s.button('void'));const savedConfirm=s.lastView().reply_markup.inline_keyboard[0][0].callback_data;
  await s.confirm();expect(s.flow.store.getState(chat)).toMatchObject({step:'success'});
  expect(s.lastView().text).toContain('Movimento annullato contabilmente');expect(s.lastView().reply_markup.inline_keyboard[0][0].text).toBe('📋 Torna ai movimenti');
  s.management.getChangeReceipt.mockResolvedValueOnce({transaction_id:uuid(9),action:'void',version:'2'} as never);
  await s.deliver({...s.button('confirm'),callback_query:{...s.button('confirm').callback_query,data:savedConfirm}});
  expect(s.management.changeMovement).toHaveBeenCalledTimes(1);
  await s.deliver(s.button('history'));expect(s.history.getMovements).toHaveBeenCalledTimes(2);expect(s.flow.store.getState(chat)?.kind).toBe('history');
 });
 it('keeps each balance observation immutable while navigating menu, history, wizard and expiry',async()=>{
  let clock=0;const s=fixture(new ProposalStore(100,()=>clock));await s.message('/saldi');
  const firstId=s.client.sendMessage.mock.results[0].value; // message promises are resolved before delivery completes
  const snapshotId=await firstId;const old=s.button('refresh');
  await s.message('/menu');await s.message('/movimenti');await s.deliver(old);await s.message('/menu');
  const menu=s.flow.store.getState(chat)!;await s.deliver({...s.button('movement'),callback_query:{...s.button('movement').callback_query,data:`m:${'id' in menu?menu.id:''}:movement`}});
  clock=101;await s.message('/menu');
  expect(s.client.call.mock.calls.filter(([method,body])=>method.startsWith('editMessage')&&body.message_id===snapshotId)).toEqual([]);
  expect(s.flow.panels.get(chat)?.messageId).not.toBe(snapshotId);
 });
 it('refresh sends a new timestamped observation, leaves the old one intact and invalidates its buttons',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-17T17:08:00Z'));
  try {
   const s=fixture();await s.message('/saldi');const old=s.button('refresh');
   expect(s.client.sendMessage.mock.calls[0][1]).toContain('19:08:00');expect(s.client.sendMessage.mock.calls[0][1]).toContain('Europe/Rome');
   vi.setSystemTime(new Date('2026-10-17T17:09:00Z'));await s.deliver(old);
   expect(s.client.sendMessage.mock.calls[1][1]).toContain('19:09:00');expect(s.client.sendMessage).toHaveBeenCalledTimes(2);
   expect(s.client.call.mock.calls.filter(([m])=>m.startsWith('editMessage'))).toEqual([]);
   await s.deliver(old);expect(s.client.sendMessage).toHaveBeenCalledTimes(2);expect(s.balances.getBalances).toHaveBeenCalledTimes(2);
   await s.deliver(s.button('menu'));expect(s.client.sendMessage).toHaveBeenCalledTimes(3);expect(s.flow.store.getState(chat)?.kind).toBe('menu');
  } finally {vi.useRealTimers();}
 });
 it('makes repeated /saldi commands independent and opens balances from a menu without reusing it',async()=>{
  const s=fixture();await s.message('/menu');await s.message('/saldi');await s.message('/saldi');
  const snapshots=s.client.sendMessage.mock.calls.filter(([,text])=>text.includes('💰 Saldi teorici'));
  expect(snapshots).toHaveLength(2);expect(s.flow.panels.has(chat)).toBe(false);
  await s.message('/menu');await s.deliver(s.button('balances'));expect(s.client.sendMessage.mock.calls.filter(([,text])=>text.includes('💰 Saldi teorici'))).toHaveLength(3);
 });
 it('does not duplicate a replayed /saldi update during or after its read',async()=>{
  const s=fixture();let finish!:(rows:AccountBalance[])=>void;s.balances.getBalances.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const update={update_id:900,message:{message_id:900,text:'/saldi',chat:{id:chat,type:'private'}}};
  const pending=s.deliver(update);await vi.waitFor(()=>expect(s.balances.getBalances).toHaveBeenCalledTimes(1));await s.deliver(update);finish([]);await pending;await s.deliver(update);
  expect(s.balances.getBalances).toHaveBeenCalledTimes(1);expect(s.client.sendMessage).toHaveBeenCalledTimes(1);
 });
 it('contains uncertain balance delivery without automatic retry or exposing the raw error',async()=>{
  const s=fixture(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});s.client.sendMessage.mockRejectedValueOnce(new Error('private token'));
  await expect(s.message('/saldi')).resolves.toBeUndefined();expect(s.client.sendMessage).toHaveBeenCalledTimes(1);
  expect(s.client.sendMessage.mock.calls[0][4]).toBe(true);expect(warn.mock.calls.flat().join('')).not.toContain('private token');
  await s.message('/saldi');expect(s.client.sendMessage).toHaveBeenCalledTimes(2);
 });
 it('leaves old balances untouched after a restart or expired session',async()=>{
  let clock=0;const s=fixture(new ProposalStore(10,()=>clock));await s.message('/saldi');const old=s.button('refresh');
  clock=11;await s.deliver(old);s.flow.store.clear();await s.deliver(old);
  expect(s.balances.getBalances).toHaveBeenCalledTimes(1);expect(s.client.sendMessage).toHaveBeenCalledTimes(1);
  expect(s.client.call.mock.calls.every(([method])=>method==='answerCallbackQuery')).toBe(true);
 });
});
