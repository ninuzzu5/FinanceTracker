import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// The caller owns a NEW disposable local cluster. All operations use ordinary authenticated privileges.
export async function auditCashStress({admin,connect,user,cash,bank}) {
  const workers = await Promise.all(Array.from({length:25},async()=>{
    const client=await connect();
    await client.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
    return client;
  }));
  const rpc=(client,date,observed,expected,key)=>client.query('select * from public.reconcile_cash($1,$2,$3,$4,$5)',[cash,date,observed,expected,key]);
  const theoretical=async date=>(await workers[0].query('select theoretical_balance from public.preview_cash_reconciliation($1)',[date])).rows[0].theoretical_balance;
  let attempts=0;
  // 25 simultaneous retries after a committed result whose response is deliberately discarded.
  const receiptKey=randomUUID();const expected=await theoretical('2026-01-04');
  const receipt=await rpc(workers[0],'2026-01-04',expected,expected,receiptKey);
  const replay=await Promise.all(workers.map(c=>rpc(c,'2026-01-04',expected,expected,receiptKey)));attempts+=26;
  for(const result of replay) assert.deepEqual(result.rows,receipt.rows);
  assert.equal((await admin.query('select count(*)::int n from public.account_adjustments where request_id=$1',[receiptKey])).rows[0].n,1);
  // Same request_id concurrently with conflicting payloads: exactly one payload wins.
  const conflictKey=randomUUID();const before=await theoretical('2026-01-05');
  const conflicts=await Promise.allSettled(workers.map((c,i)=>rpc(c,'2026-01-05',i%2 ? '93.00':before,before,conflictKey)));attempts+=25;
  const winners=conflicts.filter(r=>r.status==='fulfilled');assert.ok(winners.length>0);
  const winningRows=winners[0].value.rows;
  for(const r of conflicts) {
    if(r.status==='fulfilled') assert.deepEqual(r.value.rows,winningRows);
    else assert.equal(r.reason.code,'PT409');
  }
  assert.equal((await admin.query('select count(*)::int n from public.account_adjustments where request_id=$1',[conflictKey])).rows[0].n,1);
  // Different request_ids concurrently: one day, one active adjustment.
  const beforeDifferent=await theoretical('2026-01-06');
  const different=await Promise.allSettled(workers.map(c=>rpc(c,'2026-01-06',beforeDifferent,beforeDifferent,randomUUID())));attempts+=25;
  assert.equal(different.filter(r=>r.status==='fulfilled').length,1);
  for(const r of different) if(r.status==='rejected') assert.equal(r.reason.code,'PT423');
  // 12 opposing cent transfers plus 12 reverse transfers race a day closure, repeated 12 days.
  // Successful transfers must net zero when confirmation succeeds; otherwise a stale preview fails.
  for(let day=7;day<=18;day++) {
    const date=`2026-01-${String(day).padStart(2,'0')}`;const beforeDay=await theoretical(date);
    const beforeTotal=(await workers[0].query('select sum(balance)::text total from public.get_account_balances($1)',[date])).rows[0].total;
    const operations=workers.slice(0,24).map((c,i)=>c.query(
      'insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id) values($1,\'transfer\',0.01,$2,$3,$4)',
      [user,date,i%2?cash:bank,i%2?bank:cash]));
    operations.push(rpc(workers[24],date,beforeDay,beforeDay,randomUUID()));
    const results=await Promise.allSettled(operations);attempts+=25;
    for(const r of results.slice(0,24)) if(r.status==='rejected') assert.equal(r.reason.code,'PT423');
    const confirmation=results[24];
    if(confirmation.status==='rejected') {
      assert.equal(confirmation.reason.code,'PT409');
      const fresh=await theoretical(date);assert.equal(fresh,beforeDay);
      await rpc(workers[0],date,fresh,fresh,randomUUID());attempts++;
    }
    const afterTotal=(await workers[0].query('select sum(balance)::text total from public.get_account_balances($1)',[date])).rows[0].total;
    assert.equal(afterTotal,beforeTotal);
    assert.equal((await admin.query('select count(*)::int n from public.account_adjustments where account_id=$1 and effective_date=$2',[cash,date])).rows[0].n,1);
  }
  // A larger ledger: 10,000 bank movements, exact cent cancellation and 25 concurrent reads.
  const loadStart=performance.now();
  const largeDate='2026-01-19';
  const totalBefore=(await workers[0].query('select sum(balance)::text total from public.get_account_balances($1)',[largeDate])).rows[0].total;
  await workers[0].query(`insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id,to_account_id)
    select $1::uuid,case when n%2=0 then 'expense' else 'income' end,0.01::numeric,$2::date,
      case when n%2=0 then 'food' else 'salary' end,
      case when n%2=0 then $3::uuid else null::uuid end,
      case when n%2=1 then $3::uuid else null::uuid end
    from generate_series(1,10000) n`,[user,largeDate,bank]);
  const totals=await Promise.all(workers.map(c=>c.query('select sum(balance)::text total from public.get_account_balances($1)',[largeDate])));
  for(const total of totals) assert.equal(total.rows[0].total,totalBefore);
  console.log(`AUDIT large ledger passed: 10,000 additional movements and 25 concurrent balance reads in ${Math.round(performance.now()-loadStart)} ms (local measurement only).`);
  // Old/new references and bulk operations cannot evade a closed day's guard.
  const cashRow=(await workers[0].query('select id from public.transactions where from_account_id=$1 or to_account_id=$1 limit 1',[cash])).rows[0].id;
  for(const statement of [
    'update public.transactions set amount=amount+0.01 where id=$1',
    "update public.transactions set transaction_date='2026-01-19' where id=$1",
    'delete from public.transactions where id=$1',
  ]) await assert.rejects(workers[0].query(statement,[cashRow]),{code:'PT423'});
  // Rollback must preserve ALL rows when one closed leg occurs in a bulk statement.
  const n=(await admin.query('select count(*)::int n from public.transactions')).rows[0].n;
  await assert.rejects(workers[0].query('delete from public.transactions where user_id=$1',[user]),{code:'PT423'});
  assert.equal((await admin.query('select count(*)::int n from public.transactions')).rows[0].n,n);
  console.log(`AUDIT stress passed: ${attempts} reconciliation/transfer attempts, 25 sessions, 12 race waves; replay, conflicting payloads, closures, exact SQL totals and bulk rollback checked.`);
}
