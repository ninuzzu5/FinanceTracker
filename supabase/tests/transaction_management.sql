-- Isolated synthetic fixture; no disabled RLS, constraints or triggers.
begin;
do $$ begin if current_setting('financetracker.test_database',true) is distinct from 'isolated' then raise exception 'Isolated database required'; end if; end $$;
create function pg_temp.management_check(value boolean) returns void language plpgsql as $$ begin
 if value is distinct from true then raise exception 'Management assertion failed'; end if; end $$;
create function pg_temp.management_error(statement text, code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate<>code then raise; end if; return; end;
 raise exception 'Expected SQLSTATE %',code; end $$;
insert into auth.users values('00000000-0000-4000-8000-000000000091'),('00000000-0000-4000-8000-000000000092');
insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
 ('10000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000091','Revolut','bank',100,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000091','Isybank','bank',-10,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000091','Contanti','cash',0,'2026-01-01'),
 ('20000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000092','Revolut','bank',0,'2026-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
create temp table managed_ids(kind text,id uuid);
insert into managed_ids select 'expense',transaction_id from public.save_transaction_once('40000000-0000-4000-8000-000000000091','expense',0.29,'2026-01-01','food','revolut',null);
insert into managed_ids select 'income',transaction_id from public.save_transaction_once('40000000-0000-4000-8000-000000000092','income',0.20,'2026-01-01','salary',null,'isybank');
insert into managed_ids select 'transfer',transaction_id from public.save_transaction_once('40000000-0000-4000-8000-000000000093','transfer',0.10,'2026-01-02',null,'revolut','isybank');
select pg_temp.management_check((select sum(balance)=89.91 from public.get_account_balances('2026-01-02')));
select pg_temp.management_check((public.get_transaction_for_management((select id from managed_ids where kind='expense'))->'movement'->>'amount')='0.29');
-- Atomic edit: amount/date/category/account; version and before/after audit are persisted.
select public.manage_transaction_once('50000000-0000-4000-8000-000000000091',(select id from managed_ids where kind='expense'),1,'edit',0.31,'2026-01-02','tobacco','10000000-0000-4000-8000-000000000092',null);
select pg_temp.management_check((select amount=0.31 and category='tobacco' and transaction_date='2026-01-02' and ledger_version=2 and from_account_id='10000000-0000-4000-8000-000000000092' from public.transactions where id=(select id from managed_ids where kind='expense')));
select pg_temp.management_check((select sum(balance)=89.89 from public.get_account_balances('2026-01-02')));
select pg_temp.management_check((select before_state->>'amount'='0.29' and after_state->>'amount'='0.31' and before_state->>'version'='1' and after_state->>'version'='2' from public.transaction_changes));
-- Same key returns the receipt even after the row has changed; different payload rejected.
select public.manage_transaction_once('50000000-0000-4000-8000-000000000091',(select id from managed_ids where kind='expense'),1,'edit',0.31,'2026-01-02','tobacco','10000000-0000-4000-8000-000000000092',null);
select pg_temp.management_check((select count(*)=1 from public.transaction_changes));
do $$ declare t uuid:=(select id from managed_ids where kind='expense'); bad text; begin
 perform pg_temp.management_error(format($q$select public.manage_transaction_once('50000000-0000-4000-8000-000000000091',%L,1,'edit',0.32,'2026-01-02','tobacco','10000000-0000-4000-8000-000000000092',null)$q$,t),'PT409');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,1,'void')$q$,t),'PT409');
 foreach bad in array array['0.001','NaN','Infinity','-Infinity','0','-1'] loop
  perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,2,'edit',%L::numeric,'2026-01-02','food','10000000-0000-4000-8000-000000000091',null)$q$,t,bad),'22023');
 end loop;
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,2,'edit',1,'infinity','food','10000000-0000-4000-8000-000000000091',null)$q$,t),'22023');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,2,'edit',1,'2026-01-02','salary','10000000-0000-4000-8000-000000000091',null)$q$,t),'23514');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,2,'edit',1,'2026-01-02','food','20000000-0000-4000-8000-000000000091',null)$q$,t),'PT404');
end $$;
select pg_temp.management_check((select count(*)=1 from public.transaction_changes));
-- Transfer reversed, exact cents, net worth invariant; identical legs rejected atomically.
select public.manage_transaction_once(gen_random_uuid(),(select id from managed_ids where kind='transfer'),1,'edit',0.21,'2026-01-03',null,'10000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000091');
select pg_temp.management_check((select sum(balance)=89.89 from public.get_account_balances('2026-01-03')));
do $$ begin perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,2,'edit',1,'2026-01-03',null,'10000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091')$q$,(select id from managed_ids where kind='transfer')),'22023'); end $$;
-- All three transaction types cancel logically and remain linked to original B1 receipts.
do $$ declare t record; begin
 for t in select m.id, x.ledger_version from managed_ids m join public.transactions x on x.id=m.id loop
  perform public.manage_transaction_once(gen_random_uuid(),t.id,t.ledger_version,'void');
  perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,%s,'void')$q$,t.id,t.ledger_version+1),'PT409');
  perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,%s,'edit',1,'2026-01-02','food','10000000-0000-4000-8000-000000000091',null)$q$,t.id,t.ledger_version+1),'PT409');
 end loop;
