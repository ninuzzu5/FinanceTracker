# Supabase

Qui c’è lo schema del database: migrazioni, controlli preliminari e test SQL.
Le migrazioni si applicano a mano dal SQL Editor di Supabase. Né il bot né la
dashboard le eseguono, e il fatto che un file sia nel repository non vuol dire
che sia stato applicato.

Il database fa da contabile: calcola i saldi, impedisce i doppioni, tiene la
storia delle correzioni. I client leggono le proprie righe e scrivono solo
attraverso funzioni SQL.

## Ordine delle migrazioni

| File | Cosa aggiunge |
| --- | --- |
| [001](migrations/001_initial_schema.sql) | Tabelle `accounts` e `transactions`, vincoli su proprietario, direzioni e categorie |
| [002](migrations/002_rls_policies.sql) | RLS: ognuno vede solo le proprie righe, nessun accesso anonimo |
| [003](migrations/003_enforce_transaction_category.sql) | Correzione di un vecchio vincolo sulle categorie. Su un database nuovo si salta |
| [004](migrations/004_account_openings_and_balances.sql) | Saldo iniziale dei conti e funzione `get_account_balances` |
| [005](migrations/005_cash_reconciliation.sql) | Chiusura di cassa dei contanti e rettifiche |
| [006](migrations/006_transaction_idempotency.sql) | Ricevute e `save_transaction_once`: stessa richiesta, un solo movimento |
| [007](migrations/007_monetary_integrity_and_eur.sql) | Importi positivi al centesimo, date valide, solo EUR |
| [008](migrations/008_transaction_management.sql) | Modifica e annullamento dei movimenti con registro delle correzioni |
| [009](migrations/009_restrict_ledger_writes.sql) | Toglie ai client ogni scrittura diretta su conti e movimenti |
| [010](migrations/010_shared_read_access.sql) | Accesso in sola lettura per l’account web, dietro secondo fattore |
| [011](migrations/011_shared_balance_queries.sql) | Funzioni di lettura per la dashboard |

Database nuovo: 001 → 002 → 004 → 005 → … → 011. Il bot ha bisogno di tutto
fino a 009, la dashboard anche di 010 e 011.

## Applicare una migrazione

1. Provo prima su un progetto Supabase di test con dati inventati.
2. Fermo il bot, così non ci sono scritture nel mezzo.
3. Per 007 e 008 eseguo prima il relativo file in `preflight/`: è in sola
   lettura e segnala le righe che farebbero fallire la migrazione.
4. Incollo nel SQL Editor il file intero, `BEGIN` e `COMMIT` compresi, una volta
   sola.
5. Se fallisce non cambia nulla: `ROLLBACK`, capisco il motivo e riprovo. Non
   aggiungo `DROP` per farla passare.
6. Se dopo il bot non trova una funzione nuova: `NOTIFY pgrst, 'reload schema';`.

Le migrazioni non sono rieseguibili: vanno applicate una volta e in ordine. Su
un database già in uso controllo cosa c’è davvero (tabelle, vincoli, policy,
permessi) e applico solo quello che manca.

Per provare una funzione serve una sessione vera dell’utente: dal SQL Editor,
che non ha un utente autenticato, le funzioni rispondono con un errore, ed è
voluto.

## Conti e saldi iniziali

Utenti e conti non sono creati dalle migrazioni. Li preparo a mano:

1. In **Authentication → Users** creo l’utente del bot e, a parte, quello della
   dashboard.
2. In **Table Editor → accounts** aggiungo una riga per conto, con `user_id`
   dell’utente del bot, `name` (`Revolut`, `Isybank`, `Contanti`) e `type`
   (`cash` per i contanti). Il resto resta ai valori predefiniti. Il bot trova
   i conti per nome, quindi niente doppioni.
3. Imposto insieme `opening_balance` e `opening_date`.

Il saldo iniziale è quello **a inizio giornata** della data indicata: i movimenti
di quel giorno contano, quelli precedenti no. Non va registrato anche come
movimento, altrimenti lo conterei due volte. Le banche possono partire in
negativo, i contanti no.

Il saldo di un conto è:

`saldo iniziale + entrate − uscite + trasferimenti ricevuti − inviati + rettifiche`

