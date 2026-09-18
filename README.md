# Finance Tracker

Personal finance tracker designed around a low-friction Telegram bot and a realtime web dashboard.

The local bot accepts short messages such as `8,30 tabacco`, extracts amount, date and account, and replies with a preview. **No transaction is saved.** Classification, persistence, budgets and the dashboard are future work.

## Project status

Local preview MVP available through Telegram long polling. The future end-to-end milestone is:

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
npm run build
npm test
npm run typecheck
```

### Bot Telegram locale (Mac)

Dalla root del progetto, configura privatamente `.env.local`. Se il file esiste già, mantienilo; altrimenti crealo partendo da `.env.example`.

- `TELEGRAM_BOT_TOKEN`: token fornito da BotFather (obbligatorio).
- `TELEGRAM_ALLOWED_CHAT_ID`: ID numerico positivo della tua chat privata (obbligatorio).
- `APP_TIMEZONE`: fuso orario, predefinito `Europe/Rome`.
- `DEFAULT_ACCOUNT`: `revolut` (predefinito) oppure `isybank`.

Il programma carica `.env.local` a runtime tramite `process.loadEnvFile`, nativo di Node.js 22+. Le variabili già presenti nell'ambiente della shell hanno precedenza. Il file è escluso da Git: non pubblicare token, ID o contenuto del file. Per il polling non servono webhook secret, Supabase o hosting. La validazione locale controlla formato e presenza delle impostazioni; Telegram verifica il token alla prima richiesta.

Avvia dalla root:

```bash
npm run bot:dev
```

Il comando compila il progetto e avvia una singola istanza del bot. Per applicare modifiche al codice, arrestalo e rilancia il comando. All'avvio verifica `getWebhookInfo`: se esiste un webhook, si ferma senza cancellarlo. Per passare al polling occorre disattivare esplicitamente il webhook. Un conflitto con un'altra istanza di polling interrompe il programma: tieni attiva una sola istanza.

Quando compare “Bot locale attivo”, apri la chat privata con `@niuzzu_bot`:

1. Invia `/start` o `/help`: riceverai una breve guida con esempi.
2. Invia `8,30 tabacco`: riceverai importo in euro, conto e data, con la dicitura “Il movimento NON è stato salvato”.
3. Invia `ciao`: riceverai una richiesta di importo valido e un esempio.
4. Puoi anche provare `ieri 12,50 spesa` oppure `20 benzina isybank`.

Arresta con **Ctrl+C** nel terminale. Il bot funziona soltanto mentre il programma è acceso e il Mac è connesso; durante stop o sospensione non risponde. Al riavvio può ricevere messaggi ancora in coda su Telegram.

Accetta esclusivamente messaggi testuali della chat privata autorizzata. Le altre chat e gli aggiornamenti non supportati vengono ignorati. Non salva movimenti, categorie, budget o lo stato di elaborazione. Il parser di date/importi mantiene i limiti attuali: riconosce un singolo importo e le date supportate, non interpreta liberamente il linguaggio naturale; una data esplicita impossibile ricade sulla data predefinita.

L'offset è mantenuto **solo in memoria durante la sessione** e avanza dopo l'elaborazione o lo scarto di un aggiornamento. Non è idempotenza persistente: un arresto prima della conferma dell'offset, oppure un invio riuscito con risposta di rete persa, può produrre una risposta duplicata. La deduplicazione persistente verrà introdotta con il database.

Le chiamate hanno timeout di 40 secondi (long polling Telegram di 30 secondi). Rete, risposte malformate, errori server e rate limit ricevono fino a 5 tentativi totali, con pause esponenziali e rispetto di `retry_after`. Esauriti i tentativi il bot termina con un errore sintetico: controlla la connessione e riavvialo. Ctrl+C interrompe anche richieste e pause. I log non includono token, URL del bot, chat ID o testo dei messaggi.

I test automatici usano trasporto simulato e non caricano `.env.local` né contattano Telegram. Il webhook resta disponibile e condivide elaborazione e trasporto con il bot locale; non usarlo contemporaneamente al polling.

Verifiche e audit separato per produzione/sviluppo:

```bash
npm run build
npm run typecheck
npm test
npm audit --omit=dev
npm audit --include=dev
```

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
