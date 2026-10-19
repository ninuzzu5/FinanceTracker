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
- Remote Supabase endpoints require HTTPS without embedded URL credentials. HTTP is accepted only for the literal loopback authorities localhost, 127.0.0.1 and [::1], with an optional port. Ambiguous numeric forms, encoded loopback hostnames and lookalike domains are rejected for HTTP. Configuration errors omit the URL and credentials.
- Webhook requests must pass the Telegram webhook secret check. Local polling checks the private chat allowlist instead.
- Only explicitly associated Telegram chat IDs may create transactions.
- Every user-owned database table must use Row Level Security. Account lookups select active owned accounts; the atomic save RPC derives the authenticated user ID, with database constraints enforcing account ownership. Receipt and reconciliation write RPCs use SECURITY DEFINER with explicit ownership checks; read RPCs use SECURITY INVOKER and RLS.
- Schema, RLS, openings, cash closure guards, idempotent receipts and monetary/EUR constraints are versioned in migrations 001–008. Follow [the migration order and preflights](supabase/README.md); 003 is legacy-only. Apply 001/002 only to a fresh database, never replay them on existing tables. Managed Auth and private user/account provisioning are separate prerequisites. Remote alignment is not verified by this documentation review.
- Application tests mock services; separate SQL/stress runners use disposable local databases and synthetic Auth fixtures, keeping RLS, triggers and constraints enabled. They do not certify hosted Auth or remote schema configuration.
- Monetary values are validated in the domain and SQL; 007 rejects nonfinite/nonpositive/sub-cent amounts and nonfinite dates on INSERT/UPDATE without rounding. All accounts must be EUR. Historical transaction checks are NOT VALID until separately reviewed/validated. The classifier never modifies an amount.
- Persistent idempotency applies to the stable operation key through save_transaction_once, not direct SQL/REST inserts or pre-006 history. Do not rotate its namespace or share one owner between multiple bots without a compatibility plan. Closed cash days cannot be reopened through the current application.

## Reporting

Until a dedicated security contact is configured, do not open a public issue containing a vulnerability or secret. Contact the repository owner privately.

## Historical corrections (008)

Authenticated clients cannot UPDATE/DELETE transactions directly. Corrections use manage_transaction_once: explicit owner, active EUR account checks, expected ledger version, durable request key and canonical payload. Atomic before/after audit records in transaction_changes are owner-readable and immutable; they contain structured accounting values, not raw Telegram messages. Cancellation preserves the row and original B1 receipt, recording voided_by/voided_at. No reactivation is exposed.

The existing cash closure trigger remains enabled and checks old/new legs for corrections and cancellation. New guards require valid initial state and audited version increments, including privileged direct updates. Trusted administrators can always alter database protections: do not use manual ledger edits, disable triggers, change grants or restore pre-008 code as an application workflow. After the first correction, a rollback requires a reviewed migration/recovery plan preserving cancellations and audit.

## Pre-release verification and accepted risk

The [audit](docs/audit-v1-2026-10-17.md) retains the original findings and local remediation status. UX-01 remains a confirmed issue accepted by the owner for the personal v1: editing an unrelated Telegram message can populate an active input field. Explicit confirmation is still required. During active entry, send a new reply and verify the preview; no fix for UX-01 is included in this hardening task. OPS-01 remains open until an isolated backup/restore has been demonstrated.

The CI definition audits development and production dependencies without suppressing failures. SQL/concurrency qualification is currently manual, pending a clean Linux run; a regular green application job alone does not certify the accounting schema. See [verification status](docs/hardening-2026-10-19.md). Real Auth, PostgREST, Telegram delivery and hosted backup settings still require separate checks.
