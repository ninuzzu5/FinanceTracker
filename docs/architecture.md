# Architecture decisions

## Bot-first delivery

The Telegram flow is the first end-to-end feature because it provides the lowest-friction input method. The web application initially focuses on authentication and visualization.

## Narrow local classifier

The application does not use a general-purpose language model. A small local classifier is limited to a closed set of transaction types and categories. Amount and date extraction remain deterministic.

## Failure behavior

A prediction below the configured confidence threshold is not stored as if it were certain. The bot presents category buttons and waits for confirmation.

## Transfers

A transfer proposal uses `type: "transfer"`, `fromAccount` and `toAccount`, without a single `account` or a category. The domain's discriminated draft union separates transfers from expense/income proposals. Both accounts must be explicitly chosen and different before confirmation; changing type rebuilds the draft without incompatible fields. Parsing and manual editing share this representation.

Proposals are currently memory-only: confirmation neither moves funds nor persists data. Future balance accounting must exclude transfers from income, expense and budget totals; no balance or double-entry implementation exists yet.

## Realtime dashboard

Supabase is the source of truth. When a transaction is committed, an event updates an open dashboard. A dashboard opened later fetches the current state normally; periodic polling is unnecessary.
