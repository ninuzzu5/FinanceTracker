-- Dati sintetici: questa prova è ammessa soltanto nei runner temporanei.
begin;
do $$ begin
  if current_setting('financetracker.test_database',true) is distinct from 'isolated' then
    raise exception 'Database temporaneo richiesto';
  end if;
end $$;
create function pg_temp.privilege_check(value boolean) returns void language plpgsql as $$ begin
  if value is distinct from true then raise exception 'Verifica privilegi fallita'; end if;
end $$;
create function pg_temp.privilege_error(statement text, expected text) returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then if sqlstate <> expected then raise; end if; return; end;
  raise exception 'Atteso SQLSTATE % per %', expected, statement;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000061'),('00000000-0000-4000-8000-000000000062');
insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
  ('10000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000061','Revolut','bank',100,'2026-01-01'),
  ('10000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000061','Contanti','cash',0,'2026-01-01'),
  ('10000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000062','Revolut','bank',100,'2026-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000061',true);
select pg_temp.privilege_check((select count(*)=2 from public.accounts));
select pg_temp.privilege_error($q$insert into public.accounts(user_id,name,type) values(auth.uid(),'Nuovo','bank')$q$,'42501');
select pg_temp.privilege_error('update public.accounts set opening_balance=999','42501');
select pg_temp.privilege_error($q$update public.accounts set opening_date='2025-01-01'$q$,'42501');
select pg_temp.privilege_error('delete from public.accounts','42501');
select pg_temp.privilege_error('truncate public.accounts cascade','42501');
select pg_temp.privilege_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id)
  values(auth.uid(),'expense',1,'2026-01-01','food','10000000-0000-4000-8000-000000000061')$q$,'42501');
select pg_temp.privilege_error('update public.transactions set amount=1','42501');
select pg_temp.privilege_error('delete from public.transactions','42501');
select pg_temp.privilege_error('truncate public.transactions cascade','42501');

-- Le tre RPC privilegiate devono funzionare realmente dopo le revoche, inclusi i lock Contanti.
create temp table secured_ids(id uuid);
insert into secured_ids select transaction_id from public.save_transaction_once(
  '40000000-0000-4000-8000-000000000061','expense',0.29,'2026-01-01','food','revolut',null);
select pg_temp.privilege_check((select transaction_id=(select id from secured_ids) from public.save_transaction_once(
  '40000000-0000-4000-8000-000000000061','expense',0.290,'2026-01-01','food','revolut',null)));
select pg_temp.privilege_error($q$select * from public.save_transaction_once(
  '40000000-0000-4000-8000-000000000061','expense',0.30,'2026-01-01','food','revolut',null)$q$,'PT409');
select * from public.save_transaction_once(gen_random_uuid(),'income',0.20,'2026-01-01','salary',null,'contanti');
select pg_temp.privilege_check((select theoretical_balance='0.20' from public.preview_cash_reconciliation('2026-01-01')));
select * from public.reconcile_cash('10000000-0000-4000-8000-000000000063','2026-01-01',0.19,0.20,'50000000-0000-4000-8000-000000000061');
select pg_temp.privilege_check((select delta='-0.01' from public.reconcile_cash(
  '10000000-0000-4000-8000-000000000063','2026-01-01',0.19,0.20,'50000000-0000-4000-8000-000000000061')));
select pg_temp.privilege_error($q$select * from public.save_transaction_once(gen_random_uuid(),'expense',0.01,'2026-01-01','food','contanti',null)$q$,'PT423');
select public.manage_transaction_once('60000000-0000-4000-8000-000000000061',(select id from secured_ids),1,'edit',0.31,'2026-01-02','food','10000000-0000-4000-8000-000000000061',null);
select pg_temp.privilege_check((select sum(balance)=99.88 from public.get_account_balances('2026-01-02')));
select public.manage_transaction_once('60000000-0000-4000-8000-000000000062',(select id from secured_ids),2,'void');
select pg_temp.privilege_check((select sum(balance)=100.19 from public.get_account_balances('2026-01-02')));
select pg_temp.privilege_check((select count(*)=2 from public.transaction_changes));
select pg_temp.privilege_check((select count(*)=2 from public.transaction_receipts));
select pg_temp.privilege_check((select count(*)=1 from public.account_adjustments));
select pg_temp.privilege_error('update public.transaction_changes set payload=payload','42501');
select pg_temp.privilege_error('delete from public.account_adjustments','42501');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',true);
select pg_temp.privilege_check((select count(*)=1 from public.accounts));
select pg_temp.privilege_check((select count(*)=0 from public.transactions));
select pg_temp.privilege_check((select count(*)=0 from public.transaction_receipts));
select pg_temp.privilege_check((select count(*)=0 from public.transaction_changes));
select pg_temp.privilege_check((select count(*)=0 from public.account_adjustments));
do $$ begin
  perform pg_temp.privilege_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,3,'void')$q$, (select id from secured_ids)), 'PT404');
end $$;
select pg_temp.privilege_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000063','2026-01-02',0,0,gen_random_uuid())$q$,'42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.privilege_error($q$select * from public.save_transaction_once(gen_random_uuid(),'income',1,'2026-01-02','salary',null,'revolut')$q$,'42501');
reset role;
set local role anon;
select pg_temp.privilege_error($q$insert into public.accounts(user_id,name,type) values('00000000-0000-4000-8000-000000000061','Nuovo','bank')$q$,'42501');
select pg_temp.privilege_error('update public.accounts set opening_balance=999','42501');
select pg_temp.privilege_error('delete from public.accounts','42501');
select pg_temp.privilege_error('insert into public.transactions default values','42501');
select pg_temp.privilege_error('update public.transactions set amount=1','42501');
select pg_temp.privilege_error('delete from public.transactions','42501');
select pg_temp.privilege_error('select * from public.accounts','42501');
select pg_temp.privilege_error('select * from public.transactions','42501');
select pg_temp.privilege_error($q$select * from public.save_transaction_once(gen_random_uuid(),'income',1,'2026-01-02','salary',null,'revolut')$q$,'42501');
select pg_temp.privilege_error($q$select public.manage_transaction_once(gen_random_uuid(),gen_random_uuid(),1,'void')$q$,'42501');
select pg_temp.privilege_error($q$select * from public.reconcile_cash(gen_random_uuid(),'2026-01-02',0,0,gen_random_uuid())$q$,'42501');
reset role;
rollback;
