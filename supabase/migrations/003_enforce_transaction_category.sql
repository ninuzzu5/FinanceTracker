-- Existing-database category correction. Run the read-only preflight in README.md first.
-- Validates existing rows; failure rolls back the constraint replacement.
begin;

alter table public.transactions
  drop constraint transactions_category_check,
  add constraint transactions_category_check
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
    );

commit;
