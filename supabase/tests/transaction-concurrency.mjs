import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Only receives connections to the caller's disposable local cluster.
export async function transactionConcurrency({admin,connect,user,cash}) {
  const workers=await Promise.all(Array.from({length:25},async()=>{
    const c=await connect();await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);return c;
  }));
  const save=(c,key,amount='0.01',type='expense',from='revolut',to=null,category='food',date='2026-09-01')=>c.query(
    'select * from public.save_transaction_once($1,$2,$3,$4,$5,$6,$7)',[key,type,amount,date,category,from,to]);
  const count=async()=>(await admin.query('select count(*)::int n from public.transactions')).rows[0].n;
  const wait=async c=>{
    for(let i=0;i<100;i++) {
      if((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).rows[0]?.wait_event_type==='Lock') return;
      await new Promise(r=>setTimeout(r,10));
    }
    throw new Error('Expected a real lock wait');
  };
  let before=await count();const key=randomUUID();
  const results=await Promise.all(workers.map(c=>save(c,key)));
  for(const r of results)assert.deepEqual(r.rows,results[0].rows);
  assert.equal(await count(),before+1);
  // Disconnect after a committed response; a new connection returns the durable receipt.
  const disconnected=await connect();await disconnected.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  const lostKey=randomUUID();await save(disconnected,lostKey);await disconnected.end();
  const recovered=await save(workers[0],lostKey);assert.equal(recovered.rows.length,1);assert.equal(await count(),before+2);
  before=await count();const conflicting=randomUUID();
  const mixed=await Promise.allSettled(workers.map((c,i)=>save(c,conflicting,i%2?'0.02':'0.03')));
  const winner=mixed.find(r=>r.status==='fulfilled');assert.ok(winner);
  for(const r of mixed)if(r.status==='fulfilled')assert.deepEqual(r.value.rows,winner.value.rows);else assert.equal(r.reason.code,'PT409');
  assert.equal(await count(),before+1);
  before=await count();const distinct=await Promise.all(workers.map(c=>save(c,randomUUID())));
  assert.equal(new Set(distinct.map(r=>r.rows[0].transaction_id)).size,25);assert.equal(await count(),before+25);
  // Rollback releases the operation key, with no orphan transaction or receipt.
  const retryKey=randomUUID();await workers[0].query('begin');const abandoned=await save(workers[0],retryKey);
  const waiting=save(workers[1],retryKey);await wait(workers[1]);await workers[0].query('rollback');
  const replacement=await waiting;
  assert.notEqual(replacement.rows[0].transaction_id,abandoned.rows[0].transaction_id);
  assert.equal((await admin.query('select count(*)::int n from public.transactions where id=$1',[abandoned.rows[0].transaction_id])).rows[0].n,0);
  // Movement first: cash closure must see it after waiting and reject a stale preview.
  const theoretical=(await workers[0].query("select theoretical_balance from public.preview_cash_reconciliation('2026-09-01')")).rows[0].theoretical_balance;
  const transferKey=randomUUID();await workers[0].query('begin');
  const transfer=await save(workers[0],transferKey,'0.01','transfer','revolut','contanti',null);
  const stale=workers[1].query('select * from public.reconcile_cash($1,$2,$3,$4,$5)',[cash,'2026-09-01',theoretical,theoretical,randomUUID()]).then(()=>null,e=>e.code);
  await wait(workers[1]);await workers[0].query('commit');assert.equal(await stale,'PT409');
  // Closure first: new writes fail, but the old committed transfer remains recoverable.
  const fresh=(await workers[0].query("select theoretical_balance from public.preview_cash_reconciliation('2026-09-01')")).rows[0].theoretical_balance;
  await workers[0].query('begin');await workers[0].query('select * from public.reconcile_cash($1,$2,$3,$4,$5)',[cash,'2026-09-01',fresh,fresh,randomUUID()]);
  const blockedKey=randomUUID();const blocked=save(workers[1],blockedKey,'0.01','transfer','contanti','revolut',null).then(()=>null,e=>e.code);
  await wait(workers[1]);await workers[0].query('commit');assert.equal(await blocked,'PT423');
  assert.equal((await workers[1].query('select * from public.get_transaction_receipt($1)',[blockedKey])).rows.length,0);
  assert.deepEqual((await save(workers[1],transferKey,'0.01','transfer','revolut','contanti',null)).rows,transfer.rows);
  console.log('B1 native SQL passed: 25 simultaneous retries, conflicting payloads, 25 distinct identical operations, disconnect recovery, rollback and both cash closure races.');
  await botReceiptIntegration(workers[2],user);
}
async function botReceiptIntegration(connection,user) {
  const {SupabaseTransactionRepository}=await import('../../apps/bot/dist/src/supabase.js');
  const {ProposalFlow}=await import('../../apps/bot/dist/src/proposal-flow.js');
  const {deliverUpdate}=await import('../../apps/bot/dist/src/flow-delivery.js');
  let lose=true;
  const sdk={auth:{getSession:async()=>({data:{session:{user:{id:user},access_token:'synthetic',expires_at:Date.now()/1000+3600}},error:null}),
    getUser:async()=>({data:{user:{id:user}},error:null})},rpc:async(name,args)=>{
      try {
        const query=name==='get_transaction_receipt'
          ? await connection.query('select * from public.get_transaction_receipt($1)',[args.p_request_id])
          : await connection.query('select * from public.save_transaction_once($1,$2,$3,$4,$5,$6,$7)',
            [args.p_request_id,args.p_type,args.p_amount,args.p_date,args.p_category,args.p_from_account,args.p_to_account]);
        if(name==='save_transaction_once' && lose){lose=false;throw new Error('Synthetic post-commit response loss');}
        return {data:query.rows,error:null};
      }catch(error){return {data:null,error:{code:error.code??'NETWORK',message:'synthetic'}};}
    }};
  const repository=new SupabaseTransactionRepository(()=>({url:'https://synthetic.invalid',anonKey:'synthetic',email:'test@example.invalid',password:'synthetic'}),()=>sdk);
  const client={call:async()=>true,sendMessage:async()=>{}};
  const config={allowedChatId:'123456'};
  const original={update_id:10001,message:{message_id:10001,text:'12 tabacco revolut 2026-09-02',chat:{id:123456,type:'private'}}};
  const button=(flow,action='confirm')=>{
    const p=flow.store.get(123456);assert.ok(p);
    return {update_id:10002,callback_query:{id:'synthetic',from:{id:123456},data:`p:${p.id}:${p.revision}:${action}${action==='confirm'?':'+Buffer.from(p.requestId.replaceAll('-',''),'hex').toString('base64url'):''}`,
      message:{message_id:10002,chat:{id:123456,type:'private'}}}};
  };
  const count=async()=>(await connection.query('select count(*)::int n from public.transactions')).rows[0].n;
  const before=await count();const flow=new ProposalFlow();const restarted=new ProposalFlow();
  try {
    await deliverUpdate(flow,client,original,config,undefined,repository);
    const key=flow.store.get(123456).requestId;const confirm=button(flow);
    await deliverUpdate(flow,client,confirm,config,undefined,repository);
    assert.equal(await count(),before+1);assert.equal(flow.store.get(123456).submitted,true);
    // No state in a new process, only a durable key from the old confirmation button.
    await deliverUpdate(restarted,client,confirm,config,undefined,repository);assert.equal(await count(),before+1);
    await Promise.all([deliverUpdate(flow,client,button(flow),config,undefined,repository),deliverUpdate(flow,client,button(flow),config,undefined,repository)]);
    assert.equal(await count(),before+1);
    await deliverUpdate(restarted,client,original,config,undefined,repository);
    assert.equal(restarted.store.get(123456).requestId,key);
    await deliverUpdate(restarted,client,button(restarted),config,undefined,repository);assert.equal(await count(),before+1);
    await deliverUpdate(restarted,client,{update_id:10003,edited_message:{...original.message,text:'13 tabacco revolut 2026-09-02'}},config,undefined,repository);
    await deliverUpdate(restarted,client,button(restarted),config,undefined,repository);assert.equal(await count(),before+1);
    await deliverUpdate(restarted,client,{...original,update_id:10004,message:{...original.message,message_id:10004}},config,undefined,repository);
    assert.notEqual(restarted.store.get(123456).requestId,key);
    await deliverUpdate(restarted,client,button(restarted),config,undefined,repository);assert.equal(await count(),before+2);
    console.log('B1 bot + native SQL passed: real repository/flow, simulated post-commit response loss, double confirm, process-state reset, source replay/edit and distinct identical expense.');
  }finally{flow.store.clear();restarted.store.clear();}
}
