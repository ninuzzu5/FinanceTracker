-- Milestone 1. Incremental migration; does not initialize balances or change transactions.
-- Run the read-only preflight in supabase/README.md before applying manually.
begin;

do $preflight$
begin
  if not exists (select 1 from pg_catalog.pg_class
    where oid = 'public.accounts'::regclass and relrowsecurity)
    or not exists (select 1 from pg_catalog.pg_class
    where oid = 'public.transactions'::regclass and relrowsecurity) then
    raise exception 'Accounts and transactions must already have RLS enabled';
  end if;
end;
$preflight$;

-- Unconstrained numeric plus CHECK rejects excess precision instead of rounding input.
alter table public.accounts
  add column opening_balance numeric,
  add column opening_date date,
  add constraint accounts_opening_pair_check
    check ((opening_balance is null) = (opening_date is null)),
  add constraint accounts_opening_money_check
    check (opening_balance is null or (
      opening_balance not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      and opening_balance = round(opening_balance, 2)
    )),
  add constraint accounts_opening_date_check
    check (opening_date is null or isfinite(opening_date)),
  add constraint accounts_cash_opening_check
    check (opening_balance is null or opening_balance >= 0 or (
      lower(btrim(name)) <> 'contanti' and lower(btrim(type)) <> 'cash'
    ));

-- Invoker privileges preserve table RLS; explicit owner filters also protect privileged calls.
-- Required date parameter avoids implicit server timezone defaults.
create function public.get_account_balances(p_as_of date)
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
      else pg_catalog.round(a.opening_balance + coalesce(movement.total, 0::numeric), 2) end
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
  where a.user_id = caller_id
  order by a.name, a.id;
end;
$function$;

revoke all on function public.get_account_balances(date) from public, anon;
grant execute on function public.get_account_balances(date) to authenticated;

comment on column public.accounts.opening_balance is 'Balance at the start of opening_date; NULL means not configured.';
comment on column public.accounts.opening_date is 'Inclusive first transaction date; paired with opening_balance.';
comment on function public.get_account_balances(date) is 'Owner-only theoretical balances through the requested day, including inactive accounts. No stored running balance.';

commit;
