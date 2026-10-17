// Runs only inside the disposable native runner, with its synthetic Auth contract.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function managementConcurrency({admin,connect,mustWait}) {
 const user='00000000-0000-4000-8000-000000000095',cash='10000000-0000-4000-8000-000000000095',bank='10000000-0000-4000-8000-000000000096';
 await admin.query(`insert into auth.users values($1)`,[user]);
 await admin.query(`insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values($1,$3,'Contanti','cash',0,'2026-01-01'),($2,$3,'Revolut','bank',100,'2026-01-01')`,[cash,bank,user]);
 const login=async()=>{const c=await connect();await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);return c;};
 const workers=await Promise.all(Array.from({length:25},login)),a=workers[0],b=workers[1];
 const save=async(type,amount,date,category,from,to,key=randomUUID())=>(await a.query('select transaction_id from public.save_transaction_once($1,$2,$3,$4,$5,$6,$7)',[key,type,amount,date,category,from,to])).rows[0].transaction_id;
 const edit=(c,key,id,version,amount,date,from,to,category='food')=>c.query('select public.manage_transaction_once($1,$2,$3,\'edit\',$4,$5,$6,$7,$8) receipt',[key,id,version,amount,date,category,from,to]);
 const cancel=(c,key,id,version)=>c.query("select public.manage_transaction_once($1,$2,$3,'void') receipt",[key,id,version]);
 const reconcile=(c,day,observed,expected)=>c.query('select * from public.reconcile_cash($1,$2,$3,$4,$5)',[cash,day,observed,expected,randomUUID()]);
 const code=p=>p.then(()=>null,e=>e.code);
 // Same key, 25 sessions: one version increment and one durable audit row.
 const originalKey=randomUUID(),id=await save('expense','0.29','2026-01-01','food','revolut',null,originalKey),key=randomUUID();
 const results=await Promise.all(workers.map(c=>edit(c,key,id,1,'0.31','2026-01-01',bank,null)));
 assert(results.every(r=>JSON.stringify(r.rows)===JSON.stringify(results[0].rows)));
 assert.equal((await admin.query('select count(*)::int n from public.transaction_changes where user_id=$1',[user])).rows[0].n,1);
 // Same key, different payload after commit cannot be reinterpreted as another operation.
 assert.equal(await code(edit(b,key,id,1,'0.32','2026-01-01',bank,null)),'PT409');
 // Distinct keys, same base version: exactly one incompatible edit can win.
 const conflicting=await Promise.all(workers.map((c,i)=>code(edit(c,randomUUID(),id,2,`0.${String(40+i).padStart(2,'0')}`,'2026-01-01',bank,null))));
 assert.equal(conflicting.filter(c=>c===null).length,1);assert.equal(conflicting.filter(c=>c==='PT409').length,24);
 // Deterministic lock wait: cancellation vs correction, stale version must not overwrite.
 await a.query('begin');const voidKey=randomUUID();await cancel(a,voidKey,id,3);
 const stale=code(edit(b,randomUUID(),id,3,'0.80','2026-01-01',bank,null));await mustWait(b,stale);await a.query('commit');assert.equal(await stale,'PT409');
 assert.equal((await b.query('select transaction_id from public.get_transaction_receipt($1)',[originalKey])).rows[0].transaction_id,id);
 // Simulated lost post-COMMIT response and process reset: a fresh session recovers the same operation.
 const second=await save('income','0.20','2026-01-02','salary',null,'revolut');
 const disconnected=await login(),lostKey=randomUUID();await disconnected.query('begin');await cancel(disconnected,lostKey,second,1);await disconnected.query('commit');await disconnected.end();
 const fresh=await login();const recovered=(await fresh.query('select public.get_transaction_change_receipt($1) receipt',[lostKey])).rows[0].receipt;
 assert.equal(recovered.transaction_id,second);assert.deepEqual((await cancel(fresh,lostKey,second,1)).rows[0].receipt,recovered);
 // Correction wins cash lock: waiting reconciliation detects changed theoretical balance.
 const cashIncome=await save('income','1.00','2026-01-01','salary',null,'contanti');
 const cashEditKey=randomUUID();await a.query('begin');await edit(a,cashEditKey,cashIncome,1,'2.00','2026-01-01',null,cash,'salary');
 const oldPreview=code(reconcile(b,'2026-01-01','1.00','1.00'));await mustWait(b,oldPreview);await a.query('commit');assert.equal(await oldPreview,'PT409');
 // Reconciliation wins: old cash leg remains protected even when new date/account move it away.
 await a.query('begin');await reconcile(a,'2026-01-01','2.00','2.00');
 const blocked=code(edit(b,randomUUID(),cashIncome,2,'2.00','2026-01-02',null,bank,'salary'));
 await mustWait(b,blocked);await a.query('commit');assert.equal(await blocked,'PT423');
 assert.equal(await code(cancel(b,randomUUID(),cashIncome,2)),'PT423');
 await edit(b,cashEditKey,cashIncome,1,'2.00','2026-01-01',null,cash,'salary');
 // New cash leg is protected too, including a transfer correction racing with a closure.
 const transfer=await save('transfer','0.01','2026-01-02',null,'revolut','contanti');
 await a.query('begin');await reconcile(a,'2026-01-02','2.01','2.01');
 const transferChange=code(edit(b,randomUUID(),transfer,1,'0.02','2026-01-02',bank,cash,null));
 await mustWait(b,transferChange);await a.query('commit');assert.equal(await transferChange,'PT423');
 // Correction rollback releases its cash lock and leaves no audit entry or balance effect.
 const day3=await save('income','0.01','2026-01-03','salary',null,'contanti'),rollbackKey=randomUUID();
 await a.query('begin');await cancel(a,rollbackKey,day3,1);
 const afterRollback=reconcile(b,'2026-01-03','2.02','2.02');await mustWait(b,afterRollback);await a.query('rollback');await afterRollback;
 assert.equal((await b.query('select public.get_transaction_change_receipt($1) receipt',[rollbackKey])).rows[0].receipt,null);
 assert.equal((await b.query("select balance::text from public.get_account_balances('2026-01-03') where account_id=$1",[cash])).rows[0].balance,'2.02');
 assert.equal((await b.query('select count(*)::int n from public.transaction_changes where user_id=$1',[user])).rows[0].n,5);
 const botTarget=await save('expense','0.01','2026-01-04','food','revolut',null);
 await botManagementIntegration(a,user,botTarget);
 console.log('B/C native concurrency passed: 25 identical retries, 25 conflicting edits, cancel/edit race, post-commit recovery, old/new cash legs vs closure, correction rollback.');
}

