# Supabase

This directory versions the Supabase 01 application schema and ownership policies. Migrations 001 and 002 are a baseline for a fresh Supabase database. Migration 003 is the separate category-constraint correction for an existing database. Migration 004 adds optional account openings and authenticated balance calculation. Migration 005 adds cash reconciliation and protection of closed cash days. No migration has been applied remotely by this task.

## Migration order

1. `migrations/001_initial_schema.sql` creates `public.accounts` and `public.transactions`, their defaults, primary keys, user foreign keys, account foreign keys, composite ownership foreign keys, and transaction checks.
2. `migrations/002_rls_policies.sql` explicitly enables RLS on both tables, grants CRUD privileges to the `authenticated` role, and creates separate SELECT, INSERT, UPDATE and DELETE policies for each table.
3. `migrations/003_enforce_transaction_category.sql` replaces only `transactions_category_by_type_check` in legacy databases where that constraint exists but does not enforce the correct category rule. Skip 003 for fresh databases created with the corrected 001 and for the existing Supabase project: its constraint has already been verified as correct, so no migration is needed.

4. `migrations/004_account_openings_and_balances.sql` incrementally adds nullable opening fields and `get_account_balances(date)`. It needs the existing accounts/transactions schema and RLS, not legacy migration 003.
5. `migrations/005_cash_reconciliation.sql` requires 004 and adds separate adjustment records, authenticated reconciliation RPCs and closure guards.

Apply the baseline files 001 and 002 once, in order, as part of provisioning a new database, before exposing application access. They intentionally fail if the tables or policies already exist. Each file is transactional. Do not replay this baseline against the existing Supabase project; reconciling an existing database with migration history is separate work.

## Prerequisites and boundaries

The target must already provide Supabase Auth, `auth.users`, `auth.uid()`, the `authenticated` role and `gen_random_uuid()`. These files version the application tables and policies; they do not recreate Supabase's managed Auth infrastructure or project-level Auth settings. The SQL must be applied by a database administrator with the required DDL privileges, separately from normal bot access.

No users, accounts, transactions or seeds are inserted. Real Auth users and account rows must be provisioned privately. Revolut, Isybank and Contanti are conceptual account names used by the bot; their UUIDs are resolved from active rows owned by the authenticated user, never hardcoded.

The schema follows the DDL supplied for Supabase 01, with one reviewed correction: the category CHECK explicitly requires `category IS NOT NULL` for expense/income, together with a category valid for that type. For transfers the category must be NULL and the two accounts must be distinct. The column remains nullable to support transfers; `description` also remains nullable. Category identifiers match the domain taxonomy. No other schema or application behavior is changed.

`created_at` and `updated_at` have insertion defaults only. No automatic timestamp-update trigger is introduced. The policy names in this baseline are descriptive local names; names and grants have not been compared to the remote catalog. The supplied ownership model is preserved: SELECT and DELETE use `USING`, INSERT uses `WITH CHECK`, and UPDATE uses both, preventing changes to another owner's user ID. Composite foreign keys prevent references to another user's accounts. No policy authorizes anonymous users, and RLS is never disabled.

## Existing database: category preflight and migration 003

Do not replay 001 or 002 on the existing project. Before manually applying 003, run this read-only query privately with an administrative SQL connection that can see all rows, not a user session restricted by RLS:

```sql
select type, count(*) as incompatible_rows
from public.transactions
where type in ('expense', 'income')
  and category is null
group by type;
```

No rows means no NULL-category expense/income rows were found. If counts are returned, stop: 003 will fail until those rows are reviewed and corrected explicitly by the owner. Neither the query nor the migration changes or deletes any data automatically.

Only for a legacy database with an incorrect `transactions_category_by_type_check`, after the preflight, apply `003_enforce_transaction_category.sql` once through the separately authorized database administration workflow. It drops only `transactions_category_by_type_check` and adds its corrected definition in one transactional ALTER TABLE. Adding the constraint validates all existing rows; concurrent incompatible writes before validation can still make it fail. A failure rolls back the replacement and preserves the previous constraint. Validation takes a table lock, so choose an appropriate maintenance window for a populated database.

This task prepares the query and migration only: neither has been executed, and no database credentials are required to review these files. Existing-database migration history reconciliation remains separate work.

