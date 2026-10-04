# Architecture decisions

## Bot-first delivery

The Telegram flow is the first end-to-end feature because it provides the lowest-friction input method. The web application initially focuses on authentication and visualization.

## Narrow local classifier

The application does not use a general-purpose language model. A small local classifier is limited to a closed set of transaction types and categories. Amount and date extraction remain deterministic.

## Failure behavior

A prediction below the configured confidence threshold is not stored as if it were certain. The bot presents category buttons and waits for confirmation.

## Transfers

A transfer proposal uses `type: "transfer"`, `fromAccount` and `toAccount`, without a single `account` or a category. The domain's discriminated draft union separates transfers from expense/income proposals. Both accounts must be explicitly chosen and different before confirmation; changing type rebuilds the draft without incompatible fields. Parsing and manual editing share this representation.

Proposals remain in memory until confirmation. Confirmation emits a persistence effect handled by the delivery layer; the repository authenticates a Supabase user, resolves active owned accounts and inserts one transaction. Success closes the proposal before sending the reply. Failure retains it until its normal expiry. Concurrent confirmation clicks are blocked in the current process. Future balance accounting must exclude transfers from income, expense and budget totals; no balance or double-entry implementation exists yet.

## Realtime dashboard

Supabase is the source of truth. When a transaction is committed, an event updates an open dashboard. A dashboard opened later fetches the current state normally; periodic polling is unnecessary.

## Supabase 02

`persistence.ts` defines the repository contract, explicit domain mapping and sanitized errors without importing the Supabase SDK. `supabase.ts` implements the contract with an anonymous public key and password authentication on the same client used for queries. Sessions stay in memory; missing or nearly expired sessions trigger password login, and `getUser` validates ownership before each save. RLS applies to all reads and writes. No service role, schema migrations or account creation are used.

Account names are matched case-insensitively after trimming, only among active accounts owned by the authenticated user. Missing or ambiguous names fail before insertion. Expense uses the source account, income the destination, transfer both distinct accounts and a null category. Description is omitted because proposals do not retain original text.

No automatic insert retry or durable idempotency is implemented. A lost database response may leave an uncertain write; the user must inspect the database before retrying. A successful insert followed by failed Telegram delivery remains persisted. Local single-process polling is the supported workflow; webhook memory does not coordinate multiple instances.
