# Finance Tracker

Personal finance tracker designed around a low-friction Telegram bot and a realtime web dashboard.

The bot accepts short messages such as `8,30 tabacco`, extracts only the financial information the application understands, validates it and stores the transaction. The dashboard then updates balances, budgets and charts.

## Project status

Early MVP development. The first milestone is:

```text
Telegram message
  → deterministic amount/date parsing
  → category/type classification
  → validation
  → Supabase insert
  → confirmation with remaining budget
```

## Principles

- No calls to external AI APIs.
- Amounts and dates are parsed using deterministic rules.
- A small local classifier will handle only transaction type and category.
- Low-confidence predictions require explicit user confirmation.
- Transfers affect account balances but never income or expense totals.
- Personal transactions and secrets never belong in this repository.

## Repository structure

```text
apps/
  bot/        Telegram bot and webhook
  web/        React dashboard (next phase)
packages/
  domain/     Shared parsing and financial domain rules
supabase/     Database schema, policies and safe example seeds
model/        Training code and non-personal example data
docs/         Architecture and project decisions
```

## Local development

Requirements: Node.js 22 or newer.

```bash
npm install
npm test
npm run typecheck
```

Copy `.env.example` to `.env.local` only when integrations are configured. Never commit the resulting file.

## Security and privacy

This is intended to be a public repository. Only source code, synthetic examples and safe configuration templates are allowed. Read [SECURITY.md](SECURITY.md) before publishing data, model artifacts or deployment configuration.

## Roadmap

1. Telegram bot and webhook skeleton.
2. Deterministic acquisition of amount, date and account.
3. Local category/type classifier with confidence threshold.
4. Supabase persistence with RLS.
5. React dashboard.
6. Realtime dashboard updates.

## License

No open-source license has been selected yet. All rights are reserved until a license is added.