## Supabase 02 access

The bot uses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_USER_EMAIL` and `SUPABASE_USER_PASSWORD`. It signs in as the dedicated Auth user and uses that session for account queries and transaction inserts, subject to RLS. Normal bot access never uses a secret/service-role key.

Real values stay in the ignored `.env.local` file or private runtime environment. There are no personal UUIDs, credentials, financial records or balances in these migrations.

## Validation

Normal application tests mock the SDK and never contact the real database. See [the bot guide](../docs/bot-guide.md) for manual application checks. Migration 004 and its balance/RLS assertions are executed in disposable embedded PostgreSQL (PGlite), with a minimal local Supabase Auth contract. Hosted Supabase Auth and the remote catalog are not tested. The SQL runner is separate from the default Vitest suite and CI; it never reads credentials or connects to a remote database.


## Configurazione manuale del conto Contanti

Lo schema verificato è quello versionato in `migrations/001_initial_schema.sql`.
Non è stata verificata la corrispondenza con il catalogo del database remoto.
`public.accounts` richiede `user_id`, `name`, `type`; le altre colonne hanno default.
`type` è testo obbligatorio senza CHECK/enum nello schema locale. Dopo la migrazione 004
i campi di apertura esistono, ma possono restare entrambi NULL quando crei il conto.

Nel progetto Supabase corretto:

1. Apri **Authentication → Users** e individua l'utente Auth usato dal bot
   (quello configurato privatamente in `SUPABASE_USER_EMAIL`). Copia il suo UUID,
   non l'ID della chat Telegram. Deve coincidere con il proprietario dei conti esistenti.
2. Apri **Table Editor → schema public → accounts**. Verifica le colonne e i
   default contro la tabella seguente, e controlla che per questo utente non
   esista già un conto attivo chiamato Contanti. Se esiste, non crearne un duplicato.
3. Se manca, premi **Insert → Insert row**, compila i campi e salva la riga:

| Colonna | Valore |
| --- | --- |
| `user_id` | UUID dell'utente Auth dedicato al bot (obbligatorio, senza default) |
| `name` | `Contanti` (obbligatorio, senza default) |
| `type` | `cash` (obbligatorio, senza default; valore scelto per un conto di cassa) |
| `currency` | `EUR` (default) |
| `is_active` | `true` (default; necessario per la risoluzione del bot) |
| `id` | Lascia il default `gen_random_uuid()`; non inserire `null` |
| `created_at` | Lascia il default `now()` |
| `updated_at` | Lascia il default `now()` |

Per i campi generati mantieni i default nel form, senza impostare NULL esplicitamente.
Se lo schema remoto presenta vincoli diversi, verifica quei vincoli prima di salvare.
Il repository abbina `name` ignorando maiuscole/minuscole e spazi esterni; gli alias
`cash` e `liquidi` sono interpretati solo dal parser e non sono nomi alternativi della
riga nel database. Serve una sola riga attiva Contanti per il proprietario.
L'UUID viene risolto a ogni salvataggio: non va aggiunto alla configurazione del bot.
RLS e vincoli di proprietà restano applicati.

Questa operazione crea soltanto un conto: non inserire transazioni iniziali o
saldi inventati. Per configurare un'apertura verificata, segui la sezione Milestone 1. Il bot non crea automaticamente la riga remota.

Riferimenti per l'interfaccia: [inserimento di righe dal Table Editor](https://supabase.com/docs/guides/database/arrays)
e [utenti Auth nel Dashboard](https://supabase.com/docs/guides/auth/managing-user-data).


## Milestone 1: apertura e saldo teorico

La migrazione incrementale è `migrations/004_account_openings_and_balances.sql`.
Aggiunge a `accounts` `opening_balance numeric` e `opening_date date`, entrambi
nullable, senza default monetario. Devono essere presenti entrambi oppure assenti
entrambi. L'apertura è il saldo **all'inizio** del giorno indicato: movimenti della
stessa giornata inclusi, precedenti esclusi. Per un saldo rilevato a fine giornata,
usa il giorno successivo come data di apertura. Non inserire anche una transazione
iniziale: conteresti due volte lo stesso denaro.

Le aperture bancarie possono essere negative. Contanti non può avere apertura
negativa, riconosciuto da `lower(trim(name)) = 'contanti'` oppure `type = 'cash'`
(ignorando maiuscole e spazi esterni). Il saldo teorico successivo può invece diventare
negativo: il calcolo non inventa disponibilità e non blocca la registrazione dei movimenti.
Aperture e date infinite/NaN sono rifiutate. `numeric` non ha un typmod di scala:
un CHECK rifiuta valori con frazioni di centesimo senza arrotondarli automaticamente.

### Preflight di sola lettura, prima di applicare 004

Il catalogo remoto non è stato verificato. Esegui privatamente nel SQL Editor del
progetto corretto queste interrogazioni di soli metadati e conteggi:

```sql
show server_version;
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('accounts', 'transactions')
order by table_name, ordinal_position;

