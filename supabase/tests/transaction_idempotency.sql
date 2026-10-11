-- Disposable database only, synthetic data, no disabling of RLS/constraints/triggers.
begin;
do $$ begin
 if current_setting('financetracker.test_database',true) is distinct from 'isolated' then raise exception 'Isolated database required'; end if;
end $$;
create function pg_temp.check_receipt(value boolean) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Receipt assertion failed'; end if; end $$;
create function pg_temp.receipt_error(statement text, code text) returns void language plpgsql as $$
begin begin execute statement;
 exception when others then if sqlstate<>code then raise; end if; return; end;
 raise exception 'Expected % for %',code,statement;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Revolut','bank',100,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Contanti','cash',100,'2026-01-01'),
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Revolut','bank',100,'2026-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.check_receipt((select count(*)=0 from public.get_transaction_receipt('40000000-0000-4000-8000-000000000001')));
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-01','food','revolut',null);
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.290,'2026-01-01','food',' Revolut ',null);
select pg_temp.check_receipt((select count(*)=1 from public.transaction_receipts));
select pg_temp.check_receipt((select count(*)=1 from public.transactions));
select pg_temp.check_receipt((select r.transaction_id=t.id from public.get_transaction_receipt('40000000-0000-4000-8000-000000000001') r cross join public.transactions t));
-- Every financial field is part of the immutable payload comparison.
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.30,'2026-01-01','food','revolut',null)$q$,'PT409');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-02','food','revolut',null)$q$,'PT409');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-01','tobacco','revolut',null)$q$,'PT409');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-01','food','contanti',null)$q$,'PT409');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','income',0.29,'2026-01-01','salary',null,'revolut')$q$,'PT409');
-- Two identical legitimate operations have different keys and are both saved.
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000002','expense',0.29,'2026-01-01','food','revolut',null);
select pg_temp.check_receipt((select count(*)=2 and count(distinct id)=2 from public.transactions));
select pg_temp.check_receipt((select balance=99.42 from public.get_account_balances('2026-01-01') where account_name='Revolut'));
-- RPC failure leaves neither a transaction nor a receipt; the key can be used for a corrected, never committed payload.
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000003','expense',1,'2026-01-01','salary','revolut',null)$q$,'23514');
select pg_temp.check_receipt((select count(*)=2 from public.transactions));
select pg_temp.check_receipt((select count(*)=0 from public.get_transaction_receipt('40000000-0000-4000-8000-000000000003')));
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000003','income',1,'2026-01-01','salary',null,'revolut');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000004','transfer',1,'2026-01-01',null,'contanti','contanti')$q$,'22023');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000004','transfer',1,'2026-01-01',null,'revolut','isybank')$q$,'PT404');
select pg_temp.check_receipt((select count(*)=0 from public.get_transaction_receipt('40000000-0000-4000-8000-000000000004')));
-- Recover a transfer after a cash closure, before re-resolving accounts / re-entering triggers.
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000004','transfer',1,'2026-01-01',null,'revolut','contanti');
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000005','transfer',0.01,'2026-01-01',null,'contanti','revolut');
select * from public.reconcile_cash('10000000-0000-4000-8000-000000000002','2026-01-01',100.99,100.99,'50000000-0000-4000-8000-000000000001');
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000004','transfer',1,'2026-01-01',null,'revolut','contanti');
select pg_temp.check_receipt((select count(*)=5 from public.transactions));
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000006','transfer',1,'2026-01-01',null,'revolut','contanti')$q$,'PT423');
select pg_temp.check_receipt((select count(*)=0 from public.get_transaction_receipt('40000000-0000-4000-8000-000000000006')));
update public.accounts set is_active=false where name='Revolut';
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-01','food','revolut',null);
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000006','expense',1,'2026-01-02','food','revolut',null)$q$,'PT404');
-- Clients cannot mutate or forge durable receipts, or delete their linked transactions.
select pg_temp.receipt_error($q$delete from public.transaction_receipts$q$,'42501');
select pg_temp.receipt_error($q$update public.transaction_receipts set payload='{}'$q$,'42501');
select pg_temp.receipt_error($q$insert into public.transaction_receipts(user_id,request_id,transaction_id,payload) select auth.uid(),'40000000-0000-4000-8000-000000000007',id,'{}' from public.transactions limit 1$q$,'42501');
select pg_temp.receipt_error($q$delete from public.transactions where type='expense'$q$,'23503');
-- Same key in a different owner namespace is a distinct authorized operation.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.check_receipt((select count(*)=0 from public.transaction_receipts));
select pg_temp.check_receipt((select count(*)=0 from public.get_transaction_receipt('40000000-0000-4000-8000-000000000001')));
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000004','transfer',1,'2026-01-02',null,'revolut','contanti')$q$,'PT404');
select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-01','food','revolut',null);
select pg_temp.check_receipt((select count(*)=1 from public.transaction_receipts));
select pg_temp.check_receipt((select count(*)=1 from public.transactions));
select set_config('request.jwt.claim.sub','',true);
select pg_temp.receipt_error($q$select * from public.get_transaction_receipt('40000000-0000-4000-8000-000000000001')$q$,'42501');
select pg_temp.receipt_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000001','expense',0.29,'2026-01-01','food','revolut',null)$q$,'42501');
reset role;
set local role anon;
select pg_temp.receipt_error($q$select * from public.get_transaction_receipt('40000000-0000-4000-8000-000000000001')$q$,'42501');
select pg_temp.receipt_error($q$select * from public.transaction_receipts$q$,'42501');
reset role;
select pg_temp.receipt_error($q$delete from public.transaction_receipts$q$,'PT409');
rollback;
