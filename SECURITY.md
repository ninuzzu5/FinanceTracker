# Security policy

## Public repository rules

Never commit:

- Telegram bot tokens, webhook secrets or personal chat IDs;
- Supabase secret/service-role keys, Auth user credentials, passwords or authenticated database URLs;
- private email addresses, access/refresh tokens, JWTs or personal account/user UUIDs;
- `.env` files other than `.env.example`;
- real transactions, account balances or exports from banks and Notion;
- screenshots containing names, balances, transaction details or identifiers;
- private training phrases derived from personal financial history;
- generated model artifacts before checking their contents and provenance.

Use synthetic data in tests, documentation, seeds and demos.

## If a secret is exposed

Deleting the file in a later commit is not enough because the value remains in Git history. Revoke or rotate the secret immediately. Keep the repository private until exposure is assessed, including commit history, branches, tags and copies. Plan any history cleanup explicitly with the owner; never automatically rewrite commits or force push. Removing a value from history does not revoke it.

Before publishing, also review author/committer names and email addresses in commit metadata. A future noreply email setting does not change existing commits.

## Application boundaries

- The dashboard is not implemented yet. Any future browser client may receive only public Supabase configuration, never the bot's Auth credentials or session.
- The bot uses the public anonymous key and a dedicated Supabase Auth user. Reads and writes use that authenticated session and remain subject to RLS. Secret/service-role keys are not used by the normal bot flow.
- Auth credentials come only from private runtime environment variables; the session stays in memory.
- Webhook requests must pass the Telegram webhook secret check. Local polling checks the private chat allowlist instead.
- Only explicitly associated Telegram chat IDs may create transactions.
- Every user-owned database table must use Row Level Security. Account lookups select active owned accounts; transaction inserts include the authenticated user ID, with database constraints enforcing account ownership.
- Database schema, constraints and RLS policies currently live outside this repository and are not independently reproducible from versioned SQL. Do not assume a new database has those protections configured.
- Tests use synthetic fixtures and mocked services, without real credentials or financial data.
- Monetary values are validated before persistence; the classifier never modifies an amount.

## Reporting

Until a dedicated security contact is configured, do not open a public issue containing a vulnerability or secret. Contact the repository owner privately.
