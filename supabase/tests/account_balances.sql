-- Only run in a disposable/local test database, after 001, 002 and 004 (not legacy-only 003).
-- All fixture data is synthetic and rolled back. Never execute against personal data.
begin;

do $$ begin
  if current_setting('financetracker.test_database', true) is distinct from 'isolated' then
    raise exception 'This test requires an explicitly isolated test database';
  end if;
end $$;

create function pg_temp.assert_balance(expected_id uuid, expected_status text, expected_balance numeric, on_date date)
returns void language plpgsql as $$
declare actual record;
begin
  select * into actual from public.get_account_balances(on_date) where account_id = expected_id;
  if not found or actual.status is distinct from expected_status or actual.balance is distinct from expected_balance then
    raise exception 'Unexpected balance/status for % on %: %', expected_id, on_date, row_to_json(actual);
  end if;
end $$;

create function pg_temp.expect_error(statement text, expected_code text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate <> expected_code then raise; end if;
    return;
  end;
  raise exception 'Expected SQLSTATE % for %', expected_code, statement;
end $$;

insert into auth.users (id) values
 ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.accounts (id, user_id, name, type) values
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Isybank', 'bank'),
 ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Revolut', 'bank'),
 ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', ' Contanti ', 'cash'),
 ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'Unconfigured', 'bank'),
 ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Isybank', 'bank');

-- Pair, precision, finiteness and cash constraints; no numeric typmod rounding.
select pg_temp.expect_error($q$update public.accounts set opening_balance = 1 where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_date = '2026-10-01' where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_balance = 1.001, opening_date = '2026-10-01' where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_balance = 'NaN', opening_date = '2026-10-01' where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_balance = 'Infinity', opening_date = '2026-10-01' where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_balance = '-Infinity', opening_date = '2026-10-01' where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_balance = 1, opening_date = 'infinity' where name = 'Isybank'$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set opening_balance = -0.01, opening_date = '2026-10-01' where name = ' Contanti '$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set type = 'bank', opening_balance = -1, opening_date = '2026-10-01' where name = ' Contanti '$q$, '23514');
select pg_temp.expect_error($q$update public.accounts set name = 'Wallet', opening_balance = -1, opening_date = '2026-10-01' where type = 'cash'$q$, '23514');

update public.accounts set opening_balance = -10.00, opening_date = '2026-10-01' where name = 'Isybank';
update public.accounts set opening_balance = 20.00, opening_date = '2026-10-01' where name = 'Revolut';
update public.accounts set opening_balance = 0.00, opening_date = '2026-10-01' where type = 'cash';

insert into public.transactions (id, user_id, type, amount, transaction_date, category, from_account_id, to_account_id) values
 ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'income', 999, '2026-09-30', 'salary', null, '10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'income', 0.10, '2026-10-01', 'salary', null, '10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'income', 0.20, '2026-10-01', 'salary', null, '10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'expense', 0.01, '2026-10-01', 'food', '10000000-0000-4000-8000-000000000001', null),
 ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'transfer', 2.50, '2026-10-02', null, '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'),
 ('30000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'transfer', 1.25, '2026-10-03', null, '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'income', 50, '2026-10-04', 'salary', null, '10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000002', 'income', 1000, '2026-10-01', 'salary', null, '20000000-0000-4000-8000-000000000001');

-- Execute as a non-owner role, not as the administrator that bypasses RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000001', 'before_opening', null, '2026-09-30');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000001', 'configured', -9.71, '2026-10-01');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000003', 'configured', 0.00, '2026-10-01');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000002', 'configured', 17.50, '2026-10-02');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000003', 'configured', 2.50, '2026-10-02');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000003', 'configured', 1.25, '2026-10-03');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000001', 'configured', -8.46, '2026-10-03');
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000004', 'not_configured', null, '2026-10-03');

