-- Isolated, synthetic fixtures only. Constraints, RLS and cash triggers remain enabled.
begin;
do $$ begin
 if current_setting('financetracker.test_database',true) is distinct from 'isolated' then raise exception 'Isolated database required'; end if;
end $$;
create function pg_temp.integrity_check(value boolean) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Integrity assertion failed'; end if; end $$;
create function pg_temp.integrity_error(statement text, code text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then if sqlstate <> code then raise; end if; return; end;
 raise exception 'Expected SQLSTATE % for %',code,statement;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000071'),('00000000-0000-4000-8000-000000000072');
insert into public.accounts(id,user_id,name,type,opening_balance,opening_date) values
 ('10000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071','Revolut','bank',100,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000071','Isybank','bank',100,'2026-01-01'),
 ('10000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000071','Contanti','cash',100,'2026-01-01'),
 ('20000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000072','Revolut','bank',100,'2026-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',true);
insert into public.transactions(id,user_id,type,amount,transaction_date,category,to_account_id)
 values('30000000-0000-4000-8000-000000000071',auth.uid(),'income',0.290,'2026-07-10','salary','10000000-0000-4000-8000-000000000071');
-- INSERT and UPDATE rejected; no implicit rounding, including both infinities and NaN.
do $$ declare value text; day text; begin
 foreach value in array array['0.001','1.009','NaN','Infinity','-Infinity','0','-0.01'] loop
  perform pg_temp.integrity_error(format($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'income',%L::numeric,'2026-07-10','salary','10000000-0000-4000-8000-000000000071')$q$,value),'23514');
  perform pg_temp.integrity_error(format($q$update public.transactions set amount=%L::numeric where id='30000000-0000-4000-8000-000000000071'$q$,value),'23514');
  perform pg_temp.integrity_error(format($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000071','income',%L::numeric,'2026-07-10','salary',null,'revolut')$q$,value),'22023');
 end loop;
 foreach day in array array['infinity','-infinity'] loop
  perform pg_temp.integrity_error(format($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'income',1,%L::date,'salary','10000000-0000-4000-8000-000000000071')$q$,day),'23514');
  perform pg_temp.integrity_error(format($q$update public.transactions set transaction_date=%L::date where id='30000000-0000-4000-8000-000000000071'$q$,day),'23514');
  perform pg_temp.integrity_error(format($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000071','income',1,%L::date,'salary',null,'revolut')$q$,day),'22023');
  perform pg_temp.integrity_error(format($q$select * from public.get_account_balances(%L::date)$q$,day),'22023');
 end loop;
end $$;
select pg_temp.integrity_check((select count(*)=1 and min(amount)=0.29 from public.transactions));
select pg_temp.integrity_check((select count(*)=0 from public.transaction_receipts));
-- Product-wide EUR excludes foreign accounts at the source of cross-currency transfers.
-- This holds for inserts, inactive accounts, and edits with/without existing transfers.
select pg_temp.integrity_error($q$insert into public.accounts(user_id,name,type,currency) values(auth.uid(),'USD source','bank','USD')$q$,'23514');
select pg_temp.integrity_error($q$insert into public.accounts(user_id,name,type,currency,is_active) values(auth.uid(),'USD inactive','bank','USD',false)$q$,'23514');
select pg_temp.integrity_error($q$update public.accounts set currency='USD' where name='Revolut'$q$,'23514');
select pg_temp.integrity_error($q$update public.accounts set currency='eur' where name='Isybank'$q$,'23514');
insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id)
 values(auth.uid(),'transfer',0.01,'2026-07-10','10000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000072');
select pg_temp.integrity_error($q$update public.accounts set currency='USD' where name='Isybank'$q$,'23514');
select pg_temp.integrity_error($q$update public.transactions set amount=0.001 where type='transfer'$q$,'23514');
select pg_temp.integrity_error($q$update public.transactions set transaction_date='infinity' where type='transfer'$q$,'23514');

-- Atomic multi-statement FX attempt cannot alter either the account or transfer.
select pg_temp.integrity_error($q$update public.accounts set currency='USD' where name='Revolut'; insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id) values(auth.uid(),'transfer',1,'2026-07-10','10000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000072')$q$,'23514');
select pg_temp.integrity_check((select bool_and(currency='EUR') from public.accounts));
select pg_temp.integrity_check((select sum(balance)=300.29 from public.get_account_balances('2026-07-10')));
-- Accounting date is stored verbatim, not derived from UTC created_at.
select pg_temp.integrity_check((select transaction_date='2026-07-10' from public.transactions where id='30000000-0000-4000-8000-000000000071'));
select pg_temp.integrity_check(('2026-10-09 17:08:00+00'::timestamptz at time zone 'Europe/Rome')='2026-10-09 19:08:00'::timestamp);
select pg_temp.integrity_check(('2026-07-09 22:05:00+00'::timestamptz at time zone 'Europe/Rome')::date='2026-07-10');
select pg_temp.integrity_check((select data_type='timestamp with time zone' from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='created_at'));
-- RLS unchanged: owner-only reads/writes, foreign FK blocked, unauthenticated RPC rejected.
select pg_temp.integrity_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values('00000000-0000-4000-8000-000000000072','income',1,'2026-07-10','salary','20000000-0000-4000-8000-000000000071')$q$,'42501');
select pg_temp.integrity_error($q$insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id) values(auth.uid(),'income',1,'2026-07-10','salary','20000000-0000-4000-8000-000000000071')$q$,'23503');
select pg_temp.integrity_check((select count(*)=3 from public.accounts));
update public.accounts set currency='USD' where id='20000000-0000-4000-8000-000000000071';
select pg_temp.integrity_check((select count(*)=0 from public.accounts where id='20000000-0000-4000-8000-000000000071'));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000072',true);
select pg_temp.integrity_check((select count(*)=0 from public.transactions));
select pg_temp.integrity_check((select count(*)=1 from public.get_account_balances('2026-07-10')));
select set_config('request.jwt.claim.sub','',true);
select pg_temp.integrity_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000071','income',1,'2026-07-10','salary',null,'revolut')$q$,'42501');
reset role;
set local role anon;
select pg_temp.integrity_error($q$select * from public.save_transaction_once('40000000-0000-4000-8000-000000000071','income',1,'2026-07-10','salary',null,'revolut')$q$,'42501');
reset role;
-- Administrator/direct SQL is constrained too; no privileged bypass of B2/B3.
select pg_temp.integrity_error($q$update public.transactions set amount=0.001 where id='30000000-0000-4000-8000-000000000071'$q$,'23514');
select pg_temp.integrity_error($q$update public.accounts set currency='USD' where name='Revolut'$q$,'23514');
rollback;
