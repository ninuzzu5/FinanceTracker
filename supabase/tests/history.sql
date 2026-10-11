-- Read-only pagination queries against isolated synthetic fixture data; no production schema changes.
begin;
do $$ begin
 if current_setting('financetracker.test_database',true) is distinct from 'isolated' then raise exception 'Isolated database required'; end if;
end $$;
create function pg_temp.history_check(value boolean) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'History assertion failed'; end if; end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000081'),('00000000-0000-4000-8000-000000000082');
insert into public.accounts(id,user_id,name,type) values
 ('10000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000081','Revolut','bank'),
 ('10000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081','Contanti','cash'),
 ('20000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000082','Revolut','bank');
insert into public.transactions(id,user_id,type,amount,transaction_date,category,from_account_id)
select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000081','expense',0.010,'2026-10-09','food','10000000-0000-4000-8000-000000000081'
from generate_series(1,7) i;
insert into public.transactions(user_id,type,amount,transaction_date,category,to_account_id)
 values('00000000-0000-4000-8000-000000000082','income',999,'2026-10-10','salary','20000000-0000-4000-8000-000000000081');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
-- Tied dates use UUID DESC. Six queried rows provide a lookahead without counting the full ledger.
select pg_temp.history_check((select array_agg(id::text) = array[
 '30000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000005',
 '30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002']
 from (select id from public.transactions where user_id=auth.uid() order by transaction_date desc,id desc limit 6) page));
select pg_temp.history_check((select count(*)=2 from public.transactions where user_id=auth.uid()
 and (transaction_date<'2026-10-09' or (transaction_date='2026-10-09' and id<'30000000-0000-4000-8000-000000000003'))));
-- A new more recent row does not shift the second page or duplicate the first page's entries.
insert into public.transactions(user_id,type,amount,transaction_date,from_account_id,to_account_id)
 values(auth.uid(),'transfer',0.01,'2026-10-10','10000000-0000-4000-8000-000000000081','10000000-0000-4000-8000-000000000082');
select pg_temp.history_check((select count(*)=2 from public.transactions where user_id=auth.uid()
 and (transaction_date<'2026-10-09' or (transaction_date='2026-10-09' and id<'30000000-0000-4000-8000-000000000003'))));
select pg_temp.history_check((select count(*)=1 from public.transactions t join public.accounts s on s.id=t.from_account_id
 join public.accounts d on d.id=t.to_account_id where t.type='transfer' and s.name='Revolut' and d.name='Contanti'));
select pg_temp.history_check((select count(*)=0 from public.transactions where user_id<>auth.uid()));
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
select pg_temp.history_check((select count(*)=1 from public.transactions));
reset role;
rollback;
