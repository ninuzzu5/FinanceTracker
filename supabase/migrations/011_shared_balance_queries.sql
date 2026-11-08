-- RPC di sola lettura della dashboard e calcolo dei saldi condiviso con il bot.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';

do $preflight$
declare
  balance_rpc regprocedure := to_regprocedure('public.get_account_balances(date)');
begin
  if to_regclass('financetracker_private.dashboard_access') is null
    or to_regprocedure('financetracker_private.shared_dashboard_owner()') is null
    or to_regprocedure('financetracker_private.reject_dashboard_writes()') is null then
    raise exception 'Applicare la migrazione 010 prima della 011';
  end if;
  if exists (select 1 from financetracker_private.dashboard_access) then
    raise exception 'Eseguire l’associazione privata solo dopo la migrazione 011';
  end if;
  if to_regprocedure('public.get_dashboard_balances(date)') is not null
    or to_regprocedure('public.get_dashboard_movements(date,date,integer,date,uuid)') is not null then
    raise exception 'Le RPC della dashboard esistono già. Verificare lo stato di 011';
  end if;

  -- Confronta il corpo canonico di 008 prima di sostituirlo; tollera CRLF e spazi esterni.
  if not exists (
    select 1 from pg_proc where oid = balance_rpc and not prosecdef and provolatile = 's'
      and proconfig @> array['search_path=""']
      and md5(btrim(replace(prosrc, chr(13), ''), E' \n\t')) = '7bcfc0cc61c961b817f8b9f475347379'
  ) or not has_function_privilege('authenticated', balance_rpc, 'EXECUTE')
    or has_function_privilege('anon', balance_rpc, 'EXECUTE') then
    raise exception 'get_account_balances non allineata alla 008. Confrontare corpo e grant prima di proseguire';
  end if;

  if exists (
    select 1
    from (values ('type', 'text'::regtype), ('category', 'text'::regtype),
      ('ledger_version', 'integer'::regtype)) as expected(name, data_type)
    where not exists (
      select 1 from pg_attribute where attrelid = 'public.transactions'::regclass
        and attname = expected.name and atttypid = expected.data_type and attnum > 0 and not attisdropped
    )
  ) then
    raise exception 'Tipi delle colonne dei movimenti incompatibili con 011';
  end if;
end;
$preflight$;

create function financetracker_private.account_balances_for_owner(p_owner uuid, p_as_of date)
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
  caller_id uuid := p_owner;
  allowed_owner uuid := case
    when financetracker_private.is_dashboard_viewer() then financetracker_private.shared_dashboard_owner()
    else auth.uid()
  end;
begin
  if caller_id is null or caller_id is distinct from allowed_owner then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_as_of is null or not pg_catalog.isfinite(p_as_of) then
    raise exception 'A finite balance date is required' using errcode = '22023';
  end if;

  -- Controlla soltanto gli importi che contribuiscono al saldo.
  if exists (
    select 1
    from public.accounts a
    join public.transactions t on t.user_id = a.user_id
      and (t.from_account_id = a.id or t.to_account_id = a.id)
    where a.user_id = caller_id and a.opening_date is not null
      and t.voided_at is null
      and t.transaction_date between a.opening_date and p_as_of
      and (t.amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        or t.amount <= 0 or t.amount <> pg_catalog.round(t.amount, 2))
  ) then
    raise exception 'Included transactions must have finite positive amounts with at most two decimals'
      using errcode = '22003';
  end if;

  -- I trasferimenti tra valute diverse richiedono una conversione esplicita.
  if exists (
    select 1
    from public.transactions t
    join public.accounts source on source.id = t.from_account_id and source.user_id = t.user_id
    join public.accounts destination on destination.id = t.to_account_id and destination.user_id = t.user_id
    where t.user_id = caller_id and t.voided_at is null and t.type = 'transfer'
      and source.currency <> destination.currency
      and ((source.opening_date is not null and t.voided_at is null
      and t.transaction_date between source.opening_date and p_as_of)
        or (destination.opening_date is not null and t.voided_at is null
      and t.transaction_date between destination.opening_date and p_as_of))
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
      and t.voided_at is null
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return query select * from financetracker_private.account_balances_for_owner(auth.uid(), p_as_of);
end;
$function$;

revoke all on function financetracker_private.account_balances_for_owner(uuid,date) from public, anon, authenticated, service_role;
grant execute on function financetracker_private.account_balances_for_owner(uuid,date) to authenticated;

create function public.get_dashboard_balances(p_as_of date)
returns table(account_id uuid,account_name text,currency text,is_active boolean,as_of_date date,status text,balance text)
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=financetracker_private.shared_dashboard_owner();
begin
  if owner_id is null then
    raise exception 'Accesso condiviso non disponibile' using errcode = '42501';
  end if;
  return query select b.account_id,b.account_name,b.currency,b.is_active,b.as_of_date,b.status,b.balance::text
    from financetracker_private.account_balances_for_owner(owner_id,p_as_of) b;
end $$;

create function public.get_dashboard_movements(p_from date,p_to date,p_limit integer default 50,p_before_date date default null,p_before_id uuid default null)
returns table(id uuid,type text,amount text,transaction_date date,category text,from_account_id uuid,to_account_id uuid,voided boolean,ledger_version integer)
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=financetracker_private.shared_dashboard_owner();
begin
  if owner_id is null then
    raise exception 'Accesso condiviso non disponibile' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_from>p_to or p_to-p_from>366 or p_limit is null or p_limit<1 or p_limit>100
    or ((p_before_date is null)<>(p_before_id is null))
    or (p_before_date is not null and not isfinite(p_before_date)) then
    raise exception 'Intervallo o paginazione non validi' using errcode='22023';
  end if;
  return query select t.id,t.type,t.amount::text,t.transaction_date,t.category,
    t.from_account_id,t.to_account_id,t.voided_at is not null,t.ledger_version
    from public.transactions t where t.user_id=owner_id and t.transaction_date between p_from and p_to
      and (p_before_date is null or (t.transaction_date,t.id)<(p_before_date,p_before_id))
    order by t.transaction_date desc,t.id desc limit p_limit;
end $$;
revoke all on function public.get_dashboard_balances(date),public.get_dashboard_movements(date,date,integer,date,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_balances(date),public.get_dashboard_movements(date,date,integer,date,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
