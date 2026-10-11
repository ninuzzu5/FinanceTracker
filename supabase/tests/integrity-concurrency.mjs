import assert from 'node:assert/strict';
// Native PostgreSQL only. No new dependency, URL, real credentials or remote writes.
export async function integrityConcurrency({admin,connect,user,cash,bank}) {
  const workers=await Promise.all(Array.from({length:25},()=>connect()));
  for (const c of workers) await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  const before=(await admin.query('select count(*)::int n from public.transactions')).rows[0].n;
  let refused=0;
  await Promise.all(workers.map(async c=>{
    for (const value of ['0.001','NaN','Infinity','-Infinity','0','-1']) {
      await assert.rejects(c.query(`insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
        values($1,'income',$2,'2098-01-01','salary',$3)`,[user,value,bank]),{code:'23514'}); refused++;
    }
    for (const date of ['infinity','-infinity']) {
      await assert.rejects(c.query(`insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
        values($1,'income',1,$2,'salary',$3)`,[user,date,bank]),{code:'23514'}); refused++;
    }
  }));
  assert.equal((await admin.query('select count(*)::int n from public.transactions')).rows[0].n,before);
  // Simultaneous currency edits cannot turn otherwise valid transfers into FX operations.
  const expected=(await workers[0].query("select sum(balance)::text value from public.get_account_balances('2098-01-01')")).rows[0].value;
  await Promise.all(workers.map(async (c,i)=>{
    if (i%2) {
      await assert.rejects(c.query("update public.accounts set currency='USD' where id=$1",[bank]),{code:'23514'}); refused++;
    } else {
      await c.query(`insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id)
        values($1,'transfer',0.01,'2098-01-01',$2,$3)`,[user,bank,cash]);
    }
  }));
  assert.equal((await workers[0].query("select sum(balance)::text value from public.get_account_balances('2098-01-01')")).rows[0].value,expected);
  assert.equal((await admin.query("select count(*)::int n from public.accounts where currency<>'EUR'")).rows[0].n,0);
  assert.equal((await admin.query('select count(*)::int n from public.transactions')).rows[0].n,before+13);
  console.log(`B2/B3 native stress passed: ${refused} invalid writes rejected, 13 simultaneous EUR transfers, unchanged net worth, 25 sessions.`);
}
