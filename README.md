# Finance Tracker

Personal finance tracker designed around a low-friction Telegram bot and a realtime web dashboard.

The local bot accepts short messages such as `8,30 tabacco`, extracts amount, date and account, classifies type/category with deterministic rules, and replies with a preview. **No transaction is saved.** Persistence, budgets and the dashboard are future work.

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
- Type and category currently use deterministic rules; a small local classifier may later handle unknown cases.
- Unknown classifications remain “da confermare”; confirmation buttons are not implemented yet.
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
2. Invia `8,30 tabacco`: riceverai una risposta personale con importo in euro, conto e data in formato giorno/mese/anno, con la dicitura “Solo anteprima: non ho salvato nulla”.
3. Invia `ciao`: riceverai una richiesta di importo valido e un esempio.
4. Puoi anche provare `ieri 12,50 spesa` oppure `20 benzina isybank`.

Arresta con **Ctrl+C** nel terminale. Il bot funziona soltanto mentre il programma è acceso e il Mac è connesso; durante stop o sospensione non risponde. Al riavvio può ricevere messaggi ancora in coda su Telegram.

Accetta esclusivamente messaggi testuali, nuovi o modificati, della chat privata autorizzata. Le altre chat e gli aggiornamenti non supportati vengono ignorati. Non salva movimenti, categorie, budget o lo stato di elaborazione. Il parser usa la grammatica esplicita documentata sotto, senza interpretazione libera del linguaggio naturale.

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

### Grammatica di importi, date e conti

Ogni messaggio descrive una sola anteprima. Maiuscole, accenti nei giorni della settimana, spazi ripetuti e apostrofi dritti/curvi sono normalizzati.

**Importo:** un solo numero positivo, massimo 7 cifre intere e 2 decimali. Esempi: `12`, `12€`, `12 €`, `€12`, `12 EUR`, `EUR 12`, `8,30`, `8.30`. I componenti delle date e il numero in `N giorni fa` non sono importi. Zero, segni, separatori delle migliaia, precisione eccessiva e più importi vengono rifiutati, senza somme o arrotondamenti impliciti. Non scrivere quantità numeriche aggiuntive: `2 mozzarelle 5€` è ambiguo. `eskere` produce un messaggio di importo mancante, mai un'anteprima.

**Date:** il riferimento è il giorno in cui il bot elabora il messaggio, calcolato in `APP_TIMEZONE` (default `Europe/Rome`), mai nel fuso implicito del computer. Vale anche per messaggi modificati o ricevuti dopo un periodo offline. I giorni vengono sottratti come giorni di calendario, anche nei cambi d'ora legale.

Con riferimento a **venerdì 18 settembre 2026**:

| Espressione | Data risultante |
| --- | --- |
| `oggi` / nessuna data | 2026-09-18 |
| `ieri` | 2026-09-17 |
| `l'altro ieri`, `l’altro ieri`, `altro ieri`, `avantieri` | 2026-09-16 |
| `N giorni fa` (N intero ≥ 0), per esempio `3 giorni fa` | 2026-09-15 |
| `una settimana fa` | 2026-09-11 |
| `mercoledì` / `mercoledi` | 2026-09-16 |
| `mercoledì scorso` | 2026-09-16 |
| `mercoledì prossimo` | 2026-09-23 |
| `venerdì` / `venerdì scorso` / `venerdì prossimo` | 2026-09-18 / 2026-09-11 / 2026-09-25 |
| `10/09`, `10-09`, `10/09/2026`, `10-09-2026` | 2026-09-10 |
| `2026-09-10` (ISO) | 2026-09-10 |
| `10 settembre`, `10 settembre 2026` | 2026-09-10 |

Sono supportati tutti i sette giorni della settimana, con o senza accenti, e tutti i dodici mesi italiani per esteso. Giorni e mesi numerici possono avere una o due cifre. Un giorno settimanale senza qualificatore è l'occorrenza più recente, incluso oggi; `scorso` è strettamente precedente e `prossimo` strettamente successivo.

Senza anno si usa sempre l'anno del riferimento: `31/12` a settembre significa dicembre dello stesso anno, senza scegliere automaticamente l'anno passato. Per compatibilità restano validi gli anni italiani a due cifre, interpretati come 2000–2099 (`10/09/26`). Gli anni espliciti a quattro cifre sono validati, così come i giorni del mese e gli anni bisestili. Formati numerici con separatori misti non sono validi.

Una data riconosciuta ma impossibile (`31/02/2026`) o più espressioni di data (`oggi ieri`, anche `mercoledì 16 settembre 2026`) richiedono chiarimento: **non vengono sostituite con oggi**. Le espressioni fuori grammatica non sono interpretate come date; per esempio `domani` non è supportato e rimane testo descrittivo. Se vuoi una data diversa, usa un formato della tabella.

