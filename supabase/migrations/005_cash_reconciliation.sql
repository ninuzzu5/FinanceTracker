-- Milestone 2. Apply only after 004, manually; no seeds or changes to historical rows.
begin;
do $preflight$
declare balance_rpc regprocedure := to_regprocedure('public.get_account_balances(date)');
begin
  if balance_rpc is null then raise exception 'Migration 004 is required'; end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.accounts'::regclass and relrowsecurity)
    or not exists (select 1 from pg_catalog.pg_class where oid = 'public.transactions'::regclass and relrowsecurity) then
    raise exception 'Accounts and transactions must have RLS enabled';
  end if;
  if pg_get_function_result(balance_rpc) <> 'TABLE(account_id uuid, account_name text, currency text, is_active boolean, opening_date date, opening_balance numeric, as_of_date date, status text, balance numeric)'
    or exists (select 1 from pg_catalog.pg_proc where oid = balance_rpc and (prosecdef or provolatile <> 's')) then
    raise exception 'Balance RPC differs from migration 004; inspect schema before proceeding';
  end if;
  if (select count(*) from pg_catalog.pg_constraint where conrelid = 'public.accounts'::regclass
    and conname in ('accounts_opening_pair_check','accounts_opening_money_check','accounts_opening_date_check','accounts_cash_opening_check')) <> 4 then
    raise exception 'Opening constraints from migration 004 are required';
  end if;
