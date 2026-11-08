-- Accesso contabile condiviso per una sola identità web dedicata.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';

do $preflight$
declare
  ledger regclass;
  routine regprocedure;
  client_role text;
  reachable record;
  privilege text;
begin
  if to_regnamespace('financetracker_private') is not null then
    raise exception 'Lo schema financetracker_private esiste già. Verificare lo stato di 010';
  end if;
  if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null
    or to_regprocedure('auth.jwt()') is null
    or pg_has_role('anon', 'authenticated', 'MEMBER') then
    raise exception 'Configurazione Supabase Auth incompatibile con 010';
  end if;

  foreach ledger in array array[
    'public.accounts'::regclass, 'public.transactions'::regclass,
    'public.account_adjustments'::regclass, 'public.transaction_receipts'::regclass,
    'public.transaction_changes'::regclass
  ] loop
    if not exists (select 1 from pg_class where oid = ledger and relkind = 'r' and relrowsecurity)
      or not has_table_privilege('authenticated', ledger, 'SELECT') then
      raise exception 'Tabella contabile, RLS o grant SELECT incompatibili su %', ledger;
    end if;
    -- Le policy SELECT preesistenti devono corrispondere all'isolamento per proprietario.
    if (select count(*) from pg_policy where polrelid = ledger and polcmd in ('r', '*')) <> 1
      or not exists (
        select 1 from pg_policy
        where polrelid = ledger and polcmd = 'r' and polpermissive
          and polroles = array['authenticated'::regrole::oid]
          and regexp_replace(
            pg_get_expr(polqual, polrelid),
            '[[:space:]()]', '', 'g'
            ) in (
              'user_id=auth.uid',
              'auth.uid=user_id'
            )
      ) then
      raise exception 'Policy SELECT non allineate alla baseline su %', ledger;
    end if;

    foreach client_role in array array['anon', 'authenticated'] loop
      for reachable in
        select oid, rolname, rolsuper, rolbypassrls from pg_roles
        where pg_has_role(client_role, oid, 'MEMBER')
      loop
        if reachable.rolsuper or reachable.rolbypassrls or
          pg_has_role(reachable.oid, (select relowner from pg_class where oid = ledger), 'MEMBER') then
          raise exception 'Ruolo privilegiato % raggiungibile da % su %', reachable.rolname, client_role, ledger;
        end if;
        foreach privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
          if has_table_privilege(reachable.oid, ledger, privilege)
            or (privilege in ('INSERT','UPDATE','REFERENCES')
              and has_any_column_privilege(reachable.oid, ledger, privilege)) then
            raise exception 'Grant residuo % su % per % tramite %', privilege, ledger, client_role, reachable.rolname;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  foreach routine in array array[
    'public.save_transaction_once(uuid,text,numeric,date,text,text,text)'::regprocedure,
    'public.manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid)'::regprocedure,
    'public.reconcile_cash(uuid,date,numeric,numeric,uuid)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc where oid = routine and prosecdef and provolatile = 'v'
        and proconfig @> array['search_path=""']
    ) or not has_function_privilege('authenticated', routine, 'EXECUTE')
      or has_function_privilege('anon', routine, 'EXECUTE') then
      raise exception 'Configurazione o grant della RPC di scrittura incompatibili su %', routine;
    end if;
  end loop;
end;
$preflight$;

create schema financetracker_private;
revoke all on schema financetracker_private from public, anon, authenticated, service_role;
grant usage on schema financetracker_private to authenticated;

-- Il registro nasce vuoto. Per revocare l'accesso, disabilitare la riga e conservarla.
create table financetracker_private.dashboard_access (
  viewer_user_id uuid primary key references auth.users(id),
  owner_user_id uuid not null references auth.users(id),
  singleton boolean not null default true unique check (singleton),
  enabled boolean not null default false,
  expires_at timestamptz,
  approved_at timestamptz not null default now(),
  approved_by text not null default current_user,
  approval_reference text not null check (length(btrim(approval_reference)) between 1 and 200),
  check (viewer_user_id <> owner_user_id)
);
alter table financetracker_private.dashboard_access enable row level security;
revoke all on financetracker_private.dashboard_access from public, anon, authenticated, service_role;

-- Le funzioni privilegiate leggono soltanto la configurazione del chiamante.
create function financetracker_private.is_dashboard_viewer() returns boolean
language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from financetracker_private.dashboard_access d
    where d.viewer_user_id = (select auth.uid())
  )
$function$;

create function financetracker_private.shared_dashboard_owner() returns uuid
language sql stable security definer set search_path = '' as $function$
  select d.owner_user_id
  from financetracker_private.dashboard_access d
  where d.viewer_user_id = (select auth.uid())
    and (select auth.jwt()->>'aal') = 'aal2'
    and d.enabled
    and (d.expires_at is null or d.expires_at > pg_catalog.statement_timestamp())
$function$;

revoke all on function financetracker_private.is_dashboard_viewer(),
  financetracker_private.shared_dashboard_owner() from public, anon, authenticated, service_role;
grant execute on function financetracker_private.is_dashboard_viewer(),
  financetracker_private.shared_dashboard_owner() to authenticated;

do $policies$
declare
  ledger regclass;
begin
  foreach ledger in array array[
    'public.accounts'::regclass, 'public.transactions'::regclass, 'public.account_adjustments'::regclass
  ] loop
    execute format('create policy dashboard_shared_read on %s for select to authenticated
      using (user_id = (select financetracker_private.shared_dashboard_owner()))', ledger);
    -- Per il viewer le righe di test proprie restano presenti ma fuori dalle letture.
    execute format('create policy dashboard_read_scope on %s as restrictive for select to authenticated
      using (not (select financetracker_private.is_dashboard_viewer())
        or user_id = (select financetracker_private.shared_dashboard_owner()))', ledger);
  end loop;
  foreach ledger in array array['public.transaction_receipts'::regclass, 'public.transaction_changes'::regclass] loop
    execute format('create policy dashboard_read_scope on %s as restrictive for select to authenticated
      using (not (select financetracker_private.is_dashboard_viewer()))', ledger);
  end loop;
end;
$policies$;

-- I trigger bloccano anche il DML delle RPC SECURITY DEFINER e restano attivi dopo la revoca.
create function financetracker_private.reject_dashboard_writes() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if financetracker_private.is_dashboard_viewer() then
    raise exception 'Identità web di sola lettura' using errcode = '42501';
  end if;
  return null;
end;
$function$;
revoke all on function financetracker_private.reject_dashboard_writes()
  from public, anon, authenticated, service_role;

do $triggers$
declare
  ledger regclass;
begin
  foreach ledger in array array[
    'public.accounts'::regclass, 'public.transactions'::regclass,
    'public.account_adjustments'::regclass, 'public.transaction_receipts'::regclass,
    'public.transaction_changes'::regclass
  ] loop
    execute format('create trigger reject_dashboard_writes before insert or update or delete or truncate
      on %s for each statement execute function financetracker_private.reject_dashboard_writes()', ledger);
  end loop;
end;
$triggers$;

commit;
