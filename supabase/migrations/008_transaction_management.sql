-- Milestones B/C. Incremental only; run the read-only 008 preflight first.
-- No historical financial values or B1 receipts are rewritten.
begin;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.accounts'::regclass and conname='accounts_eur_currency_check')
    or to_regprocedure('public.save_transaction_once(uuid,text,numeric,date,text,text,text)') is null then
    raise exception 'Migration 007 is required'; end if;
  if (select count(*) from pg_class where oid in ('public.accounts'::regclass,'public.transactions'::regclass,
    'public.transaction_receipts'::regclass,'public.account_adjustments'::regclass) and relrowsecurity)<>4 then
    raise exception 'RLS required on all accounting tables'; end if;
  if (select count(*) from pg_constraint where conrelid='public.transactions'::regclass
    and conname in ('transactions_money_integrity_check','transactions_finite_date_check'))<>2
    or not exists(select 1 from pg_trigger where tgrelid='public.transactions'::regclass
      and tgname='protect_reconciled_cash_transactions' and tgenabled='O') then
    raise exception 'Migration 005/007 guards required'; end if;
end $$;
alter table public.transactions
  add column ledger_version integer not null default 1 check(ledger_version > 0),
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users(id),
  add constraint transactions_void_pair_check check((voided_at is null) = (voided_by is null));

-- Exact, deliberately bounded snapshot: no raw Telegram message or unused legacy fields.
create function public.transaction_snapshot(t public.transactions) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',t.id,'user_id',t.user_id,'type',t.type,'amount',t.amount::text,
    'date',t.transaction_date::text,'category',t.category,'from_id',t.from_account_id,'to_id',t.to_account_id,
    'version',t.ledger_version::text,'voided_at',t.voided_at,'voided_by',t.voided_by)
$$;
create table public.transaction_changes (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  transaction_id uuid not null references public.transactions(id),
  action text not null check(action in ('edit','void')),
  payload jsonb not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
create unique index transaction_changes_version on public.transaction_changes(transaction_id, (after_state->>'version'));
alter table public.transaction_changes enable row level security;
revoke all on public.transaction_changes from public,anon,authenticated;
grant select on public.transaction_changes to authenticated;
create policy transaction_changes_select_own on public.transaction_changes for select to authenticated using(user_id=auth.uid());
create trigger protect_transaction_changes before update or delete on public.transaction_changes
  for each row execute function public.guard_transaction_receipts();
-- Corrections only through the narrow atomic RPC. INSERT stays compatible with B1/direct owned inserts.
revoke update,delete on public.transactions from authenticated;

create function public.guard_managed_transactions() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if TG_OP='DELETE' then raise exception 'Use logical cancellation' using errcode='PT409'; end if;
  if TG_OP='INSERT' then
    if NEW.ledger_version<>1 or NEW.voided_at is not null or NEW.voided_by is not null then
      raise exception 'Invalid initial transaction state' using errcode='22023'; end if;
    return NEW;
  end if;
  if OLD.voided_at is not null or NEW.ledger_version<>OLD.ledger_version+1
    or (NEW.id,NEW.user_id,NEW.type,NEW.created_at) is distinct from (OLD.id,OLD.user_id,OLD.type,OLD.created_at)
    or not exists(select 1 from public.transaction_changes c where c.user_id=auth.uid() and c.transaction_id=OLD.id
      and c.before_state=public.transaction_snapshot(OLD) and c.after_state=public.transaction_snapshot(NEW)) then
    raise exception 'Atomic audited correction required' using errcode='PT409'; end if;
  return NEW;
end $$;
create trigger protect_managed_transactions before insert or update or delete on public.transactions
  for each row execute function public.guard_managed_transactions();

create function public.get_transaction_for_management(p_transaction_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.transactions; result jsonb; available jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into t from public.transactions where id=p_transaction_id and user_id=auth.uid();
  if not found then raise exception 'Movement unavailable' using errcode='PT404'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'currency',a.currency,'active',a.is_active) order by a.id),'[]')
    into available from public.accounts a where a.user_id=auth.uid();
  return jsonb_build_object('movement',public.transaction_snapshot(t),'accounts',available);
