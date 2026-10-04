-- Supabase 01 baseline for a fresh database with Supabase Auth already provisioned.
begin;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  type text not null,
  currency text not null default 'EUR',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint accounts_user_id_id_unique
    unique (user_id, id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  amount numeric not null,
  transaction_date date not null,
  category text null,
  description text null,
  from_account_id uuid null,
  to_account_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transactions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint transactions_from_account_id_fkey
    foreign key (from_account_id) references public.accounts(id),
  constraint transactions_to_account_id_fkey
    foreign key (to_account_id) references public.accounts(id),
  constraint transactions_from_account_owner_fkey
    foreign key (user_id, from_account_id) references public.accounts(user_id, id),
  constraint transactions_to_account_owner_fkey
    foreign key (user_id, to_account_id) references public.accounts(user_id, id),

  constraint transactions_type_check
    check (type in ('expense', 'income', 'transfer')),
  constraint transactions_amount_check
    check (amount > 0),
  constraint transactions_accounts_direction_check
    check (
      (type = 'expense' and from_account_id is not null and to_account_id is null)
      or (type = 'income' and from_account_id is null and to_account_id is not null)
      or (type = 'transfer' and from_account_id is not null and to_account_id is not null)
    ),
  constraint transactions_transfer_accounts_check
    check (type <> 'transfer' or from_account_id <> to_account_id),
  constraint transactions_category_check
    check (
      (
        type = 'expense'
        and category is not null
        and category in (
          'groceries', 'public_transport', 'flights', 'tobacco', 'sport',
          'leisure', 'food', 'rent', 'personal_care', 'gifts',
          'subscriptions', 'holidays', 'unexpected'
        )
      )
      or (
        type = 'income'
        and category is not null
        and category in ('salary', 'gifts', 'personal_projects')
      )
      or (type = 'transfer' and category is null)
    )
);

commit;
