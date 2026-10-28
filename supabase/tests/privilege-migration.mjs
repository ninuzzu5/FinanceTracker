import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Il chiamante fornisce soltanto un database temporaneo con utenti sintetici.
export async function qualifyPrivilegeMigration({exec, query}) {
  assert.equal((await query("select current_setting('financetracker.test_database',true) as isolated")).rows[0].isolated, 'isolated');
  const migration = await readFile(new URL('../migrations/009_restrict_ledger_writes.sql', import.meta.url), 'utf8');
  const rows = async () => {
    const snapshot = [];
    for (const table of ['accounts','transactions','transaction_receipts','account_adjustments','transaction_changes']) {
      snapshot.push((await query(`select to_jsonb(t) row_data from public.${table} t order by to_jsonb(t)::text`)).rows);
    }
    return snapshot;
  };
  const metadata = () => query(`select 'relation' kind, oid::text id,
      jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity) value
      from pg_class where oid in ('public.accounts'::regclass,'public.transactions'::regclass,
        'public.transaction_receipts'::regclass,'public.account_adjustments'::regclass,'public.transaction_changes'::regclass)
    union all select 'function',oid::text,jsonb_build_object('body',prosrc,'owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl)
      from pg_proc where pronamespace='public'::regnamespace
    union all select 'trigger',oid::text,to_jsonb(t) from pg_trigger t where not tgisinternal
    union all select 'policy',oid::text,to_jsonb(p) from pg_policy p order by 1,2`);
  const acls = () => query(`select c.oid::text id,c.relacl::text acl,a.attnum,a.attacl::text column_acl
    from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.oid in ('public.accounts'::regclass,'public.transactions'::regclass) order by c.oid,a.attnum`);
  const beforeRows = await rows(), beforeMetadata = (await metadata()).rows;
  await exec('create role privilege_parent nologin; create role privilege_bridge nologin noinherit; grant privilege_parent to privilege_bridge; grant privilege_bridge to authenticated');
  for (const grant of [
    'insert on public.transactions', 'update (opening_balance) on public.accounts',
    'insert (description) on public.transactions', 'truncate on public.accounts',
  ]) {
    await exec(`grant ${grant} to privilege_parent`);
    const beforeAcl = (await acls()).rows;
    await assert.rejects(exec(migration), {code:'42501'});
    await exec('rollback');
    assert.deepEqual((await acls()).rows, beforeAcl);
    assert.deepEqual(await rows(), beforeRows);
    await exec(`revoke ${grant} from privilege_parent`);
  }
  await exec('revoke privilege_bridge from authenticated; drop role privilege_bridge; drop role privilege_parent');
  // Un proprietario RPC dipendente da PUBLIC deve causare rollback, non una RPC inutilizzabile.
  await exec(`create role privilege_definer nologin; grant authenticated to privilege_definer;
    grant update on public.accounts to privilege_definer;
    grant insert on public.transaction_receipts to privilege_definer;
    grant insert on public.transactions to public;
    alter function public.save_transaction_once(uuid,text,numeric,date,text,text,text) owner to privilege_definer`);
  const beforeOwnerFailure = (await acls()).rows;
  await assert.rejects(exec(migration), {code:'P0001'});
  await exec('rollback');
  assert.deepEqual((await acls()).rows, beforeOwnerFailure);
  await exec(`alter function public.save_transaction_once(uuid,text,numeric,date,text,text,text) owner to current_user;
    revoke insert on public.transactions from public;
    revoke all on public.accounts,public.transaction_receipts from privilege_definer;
    revoke authenticated from privilege_definer; drop role privilege_definer`);
  await exec(`grant insert,update,delete,truncate,references,trigger on public.accounts,public.transactions to public;
    grant update (opening_balance),insert (name) on public.accounts to anon,authenticated;
    grant insert (description),update (amount),references (id) on public.transactions to public,anon,authenticated`);
  await exec(migration);
  assert.deepEqual(await rows(), beforeRows);
  assert.deepEqual((await metadata()).rows, beforeMetadata);
  const forbidden = await query(`select r.rolname,c.relname,p.privilege from pg_roles r
    cross join pg_class c
    cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
    where c.oid in ('public.accounts'::regclass,'public.transactions'::regclass)
      and r.rolname in ('anon','authenticated') and
      (has_table_privilege(r.oid,c.oid,p.privilege) or case when p.privilege in ('INSERT','UPDATE','REFERENCES')
        then has_any_column_privilege(r.oid,c.oid,p.privilege) else false end)`);
  assert.deepEqual(forbidden.rows, []);
  await exec(migration);
  assert.deepEqual(await rows(), beforeRows);
  console.log('Privilegi SQL: grant PUBLIC/colonna rimossi, ereditarietà indiretta e proprietario RPC incompatibile rifiutati atomicamente, dati e protezioni invariati, riapplicazione verificata.');
}