end $$;
select pg_temp.management_check((select sum(balance)=90 from public.get_account_balances('2026-01-03')));
select pg_temp.management_check((select count(*)=3 and bool_and(voided_by=auth.uid() and voided_at is not null) from public.transactions));
select pg_temp.management_check((select count(*)=3 from public.transaction_receipts));
select pg_temp.management_check((select count(*)=5 from public.transaction_changes));
select pg_temp.management_check((select transaction_id=(select id from managed_ids where kind='expense') from public.get_transaction_receipt('40000000-0000-4000-8000-000000000091')));
select pg_temp.management_check((select transaction_id=(select id from managed_ids where kind='expense') from public.save_transaction_once('40000000-0000-4000-8000-000000000091','expense',0.29,'2026-01-01','food','revolut',null)));
-- New cash operations, then a closure: old/new legs and cancellations still hit unchanged 005 triggers.
insert into managed_ids select 'cash',transaction_id from public.save_transaction_once(gen_random_uuid(),'income',1,'2026-01-02','salary',null,'contanti');
insert into managed_ids select 'bank',transaction_id from public.save_transaction_once(gen_random_uuid(),'expense',1,'2026-01-02','food','revolut',null);
insert into managed_ids select 'cash_transfer',transaction_id from public.save_transaction_once(gen_random_uuid(),'transfer',0.10,'2026-01-02',null,'revolut','contanti');
select * from public.reconcile_cash('10000000-0000-4000-8000-000000000093','2026-01-02',1.20,1.10,gen_random_uuid());
do $$ declare t uuid; begin
 t:=(select id from managed_ids where kind='cash');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,1,'void')$q$,t),'PT423');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,1,'edit',2,'2026-01-03','salary',null,'10000000-0000-4000-8000-000000000091')$q$,t),'PT423');
 t:=(select id from managed_ids where kind='bank');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,1,'edit',1,'2026-01-02','food','10000000-0000-4000-8000-000000000093',null)$q$,t),'PT423');
 t:=(select id from managed_ids where kind='cash_transfer');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,1,'edit',0.20,'2026-01-03',null,'10000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000091')$q$,t),'PT423');
end $$;
select pg_temp.management_check((select count(*)=5 from public.transaction_changes));
select pg_temp.management_check((select balance=1.20 from public.get_account_balances('2026-01-02') where account_name='Contanti'));
-- Balance read contract after 008: negative bank, inactive extra account, huge exact cents,
-- explicit NULL states; no application-side reconstruction of the ledger.
update public.accounts set is_active=false where name='Isybank';
select pg_temp.management_check((select balance=-10 and not is_active from public.get_account_balances('2026-01-03') where account_name='Isybank'));
insert into public.accounts(user_id,name,type,opening_balance,opening_date,is_active) values
 (auth.uid(),'Archivio','bank',9007199254740992.29,'2026-01-01',false),
 (auth.uid(),'Da configurare','bank',null,null,true);
select pg_temp.management_check((select balance=9007199254740992.29 and not is_active from public.get_account_balances('2026-01-03') where account_name='Archivio'));
select pg_temp.management_check((select balance is null and status='not_configured' from public.get_account_balances('2026-01-03') where account_name='Da configurare'));
select pg_temp.management_check((select balance is null and status='before_opening' from public.get_account_balances('2025-12-31') where account_name='Contanti'));
select pg_temp.management_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id,ledger_version) values(auth.uid(),'income',1,'2026-01-04','salary','10000000-0000-4000-8000-000000000091',2)$q$,'22023');
-- Privileges and RLS: no direct edits/deletes/audit writes, no foreign management/read/receipt.
select pg_temp.management_error('update public.transactions set amount=1','42501');
select pg_temp.management_error('delete from public.transactions','42501');
select pg_temp.management_error('delete from public.transaction_changes','42501');
select pg_temp.management_error('update public.transaction_receipts set payload=payload','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
select pg_temp.management_check((select count(*)=0 from public.transactions));
select pg_temp.management_check((select count(*)=0 from public.transaction_changes));
select pg_temp.management_check(public.get_transaction_change_receipt('50000000-0000-4000-8000-000000000091') is null);
do $$ declare t uuid:=(select id from managed_ids limit 1); begin
 perform pg_temp.management_error(format('select public.get_transaction_for_management(%L)',t),'PT404');
 perform pg_temp.management_error(format($q$select public.manage_transaction_once(gen_random_uuid(),%L,1,'void')$q$,t),'PT404');
end $$;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.management_error('select public.get_transaction_change_receipt(gen_random_uuid())','42501');
reset role;
set local role anon;
select pg_temp.management_error('select public.get_transaction_change_receipt(gen_random_uuid())','42501');
reset role;
-- Even direct administrator updates cannot silently bypass the append-only audit protocol.
select pg_temp.management_error('update public.transactions set amount=2 where voided_at is null','PT409');
select pg_temp.management_error('delete from public.transactions','PT409');
select pg_temp.management_error('update public.transaction_changes set payload=payload','PT409');
rollback;