async function botManagementIntegration(connection,user,id) {
 const {SupabaseTransactionRepository}=await import('../../apps/bot/dist/src/supabase.js');
 const {ProposalFlow}=await import('../../apps/bot/dist/src/proposal-flow.js');
 const {deliverUpdate}=await import('../../apps/bot/dist/src/flow-delivery.js');
 let lose=true;
 const sdk={auth:{getSession:async()=>({data:{session:{user:{id:user},access_token:'synthetic',expires_at:Date.now()/1000+3600}}}),getUser:async()=>({data:{user:{id:user}}})},rpc:async(name,args)=>{
  try {
   let query;
   if(name==='get_transaction_for_management')query=await connection.query('select public.get_transaction_for_management($1) result',[args.p_transaction_id]);
   else if(name==='get_transaction_change_receipt')query=await connection.query('select public.get_transaction_change_receipt($1) result',[args.p_request_id]);
   else query=await connection.query('select public.manage_transaction_once($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[args.p_request_id,args.p_transaction_id,args.p_expected_version,args.p_action,args.p_amount,args.p_date,args.p_category,args.p_from_account,args.p_to_account]);
   if(name==='manage_transaction_once'&&lose){lose=false;throw new Error('Synthetic response lost after commit');}
   return {data:query.rows[0].result,error:null};
  }catch(error){return {data:null,error:{code:error.code??'NETWORK'}};}
 }};
 const repository=new SupabaseTransactionRepository(()=>({url:'https://synthetic.invalid',anonKey:'synthetic',email:'test@example.invalid',password:'synthetic'}),()=>sdk);
 const client={call:async()=>true,sendMessage:async()=>101},config={allowedChatId:'123456'},flow=new ProposalFlow(),restarted=new ProposalFlow();
 const deliver=(f,update)=>deliverUpdate(f,client,update,config,undefined,repository,repository,repository,repository,repository);
 const button=(f,action)=>{const s=f.store.getState(123456);return {update_id:1,callback_query:{id:'query',from:{id:123456},message:{message_id:101,chat:{id:123456,type:'private'}},data:`c:${s.id}:${s.revision}:${action}`}};};
 try {
  const effect=flow.management.open(123456,id)[0];flow.management.loaded(effect,await repository.getMovement(id));
  await deliver(flow,button(flow,'void'));
  const key=flow.store.getState(123456).requestId,confirm=button(flow,`confirm:${Buffer.from(key.replaceAll('-',''),'hex').toString('base64url')}`);
  await deliver(flow,confirm);assert.equal(flow.store.getState(123456).step,'uncertain');
  assert.equal((await connection.query('select count(*)::int n from public.transaction_changes where request_id=$1',[key])).rows[0].n,1);
  // A new process may read the receipt from the old callback but never reconstruct a write.
  await deliver(restarted,confirm);assert.equal(restarted.store.getState(123456),undefined);
  const retry=button(flow,`confirm:${Buffer.from(key.replaceAll('-',''),'hex').toString('base64url')}`);
  await Promise.all([deliver(flow,retry),deliver(flow,retry)]);
  assert.equal(flow.store.getState(123456).step,'success');
  assert.equal((await connection.query('select count(*)::int n from public.transaction_changes where request_id=$1',[key])).rows[0].n,1);
  console.log('B/C bot + native SQL passed: real repository/flow, post-commit response loss, double confirmation, same-key retry and restart receipt recovery.');
 }finally{flow.store.clear();restarted.store.clear();}
}