end;
$preflight$;
create table public.account_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  account_id uuid not null,
  effective_date date not null check (isfinite(effective_date)),
  delta numeric not null check (delta not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and delta = round(delta, 2)),
  observed_balance numeric not null check (observed_balance not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and observed_balance >= 0 and observed_balance = round(observed_balance, 2)),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz null,
  foreign key (user_id, account_id) references public.accounts(user_id, id),
  unique (user_id, request_id),
  check (voided_at is null or voided_at >= created_at)
);
create unique index account_adjustments_active_day on public.account_adjustments(user_id, account_id, effective_date) where voided_at is null;
alter table public.account_adjustments enable row level security;
revoke all on public.account_adjustments from public, anon, authenticated;
grant select on public.account_adjustments to authenticated;
create policy adjustments_select_own on public.account_adjustments for select to authenticated using (user_id = auth.uid());
-- Inserts are reserved to the narrowly scoped RPC; reopening/voiding is deliberately unavailable.
create or replace function public.get_account_balances(p_as_of date)
returns table (
  account_id uuid,
  account_name text,
  currency text,
  is_active boolean,
  opening_date date,
  opening_balance numeric,
  as_of_date date,
  status text,
  balance numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_as_of is null or not pg_catalog.isfinite(p_as_of) then
    raise exception 'A finite balance date is required' using errcode = '22023';
  end if;

  -- Existing rows are never silently repaired or rounded. Only relevant movements matter.
  if exists (
    select 1
    from public.accounts a
    join public.transactions t on t.user_id = a.user_id
      and (t.from_account_id = a.id or t.to_account_id = a.id)
    where a.user_id = caller_id and a.opening_date is not null
      and t.transaction_date between a.opening_date and p_as_of
      and (t.amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        or t.amount <= 0 or t.amount <> pg_catalog.round(t.amount, 2))
  ) then
    raise exception 'Included transactions must have finite positive amounts with at most two decimals'
      using errcode = '22003';
  end if;

  -- No implicit FX conversion: internal transfers must have matching account currencies.
  if exists (
    select 1
    from public.transactions t
    join public.accounts source on source.id = t.from_account_id and source.user_id = t.user_id
    join public.accounts destination on destination.id = t.to_account_id and destination.user_id = t.user_id
    where t.user_id = caller_id and t.type = 'transfer'
      and source.currency <> destination.currency
      and ((source.opening_date is not null and t.transaction_date between source.opening_date and p_as_of)
        or (destination.opening_date is not null and t.transaction_date between destination.opening_date and p_as_of))
  ) then
    raise exception 'Cross-currency transfers require an explicit conversion model'
      using errcode = '22023';
  end if;

  return query
  select a.id, a.name, a.currency, a.is_active, a.opening_date, a.opening_balance, p_as_of,
    case when a.opening_date is null then 'not_configured'
      when p_as_of < a.opening_date then 'before_opening'
      else 'configured' end,
    case when a.opening_date is null or p_as_of < a.opening_date then null::numeric
      else pg_catalog.round(a.opening_balance + coalesce(movement.total, 0::numeric) + coalesce(adjustment.total, 0::numeric), 2) end
  from public.accounts a
  left join lateral (
    select sum(
      case when t.type in ('income', 'transfer') and t.to_account_id = a.id then t.amount else 0::numeric end
      - case when t.type in ('expense', 'transfer') and t.from_account_id = a.id then t.amount else 0::numeric end
    ) as total
    from public.transactions t
    where t.user_id = caller_id
      and (t.from_account_id = a.id or t.to_account_id = a.id)
      and t.transaction_date between a.opening_date and p_as_of
  ) movement on true
  left join lateral (
    select sum(j.delta) as total from public.account_adjustments j
    where j.user_id = caller_id and j.account_id = a.id and j.voided_at is null
      and j.effective_date between a.opening_date and p_as_of
  ) adjustment on true
  where a.user_id = caller_id
  order by a.name, a.id;
end;
$function$;


-- Same lock as reconciliation, for every old/new cash leg, including transfers.
create function public.guard_reconciled_cash_transactions() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare old_row public.transactions; new_row public.transactions; cash_id uuid; closed date;
begin
  if TG_OP <> 'INSERT' then old_row := OLD; end if;
  if TG_OP <> 'DELETE' then new_row := NEW; end if;
  for cash_id in select a.id from public.accounts a
    where (lower(btrim(a.name)) = 'contanti' or lower(btrim(a.type)) = 'cash')
      and (a.id in (old_row.from_account_id, old_row.to_account_id, new_row.from_account_id, new_row.to_account_id))
    order by a.id for update
  loop
    -- Higher isolation levels require a versioned ledger; fail safely instead of reading stale closures.
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'Cash writes require READ COMMITTED isolation' using errcode = '22023';
    end if;
    select max(j.effective_date) into closed from public.account_adjustments j where j.account_id = cash_id and j.voided_at is null;
    if closed is not null and (
      (cash_id in (old_row.from_account_id, old_row.to_account_id) and old_row.transaction_date <= closed)
      or (cash_id in (new_row.from_account_id, new_row.to_account_id) and new_row.transaction_date <= closed)
    ) then
      raise exception 'Cash day is reconciled; reopening is not available' using errcode = 'PT423';
    end if;
  end loop;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger protect_reconciled_cash_transactions before insert or update or delete on public.transactions
for each row execute function public.guard_reconciled_cash_transactions();

create function public.guard_reconciled_cash_accounts() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (lower(btrim(OLD.name)) = 'contanti' or lower(btrim(OLD.type)) = 'cash')
    and current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Cash writes require READ COMMITTED isolation' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_adjustments j where j.account_id = OLD.id and j.voided_at is null)
    and (TG_OP = 'DELETE' or (NEW.user_id, NEW.name, NEW.type, NEW.currency, NEW.opening_balance, NEW.opening_date)
      is distinct from (OLD.user_id, OLD.name, OLD.type, OLD.currency, OLD.opening_balance, OLD.opening_date)) then
    raise exception 'Cash opening/account is reconciled; reopening is not available' using errcode = 'PT423';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger protect_reconciled_cash_accounts before update or delete on public.accounts
for each row execute function public.guard_reconciled_cash_accounts();

create function public.guard_adjustment_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Adjustment changes require reopening, which is not available' using errcode = 'PT423';
end $$;
create trigger protect_adjustments before update or delete on public.account_adjustments
for each row execute function public.guard_adjustment_changes();

create function public.preview_cash_reconciliation(p_date date)
returns table(account_id uuid, theoretical_balance text)
language plpgsql stable security invoker set search_path = '' as $$
declare cash_id uuid; opening date; actual numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_date is null or not isfinite(p_date) or p_date > (now() at time zone 'Europe/Rome')::date then
    raise exception 'Invalid reconciliation day' using errcode = '22023';
  end if;
  if (select count(*) from public.accounts a where a.user_id = auth.uid() and a.is_active and lower(btrim(a.name)) = 'contanti') <> 1 then
    raise exception 'Exactly one active Contanti account is required' using errcode = 'PT404';
  end if;
  select a.id, a.opening_date into cash_id, opening from public.accounts a
    where a.user_id = auth.uid() and a.is_active and lower(btrim(a.name)) = 'contanti' and a.currency = 'EUR';
  if cash_id is null then raise exception 'Contanti must use EUR' using errcode = '22023'; end if;
  if opening is null or p_date < opening then raise exception 'Cash opening is not configured for this day' using errcode = 'PT412'; end if;
  if exists (select 1 from public.account_adjustments j where j.account_id = cash_id and j.user_id = auth.uid() and j.voided_at is null and j.effective_date >= p_date) then
    raise exception 'Cash day is reconciled; reopening is not available' using errcode = 'PT423';
  end if;
  select b.balance into actual from public.get_account_balances(p_date) b where b.account_id = cash_id;
  return query select cash_id, round(actual, 2)::text;
end $$;

create function public.reconcile_cash(p_account_id uuid, p_date date, p_observed numeric, p_expected numeric, p_request_id uuid)
returns table(adjustment_id uuid, delta text, observed_balance text)
language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); a public.accounts; receipt public.account_adjustments; actual numeric;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null or p_account_id is null or p_observed is null or p_expected is null
    or p_observed in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or p_expected in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or p_observed < 0 or p_observed <> round(p_observed,2) or p_expected <> round(p_expected,2)
    or p_date is null or not isfinite(p_date) then
    raise exception 'Invalid reconciliation values' using errcode = '22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Reconciliation requires READ COMMITTED isolation' using errcode = '22023';
  end if;
  select * into a from public.accounts where id = p_account_id and user_id = caller for update;
  if not found then raise exception 'Account unavailable' using errcode = '42501'; end if;
  select * into receipt from public.account_adjustments j where j.user_id = caller and j.request_id = p_request_id;
  if found then
    if receipt.account_id <> p_account_id or receipt.effective_date <> p_date or receipt.observed_balance <> p_observed
      or receipt.observed_balance - receipt.delta <> p_expected or receipt.voided_at is not null then
      raise exception 'Idempotency key payload mismatch' using errcode = 'PT409';
    end if;
    return query select receipt.id, round(receipt.delta,2)::text, round(receipt.observed_balance,2)::text;
    return;
  end if;
  if not a.is_active or lower(btrim(a.name)) <> 'contanti' or a.currency <> 'EUR' then
    raise exception 'Active EUR Contanti account required' using errcode = 'PT404';
  end if;
  if a.opening_date is null or a.opening_balance is null or p_date < a.opening_date then
    raise exception 'Cash opening is not configured for this day' using errcode = 'PT412';
  end if;
  if p_date > (now() at time zone 'Europe/Rome')::date then raise exception 'Future reconciliation day' using errcode = '22023'; end if;
  if exists (select 1 from public.account_adjustments j where j.account_id = a.id and j.user_id = caller and j.voided_at is null and j.effective_date >= p_date) then
    raise exception 'Cash day is reconciled; reopening is not available' using errcode = 'PT423';
  end if;
  select b.balance into actual from public.get_account_balances(p_date) b where b.account_id = a.id;
  if actual is distinct from p_expected then
    raise exception 'Balance changed since preview; request a new preview' using errcode = 'PT409';
  end if;
  insert into public.account_adjustments(user_id, account_id, effective_date, delta, observed_balance, request_id)
    values(caller, a.id, p_date, p_observed - actual, p_observed, p_request_id) returning * into receipt;
  return query select receipt.id, round(receipt.delta,2)::text, round(receipt.observed_balance,2)::text;
end $$;

revoke all on function public.get_account_balances(date) from public, anon;
grant execute on function public.get_account_balances(date) to authenticated;
revoke all on function public.preview_cash_reconciliation(date) from public, anon;
revoke all on function public.reconcile_cash(uuid,date,numeric,numeric,uuid) from public, anon;
grant execute on function public.preview_cash_reconciliation(date) to authenticated;
grant execute on function public.reconcile_cash(uuid,date,numeric,numeric,uuid) to authenticated;
revoke all on function public.guard_reconciled_cash_transactions() from public, anon, authenticated;
revoke all on function public.guard_reconciled_cash_accounts() from public, anon, authenticated;
revoke all on function public.guard_adjustment_changes() from public, anon, authenticated;
commit;
