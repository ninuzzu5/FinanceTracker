-- READ ONLY. Execute privately in SQL Editor before 007. No messages or credentials queried.
begin read only;
select to_regprocedure('public.save_transaction_once(uuid,text,numeric,date,text,text,text)') as migration_006;
select c.relname, c.relrowsecurity, con.conname, con.convalidated,
       pg_get_constraintdef(con.oid) as definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
left join pg_constraint con on con.conrelid=c.oid
where n.nspname='public' and c.relname in ('accounts','transactions');
select tablename, policyname, roles, cmd, qual, with_check from pg_policies
where schemaname='public' and tablename in ('accounts','transactions');
select count(*) as incompatible_transactions from public.transactions
where amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
   or amount <= 0 or amount <> round(amount,2) or not isfinite(transaction_date);
select id, user_id,
       amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or amount <= 0 or amount <> round(amount,2) as invalid_amount,
       not isfinite(transaction_date) as invalid_date
from public.transactions
where amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
   or amount <= 0 or amount <> round(amount,2) or not isfinite(transaction_date);
select id, user_id, currency from public.accounts where currency is distinct from 'EUR';
select t.id, t.user_id, s.currency as source_currency, d.currency as destination_currency
from public.transactions t
join public.accounts s on s.id=t.from_account_id and s.user_id=t.user_id
join public.accounts d on d.id=t.to_account_id and d.user_id=t.user_id
where t.type='transfer' and s.currency is distinct from d.currency;
commit;
