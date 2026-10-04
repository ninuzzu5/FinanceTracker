# Supabase

Supabase 01 tables, constraints, Auth and RLS already exist in the private database. Supabase 02 uses them without changing schema or policies. The schema supplied for this milestone has active owned accounts (`id`, `user_id`, `name`, `is_active`) and transactions (`user_id`, `type`, `amount`, `transaction_date`, `category`, `from_account_id`, `to_account_id`). Composite foreign keys enforce account ownership.

The bot uses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_USER_EMAIL` and `SUPABASE_USER_PASSWORD`. Use the existing dedicated Auth user. Never use a service role key. Keep credentials in the ignored `.env.local` file or private runtime environment.

Only synthetic test fixtures may be committed. Normal tests mock the SDK and never write to the real database. See the Supabase 02 manual checklist in the root README.
