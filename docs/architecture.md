# Architecture decisions

## Bot-first delivery

The Telegram flow is the first end-to-end feature because it provides the lowest-friction input method. The web application initially focuses on authentication and visualization.

## Narrow local classifier

The application does not use a general-purpose language model. A small local classifier is limited to a closed set of transaction types and categories. Amount and date extraction remain deterministic.

## Failure behavior

A prediction below the configured confidence threshold is not stored as if it were certain. The bot presents category buttons and waits for confirmation.

## Transfers

A transfer records both a source and a destination account. It changes their balances but is excluded from income, expense and budget calculations.

## Realtime dashboard

Supabase is the source of truth. When a transaction is committed, an event updates an open dashboard. A dashboard opened later fetches the current state normally; periodic polling is unnecessary.
