// Starts ONLY a new disposable local PostgreSQL cluster. Never accepts remote URLs or credentials.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const runtime = process.argv[2];
if (!runtime) throw new Error('Supply a temporary embedded-postgres dist/index.js runtime path');
const { default: EmbeddedPostgres } = await import(pathToFileURL(resolve(runtime)).href);
const root = await mkdtemp(join(tmpdir(), 'finance-cash-tests-'));
// Unix socket only: no TCP listener, no remote database configuration.
const cluster = new EmbeddedPostgres({ databaseDir: join(root, 'db'), user: 'postgres', password: randomUUID(),
  port: 55439, persistent: false, postgresFlags: ['-c', 'listen_addresses=', '-c', `unix_socket_directories=${root}`],
  onLog: () => {}, onError: () => {} });
const clients = [];
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
const user = '00000000-0000-4000-8000-000000000001';
const cash = '10000000-0000-4000-8000-000000000001';
const bank = '10000000-0000-4000-8000-000000000002';
try {
  await cluster.initialise(); await cluster.start();
  const connect = async () => {
    const client = cluster.getPgClient('postgres', root); await client.connect(); clients.push(client);
    await client.query("set statement_timeout = '8s'; set lock_timeout = '6s'"); return client;
  };
  const admin = await connect();
  await admin.query(`create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    set financetracker.test_database='isolated';`);
  for (const migration of ['001_initial_schema.sql','002_rls_policies.sql','004_account_openings_and_balances.sql','005_cash_reconciliation.sql']) {
    await admin.query(await read(`../migrations/${migration}`));
  }
  await admin.query(await read('account_balances.sql'));
  await admin.query(await read('cash_reconciliation.sql'));
  await admin.query(`insert into auth.users values ('${user}');
    insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
    ('${cash}','${user}','Contanti','cash',100,'2026-01-01'),('${bank}','${user}','Revolut','bank',100,'2026-01-01');`);
  const a = await connect(), b = await connect();
  for (const c of [a,b]) await c.query(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  const reconcile = (c, date, observed, expected, key) => c.query('select * from public.reconcile_cash($1,$2,$3,$4,$5)', [cash,date,observed,expected,key]);
  const mustWait = async (client, promise) => {
    const pid = (await admin.query('select pid from pg_stat_activity where pid=$1',[client.processID])).rows[0].pid;
    for (let i = 0; i < 100; i++) {
      if ((await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(r => setTimeout(r,10));
    }
    await promise; throw new Error('Expected a real row-lock wait');
  };
  // Same request concurrently: the second session waits, then receives the same receipt.
  const key = randomUUID(); await a.query('begin');
  const first = await reconcile(a,'2026-01-01','95.00','100.00',key);
  const duplicate = reconcile(b,'2026-01-01','95.00','100.00',key);
  await mustWait(b,duplicate); await a.query('commit');
  assert.deepEqual((await duplicate).rows,first.rows);
  assert.equal((await admin.query('select count(*)::int n from public.account_adjustments')).rows[0].n,1);
  // Reconciliation wins the lock: an insert started before commit must see the new closure.
  await a.query('begin'); await reconcile(a,'2026-01-02','94.00','95.00',randomUUID());
  const retro = b.query(`insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id)
    values('${user}','transfer',1,'2026-01-02','${bank}','${cash}')`).then(() => null,e => e.code);
  await mustWait(b,retro); await a.query('commit'); assert.equal(await retro,'PT423');
  // Movement wins: confirmation started before commit must see its changed theoretical balance.
  await a.query('begin');
  await a.query(`insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id)
    values('${user}','expense',0.01,'2026-01-03','food','${cash}')`);
  const stale = reconcile(b,'2026-01-03','94.00','94.00',randomUUID()).then(() => null,e => e.code);
  await mustWait(b,stale); await a.query('commit'); assert.equal(await stale,'PT409');
  // Competing different request keys: exactly one closure for the day.
  await a.query('begin'); await reconcile(a,'2026-01-03','93.99','93.99',randomUUID());
  const competing = reconcile(b,'2026-01-03','93.99','93.99',randomUUID()).then(() => null,e => e.code);
  await mustWait(b,competing); await a.query('commit'); assert.equal(await competing,'PT423');
  // Rollback releases closure: a waiting movement is permitted if reconciliation never committed.
  await a.query('begin'); await reconcile(a,'2026-01-04','93.99','93.99',randomUUID());
  const rollbackMovement = b.query(`insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
    values('${user}','income',0.01,'2026-01-04','salary','${cash}')`);
  await mustWait(b,rollbackMovement); await a.query('rollback'); await rollbackMovement;
  assert.equal((await b.query("select theoretical_balance from public.preview_cash_reconciliation('2026-01-04')")).rows[0].theoretical_balance,'94.00');
  // Snapshot isolation is deliberately rejected instead of risking a stale closure check.
  await a.query('begin isolation level repeatable read');
  await assert.rejects(reconcile(a,'2026-01-04','94.00','94.00',randomUUID()), {code:'22023'}); await a.query('rollback');
  console.log('Native PostgreSQL passed: SQL fixtures, five concurrent lock scenarios, snapshot-isolation rejection. No remote connections.');
} finally {
  await Promise.allSettled(clients.map(c => c.end()));
  await cluster.stop(); await rm(root,{recursive:true,force:true});
}