do $$ begin
  if (select count(*) from public.get_account_balances('2026-10-03')) <> 4 then raise exception 'Other user exposed'; end if;
  if (select sum(balance) from public.get_account_balances('2026-10-01')) <> 10.29
    or (select sum(balance) from public.get_account_balances('2026-10-03')) <> 10.29 then
    raise exception 'Transfers changed net worth';
  end if;
  if exists (select 1 from public.accounts where user_id <> auth.uid())
    or exists (select 1 from public.transactions where user_id <> auth.uid()) then raise exception 'RLS leak'; end if;
  update public.accounts set opening_balance = 999 where id = '20000000-0000-4000-8000-000000000001';
  if found then raise exception 'RLS allowed foreign opening update'; end if;
end $$;
select pg_temp.expect_error($q$select * from public.get_account_balances(null)$q$, '22023');
select pg_temp.expect_error($q$select * from public.get_account_balances('infinity')$q$, '22023');

-- Retroactive changes recalculate from source rows; inactive accounts remain visible.
update public.transactions set amount = 0.30 where id = '30000000-0000-4000-8000-000000000003';
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000001', 'configured', -8.36, '2026-10-03');
update public.accounts set is_active = false where id = '10000000-0000-4000-8000-000000000002';
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000002', 'configured', 17.50, '2026-10-03');
-- Each transfer leg uses its account's own opening date.
update public.accounts set opening_date = '2026-10-03' where id = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert_balance('10000000-0000-4000-8000-000000000003', 'configured', -1.25, '2026-10-03');
update public.accounts set opening_date = '2026-10-01' where id = '10000000-0000-4000-8000-000000000003';

-- Before 007, exercise legacy read defenses. After 007, the same writes must be rejected.
do $$ begin
 if not exists (select 1 from pg_constraint where conrelid='public.transactions'::regclass and conname='transactions_money_integrity_check') then
-- Legacy precision is preserved by the migration, but never silently rounded in balances.
update public.transactions set amount = 0.001 where id = '30000000-0000-4000-8000-000000000002';
perform pg_temp.expect_error($q$select * from public.get_account_balances('2026-10-01')$q$, '22003');
perform pg_temp.assert_balance('10000000-0000-4000-8000-000000000001', 'before_opening', null, '2026-09-30');
update public.transactions set amount = 'NaN' where id = '30000000-0000-4000-8000-000000000002';
perform pg_temp.expect_error($q$select * from public.get_account_balances('2026-10-01')$q$, '22003');
update public.transactions set amount = 'Infinity' where id = '30000000-0000-4000-8000-000000000002';
perform pg_temp.expect_error($q$select * from public.get_account_balances('2026-10-01')$q$, '22003');
update public.transactions set amount = 0.10 where id = '30000000-0000-4000-8000-000000000002';
update public.accounts set currency = 'USD' where id = '10000000-0000-4000-8000-000000000003';
perform pg_temp.expect_error($q$select * from public.get_account_balances('2026-10-03')$q$, '22023');
update public.accounts set currency = 'EUR' where id = '10000000-0000-4000-8000-000000000003';

 else
  perform pg_temp.expect_error($q$update public.transactions set amount=0.001 where id='30000000-0000-4000-8000-000000000002'$q$,'23514');
  perform pg_temp.expect_error($q$update public.transactions set amount='NaN' where id='30000000-0000-4000-8000-000000000002'$q$,'23514');
  perform pg_temp.expect_error($q$update public.transactions set amount='Infinity' where id='30000000-0000-4000-8000-000000000002'$q$,'23514');
  perform pg_temp.expect_error($q$update public.accounts set currency='USD' where id='10000000-0000-4000-8000-000000000003'$q$,'23514');
 end if;
end $$;

-- Second authenticated user sees only their own opening and income.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_balance('20000000-0000-4000-8000-000000000001', 'configured', 990.00, '2026-10-03');
do $$ begin
  if (select count(*) from public.get_account_balances('2026-10-03')) <> 1 then raise exception 'User isolation failed'; end if;
end $$;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error($q$select * from public.get_account_balances('2026-10-03')$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.get_account_balances('2026-10-03')$q$, '42501');
reset role;

do $$ begin
  if (select prosecdef from pg_proc where oid = 'public.get_account_balances(date)'::regprocedure) then
    raise exception 'Function must not bypass RLS';
  end if;
end $$;
rollback;
