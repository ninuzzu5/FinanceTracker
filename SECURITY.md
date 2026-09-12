# Security policy

## Public repository rules

Never commit:

- Telegram bot tokens, webhook secrets or personal chat IDs;
- Supabase service-role keys or authenticated database URLs;
- `.env` files other than `.env.example`;
- real transactions, account balances or exports from banks and Notion;
- screenshots containing names, balances, transaction details or identifiers;
- private training phrases derived from personal financial history;
- generated model artifacts before checking their contents and provenance.

Use synthetic data in tests, documentation, seeds and demos.

## If a secret is exposed

Deleting the file in a later commit is not enough because the value remains in Git history. Revoke or rotate the secret immediately, then clean the repository history before making it public again.

## Application boundaries

- The browser may receive only the Supabase anonymous key.
- The Supabase service-role key is backend-only.
- Telegram requests must be checked using the webhook secret.
- Only explicitly associated Telegram chat IDs may create transactions.
- Every user-owned database table must use Row Level Security.
- Monetary values are validated before persistence; the classifier never modifies an amount.

## Reporting

Until a dedicated security contact is configured, do not open a public issue containing a vulnerability or secret. Contact the repository owner privately.