select c.relname, c.relrowsecurity, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_class c join pg_namespace n on n.oid = c.relnamespace
left join pg_constraint con on con.conrelid = c.oid
where n.nspname = 'public' and c.relname in ('accounts', 'transactions');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('accounts', 'transactions');

select routine_name, routine_type
from information_schema.routines
where routine_schema = 'public' and routine_name = 'get_account_balances';

select count(*) as incompatible_amounts
from public.transactions
where amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
   or amount <= 0 or amount <> round(amount, 2);
```

È richiesto PostgreSQL 14+ per i valori speciali numeric usati nei controlli.
Confronta colonne, ownership/FK, direzioni, categorie e policy con 001/002. Verifica
che `opening_balance`, `opening_date` e `get_account_balances` non esistano già.
Se esistono o i vincoli differiscono, **fermati e confronta lo schema**: non cancellare
oggetti e non rilanciare baseline/003 per risolvere il conflitto. La 004 non usa
`IF NOT EXISTS` o `CREATE OR REPLACE`, così un conflitto non viene nascosto.
Se il conteggio monetario è diverso da zero, esamina privatamente quei dati prima
di abilitare il calcolo: nessuna correzione automatica è prevista.

### Applicazione manuale e configurazione

1. Dopo il preflight, prova 004 prima in un progetto/database di test separato.
2. Nel progetto da configurare, apri **SQL Editor**, incolla l'intero file 004 ed
   eseguilo una sola volta con privilegi amministrativi. Il file è transazionale,
   aggiunge solo campi/vincoli e una funzione; non cambia transazioni né RLS.
   Se la migrazione fallisce, il rollback preserva lo stato precedente. Non rilanciare
   001/002 su un progetto esistente. L'ALTER richiede un lock sulla tabella accounts.
3. **Table Editor → public.accounts**: per ciascun conto dell'utente del bot,
   imposta insieme `opening_balance` e `opening_date`, con importo reale verificato
   per quella data. Se non conosci l'apertura, lascia entrambi NULL. Gli UUID restano
   quelli esistenti. Una modifica successiva dell'apertura ricalcola tutta la serie;
   tracciamento delle aperture e riconciliazioni sono fuori da questa milestone.

### Lettura autenticata

La RPC è `get_account_balances`, con parametro obbligatorio `p_as_of` (`YYYY-MM-DD`).
Un client Supabase **già autenticato come proprietario** può invocare
`client.rpc('get_account_balances', { p_as_of: '2026-10-03' })`.
Il bot continua a inserire movimenti; nessun nuovo comando di apertura o saldo è
aggiunto in questa milestone. La configurazione delle aperture è manuale.

La funzione è `SECURITY INVOKER`, con search_path vuoto, RLS e filtri espliciti su
`auth.uid()`. Non accetta un user_id dal client. EXECUTE è concesso solo ad
`authenticated`, revocato a PUBLIC e anon. Un ruolo autenticato senza uid viene
rifiutato. Una chiamata amministrativa nel SQL Editor priva di JWT non rappresenta
una sessione utente valida e restituisce errore: verifica la RPC tramite autenticazione
Supabase, non impostando claim artificiali nel progetto reale.

Ogni riga contiene `account_id`, `account_name`, `currency`, `is_active`,
`opening_date`, `opening_balance`, `as_of_date`, `status`, `balance`:

| Stato | Saldo |
| --- | --- |
| `not_configured` | NULL: apertura assente, anche in presenza di transazioni |
| `before_opening` | NULL: data richiesta precedente all'apertura |
| `configured` | Apertura + entrate − uscite + trasferimenti ricevuti − inviati |

Gli intervalli sono inclusivi su entrambe le estremità. I conti inattivi restano
visibili; un utente senza conti ottiene una lista vuota. Non esiste una colonna di
saldo corrente. Aggiornare o cancellare un movimento ricalcola le letture successive.
Ogni lato del trasferimento usa l'apertura del proprio conto: con date diverse un
trasferimento può ricadere soltanto nell'intervallo di uno dei due conti. La compensazione
nel patrimonio si verifica quando entrambi i lati sono inclusi.

Gli aggregati sono calcolati esattamente in PostgreSQL, poi presentati a due decimali.
La funzione rifiuta importi incompatibili **solo nei movimenti del chiamante inclusi
nel calcolo** (errore 22003), senza alterare o arrotondare righe storiche. Il parser
esistente accetta già al massimo due decimali; la persistenza verifica ora anche
questo contratto, usando conversione a centesimi sicuri senza moltiplicazione floating
point. Il payload resta numerico e identico: 0.29 si serializza come 0.29.
Evita somme monetarie con `Number` nel futuro client: l'aggregazione è responsabilità
SQL. I trasferimenti tra valute diverse sono rifiutati (22023); non esiste conversione
FX. Per il patrimonio dei tre conti usa EUR e non sommare valute diverse.

### Test senza dati reali né aperture arbitrarie

Il runner `tests/run-account-balances.mjs` avvia PostgreSQL in memoria, con una
simulazione minima di auth.uid/users/ruoli, applica 001, 002 e 004 e verifica anche
che le transazioni preesistenti rimangano identiche. Non legge `.env`, non contatta
Supabase e non usa un database su disco. Gli importi sintetici dei test non sono
valori da trasferire ai conti personali. Nessuna modalità demo/reale è introdotta.

Per eseguire i test SQL senza aggiungere dipendenze al progetto:

```sh
npm install --prefix /private/tmp/financetracker-sql-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node supabase/tests/run-account-balances.mjs /private/tmp/financetracker-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js
npm test
npm run typecheck
npm run build
```

Su sistemi diversi da macOS usa una cartella temporanea equivalente. È possibile
eseguire `tests/account_balances.sql` anche su PostgreSQL/Supabase **isolato e usa e
getta**, dopo le migrazioni e impostando `financetracker.test_database = 'isolated'`.
Il file usa fixture con UUID sintetici, cambia ruoli soltanto nella sessione di test
e termina con ROLLBACK. Non usarlo nel progetto con dati personali.

Risultati di riferimento dei test, con aperture sintetiche Isybank −10 €, Revolut
20 €, Contanti 0 €, tutte al 1 ottobre 2026:

- Entrate Isybank 0.10 e 0.20 €, uscita 0.01 € il giorno di apertura: saldo −9.71 €;
  l'entrata di 999 € del giorno precedente non conta.
- Trasferimento Revolut → Contanti 2.50 € il 2 ottobre: 17.50 € e 2.50 €.
- Trasferimento Contanti → Isybank 1.25 € il 3 ottobre: 1.25 € e −8.46 €.
- Totale dei tre conti: 10.29 €, invariato dai trasferimenti; entrata del 4 ottobre
  esclusa dalla lettura del 3 ottobre. Il quarto conto senza apertura restituisce NULL.

Sono coperti anche precisione, aperture negative/rifiutate, date diverse, conti
inattivi, modifiche retroattive, RLS tra due utenti, accesso anonimo e JWT assente.
La verifica locale non certifica il catalogo o l'infrastruttura Auth remoti.

## Milestone 2: riconciliazione Contanti

La migrazione `migrations/005_cash_reconciliation.sql` va applicata **dopo 004**.
Nessuna migrazione di questa task è stata eseguita sul progetto remoto.

### Controlli e applicazione manuale

1. In **Supabase → progetto corretto → SQL Editor**, verifica prima solo i metadati:

   ```sql
   select to_regclass('public.account_adjustments') as existing_adjustments;
   select pg_get_functiondef('public.get_account_balances(date)'::regprocedure);
   select relname, relrowsecurity from pg_class
   where oid in ('public.accounts'::regclass, 'public.transactions'::regclass);
   select tablename, policyname, roles, cmd, qual, with_check
   from pg_policies where schemaname = 'public'
     and tablename in ('accounts','transactions');
   select conname, pg_get_constraintdef(oid)
   from pg_constraint where conrelid in ('public.accounts'::regclass,'public.transactions'::regclass);
   select proname, pg_get_function_identity_arguments(oid)
   from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('preview_cash_reconciliation','reconcile_cash',
       'guard_reconciled_cash_transactions','guard_reconciled_cash_accounts','guard_adjustment_changes');
   select tgname, pg_get_triggerdef(oid) from pg_trigger
   where not tgisinternal and tgrelid in ('public.accounts'::regclass,'public.transactions'::regclass);
   ```

2. Confronta la RPC con 004, i vincoli/ownership con 001/004 e le policy con 002.
   `account_adjustments` e le nuove funzioni/trigger devono essere assenti, RLS attiva.
   Il preflight integrato controlla RLS, firma/stabilità della RPC e presenza dei
   vincoli di apertura; **non certifica policy personalizzate o l'intero schema remoto**.
   Se ci sono differenze o oggetti già esistenti, fermati e confrontali: non eliminarli
   né rilanciare le vecchie migrazioni. Il catalogo remoto non è stato verificato.
3. Prova prima su un progetto Supabase di test separato. Ferma temporaneamente il bot
   durante l'allineamento. Nel SQL Editor, con ruolo amministrativo fidato, incolla
   **l'intero file 005**, incluso BEGIN/COMMIT, ed eseguilo una sola volta. Non servono
   seed, modifiche alle transazioni o nuovi saldi iniziali. La migrazione è transazionale;
   un errore richiede ROLLBACK nella sessione prima di procedere. La creazione dei trigger
   richiede lock DDL: scegli una finestra senza scritture dell'applicazione.
4. Verifica tabella, policy e funzioni create; distribuisci/riavvia il bot aggiornato.
   Se PostgREST segnala una funzione non trovata dopo l'applicazione, attendi il refresh
   del catalogo; se necessario esegui `NOTIFY pgrst, 'reload schema';` nel SQL Editor.
   Non applicare 001/002/004 nuovamente a un database già allineato.

### Modello contabile, autorizzazioni e limiti

`account_adjustments` conserva UUID, proprietario, conto, data effettiva, differenza
firmata (`delta`), saldo dichiarato (`observed_balance`), chiave UUID della richiesta,
`created_at` e `voided_at`. Quest'ultimo è predisposto per il tracciamento futuro:
**annullare una rettifica già confermata non è disponibile**. UPDATE/DELETE delle
rettifiche sono bloccati; non si perde la traccia storica. Annulla in Telegram interrompe
solo il flusso, e un esito incerto può già corrispondere a una scrittura completata.

La tabella ha RLS di lettura per proprietario. I client autenticati non hanno permessi
di INSERT/UPDATE/DELETE. Solo `reconcile_cash` scrive, come SECURITY DEFINER con
search_path vuoto e controlli espliciti di `auth.uid()`, proprietà, apertura, conto
Contanti attivo e EUR. Non accetta un user_id esterno. È necessario mantenere la
funzione sotto un proprietario amministrativo fidato. `preview_cash_reconciliation`
e `get_account_balances` restano SECURITY INVOKER, con filtri espliciti e RLS;
anche i trigger di protezione dei movimenti/conti rispettano i privilegi del chiamante.
Nessun accesso RPC è concesso ad anon/PUBLIC; un JWT assente è rifiutato.

Il saldo è apertura + movimenti + rettifiche non annullate nell'intervallo inclusivo.
Non esiste saldo corrente memorizzato. La RPC di conferma blocca la riga Contanti,
ricalcola il teorico e confronta il saldo mostrato nell'anteprima: se è cambiato,
non scrive e richiede una nuova anteprima. La differenza può essere positiva,
negativa o zero; il saldo dichiarato non può essere negativo. SQL usa `numeric`
con CHECK sui centesimi, senza arrotondare valori incompatibili. Le RPC di
riconciliazione trasportano importi come stringhe decimali; il bot usa BigInt per
calcolare/mostrare la differenza, senza somme floating point.

Il giorno è chiuso **a fine giornata, Europe/Rome**, includendo tutti i movimenti
con quella data. Il bot offre oggi o ieri; chiudere oggi significa non poter più
registrare movimenti Contanti oggi. Una chiusura blocca nuovi movimenti, modifiche
e cancellazioni fino a quella data, su entrambe le direzioni dei trasferimenti e
sui riferimenti vecchi/nuovi. Blocca anche modifiche all'apertura, nome, tipo,
proprietario o valuta del conto riconciliato. Movimenti bancari senza Contanti e
movimenti Contanti di giornate successive restano disponibili. Cambiare `is_active`
resta possibile. La riapertura verrà gestita in una milestone distinta.

I trigger e la RPC condividono il lock del conto. La chiave univoca per utente
rende idempotente il ritentativo con stesso payload; una chiave riutilizzata con
dati diversi è rifiutata. Un indice univoco impedisce due rettifiche attive nello
stesso giorno/conto, anche con chiavi diverse. Le scritture Contanti richiedono
READ COMMITTED, il livello normale PostgREST; livelli con snapshot persistenti
sono rifiutati per evitare controlli su chiusure non aggiornate.

Il flusso Telegram usa lo store esistente in memoria, con scadenza di 30 minuti:
un riavvio perde la conversazione. Il database conserva l'idempotenza e la chiusura,
ma non c'è ancora un comando per recuperare una ricevuta dopo un riavvio. Le richieste
HTTP hanno timeout di 15 secondi; un timeout non garantisce rollback sul server.
Il pulsante di ritentativo mantiene richiesta e chiave; Annulla non cancella scritture
incerte. La duplicazione rimane impedita dal database anche dopo un riavvio.

### Verifica automatica isolata

`run-account-balances.mjs` applica anche 005, riesegue i test 004 contro la nuova RPC,
e verifica `cash_reconciliation.sql`: date, centesimi, rettifiche positive/negative/
zero, replay, proprietà, RLS, anon/JWT assente e protezioni retroattive. Tutte le
fixture sono sintetiche e terminano con ROLLBACK.

Per la concorrenza serve PostgreSQL nativo con sessioni distinte. Nessuna dipendenza
è aggiunta al progetto: puoi installare il runtime in una cartella temporanea.

```sh
npm install --prefix /private/tmp/financetracker-concurrency-runtime --no-save --package-lock=false embedded-postgres@18.4.0-beta.17
node supabase/tests/run-cash-concurrency.mjs /private/tmp/financetracker-concurrency-runtime/node_modules/embedded-postgres/dist/index.js
```

Lascia abilitati gli script di installazione del runtime: ripristinano i symlink
necessari ai binari. Il runner crea un nuovo cluster temporaneo, solo socket Unix
locale, senza TCP o URL remoti, e lo elimina al termine. Sono verificati cinque
casi con attesa reale del lock: stesso request_id, movimento dopo una riconciliazione,
conferma dopo un movimento, chiavi concorrenti diverse e rollback della chiusura.
È verificato anche il rifiuto di REPEATABLE READ. Su sistemi senza socket Unix il
runner va adattato; non sostituirne la destinazione con un database personale.

Per verifiche manuali usa solo un progetto di test separato e un'apertura documentata
per quell'ambiente. Gli importi delle fixture non sono suggerimenti per i tuoi conti.
Dopo conferma controlla che sia comparsa **una riga account_adjustments** e nessuna
nuova riga transactions, e leggi get_account_balances con la sessione autenticata
reale dell'utente di test. Non simulare claim nel progetto personale.

## B1: ricevute persistenti dei movimenti — migrazione 006

`migrations/006_transaction_idempotency.sql` richiede 005. Crea soltanto
`transaction_receipts`, policy/trigger di protezione e due RPC. Non modifica,
riclassifica o assegna chiavi alle transazioni storiche. Il runner verifica che
anche una riga storica con precisione non compatibile rimanga identica.

### Applicazione manuale esatta

1. Ferma il bot e verifica/risolvi privatamente gli esiti incerti della vecchia
   versione prima di distribuirne una nuova. I vecchi salvataggi non hanno ricevute:
   la migrazione non può deduplicarli retroattivamente.
2. Nel progetto corretto, **SQL Editor**, esegui solo questo preflight di metadati:

   ```sql
   select to_regclass('public.transaction_receipts') as existing_receipts;
   select to_regprocedure('public.reconcile_cash(uuid,date,numeric,numeric,uuid)') as migration_005;
   select relname, relrowsecurity from pg_class
   where oid in ('public.accounts'::regclass,'public.transactions'::regclass);
   select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid in ('public.accounts'::regclass,'public.transactions'::regclass);
   select tablename, policyname, roles, cmd, qual, with_check from pg_policies
   where schemaname='public' and tablename in ('accounts','transactions');
   select proname, pg_get_function_identity_arguments(oid) from pg_proc
   where pronamespace='public'::regnamespace
     and proname in ('save_transaction_once','get_transaction_receipt','guard_transaction_receipts');
   ```

3. Verifica che 005 sia installata, RLS attiva, ownership e vincoli coerenti con
   001/002/005 e che gli oggetti 006 siano assenti. Il catalogo remoto non è stato
   verificato da questa task. Se è diverso, fermati e confrontalo; non cancellare
   oggetti e non rilanciare le migrazioni baseline.
4. Prova prima in un progetto Supabase di test separato. Poi, con un amministratore
   fidato, incolla ed esegui **l'intero file 006**, BEGIN/COMMIT inclusi, una sola
   volta. La migrazione è transazionale. In caso di errore esegui ROLLBACK nella
   sessione prima di riprovare. Il nuovo FK richiede normali lock DDL sulla tabella
   transazioni; scegli una finestra senza scritture.
5. Verifica tabella/RLS/policy e funzioni. Se PostgREST non trova subito le RPC,
   attendi il refresh o esegui `NOTIFY pgrst, 'reload schema';`. Esegui build e
   riavvia il bot aggiornato. Nessun nuovo valore è richiesto in `.env.local`.

Non usare claim simulati o fixture nel progetto personale. Le chiamate reali
avvengono con la sessione Supabase autenticata del bot; auth.uid() deve essere
presente. L'RPC nel SQL Editor amministrativo senza JWT è intenzionalmente rifiutata.

### Identità e atomicità

Per il testo libero la chiave UUIDv8 deriva da SHA-256 di un namespace versionato,
chat e message_id. Per il guidato deriva dal messaggio `/menu` o `/start` che avvia
il flusso e viene mantenuta fino alla proposta finale. Edizioni della stessa fonte,
replay, ricostruzione dopo riavvio e retry mantengono la chiave. Un nuovo messaggio
(o un nuovo comando menu) identifica invece una nuova operazione, anche con valori
identici. Il database conserva solo la chiave opaca, non testo o identificatori
Telegram grezzi. Contratto attuale: **un bot Telegram per proprietario Supabase**;
non cambiare il namespace o riutilizzare lo stesso proprietario per bot diversi
senza progettare prima un namespace distinto e una transizione compatibile.

`save_transaction_once(p_request_id,p_type,p_amount,p_date,p_category,
p_from_account,p_to_account)` riceve alias concettuali dei conti, senza user_id
esterno. Il client riutilizza la validazione di dominio; la RPC risolve gli UUID
all'interno della scrittura. SECURITY DEFINER con search_path vuoto e filtri
espliciti di proprietà permette di scrivere nella tabella ricevute riservata.
La funzione deve restare sotto un proprietario amministrativo fidato.

Un lock advisory transazionale su utente/chiave serializza i tentativi della stessa
operazione, in READ COMMITTED. Una collisione dell'hash del lock può solo rallentare
richieste estranee; l'unicità usa la coppia completa user_id/request_id. Il payload
canonico comprende tipo, importo numeric, data, categoria e alias di origine/
destinazione. La stessa chiave con payload diverso è rifiutata con PT409.

Se esiste la ricevuta coerente, la RPC restituisce l'UUID originale **prima** della
risoluzione dei conti e dei controlli di chiusura: recuperare una scrittura riuscita
resta possibile con conto disattivato/rinominato o giornata Contanti poi chiusa.
Altrimenti inserisce transazione e ricevuta nella stessa transazione SQL. Vincoli
esistenti, FK di proprietà e trigger Contanti rimangono attivi. Un errore/rollback
non lascia una ricevuta né una nuova transazione parziale.

`transaction_receipts` conserva proprietario, request_id, transaction_id, payload
originale e data di creazione. RLS autorizza solo la lettura del proprietario;
INSERT/UPDATE/DELETE diretti sono revocati ad authenticated. Le ricevute sono
immutabili, e il FK impedisce di cancellare una transazione referenziata: la chiave
non può diventare riutilizzabile per ricreare un movimento. Questa restrizione
riguarda solo i movimenti creati dal nuovo percorso RPC; una futura cancellazione
avrà bisogno di un modello esplicito che preservi la ricevuta. Il payload è quello
dell'operazione originaria, non un saldo memorizzato o un motore di aggiornamento
retroattivo dei movimenti.

`get_transaction_receipt(p_request_id)` è SECURITY INVOKER, soggetta a RLS e filtro
esplicito auth.uid(). Restituisce zero righe oppure l'UUID già registrato. Le nuove
RPC non sono eseguibili da PUBLIC/anon; authenticated senza JWT è rifiutato.

### Telegram e limiti dichiarati

Il pulsante Conferma include la chiave compatta, entro il limite Telegram di 64
byte. Dopo un timeout i valori della proposta restano congelati e il retry usa
la stessa chiave. Una conferma scaduta, obsoleta o ricevuta dopo riavvio può soltanto
**leggere una ricevuta**: non ricostruisce il payload e non inserisce nulla. Se la
prima richiesta non ha ancora concluso il commit, il controllo può non trovare
ancora una ricevuta: ripremi lo stesso pulsante dopo un intervallo.

Il replay del messaggio crea una nuova anteprima con la medesima identità. Se il
payload corrisponde, la conferma recupera la ricevuta; se differisce (anche perché
una data relativa è stata reinterpretata un altro giorno), non crea una seconda
transazione e segnala conflitto. In questo caso il bot tenta anche la lettura della
ricevuta. Una modifica della fonte già contabilizzata non corregge il movimento
esistente e non può crearne un secondo con la stessa chiave. Non è implementata
l'intera UX B6 per ignorare preventivamente tutte le fonti già contabilizzate.

Fuori copertura:

- Transazioni create prima di 006, senza ricevuta associata; inclusi vecchi pulsanti
  che non contengono la chiave. Non modificare/reinviare vecchie fonti per correggere
  lo storico: B6 completo e recupero dello storico restano attività separate.
- Inserimenti diretti SQL/REST su transactions che non passano dalla nuova RPC;
  restano disponibili secondo le policy preesistenti. Nessun altro bug dell'audit
  viene risolto attraverso questa task.
- Un messaggio nuovo, copia/incolla o inoltro con message_id diverso è una nuova
  operazione: non è possibile distinguerlo automaticamente da una seconda spesa
  legittima identica. In caso di esito incerto usa il vecchio pulsante, non una copia.
- Una compilazione guidata non ancora salvata persa al riavvio non è ricostruibile
  dal solo pulsante. Il pulsante può recuperare eventuale ricevuta, non salvare un
  payload mancante. Riprendere automaticamente bozze richiederebbe persistenza
  della conversazione, esclusa da B1.
- Modifiche manuali di record fuori RPC, rimozione amministrativa delle protezioni,
  cambio del namespace o altri bot con lo stesso proprietario non fanno parte
  della garanzia di retry dell'attuale bot.

### Verifiche e ripetibilità

```sh
npm test
npm run typecheck
npm run build
node supabase/tests/run-account-balances.mjs /private/tmp/financetracker-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js
node supabase/tests/run-cash-concurrency.mjs /private/tmp/financetracker-concurrency-runtime/node_modules/embedded-postgres/dist/index.js --b1 --audit
```

I runtime temporanei e i limiti dell'Auth locale sono descritti sopra. Il runner
SQL verifica 006, conservazione dello storico, replay, campi modificati, identità
distinte, RLS, account inattivi, giornate chiuse e rollback. Quello nativo usa
sessioni separate per 25 retry simultanei, payload concorrenti incompatibili,
25 operazioni legittime identiche, disconnessione dopo commit e gare con la
riconciliazione. Include anche il repository e il flusso bot effettivi collegati
al PostgreSQL locale tramite un SDK sintetico: perdita della risposta post-commit,
doppia conferma, reset dello stato di processo, replay e modifica della fonte.
Nessuna connessione remota e nessun uso di credenziali reali.
