-- Le scritture applicative passano soltanto dalle RPC contabili esistenti.
begin;

do $$
begin
  if (select count(*) from pg_catalog.pg_class where oid in (
    'public.accounts'::regclass, 'public.transactions'::regclass,
    'public.transaction_receipts'::regclass, 'public.account_adjustments'::regclass,
    'public.transaction_changes'::regclass) and relrowsecurity) <> 5 then
    raise exception 'RLS richiesta sulle cinque tabelle contabili';
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger
  on public.accounts, public.transactions from public, anon, authenticated;

-- Le revoche di tabella non eliminano i grant assegnati alle singole colonne.
do $$
declare item record;
begin
  for item in select attrelid::regclass as relation, attname
    from pg_catalog.pg_attribute
    where attrelid in ('public.accounts'::regclass, 'public.transactions'::regclass)
      and attnum > 0 and not attisdropped
  loop
    execute format('revoke insert (%I), update (%I), references (%I) on %s from public, anon, authenticated',
      item.attname, item.attname, item.attname, item.relation);
  end loop;
end $$;

do $$
declare application_role text; reachable record; item record; relation regclass; privilege text; routine regprocedure;
begin
  -- Controllare i proprietari dopo le revoche: anche una RPC potrebbe dipendere da PUBLIC.
  for item in select p.oid, p.proowner, p.proname, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p where p.oid in (
      'public.save_transaction_once(uuid,text,numeric,date,text,text,text)'::regprocedure,
      'public.manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid)'::regprocedure,
      'public.reconcile_cash(uuid,date,numeric,numeric,uuid)'::regprocedure)
  loop
    if not item.prosecdef or not coalesce(item.proconfig @> array['search_path=""'], false)
      or not pg_catalog.has_table_privilege(item.proowner, 'public.accounts', 'SELECT')
      or not pg_catalog.has_table_privilege(item.proowner, 'public.accounts', 'UPDATE')
      or not pg_catalog.has_table_privilege(item.proowner, 'public.transactions', 'SELECT')
      or not pg_catalog.has_table_privilege(item.proowner, 'public.account_adjustments', 'SELECT')
      or (item.proname='save_transaction_once' and not pg_catalog.has_table_privilege(item.proowner, 'public.transactions', 'INSERT'))
      or (item.proname='manage_transaction_once' and not pg_catalog.has_table_privilege(item.proowner, 'public.transactions', 'UPDATE'))
      or exists (
        select 1 from unnest(case item.proname when 'save_transaction_once' then array['public.transaction_receipts']
          when 'manage_transaction_once' then array['public.transaction_changes'] else array['public.account_adjustments'] end) as ledger(name)
        where not pg_catalog.has_table_privilege(item.proowner, ledger.name, 'SELECT')
          or not pg_catalog.has_table_privilege(item.proowner, ledger.name, 'INSERT')) then
      raise exception 'Proprietario o configurazione RPC incompatibile: %', item.oid::regprocedure;
    end if;
  end loop;

  foreach application_role in array array['anon', 'authenticated'] loop
    -- MEMBER include anche appartenenze senza ereditarietà automatica: nessun SET ROLE alternativo.
    for reachable in select oid, rolname, rolsuper, rolbypassrls from pg_catalog.pg_roles
      where pg_catalog.pg_has_role(application_role, oid, 'MEMBER')
    loop
      if reachable.rolsuper or reachable.rolbypassrls then
        raise exception 'Ruolo privilegiato raggiungibile da %: %', application_role, reachable.rolname
          using errcode = '42501';
      end if;
      foreach relation in array array['public.accounts'::regclass, 'public.transactions'::regclass] loop
        foreach privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
          if pg_catalog.has_table_privilege(reachable.oid, relation, privilege)
            or (privilege in ('INSERT', 'UPDATE', 'REFERENCES')
              and pg_catalog.has_any_column_privilege(reachable.oid, relation, privilege)) then
            raise exception 'Privilegio residuo % su % per % tramite %; nessuna revoca applicata',
              privilege, relation, application_role, reachable.rolname using errcode = '42501';
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  if not pg_catalog.has_table_privilege('authenticated', 'public.accounts', 'SELECT')
    or not pg_catalog.has_table_privilege('authenticated', 'public.transactions', 'SELECT') then
    raise exception 'Letture autenticate richieste';
  end if;
  foreach routine in array array[
    'public.save_transaction_once(uuid,text,numeric,date,text,text,text)'::regprocedure,
    'public.manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid)'::regprocedure,
    'public.reconcile_cash(uuid,date,numeric,numeric,uuid)'::regprocedure,
    'public.get_account_balances(date)'::regprocedure,
    'public.preview_cash_reconciliation(date)'::regprocedure,
    'public.get_transaction_receipt(uuid)'::regprocedure,
    'public.get_transaction_for_management(uuid)'::regprocedure,
    'public.get_transaction_change_receipt(uuid)'::regprocedure] loop
    if not pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', routine, 'EXECUTE') then
      raise exception 'Permessi RPC incompatibili: %', routine;
    end if;
  end loop;
end $$;

commit;
