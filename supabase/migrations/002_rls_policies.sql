-- Supabase 01 ownership policies; run after 001_initial_schema.sql.
begin;

alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

-- SQL privileges permit these operations; RLS restricts them to owned rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.accounts to authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;

create policy accounts_select_own on public.accounts
  for select to authenticated
  using (user_id = auth.uid());

create policy accounts_insert_own on public.accounts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy accounts_update_own on public.accounts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy accounts_delete_own on public.accounts
  for delete to authenticated
  using (user_id = auth.uid());

create policy transactions_select_own on public.transactions
  for select to authenticated
  using (user_id = auth.uid());

create policy transactions_insert_own on public.transactions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy transactions_update_own on public.transactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy transactions_delete_own on public.transactions
  for delete to authenticated
  using (user_id = auth.uid());

commit;
