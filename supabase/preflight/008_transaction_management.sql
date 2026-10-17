-- Read-only inspection. Run privately as administrator; do not auto-repair historical data.
begin read only;
select to_regprocedure('public.save_transaction_once(uuid,text,numeric,date,text,text,text)') as required_b1,
  to_regprocedure('public.reconcile_cash(uuid,date,numeric,numeric,uuid)') as required_cash,
  to_regclass('public.transaction_changes') as existing_008;
select relname,relrowsecurity from pg_class where oid in ('public.accounts'::regclass,'public.transactions'::regclass,'public.transaction_receipts'::regclass,'public.account_adjustments'::regclass);
select conname,convalidated,pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.accounts'::regclass,'public.transactions'::regclass);
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public';
select tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid='public.transactions'::regclass;
select column_name,data_type from information_schema.columns where table_schema='public' and table_name='transactions' and column_name in ('ledger_version','voided_at','voided_by');
select count(*) as incompatible_transactions from public.transactions
 where amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or amount<=0 or amount<>round(amount,2) or not isfinite(transaction_date);
select count(*) as non_eur_accounts from public.accounts where currency is distinct from 'EUR';
commit;