Non esiste una colonna con il saldo corrente: si ricalcola ogni volta. Un conto
senza saldo iniziale, o interrogato a una data precedente, restituisce `NULL` con
uno stato esplicito (`not_configured`, `before_opening`). `NULL` non è zero.

## Scritture

- **Nuovi movimenti**: `save_transaction_once`. Salva movimento e ricevuta
  insieme. Stessa chiave e stessi dati restituiscono il movimento già salvato;
  stessa chiave con dati diversi è un errore. Il bot ricava la chiave dal
  messaggio Telegram di partenza, senza conservarne il testo.
- **Correzioni**: `manage_transaction_once`. Modifica o annulla un movimento
  controllandone la versione, e salva lo stato prima e dopo in
  `transaction_changes`. Un movimento annullato resta nella tabella ma esce dai
  saldi. Non si cancella nulla.
- **Chiusura di cassa**: `reconcile_cash`. Ricalcola il saldo teorico dei
  contanti, lo confronta con quello contato e registra la differenza in
  `account_adjustments`. Da quel momento i movimenti di contanti fino a quella
  data sono bloccati. La riapertura non esiste.

Queste funzioni verificano da sole chi le chiama e non accettano un utente
passato dal client. Ricevute, correzioni e rettifiche non sono modificabili.

Dopo la 009 non c’è altro modo di scrivere: `INSERT`, `UPDATE` e `DELETE` diretti
sono revocati a tutti i ruoli dei client. Creare un conto o correggere un saldo
iniziale resta un lavoro da amministratore, da fare con calma e annotando cosa è
cambiato. I trigger dei contanti non si disattivano per far passare una modifica.

## Dashboard

La 010 crea uno schema privato, `financetracker_private`, con un registro che
associa l’account web al proprietario dei dati. Parte vuoto: la riga la aggiungo
io a mano dopo aver applicato 010 e 011. Lo schema deve restare fuori da quelli
esposti dall’API.

La 011 aggiunge `get_dashboard_balances` e `get_dashboard_movements`. Rispondono
solo se la sessione ha passato il secondo fattore e l’associazione è attiva.
L’account web non può scrivere in nessun caso. Per togliere l’accesso basta
disattivare la riga del registro.

## Test

I test girano su database temporanei, con dati inventati e senza credenziali.
Non servono dipendenze nel progetto: i due motori si installano in una cartella
temporanea.

```sh
npm ci && npm run build

FT_SQL_RUNTIME="$(mktemp -d)"
npm install --prefix "$FT_SQL_RUNTIME" --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node supabase/tests/run-account-balances.mjs "$FT_SQL_RUNTIME/node_modules/@electric-sql/pglite/dist/index.js"

FT_NATIVE_RUNTIME="$(mktemp -d)"
npm install --prefix "$FT_NATIVE_RUNTIME" --no-save --package-lock=false embedded-postgres@18.4.0-beta.17
node supabase/tests/run-cash-concurrency.mjs "$FT_NATIVE_RUNTIME/node_modules/embedded-postgres/dist/index.js" --b1 --audit
```

Il primo applica le migrazioni in memoria e controlla saldi, chiusure, ricevute,
correzioni, permessi e isolamento tra utenti. Il secondo usa un PostgreSQL vero
per le prove di concorrenza: tentativi simultanei, chiusure che si incrociano
con i movimenti, risposte perse dopo il salvataggio. Girano anche nella
[CI](../docs/ci.md).

Questi test dicono che lo schema nel repository funziona. Non dicono nulla su
com’è configurato il progetto Supabase vero.

## Backup e ripristino

Non ho ancora provato un ripristino completo. Finché non lo faccio, non do per
scontato che i backup di Supabase bastino. Quando lo proverò:

- lo farò su un progetto separato, mai sopra i dati veri;
- controllerò che siano tornati utenti, permessi, movimenti annullati, ricevute
  e chiusure di cassa, e che i saldi coincidano;
- prima di riaccendere il bot rivedrò a mano i movimenti successivi al backup:
  se una ricevuta è andata persa, reinviare un vecchio messaggio creerebbe un
  doppione.

Dopo la 008 non si torna al vecchio codice dei saldi: riconterebbe i movimenti
annullati. Se serve tornare indietro, la strada è una migrazione correttiva.
