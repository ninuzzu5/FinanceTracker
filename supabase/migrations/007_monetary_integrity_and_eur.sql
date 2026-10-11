-- B2/B3: additive guardrails. No updates, rounding, deletion or backfill of historical rows.
-- Run the read-only preflight in supabase/preflight/007_monetary_integrity_and_eur.sql first.
begin;
do $$ begin
  if to_regprocedure('public.save_transaction_once(uuid,text,numeric,date,text,text,text)') is null then
    raise exception 'Migration 006 is required';
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid='public.accounts'::regclass and relrowsecurity)
    or not exists (select 1 from pg_catalog.pg_class where oid='public.transactions'::regclass and relrowsecurity) then
    raise exception 'Accounts and transactions must have RLS enabled';
  end if;
  -- EUR is a product-wide invariant, not an implicit conversion. Fail atomically on old foreign accounts.
  if exists (select 1 from public.accounts where currency is distinct from 'EUR') then
    raise exception 'Non-EUR accounts exist: review the read-only preflight; no data has been converted'
      using errcode='PT422';
  end if;
end $$;
-- Unconstrained numeric is deliberate: numeric(precision,2) would round before checking.
-- NOT VALID preserves legacy rows, while enforcing ALL new inserts and updates immediately.
alter table public.transactions
  add constraint transactions_money_integrity_check check (
    amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    and amount > 0 and amount = round(amount,2)
  ) not valid,
  add constraint transactions_finite_date_check check (isfinite(transaction_date)) not valid;
-- Validated global invariant prevents cross-currency transfers and currency changes,
-- even concurrent/direct writes, without races or additional locking triggers.
alter table public.accounts add constraint accounts_eur_currency_check check (currency = 'EUR');

create or replace function public.save_transaction_once(
  p_request_id uuid, p_type text, p_amount numeric, p_date date,
  p_category text, p_from_account text, p_to_account text
) returns table(transaction_id uuid)
language plpgsql volatile security definer set search_path='' as $$
declare caller uuid := auth.uid(); canonical jsonb; receipt public.transaction_receipts;
  source_id uuid; destination_id uuid; inserted_id uuid;
  source_name text := lower(btrim(p_from_account)); destination_name text := lower(btrim(p_to_account));
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Idempotent writes require READ COMMITTED' using errcode='22023';
  end if;
  -- Domain validation remains a first line of defense; table constraints also guard direct writes.
  if p_request_id is null or p_type is null or p_type not in ('expense','income','transfer')
    or p_amount is null or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or p_amount <= 0 or p_amount <> round(p_amount,2) or p_date is null or not isfinite(p_date) then
    raise exception 'Invalid transaction input' using errcode='22023';
  end if;
  canonical := jsonb_build_object('type',p_type,'amount',p_amount,'date',p_date,'category',p_category,
    'from_account',source_name,'to_account',destination_name);
  -- Acquire a transaction-scoped key lock BEFORE checking the receipt or inserting a transaction.
  -- Hash collisions only serialize unrelated requests; uniqueness uses the complete UUID + owner.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text || ':' || p_request_id::text, 0));
  select * into receipt from public.transaction_receipts r where r.user_id=caller and r.request_id=p_request_id;
  if found then
    if receipt.payload is distinct from canonical then
      raise exception 'Operation already saved with a different payload' using errcode='PT409';
    end if;
    -- Return BEFORE account resolution / cash closure checks, including inactive or renamed accounts.
    return query select receipt.transaction_id;
    return;
  end if;
  if (p_type='expense' and (source_name is null or destination_name is not null))
    or (p_type='income' and (destination_name is null or source_name is not null))
    or (p_type='transfer' and (source_name is null or destination_name is null or source_name=destination_name)) then
    raise exception 'Invalid transaction direction' using errcode='22023';
  end if;
  if source_name is not null then
    if source_name not in ('revolut','isybank','contanti') or
      (select count(*) from public.accounts a where a.user_id=caller and a.is_active and lower(btrim(a.name))=source_name) <> 1 then
      raise exception 'Source account unavailable' using errcode='PT404';
    end if;
    if exists (select 1 from public.accounts a where a.user_id=caller and a.is_active
      and lower(btrim(a.name))=source_name and a.currency <> 'EUR') then
      raise exception 'FinanceTracker supports only EUR accounts' using errcode='PT422';
    end if;
    select a.id into source_id from public.accounts a where a.user_id=caller and a.is_active and lower(btrim(a.name))=source_name;
  end if;
  if destination_name is not null then
    if destination_name not in ('revolut','isybank','contanti') or
      (select count(*) from public.accounts a where a.user_id=caller and a.is_active and lower(btrim(a.name))=destination_name) <> 1 then
      raise exception 'Destination account unavailable' using errcode='PT404';
    end if;
    if exists (select 1 from public.accounts a where a.user_id=caller and a.is_active
      and lower(btrim(a.name))=destination_name and a.currency <> 'EUR') then
      raise exception 'FinanceTracker supports only EUR accounts' using errcode='PT422';
    end if;
    select a.id into destination_id from public.accounts a where a.user_id=caller and a.is_active and lower(btrim(a.name))=destination_name;
  end if;
  -- Existing direction/category/FK constraints and cash closure triggers stay active.
  insert into public.transactions(user_id,type,amount,transaction_date,category,from_account_id,to_account_id)
    values(caller,p_type,p_amount,p_date,p_category,source_id,destination_id) returning id into inserted_id;
  insert into public.transaction_receipts(user_id,request_id,transaction_id,payload)
    values(caller,p_request_id,inserted_id,canonical);
  return query select inserted_id;
end $$;
-- CREATE OR REPLACE preserves existing privileges. Restate the intended access explicitly.
revoke all on function public.save_transaction_once(uuid,text,numeric,date,text,text,text) from public, anon;
grant execute on function public.save_transaction_once(uuid,text,numeric,date,text,text,text) to authenticated;
commit;