end $$;
create function public.get_transaction_change_receipt(p_request_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  return (select jsonb_build_object('transaction_id',c.transaction_id,'action',c.action,'version',c.after_state->>'version')
    from public.transaction_changes c where c.user_id=auth.uid() and c.request_id=p_request_id);
end $$;

create function public.manage_transaction_once(
  p_request_id uuid,p_transaction_id uuid,p_expected_version integer,p_action text,
  p_amount numeric default null,p_date date default null,p_category text default null,
  p_from_account uuid default null,p_to_account uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare caller uuid:=auth.uid(); t public.transactions; next_row public.transactions;
  receipt public.transaction_changes; canonical jsonb; cash_id uuid; result jsonb;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Corrections require READ COMMITTED' using errcode='22023'; end if;
  if p_request_id is null or p_transaction_id is null or p_expected_version is null or p_expected_version<1
    or p_action is null or p_action not in ('edit','void') then
    raise exception 'Invalid correction' using errcode='22023'; end if;
  canonical:=jsonb_build_object('id',p_transaction_id,'expected_version',p_expected_version,'action',p_action,
    'amount',p_amount,'date',p_date,'category',p_category,'from_id',p_from_account,'to_id',p_to_account);
  perform pg_advisory_xact_lock(hashtextextended('history:'||caller::text||':'||p_request_id::text,0));
  select * into receipt from public.transaction_changes where user_id=caller and request_id=p_request_id;
  if found then
    if receipt.payload is distinct from canonical then raise exception 'Request payload mismatch' using errcode='PT409'; end if;
    return jsonb_build_object('transaction_id',receipt.transaction_id,'action',receipt.action,'version',receipt.after_state->>'version');
  end if;
  -- Cash locks FIRST, in the same UUID order as 005, then the transaction row.
  -- All owned cash accounts avoid races with a concurrent change of the old cash leg.
  -- Reconciliation never locks transaction rows; it sees the committed ledger after waiting.
  for cash_id in select a.id from public.accounts a where a.user_id=caller
    and (lower(btrim(a.name))='contanti' or lower(btrim(a.type))='cash') order by a.id for update
  loop null; end loop;
  select * into t from public.transactions where id=p_transaction_id and user_id=caller for update;
  if not found then raise exception 'Movement unavailable' using errcode='PT404'; end if;
  if t.voided_at is not null or t.ledger_version<>p_expected_version then
    raise exception 'Movement changed or cancelled; reload history' using errcode='PT409'; end if;
  next_row:=t;
  if p_action='void' then
    if p_amount is not null or p_date is not null or p_category is not null or p_from_account is not null or p_to_account is not null then
      raise exception 'Cancellation must not replace financial fields' using errcode='22023'; end if;
    next_row.voided_at:=clock_timestamp(); next_row.voided_by:=caller;
  else
    if p_amount is null or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or p_amount<=0 or p_amount<>round(p_amount,2) or p_date is null or not isfinite(p_date) then
      raise exception 'Invalid money/date' using errcode='22023'; end if;
    if (t.type='expense' and (p_from_account is null or p_to_account is not null))
      or (t.type='income' and (p_to_account is null or p_from_account is not null))
      or (t.type='transfer' and (p_from_account is null or p_to_account is null or p_from_account=p_to_account)) then
      raise exception 'Invalid direction' using errcode='22023'; end if;
    if exists(select 1 from unnest(array[p_from_account,p_to_account]) requested(id) where id is not null
      and not exists(select 1 from public.accounts a where a.id=requested.id and a.user_id=caller and a.is_active and a.currency='EUR')) then
      raise exception 'Owned active EUR account required' using errcode='PT404'; end if;
    next_row.amount:=p_amount; next_row.transaction_date:=p_date; next_row.category:=p_category;
    next_row.from_account_id:=p_from_account; next_row.to_account_id:=p_to_account;
  end if;
  next_row.ledger_version:=t.ledger_version+1; next_row.updated_at:=clock_timestamp();
  -- Append before UPDATE, in this same transaction; any failed CHECK/005 guard rolls both back.
  insert into public.transaction_changes(user_id,request_id,transaction_id,action,payload,before_state,after_state)
    values(caller,p_request_id,t.id,p_action,canonical,public.transaction_snapshot(t),public.transaction_snapshot(next_row));
  update public.transactions set amount=next_row.amount,transaction_date=next_row.transaction_date,category=next_row.category,
    from_account_id=next_row.from_account_id,to_account_id=next_row.to_account_id,
    ledger_version=next_row.ledger_version,updated_at=next_row.updated_at,voided_at=next_row.voided_at,voided_by=next_row.voided_by
    where id=t.id and user_id=caller;
  return jsonb_build_object('transaction_id',t.id,'action',p_action,'version',next_row.ledger_version::text);
end $$;

-- Same balance contract and adjustments, excluding logically cancelled movements.
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
      and t.voided_at is null
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


revoke all on function public.transaction_snapshot(public.transactions) from public,anon;
grant execute on function public.transaction_snapshot(public.transactions) to authenticated;
revoke all on function public.guard_managed_transactions() from public,anon,authenticated;
revoke all on function public.get_transaction_for_management(uuid) from public,anon;
revoke all on function public.get_transaction_change_receipt(uuid) from public,anon;
revoke all on function public.manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid) from public,anon;
grant execute on function public.get_transaction_for_management(uuid) to authenticated;
grant execute on function public.get_transaction_change_receipt(uuid) to authenticated;
grant execute on function public.manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid) to authenticated;
revoke all on function public.get_account_balances(date) from public,anon;
grant execute on function public.get_account_balances(date) to authenticated;
comment on function public.get_account_balances(date) is 'Owner-only theoretical balances, including adjustments and excluding cancelled movements. No stored running balance.';
commit;
