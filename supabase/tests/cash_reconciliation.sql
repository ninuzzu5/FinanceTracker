-- Synthetic fixtures only: requires an isolated database; always rolls back.
begin;
do $$ begin
  if current_setting('financetracker.test_database', true) is distinct from 'isolated' then
    raise exception 'An isolated database is required';
  end if;
end $$;
create function pg_temp.check_true(value boolean) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Assertion failed'; end if; end $$;
create function pg_temp.expect_error(statement text, expected_code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlstate <> expected_code then raise; end if; return; end;
  raise exception 'Expected SQLSTATE % for %', expected_code, statement;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Contanti','cash',100,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Revolut','bank',100,'2026-01-01'),
 ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Contanti','cash',null,null);
insert into public.transactions(id,user_id,type,amount,transaction_date,category,from_account_id,to_account_id) values
 ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','expense',10.01,'2026-01-01','food','10000000-0000-4000-8000-000000000001',null),
 ('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','transfer',5.02,'2026-01-01',null,'10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.check_true((select theoretical_balance::numeric = 95.01 from public.preview_cash_reconciliation('2026-01-01')));
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',90,95,'40000000-0000-4000-8000-000000000001')$q$,'PT409');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',-1,95.01,'40000000-0000-4000-8000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',90.001,95.01,'40000000-0000-4000-8000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01','NaN',95.01,'40000000-0000-4000-8000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select * from public.preview_cash_reconciliation((now() at time zone 'Europe/Rome')::date + 1)$q$,'22023');
select pg_temp.expect_error($q$select * from public.preview_cash_reconciliation('2025-12-31')$q$,'PT412');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000002','2026-01-01',90,100,'40000000-0000-4000-8000-000000000001')$q$,'PT404');
select pg_temp.check_true((select delta::numeric = -5.01 from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',90,95.01,'40000000-0000-4000-8000-000000000001')));
select pg_temp.check_true((select delta::numeric = -5.01 from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',90,95.01,'40000000-0000-4000-8000-000000000001')));
select pg_temp.check_true((select count(*) = 1 from public.account_adjustments));
select pg_temp.check_true((select count(*) = 2 from public.transactions));
select pg_temp.check_true((select balance = 90 from public.get_account_balances('2026-01-01') where account_name = 'Contanti'));
select pg_temp.check_true((select status = 'before_opening' and balance is null from public.get_account_balances('2025-12-31') where account_name = 'Contanti'));
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',91,95.01,'40000000-0000-4000-8000-000000000001')$q$,'PT409');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-01',90,90,'40000000-0000-4000-8000-000000000002')$q$,'PT423');
select pg_temp.expect_error($q$select * from public.preview_cash_reconciliation('2026-01-01')$q$,'PT423');
select pg_temp.check_true((select delta::numeric = 2.02 from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-02',92.02,90,'40000000-0000-4000-8000-000000000002')));
select pg_temp.check_true((select delta::numeric = 0 from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-03',92.02,92.02,'40000000-0000-4000-8000-000000000003')));
select pg_temp.check_true((select balance = 92.02 from public.get_account_balances('2026-01-03') where account_name = 'Contanti'));
select pg_temp.check_true((select bool_and(voided_at is null) from public.account_adjustments));
-- Protect both old and new legs; deleting, moving dates or removing cash must not bypass closure.
select pg_temp.expect_error($q$update public.transactions set amount = 11 where id = '30000000-0000-4000-8000-000000000001'$q$,'PT423');
select pg_temp.expect_error($q$update public.transactions set transaction_date = '2026-01-04' where id = '30000000-0000-4000-8000-000000000001'$q$,'PT423');
select pg_temp.expect_error($q$update public.transactions set from_account_id = '10000000-0000-4000-8000-000000000002' where id = '30000000-0000-4000-8000-000000000001'$q$,'PT423');
select pg_temp.expect_error($q$delete from public.transactions where id = '30000000-0000-4000-8000-000000000002'$q$,'PT423');
select pg_temp.expect_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id) values(auth.uid(),'expense',1,'2026-01-03','food','10000000-0000-4000-8000-000000000001')$q$,'PT423');
select pg_temp.expect_error($q$insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id) values(auth.uid(),'transfer',1,'2026-01-02','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')$q$,'PT423');
select pg_temp.expect_error($q$insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id) values(auth.uid(),'transfer',1,'2026-01-02','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001')$q$,'PT423');
select pg_temp.expect_error($q$update public.accounts set opening_balance = 110 where name = 'Contanti'$q$,'PT423');
select pg_temp.expect_error($q$update public.accounts set name = 'Wallet', type = 'bank' where name = 'Contanti'$q$,'PT423');
select pg_temp.expect_error($q$delete from public.accounts where name = 'Contanti'$q$,'PT423');
select pg_temp.expect_error($q$update public.account_adjustments set voided_at = now()$q$,'42501');
select pg_temp.expect_error($q$delete from public.account_adjustments$q$,'42501');
select pg_temp.expect_error($q$insert into public.account_adjustments(user_id,account_id,effective_date,delta,observed_balance,request_id) values(auth.uid(),'10000000-0000-4000-8000-000000000001','2026-01-04',1,93.02,'40000000-0000-4000-8000-000000000004')$q$,'42501');
-- Subsequent cash days and bank-only historical operations remain possible.
insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id) values(auth.uid(),'expense',0.01,'2026-01-04','food','10000000-0000-4000-8000-000000000001');
insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'income',0.01,'2026-01-01','salary','10000000-0000-4000-8000-000000000002');
select pg_temp.check_true((select balance = 92.01 from public.get_account_balances('2026-01-04') where account_name = 'Contanti'));
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-04',92.02,92.02,'40000000-0000-4000-8000-000000000004')$q$,'PT409');
-- Authorization: a non-owner role, foreign account, no JWT, anonymous and direct writes.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.check_true((select count(*) = 0 from public.account_adjustments));
select pg_temp.expect_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id) values(auth.uid(),'expense',1,'2026-01-01','food','10000000-0000-4000-8000-000000000001')$q$,'23503');
select pg_temp.check_true((select count(*) = 1 from public.get_account_balances('2026-01-04')));
select pg_temp.expect_error($q$select * from public.preview_cash_reconciliation('2026-01-04')$q$,'PT412');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-04',92.01,92.01,'40000000-0000-4000-8000-000000000004')$q$,'42501');
update public.accounts set opening_balance = 0, opening_date = '2026-01-01' where id = '20000000-0000-4000-8000-000000000001';
insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id) values(auth.uid(),'expense',0.01,'2026-01-01','food','20000000-0000-4000-8000-000000000001');
select pg_temp.check_true((select theoretical_balance::numeric = -0.01 from public.preview_cash_reconciliation('2026-01-01')));
select pg_temp.check_true((select delta::numeric = 0.01 from public.reconcile_cash('20000000-0000-4000-8000-000000000001','2026-01-01',0,-0.01,'40000000-0000-4000-8000-000000000001')));
select pg_temp.check_true((select balance = 0 from public.get_account_balances('2026-01-01') where account_name = 'Contanti'));
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select * from public.preview_cash_reconciliation('2026-01-04')$q$,'42501');
select pg_temp.expect_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000001','2026-01-04',92.01,92.01,'40000000-0000-4000-8000-000000000004')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.account_adjustments$q$,'42501');
select pg_temp.expect_error($q$select * from public.preview_cash_reconciliation('2026-01-04')$q$,'42501');
reset role;
select pg_temp.expect_error($q$update public.account_adjustments set voided_at = now()$q$,'PT423');
select pg_temp.expect_error($q$delete from public.account_adjustments$q$,'PT423');
rollback;
