-- Audit characterization: confirms gaps without changing application constraints.
-- Synthetic data only. Passing gap assertions are NOT acceptance of unsafe writes.
begin;
do $$ begin
 if current_setting('financetracker.test_database',true) is distinct from 'isolated' then raise exception 'Isolated database required'; end if;
end $$;
create function pg_temp.audit_check(value boolean) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Audit assertion failed'; end if; end $$;
create function pg_temp.audit_error(statement text, code text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then if sqlstate <> code then raise; end if; return; end;
 raise exception 'Expected SQLSTATE % for %',code,statement;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000011'),('00000000-0000-4000-8000-000000000012');
insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
 ('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','Revolut','bank',100,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011','Contanti','cash',100,'2026-01-01'),
 ('20000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','Contanti','cash',100,'2026-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
-- BUG: new invalid monetary writes are allowed; balance reads detect damage only afterwards.
insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
 values(auth.uid(),'income',0.001,'2026-01-01','salary','10000000-0000-4000-8000-000000000011');
select pg_temp.audit_check((select count(*)=1 from public.transactions where amount=0.001));
select pg_temp.audit_error($q$select * from public.get_account_balances('2026-01-01')$q$,'22003');
select pg_temp.audit_error($q$select * from public.preview_cash_reconciliation('2026-01-01')$q$,'22003');
delete from public.transactions where amount=0.001;
insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
 values(auth.uid(),'income','NaN','2026-01-01','salary','10000000-0000-4000-8000-000000000011');
select pg_temp.audit_check((select count(*)=1 from public.transactions where amount='NaN'::numeric));
select pg_temp.audit_error($q$select * from public.get_account_balances('2026-01-01')$q$,'22003');
delete from public.transactions where amount='NaN'::numeric;
insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
 values(auth.uid(),'income','Infinity','2026-01-01','salary','10000000-0000-4000-8000-000000000011');
select pg_temp.audit_error($q$select * from public.get_account_balances('2026-01-01')$q$,'22003');
delete from public.transactions where amount='Infinity'::numeric;
select pg_temp.audit_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'income',0,'2026-01-01','salary','10000000-0000-4000-8000-000000000011')$q$,'23514');
select pg_temp.audit_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'income',-1,'2026-01-01','salary','10000000-0000-4000-8000-000000000011')$q$,'23514');
-- BUG: infinite dates are admitted and the recorded movement is excluded from finite balances.
insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
 values(auth.uid(),'income',50,'infinity','salary','10000000-0000-4000-8000-000000000011');
select pg_temp.audit_check((select count(*)=1 from public.transactions where not isfinite(transaction_date)));
select pg_temp.audit_check((select balance=100 from public.get_account_balances('2026-01-01') where account_name='Revolut'));
delete from public.transactions where not isfinite(transaction_date);
-- BUG: direct FX transfers pass constraints, then block the owner's entire balance RPC.
update public.accounts set currency='USD' where name='Revolut';
insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id)
 values(auth.uid(),'transfer',1,'2026-01-01','10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000012');
select pg_temp.audit_check((select count(*)=1 from public.transactions where type='transfer'));
select pg_temp.audit_error($q$select * from public.get_account_balances('2026-01-01')$q$,'22023');
delete from public.transactions; update public.accounts set currency='EUR' where name='Revolut';
-- Direct legacy INSERTs remain unkeyed: B1 protects the bot RPC, not arbitrary direct writes.
insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id)
 values(auth.uid(),'expense',0.01,'2026-01-01','food','10000000-0000-4000-8000-000000000011'),
 (auth.uid(),'expense',0.01,'2026-01-01','food','10000000-0000-4000-8000-000000000011');
select pg_temp.audit_check((select count(*)=2 and count(distinct id)=2 from public.transactions));
select pg_temp.audit_check((select balance=99.98 from public.get_account_balances('2026-01-01') where account_name='Revolut'));
-- Attempts to evade owner and direction constraints remain blocked.
select pg_temp.audit_check((select count(*)=2 from public.accounts));
select pg_temp.audit_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id) values(auth.uid(),'expense',1,'2026-01-01','food','20000000-0000-4000-8000-000000000011')$q$,'23503');
select pg_temp.audit_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id) values('00000000-0000-4000-8000-000000000012','expense',1,'2026-01-01','food','20000000-0000-4000-8000-000000000011')$q$,'42501');
select pg_temp.audit_error($q$insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id) values(auth.uid(),'transfer',1,'2026-01-01','10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012')$q$,'23514');
select pg_temp.audit_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'expense',1,'2026-01-01','food','10000000-0000-4000-8000-000000000012')$q$,'23514');
select pg_temp.audit_error($q$truncate public.transactions$q$,'42501');
-- Idempotent cash receipt remains valid after deactivation; altered request payload is rejected.
select * from public.reconcile_cash('10000000-0000-4000-8000-000000000012','2026-01-01',100,100,'40000000-0000-4000-8000-000000000011');
update public.accounts set is_active=false where name='Contanti';
select pg_temp.audit_check((select delta::numeric=0 from public.reconcile_cash('10000000-0000-4000-8000-000000000012','2026-01-01',100,100,'40000000-0000-4000-8000-000000000011')));
select pg_temp.audit_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000012','2026-01-01',100,99,'40000000-0000-4000-8000-000000000011')$q$,'PT409');
select pg_temp.audit_error($q$select * from public.reconcile_cash('10000000-0000-4000-8000-000000000012','2026-01-02',100,100,'40000000-0000-4000-8000-000000000011')$q$,'PT409');
rollback;