**Conto:** `revolut`, `isybank`, `isy`, `isy bank`, senza distinzione maiuscole/minuscole. Un conto esplicito prevale su `DEFAULT_ACCOUNT`; in sua assenza si usa il default configurato. Se compaiono sia Revolut sia Isybank, il bot chiede un solo conto. I nomi devono essere parole intere, non parti di altre parole. Nessuna interpretazione di trasferimenti tra conti in questa versione.

### Messaggi modificati su Telegram

Il polling richiede sia `message` sia `edited_message`. Se modifichi il testo di un messaggio nella chat privata autorizzata, il bot lo ricalcola e invia **un nuovo messaggio** con “Anteprima aggiornata, bro”: la precedente risposta resta nella chat. Se la modifica non contiene più un importo valido o introduce una data/conto ambiguo, ricevi la relativa richiesta di chiarimento.

L'offset segue `update_id`, non `message_id`: una modifica ha un nuovo aggiornamento pur riferendosi allo stesso messaggio. La gestione rimane solo in memoria e senza persistenza. Anche il webhook usa la stessa elaborazione; un eventuale webhook registrato con un filtro `allowed_updates` deve includere `edited_message` per ricevere le modifiche. La sua configurazione non viene cambiata automaticamente.

### Classificazione iniziale a regole

Il dominio espone `classifyMessage(text)` con `{ type, category, confidence, source }`. Gli identificatori sono stabili e separati dalle etichette italiane. I tipi definiti restano `expense` (Uscita), `income` (Entrata), `transfer` (Trasferimento); questa versione classifica solo uscite ed entrate e non modifica la modellazione dei trasferimenti.

| ID categoria | Etichetta | Tipo |
| --- | --- | --- |
| `groceries` | Spesa | expense |
| `public_transport` | Mezzi di trasporto | expense |
| `flights` | Voli | expense |
| `tobacco` | Tabacco | expense |
| `sport` | Sport | expense |
| `leisure` | Svago & uscite | expense |
| `food` | Cibo | expense |
| `rent` | Affitto | expense |
| `personal_care` | Personal Care | expense |
| `gifts` | Regali | expense / income |
| `subscriptions` | Abbonamenti | expense |
| `holidays` | Vacanze | expense |
| `unexpected` | Imprevisti | expense |
| `salary` | Stipendio | income |
| `personal_projects` | Progetti personali | income |

Gli alias iniziali sono in `packages/domain/src/classification-aliases.ts`. Il classificatore normalizza maiuscole, accenti, apostrofi e punteggiatura separatamente dal parser, preservando la grammatica di importi/date. Cerca parole o frasi complete: `bar` non corrisponde a `barca`. Le espressioni specifiche prevalgono sugli alias contenuti: `abbonamento palestra` → Sport, `spesa al ristorante` → Cibo. Evidenze indipendenti in conflitto restano da confermare, senza scegliere la prima corrispondenza.

Spesa indica supermercati, alimentari e prodotti per la casa; Cibo indica bar, ristoranti e pasti fuori. Voli è separato da Mezzi di trasporto e Vacanze: `ryanair` e `volo per vacanza` → Voli, `hotel` → Vacanze. `volo e hotel` contiene due categorie e rimane da confermare. Imprevisti richiede un alias esplicito, non è una categoria residuale.

Per i regali il contesto direzionale prevale sull'oggetto: `regalo per Marco` / `comprato regalo` → Uscita · Regali; `regalo ricevuto` / `mi hanno regalato` / `regalo da Marco` → Entrata · Regali. `regalo 50` → tipo da confermare, categoria Regali. Indicazioni di acquisto e ricezione insieme restano ambigue.

Una corrispondenza completa non in conflitto ha `source: "rule"` e `confidence: 0.98`; è un punteggio convenzionale della regola, non una probabilità statistica. Un risultato incompleto o conflittuale usa `source: "unknown"`, confidenza 0 e almeno un campo `null`; le informazioni comuni alle regole possono restare note. `12 eskere` conserva l'anteprima di importo/data/conto con tipo e categoria “da confermare”. Non sono implementati pulsanti o salvataggi.

Queste sono regole lessicali per messaggi brevi, non comprensione del linguaggio naturale: negazioni, rimborsi e contesti complessi non sono interpretati. Gli alias sono volutamente essenziali. Un futuro classificatore locale potrà intervenire dopo un risultato sconosciuto, estendendo `ClassificationSource` con `model`; non è implementato né addestrato ora e non cambierà importo, data o conto. Nessuna API AI esterna e nessun dato personale nel repository: solo esempi sintetici nei test.

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
