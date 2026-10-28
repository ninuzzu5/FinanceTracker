# Supabase

Questa directory descrive lo schema applicativo versionato, non lo stato verificato
del progetto remoto. Il codice attuale usa aperture/saldi, riconciliazione Contanti,
ricevute idempotenti e vincoli EUR/monetari; la migrazione 009 riserva le scritture alle RPC.
Nessuna migrazione è applicata automaticamente dal bot.

## Migration order

| Migrazione | Effetto / prerequisiti | Quando eseguirla |
| --- | --- | --- |
| [001](migrations/001_initial_schema.sql) | accounts/transactions, FK di proprietà, direzioni e categorie; richiede Auth Supabase | Solo provisioning di database nuovo, una volta |
| [002](migrations/002_rls_policies.sql) | RLS, grant e policy CRUD proprie; richiede 001 | Subito dopo 001, prima di esporre accesso applicativo, una volta |
| [003](migrations/003_enforce_transaction_category.sql) | Sostituisce il CHECK categorie legacy e valida lo storico | Solo se il CHECK esistente è scorretto, dopo preflight; saltare con la 001 attuale |
| [004](migrations/004_account_openings_and_balances.sql) | Apertura/data nullable congiunte e get_account_balances | Schema/FK/categorie/RLS coerenti con 001/002; 003 non è prerequisito numerico |
| [005](migrations/005_cash_reconciliation.sql) | account_adjustments, RPC e lock/trigger di chiusura Contanti; integra rettifiche nei saldi | Dopo 004, verificando firma RPC e vincoli di apertura |
| [006](migrations/006_transaction_idempotency.sql) | transaction_receipts, save_transaction_once e get_transaction_receipt | Dopo 005, con RLS attiva e oggetti 006 assenti |
| [007](migrations/007_monetary_integrity_and_eur.sql) | CHECK importi/date, EUR per tutti i conti, controllo EUR nella RPC di salvataggio | Dopo 006 e [preflight READ ONLY](preflight/007_monetary_integrity_and_eur.sql) |
| [008](migrations/008_transaction_management.sql) | Versioni, annullamento logico, audit e RPC storiche; saldi senza movimenti annullati | Dopo 007 e [preflight READ ONLY](preflight/008_transaction_management.sql); revoca UPDATE/DELETE diretti |
| [009](migrations/009_restrict_ledger_writes.sql) | Revoca scritture dirette su conti e transazioni, comprese colonne e PUBLIC; verifica ruoli ereditati e proprietari RPC | Dopo 008 e confronto dei privilegi effettivi; nessuna modifica dei dati |

**Database nuovo:** 001 → 002 → 004 → 005 → 006 → 007 → 008 → 009. La baseline 001
include già il CHECK corretto: non eseguire 003 come passaggio obbligatorio.
**Database esistente:** confronta catalogo, policy, grant e vincoli; applica soltanto
i passaggi mancanti, nell'ordine dipendente. Non dedurre applicazione dal nome dei
file o dal branch. Non rilanciare 001/002 e non rieseguire 003 se già corretto.
Anche 004–008 vanno applicate una volta: non sono script di reset/riparazione
idempotenti; 007 sostituisce una RPC ma aggiunge vincoli senza IF NOT EXISTS.

## Scritture applicative e aperture dei conti

Con [009](migrations/009_restrict_ledger_writes.sql), i client possono leggere i
propri conti e movimenti, ma non inserirli, modificarli o cancellarli direttamente.
Sono revocati anche TRUNCATE, REFERENCES e TRIGGER, oltre ai grant di scrittura
e REFERENCES delle singole colonne, da PUBLIC, anon e authenticated.
Le nuove transazioni passano da `save_transaction_once`; correzioni e chiusure
mantengono le RPC esistenti, le ricevute, l'audit e i lock Contanti.

Non esiste una RPC di gestione conti. Il provisioning resta amministrativo;
aperture e configurazione non sono modificabili dai client. Una correzione
amministrativa richiede valori verificati, motivazione, confronto prima/dopo e
registrazione privata dell'intervento. Non disabilitare i trigger Contanti.
Amministratori e service_role restano privilegiati: non usarli nel browser o
come credenziali ordinarie del bot.

Per una successiva applicazione su un database esistente:

1. Verifica backup e recupero, schema fino a 008, RLS, policy, trigger, proprietari
   e configurazione delle RPC. Inventaria gli strumenti che scrivono direttamente.
2. Esamina ACL di tabella e colonna, grant option, PUBLIC e appartenenze dei ruoli.
   Controlla i permessi effettivi con `has_table_privilege`,
   `has_any_column_privilege` e `pg_has_role`, non soltanto i grant nominali.
3. Qualifica prima la migrazione e le regressioni su un database temporaneo con
   dati sintetici. Concorda una breve sospensione delle scritture prima del rilascio.
4. Applica soltanto 009, nella sua transazione, con il ruolo amministrativo
   autorizzato. Non esegue INSERT, UPDATE o DELETE sui dati esistenti.
   I proprietari delle RPC sono controllati dopo le revoche, comprese le
   autorizzazioni necessarie ai lock. RLS, policy, trigger e funzioni non cambiano.
5. Privilegi residui tramite ruoli ereditati, proprietari RPC incompatibili o grant
   dipendenti impediscono il COMMIT. Esegui ROLLBACK se il client lascia aperta
   la transazione fallita; esamina la causa prima di riprovare. Nessun CASCADE,
   cambio di appartenenza o ampliamento dei permessi è automatico.
6. Dopo il COMMIT ricontrolla letture, RPC e assenza di scritture dirette; controlla
   separatamente Auth e PostgREST. Riprendi una sola istanza del bot. Preferisci
   una correzione in avanti: ripristinare i vecchi grant riaprirebbe il problema.

I runner SQL verificano dati invariati, grant di colonna e PUBLIC, ereditarietà
indiretta anche senza INHERIT, rollback su proprietario RPC incompatibile,
riapplicazione e rifiuto delle scritture dirette. Dopo 009 eseguono nuovamente
le prove di gestione e storico; il nativo verifica anche retry, riconciliazioni,
audit e integrazione del bot in sessioni concorrenti. Le fixture dei vecchi
schemi restano eseguite prima delle rispettive restrizioni. Nessun runner legge
credenziali o apre connessioni al progetto remoto.

Tutti i file sono transazionali: provare su un progetto di test separato, fermare
le scritture durante DDL, incollare **l'intero file** BEGIN/COMMIT inclusi nel SQL
Editor con amministratore fidato. In caso di errore fare ROLLBACK prima di
riesaminare lo schema. Nessuna transazione storica viene modificata automaticamente.
Se oggetti o policy differiscono, fermarsi e confrontarli senza DROP correttivi.

### Verifica dopo ciascun passaggio

- 001/002: tabelle, FK composite owner/account, CHECK categorie/direzioni e
  RLS attiva; CRUD authenticated limitato al proprietario, nessuna policy anon.
- 003 (solo legacy): definizione transactions_category_by_type_check coerente
  con 001 e nessuna riga incompatibile con i tipi/categorie.
- 004: quattro CHECK di apertura e firma get_account_balances(date); coppia
  NULL restituisce not_configured, date anteriori before_opening, non zero.
- 005: account_adjustments con RLS e sola lettura diretta authenticated;
  preview_cash_reconciliation/reconcile_cash, trigger su conti e movimenti,
  saldo integrato e blocco di giornate chiuse, trasferimenti compresi.
- 006: ricevute con RLS/sola lettura e immutabilità, FK protetto; RPC con
  privilegi previsti. Stessa chiave/payload = stesso UUID; payload diverso = PT409.
- 007: tre nuovi CHECK, EUR validato, quelli transazioni inizialmente NOT VALID;
  nuove scritture/UPDATE invalidi rifiutati. Verificare anche la RPC di salvataggio sostituita.
- 008: versione/stato annullamento, RLS e immutabilità di transaction_changes, RPC storiche, UPDATE/DELETE revocati; annullamenti esclusi dai saldi e blocchi Contanti ancora attivi.

Controllare oggetti tramite pg_constraint, pg_policies, pg_class.relrowsecurity,
pg_proc e privilegi effettivi; le query di preflight nelle sezioni sotto danno
metadati utili ma non certificano da sole tutta la configurazione remota.
Se serve aggiornare PostgREST: `NOTIFY pgrst, 'reload schema';`. Verificare le RPC
con sessione Auth reale del proprietario in un ambiente di test, non con SQL Editor
amministrativo privo di JWT né con claim sintetici nel progetto personale.

## Prerequisites and boundaries

The target must already provide Supabase Auth, `auth.users`, `auth.uid()`, the `authenticated` role and `gen_random_uuid()`. These files version the application tables and policies; they do not recreate Supabase's managed Auth infrastructure or project-level Auth settings. The SQL must be applied by a database administrator with the required DDL privileges, separately from normal bot access.

No users, accounts, transactions or seeds are inserted. Real Auth users and account rows must be provisioned privately. Revolut, Isybank and Contanti are conceptual account names used by the bot; their UUIDs are resolved from active rows owned by the authenticated user, never hardcoded.

The initial baseline includes the corrected category constraint: the category CHECK explicitly requires `category IS NOT NULL` for expense/income, together with a category valid for that type. For transfers the category must be NULL and the two accounts must be distinct. The category column remains nullable to support transfers. Category identifiers match the domain taxonomy. The later incremental migrations add the protections documented below; unused baseline columns are not application features.

`created_at` and `updated_at` have insertion defaults. Migration 008 explicitly updates `updated_at` during audited corrections; no automatic timestamp-update trigger is introduced. The policy names in this baseline are descriptive local names; names and grants have not been compared to the remote catalog. The supplied ownership model is preserved: SELECT and DELETE use `USING`, INSERT uses `WITH CHECK`, and UPDATE uses both, preventing changes to another owner's user ID. Composite foreign keys prevent references to another user's accounts. No policy authorizes anonymous users, and RLS is never disabled.

## Existing database: category preflight and migration 003

Do not replay 001 or 002 on the existing project. Before manually applying 003, run this read-only query privately with an administrative SQL connection that can see all rows, not a user session restricted by RLS:

```sql
select type, count(*) as incompatible_rows
from public.transactions
where type in ('expense', 'income')
  and category is null
group by type;
```

No rows means no NULL-category expense/income rows were found. If counts are returned, stop: 003 will fail until those rows are reviewed and corrected explicitly by the data owner. Neither the query nor the migration changes or deletes any data automatically.

Only for a legacy database with an incorrect `transactions_category_by_type_check`, after the preflight, apply `003_enforce_transaction_category.sql` once through the separately authorized database administration workflow. It drops only `transactions_category_by_type_check` and adds its corrected definition in one transactional ALTER TABLE. Adding the constraint validates all existing rows; concurrent incompatible writes before validation can still make it fail. A failure rolls back the replacement and preserves the previous constraint. Validation takes a table lock, so choose an appropriate maintenance window for a populated database.

This section documents the prepared query and migration; neither was executed as part of their preparation. Reviewing these files requires no database credentials. Reconciling the existing database’s migration history remains a separate step.

## Supabase authenticated access

The bot uses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_USER_EMAIL` and `SUPABASE_USER_PASSWORD`. It signs in as the dedicated Auth user and uses that session for history, receipts and RPCs, with RLS and explicit ownership checks. The save RPC resolves UUIDs and atomically creates a transaction and receipt. Normal bot access never uses a secret/service-role key.

Real values stay in the ignored `.env.local` file or private runtime environment. There are no personal UUIDs, credentials, financial records or balances in these migrations.

## Validation

I test applicativi simulano l'SDK e non contattano il database reale. Per il collaudo manuale vedi la [guida Telegram](../docs/bot-guide.md). Il runner SQL applica 001/002/004/005/006/007/008/009 e verifica saldi, riconciliazione, idempotenza, storico, audit e privilegi. Usa PGlite temporaneo con un contratto minimo di Auth; non certifica Auth ospitata o catalogo remoto. È separato da Vitest ed eseguito anche dalla CI SQL. Non legge credenziali e non apre connessioni remote.


## CI e qualificazione Linux

Il job `sql-qualification`, visualizzato come **SQL integration**, esegue PGlite
e PostgreSQL nativo con `--b1 --audit` su tutti gli eventi della CI: push dev/main,
PR verso dev/main e avvio manuale. Build del bot prima dell’integrazione, runtime
con versioni esplicite sotto `RUNNER_TEMP`, nessun segreto applicativo o database
remoto. Un errore di setup o un’asserzione fallita rende rosso il job.

È stato riportato il successo su Linux della configurazione precedente al commit
`7464879fe6e1be5c07002b2584cf08825ac8f867`. La nuova definizione usa Ubuntu 24.04
esplicito e Actions aggiornate; il relativo run hosted resta da verificare.
Vedi [guida CI](../docs/ci.md) per evidenze, required checks e gestione dei fallimenti.

I comandi locali sotto usano `mktemp -d` e fixture sintetiche senza leggere `.env.local`.
Il runner PGlite confronta snapshot SQL testuali ordinati, mantenendo distinti
`infinity` e `-infinity`, senza confronti di `Invalid Date` dipendenti dalla versione Node.

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
saldi inventati. Per configurare un'apertura verificata, segui la sezione Apertura e saldo teorico. Il bot non crea automaticamente la riga remota.

Per i vincoli dei campi consulta la [baseline locale](migrations/001_initial_schema.sql)
e le migrazioni incrementali indicate sopra.


## Apertura e saldo teorico

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
   non esiste audit dedicato delle modifiche all’apertura. Dopo una riconciliazione 005 protegge l’apertura da modifiche: la riapertura non è implementata.

### Lettura autenticata

La RPC è `get_account_balances`, con parametro obbligatorio `p_as_of` (`YYYY-MM-DD`).
Un client Supabase **già autenticato come proprietario** può invocare
`client.rpc('get_account_balances', { p_as_of: '2026-10-03' })`.
Le aperture non hanno un comando di configurazione; `/saldi` elenca i saldi del giorno corrente.
`/riconcilia` legge il teorico Contanti tramite le RPC 005; le aperture restano manuali.

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
| `configured` | Apertura + entrate − uscite + trasferimenti ricevuti − inviati + rettifiche non annullate (005) |

Gli intervalli sono inclusivi su entrambe le estremità. I conti inattivi restano
visibili; un utente senza conti ottiene una lista vuota. Non esiste una colonna di
saldo corrente. Le correzioni 008 e gli annullamenti logici ricalcolano le letture successive; 005 protegge le giornate Contanti chiuse. UPDATE/DELETE diretti sono revocati e la cancellazione fisica è vietata dal nuovo trigger.
Ogni lato del trasferimento usa l'apertura del proprio conto: con date diverse un
trasferimento può ricadere soltanto nell'intervallo di uno dei due conti. La compensazione
nel patrimonio si verifica quando entrambi i lati sono inclusi.

Gli aggregati sono calcolati esattamente in PostgreSQL, poi presentati a due decimali.
La funzione rifiuta importi incompatibili **solo nei movimenti del chiamante inclusi
nel calcolo** (errore 22003), senza alterare o arrotondare righe storiche. Il parser
esistente accetta già al massimo due decimali; la persistenza verifica ora anche
questo contratto, usando conversione a centesimi sicuri senza moltiplicazione floating
point. Il dominio rappresenta importi limitati come Number validati in centesimi;
la RPC di salvataggio attuale riceve una stringa decimale esatta, ad esempio "0.29".
Evita somme monetarie con `Number` nel futuro client: l'aggregazione è responsabilità
SQL. I trasferimenti tra valute diverse sono rifiutati (22023); non esiste conversione
FX. Per il patrimonio dei tre conti usa EUR e non sommare valute diverse.

### Test senza dati reali né aperture arbitrarie

Il runner `tests/run-account-balances.mjs` avvia PostgreSQL in memoria, con una
simulazione minima di auth.uid/users/ruoli, applica 001, 002 e 004–009 e verifica anche
che le transazioni preesistenti rimangano identiche. Non legge `.env`, non contatta
Supabase e non usa un database su disco. Gli importi sintetici dei test non sono
valori da trasferire ai conti personali. Nessuna modalità demo/reale è introdotta.

Per eseguire i test SQL senza aggiungere dipendenze al progetto, dalla root con Node 22.12+:

```sh
FT_SQL_RUNTIME="$(mktemp -d)"
npm install --prefix "$FT_SQL_RUNTIME" --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node supabase/tests/run-account-balances.mjs "$FT_SQL_RUNTIME/node_modules/@electric-sql/pglite/dist/index.js"
npm test
npm run typecheck
npm run build
```

Mantieni `FT_SQL_RUNTIME` nella stessa shell per le esecuzioni successive; la directory può essere rimossa dopo il collaudo. È possibile
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

## Riconciliazione Contanti

La migrazione `migrations/005_cash_reconciliation.sql` va applicata **dopo 004**.
La presenza dei file locali non attesta l’applicazione sul progetto remoto.

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
resta possibile. La riapertura verrà gestita in un intervento separato.

I trigger e la RPC condividono il lock del conto. La chiave univoca per utente
rende idempotente il ritentativo con stesso payload; una chiave riutilizzata con
dati diversi è rifiutata. Un indice univoco impedisce due rettifiche attive nello
stesso giorno/conto, anche con chiavi diverse. Le scritture Contanti richiedono
READ COMMITTED, il livello normale PostgREST; livelli con snapshot persistenti
sono rifiutati per evitare controlli su chiusure non aggiornate.

Il flusso Telegram usa lo store esistente in memoria, con scadenza di 30 minuti:
un riavvio perde la conversazione. Il database conserva l'idempotenza e la chiusura,
ma non esiste recupero Telegram della ricevuta **di riconciliazione** dopo riavvio;
questo limite non riguarda i pulsanti dei movimenti con ricevuta persistente. Le richieste
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
npm ci
npm run build
FT_NATIVE_RUNTIME="$(mktemp -d)"
npm install --prefix "$FT_NATIVE_RUNTIME" --no-save --package-lock=false embedded-postgres@18.4.0-beta.17
node supabase/tests/run-cash-concurrency.mjs "$FT_NATIVE_RUNTIME/node_modules/embedded-postgres/dist/index.js" --b1 --audit
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

## Ricevute persistenti dei movimenti — migrazione 006

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
   verificato durante questa revisione. Se è diverso, fermati e confrontalo; non cancellare
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
non può diventare riutilizzabile per ricreare un movimento. Con 008 tutti i movimenti usano annullamento logico e il DELETE fisico è vietato;
le ricevute di creazione restano immutabili anche dopo una correzione o un annullamento. Il payload è quello
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

Il percorso UX attuale legge preventivamente `get_transaction_receipt` prima di
creare un'anteprima: replay o modifica di una fonte già contabilizzata producono
solo un avviso, anche dopo riavvio o se il testo diventa un comando. La lettura
fallita blocca nuove anteprime. La RPC resta la difesa atomica: stessa chiave con
payload diverso = conflitto, mai una seconda transazione. Modificare la fonte
non corregge il movimento salvato. L'ordinamento delle fonti non salvate rimane
in memoria, senza persistenza delle bozze o correzioni retroattive avanzate.

Fuori copertura:

- Transazioni create prima di 006, senza ricevuta associata; inclusi vecchi pulsanti
  che non contengono la chiave. Non modificare/reinviare vecchie fonti per correggere
  lo storico: per correggere usa il dettaglio dello storico con 008, che protegge le chiusure Contanti. `/movimenti` legge lo storico ma non collega vecchie fonti a ricevute mancanti.
- Inserimenti diretti SQL/REST su transactions che non passano dalla nuova RPC;
  restano disponibili secondo le policy preesistenti. I vincoli monetari e di valuta restano attivi anche fuori RPC.
- Un messaggio nuovo, copia/incolla o inoltro con message_id diverso è una nuova
  operazione: non è possibile distinguerlo automaticamente da una seconda spesa
  legittima identica. In caso di esito incerto usa il vecchio pulsante, non una copia.
- Una compilazione guidata non ancora salvata persa al riavvio non è ricostruibile
  dal solo pulsante. Il pulsante può recuperare eventuale ricevuta, non salvare un
  payload mancante. Riprendere automaticamente bozze richiederebbe persistenza
  della conversazione, esclusa dal recupero tramite ricevute dei movimenti.
- Modifiche manuali di record fuori RPC, rimozione amministrativa delle protezioni,
  cambio del namespace o altri bot con lo stesso proprietario non fanno parte
  della garanzia di retry dell'attuale bot.

### Verifiche e ripetibilità

```sh
npm test
npm run typecheck
npm run build
node supabase/tests/run-account-balances.mjs "$FT_SQL_RUNTIME/node_modules/@electric-sql/pglite/dist/index.js"
node supabase/tests/run-cash-concurrency.mjs "$FT_NATIVE_RUNTIME/node_modules/embedded-postgres/dist/index.js" --b1 --audit
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

## Migrazione 007: integrità monetaria e solo EUR

`migrations/007_monetary_integrity_and_eur.sql` richiede 006 e non modifica le
migrazioni precedenti. Non aggiorna transazioni, saldi iniziali, timestamp o dati
storici. Non introduce conversioni, saldo corrente, descrizioni o nuove dipendenze.

### Scelta delle valute

Il prodotto attuale gestisce esclusivamente EUR: dominio/importi non rappresentano
FX, anteprime Telegram mostrano EUR e la riconciliazione ammette solo EUR.
`accounts_eur_currency_check` impone esattamente `EUR` a **tutti** i conti, anche
inattivi e con nomi diversi dai tre conti del bot. È un vincolo validato: 007 si
ferma atomicamente se trova conti storici non EUR; non li converte o rinomina.

Questo invariante impedisce trasferimenti tra valute differenti e modifiche di
valuta che invaliderebbero trasferimenti esistenti, anche tramite SQL/REST o in
concorrenza. Non serve un trigger che confronti due conti con possibili race.
Un futuro supporto multi-valuta richiederà un modello FX esplicito e una nuova
migrazione, non la rimozione occasionale del controllo.

La risoluzione UUID resta nella RPC di salvataggio: 007 sostituisce soltanto
`save_transaction_once`, aggiungendo il controllo EUR sui conti risolti (PT422,
tradotto dal bot in un messaggio italiano). Il controllo avviene dopo il recupero della
ricevuta di creazione, così i replay già riusciti mantengono la loro semantica. La funzione
mantiene autenticazione, owner filter, search_path vuoto, lock, payload canonico,
privilegi e atomicità. Anche `mapTransaction` richiede `currency='EUR'`.

### Importi, date e dati storici

I nuovi CHECK su `transactions` richiedono importo strettamente positivo, diverso
da NaN/±Infinity, uguale a round(amount,2), e `isfinite(transaction_date)`.
L'importo resta `numeric` senza typmod: **non viene arrotondato**. Gli zeri finali
(0.290 = 0.29) non sono precisione monetaria aggiuntiva e rimangono consentiti.

I CHECK monetari/date sono `NOT VALID`: applicati immediatamente a **qualsiasi
INSERT e UPDATE**, inclusi aggiornamenti di altre colonne di una riga storica
incompatibile. Nessuna riga storica viene riscritta o cancellata; le difese in
lettura di `get_account_balances` e le validazioni del dominio restano intatte.
La mancata validazione riguarda solo lo storico e non consente nuove scritture
invalide. Date infinite storiche possono ancora essere escluse dai saldi finiti:
non utilizzare tali dati per denaro reale senza prima verificarli.

### Applicazione manuale e preflight

1. Ferma il bot e scegli una finestra senza scritture. Nel progetto corretto apri
   **SQL Editor** e, con un amministratore fidato, esegui l'intero file
   `preflight/007_monetary_integrity_and_eur.sql`: è una transazione **READ ONLY**.
   Riporta solo catalogo, conteggi e identificatori delle righe incompatibili,
   non testo Telegram, credenziali o dettagli dei messaggi.
2. Verifica presenza di 006, RLS/ownership/policy coerenti con 001/002/005/006 e
   assenza dei nuovi vincoli 007. Lo schema e i dati remoti **non sono stati
   verificati** durante questa revisione. Se trovi differenze, confrontale prima di
   procedere; non cancellare oggetti o rilanciare baseline.
3. Esamina privatamente tutte le righe segnalate. Conti non EUR o trasferimenti
   tra valute differenti richiedono una decisione contabile esplicita: **fermarsi**,
   nessun UPDATE automatico di currency. Per movimenti incompatibili, 007 può
   proteggere nuove scritture preservando lo storico, ma lo storico non diventa
   corretto applicandola. Non effettuare arrotondamenti o cancellazioni automatiche.
4. Prova prima su un database di test separato. Quando il preflight è soddisfatto,
   incolla nel SQL Editor **l'intera migrazione 007**, BEGIN/COMMIT inclusi, una sola
   volta. In caso di errore esegui ROLLBACK nella sessione; controlla il motivo
   prima di riprovare. La migrazione non converte dati e non modifica il timezone.
5. Verifica i tre vincoli e la RPC, aggiorna la cache PostgREST se necessario
   (`NOTIFY pgrst, 'reload schema';`), esegui build e riavvia il bot aggiornato.
6. Solo quando il preflight sui movimenti restituisce **zero righe incompatibili**,
   puoi validare esplicitamente lo storico con:

   ```sql
   begin;
   alter table public.transactions validate constraint transactions_money_integrity_check;
   alter table public.transactions validate constraint transactions_finite_date_check;
   commit;
   ```

   Queste istruzioni controllano lo storico senza modificarlo. Se falliscono,
   esegui ROLLBACK e riesamina i dati; le protezioni sulle nuove scritture restano
   quelle già installate da 007.

### Date, UTC e limiti

`transaction_date` resta una **data contabile**, calcolata da APP_TIMEZONE
(default Europe/Rome) e passata alla RPC senza shift UTC. `created_at` resta
`timestamptz`, un istante: 17:08 UTC = 19:08 a Roma il 9 ottobre 2026.
Il bot attuale non visualizza created_at/updated_at; per la futura dashboard usare
un timestamp con offset e formattarlo esplicitamente nel fuso desiderato, non
aggiungere manualmente due ore. I test verificano mezzanotte estiva/invernale,
salto primaverile, ora ripetuta autunnale e percorso Telegram→RPC.

Criticità indipendente confermata dal codice: riconciliazione e relativa UI usano
Europe/Rome fisso, mentre i movimenti consentono APP_TIMEZONE diverso. La
configurazione predefinita è coerente; un altro fuso può produrre giornate diverse
vicino a mezzanotte. Il parser rifiuta gli importi con segni e richiede chiarimenti sui conti ambigui.
Prima di aprire una proposta il bot verifica le ricevute di creazione e invalida
i pulsanti delle fonti modificate. La divergenza di fuso resta aperta.

### Test locali

I comandi di verifica sono nella sezione sulle ricevute persistenti. Il runner in memoria
prova prima le difese precedenti, poi 007, preflight su storico sintetico invalido,
fallimento atomico per un conto USD e conservazione integrale delle righe.
Dopo 007 riesegue saldi, riconciliazione e i salvataggi con ricevuta, oltre alla nuova fixture
`tests/monetary_integrity_and_eur.sql`: INSERT/UPDATE, date infinite, importi
invalidi, EUR, modifiche conti, trasferimenti, RLS e timestamp. Non disabilita
alcuna protezione.

Lo stress nativo esegue le gare Contanti e i salvataggi con ricevuta sullo schema 007, poi 25 sessioni con
212 scritture invalide rifiutate e 13 trasferimenti concorrenti a centesimi,
verificando patrimonio invariato. I runtime temporanei non sono dipendenze del
progetto; socket locale, credenziali sintetiche e cluster eliminato alla fine.

## Storico Telegram e audit aggiornato

`/movimenti` legge transactions con RLS e filtro proprietario, cinque righe più
lookahead, cursor transaction_date/id decrescente e importo PostgREST `amount::text`.
Non legge account_adjustments. La gestione controllata dei movimenti richiede
008: lettura del dettaglio, modifica e annullamento logico, senza DELETE. Il test [history.sql](tests/history.sql) verifica cursore, date
uguali, trasferimento singolo e isolamento tra due proprietari. Nessun indice nuovo
è introdotto: grandi ledger richiederanno una valutazione prestazionale separata.

I test conservano casi monetari e di valuta non validi sullo schema precedente
alla migrazione 007, poi verificano il rifiuto dopo la sua applicazione. Questi
casi storici non descrivono il comportamento dello schema aggiornato. Le prove
locali non attestano schema remoto, Auth/JWT, rete reale o uso multiistanza.

## Migrazione 008 — saldi Telegram e gestione dei movimenti

La procedura completa e le precauzioni di ripristino sono riportate qui sotto. Per il collaudo del bot vedi la [guida Telegram](../docs/bot-guide.md#collaudo-di-saldi-e-correzioni). Eseguire [preflight 008](preflight/008_transaction_management.sql) in READ ONLY prima del file [008_transaction_management.sql](migrations/008_transaction_management.sql), dopo 007. Non rieseguire baseline o migrazioni già applicate.

Aggiunge ledger_version (default 1), voided_at/voided_by a transactions e transaction_changes con RLS di sola lettura propria. Il registro mantiene richiesta/payload, autore-proprietario, transaction_id, timestamp e snapshot prima/dopo; non aggiorna le ricevute di creazione né i valori finanziari storici all'installazione. Il primo snapshot di correzione conserva lo stato originale. Nessun saldo corrente duplicato.

get_transaction_for_management(uuid) restituisce JSON con importo/versione testuali e conti propri; get_transaction_change_receipt(uuid) legge soltanto la ricevuta di correzione. manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid) modifica a tipo fisso o annulla, con owner/versione/payload/lock e trigger esistenti. La RPC dei saldi mantiene firma e stati, includendo rettifiche e filtrando voided_at IS NULL. `/saldi` proietta balance::text via PostgREST e somma centesimi BigInt, anche per conti inattivi.

**Cambiamento di autorizzazioni intenzionale:** authenticated perde UPDATE/DELETE diretti su transactions. Le modifiche contabili passano dalla RPC; INSERT resta compatibile con il salvataggio tramite ricevuta e le policy proprie, senza una nuova garanzia di idempotenza sugli inserimenti diretti. Gli annullamenti preservano riga e ricevuta, senza movimenti compensativi fittizi. I trigger 005 non vengono disabilitati o sostituiti. Vecchie fixture UPDATE/DELETE vengono eseguite prima di 008; la nuova fixture verifica i percorsi RPC e il rifiuto dei percorsi diretti dopo 008.

I runner eseguono anche transaction_management.sql; quello nativo aggiunge management-concurrency.mjs dopo aver rilasciato le connessioni delle suite precedenti. Include 25 retry simultanei, aggiornamenti incompatibili, lock con chiusura, rollback e repository/bot reali con SDK ponte su SQL locale. Il runtime richiede memoria condivisa e socket locali. Non serve accesso a Supabase remoto, non vengono letti file env e nessuna dipendenza entra nel progetto.

### Contratti della migrazione 008

File: [008_transaction_management.sql](migrations/008_transaction_management.sql).

| Oggetto | Contratto |
| --- | --- |
| `transactions.ledger_version` | Integer positivo, inizialmente 1; incremento per correzione |
| `transactions.voided_at`, `voided_by` | Annullamento con istante e autore, presenti insieme |
| `transaction_changes` | Owner/autore, request_id, transaction_id, action, payload, snapshot prima/dopo e created_at; unicità richiesta/utente e versione/movimento |
| `get_transaction_for_management(uuid)` | SECURITY INVOKER, snapshot JSON di un movimento proprio e conti propri, importo/versione come testo |
| `manage_transaction_once(uuid,uuid,integer,text,numeric,date,text,uuid,uuid)` | SECURITY DEFINER con owner esplicito: chiave, movimento, versione attesa, action edit/void, nuovi campi finanziari; restituisce transaction_id/action/version |
| `get_transaction_change_receipt(uuid)` | SECURITY INVOKER, lettura propria di una ricevuta o NULL, nessuna scrittura |
| `get_account_balances(date)` | Firma/stati invariati, rettifiche incluse e transazioni voided escluse |
| `guard_managed_transactions()` | Stato iniziale valido, UPDATE con versione/audit coerenti, nessun DELETE |
| `transaction_snapshot(transactions)` | Helper puro, campi contabili espliciti senza testo Telegram |

Per `void`, tutti i nuovi campi finanziari devono essere NULL. Per `edit` sono richiesti tutti i campi pertinenti, senza modifica parziale. Conti attivi posseduti in EUR, vincoli 007 e categorie del tipo sono ricontrollati dal database. Il proprietario autenticato coincide con l'autore; non è accettato user_id dal client.

La 008 revoca UPDATE/DELETE diretti su transactions ad authenticated; la successiva 009 revoca anche INSERT e le scritture sui conti. Il registro è leggibile solo dal proprietario e non modificabile direttamente. Le migrazioni precedenti e le ricevute di creazione non vengono riscritte.

I lock sono: advisory richiesta → conti Contanti propri ordinati per UUID → riga transazione. Le correzioni bancarie acquisiscono anch'esse i lock Contanti per mantenere un unico ordine prudente. Il trigger 005 resta invariato e verifica OLD/NEW anche per l'annullamento; riconciliazione e correzione non possono superarsi senza ricalcolo/conflitto. Serve READ COMMITTED.

### Applicazione manuale della migrazione 008

Procedura per ambienti non ancora allineati: **non rieseguire 008 nel progetto già migrato**.

1. **Prima su un progetto di test separato.** Predisporre utente e conti sintetici. Per le aperture usare un dataset di test documentato, oppure una consistenza verificata per quell'ambiente; non copiare importi di esempio nei conti personali.
2. Fermare il bot e altre scritture durante la finestra DDL. Nel progetto corretto, SQL Editor con amministratore fidato, eseguire l'intero [preflight 008](preflight/008_transaction_management.sql). È `BEGIN READ ONLY` e restituisce metadati/conteggi.
3. Confrontare lo schema con 001/002/004/005/006/007: RLS sulle quattro tabelle contabili, tre vincoli 007, RPC di salvataggio e riconciliazione, trigger Contanti abilitati, FK di proprietà. Gli oggetti/colonne 008 devono essere assenti. Dati monetari/date incompatibili o conti non EUR richiedono revisione esplicita: niente arrotondamenti, conversioni o cancellazioni automatiche. Il preflight non certifica policy personalizzate né l'intero catalogo.
4. Database nuovo: **001 → 002 → 004 → 005 → 006 → 007 → 008**. La 003 è solo legacy. Su database esistente applicare solo i passaggi mancanti verificati; non rieseguire baseline o 004–008 già applicate.
5. Incollare **l'intero file 008**, BEGIN/COMMIT inclusi, una volta. Non modificare trigger o policy per farlo passare. In caso di errore eseguire ROLLBACK nella sessione, confrontare lo schema e correggere il piano; non aggiungere DROP improvvisati. La migrazione aggiunge metadati e vincoli ma non riscrive i valori finanziari o gli snapshot delle ricevute di creazione.
6. Controllare gli oggetti e i permessi con query di sola lettura, per esempio:

   ```sql
   select relname, relrowsecurity from pg_class
   where oid in ('public.transactions'::regclass, 'public.transaction_changes'::regclass);
   select has_table_privilege('authenticated','public.transactions','UPDATE') as direct_update,
          has_table_privilege('authenticated','public.transactions','DELETE') as direct_delete,
          has_table_privilege('authenticated','public.transaction_changes','INSERT') as direct_audit_insert;
   select tgname, tgenabled from pg_trigger
   where tgrelid in ('public.transactions'::regclass,'public.transaction_changes'::regclass)
     and not tgisinternal;
   select proname, prosecdef, proconfig from pg_proc
   where pronamespace='public'::regnamespace
     and proname in ('manage_transaction_once','get_transaction_for_management',
                    'get_transaction_change_receipt','get_account_balances');
   ```

   RLS deve essere attiva, i tre permessi diretti false, trigger attivi, search_path vuoto per le RPC. Verificare anche grant EXECUTE: authenticated consentito, anon/PUBLIC esclusi. SECURITY DEFINER solo per la RPC di scrittura.
7. Se necessario aggiornare la cache: `NOTIFY pgrst, 'reload schema';`. Compilare/riavviare il bot con `npm run bot:dev`, in una sola istanza; il menu nativo registra sette comandi. Nessuna nuova variabile env.
8. Verificare tramite sessioni realmente autenticate degli utenti di test. SQL Editor amministrativo senza JWT non rappresenta il client; non simulare claim nei progetti personali. I claim artificiali dei runner sono esclusivamente locali.

### Se una migrazione fallisce

Un errore prima del COMMIT annulla l'intera migrazione, compresi i grant. Dopo COMMIT, non esiste un downgrade automatico sicuro: **non distribuire il vecchio codice dei saldi** o la RPC precedente, perché riconterebbero le transazioni annullate. In un ambiente usa e getta si può ricreare il database; su un database da preservare serve una migrazione correttiva in avanti o un ripristino da backup pianificato, conservando audit, annullamenti e ricevute. Verifica concretamente il ripristino su una copia isolata prima di affidarti a un backup.

## Backup e ripristino

Non è documentata una prova completata di ripristino dello schema 008. Le
impostazioni del servizio, la retention e il ripristino di Auth non sono stati
verificati. Non assumere che una CI verde dimostri la recuperabilità dei dati.

Prima di scegliere i comandi di backup o restore, verifica ciò che il provider
rende disponibile per il progetto e il piano in uso. Questa guida non inventa
una procedura specifica né considera collaudato un backup non ripristinato.

1. Registra disponibilità, frequenza, retention e punto recuperabile del backup, perdita massima accettabile e tempo di ripartenza. Verifica separatamente cosa viene conservato di Auth e dei proprietari.
2. Prova il ripristino in un progetto isolato, mai sopra i dati personali come esperimento. Proteggi il backup come i dati originali: niente file o credenziali nel repository.
3. Confronta migrazioni e catalogo fino a 009: RLS, grant effettivi di tabella e colonna, PUBLIC e ruoli ereditati, FK di proprietà, trigger Contanti, vincoli monetari/date/EUR, RPC e registro delle correzioni. I preflight precedenti non certificano policy personalizzate o tutti i grant ereditati.
4. Con utenti Auth reali di test verifica che un proprietario non possa leggere o modificare righe, ricevute e correzioni di un altro, e che l’accesso anonimo non permetta operazioni protette. Non usare l’SQL Editor amministrativo come prova di RLS.
5. Verifica almeno un movimento modificato, uno annullato, una ricevuta di creazione, una di correzione e una chiusura Contanti. Saldi e retry devono corrispondere al punto del backup; controlla anche gli importi testuali via PostgREST.
6. Prima di riavviare il bot riconcilia le operazioni successive al punto recuperato. Una scrittura o ricevuta persa può rendere pericoloso reinviare vecchi messaggi: non applicarli automaticamente.
7. Registra esito, durata, punto ripristinato e passi di ripartenza. Avvia una sola istanza con codice compatibile con schema e annullamenti recuperati.

Dopo il COMMIT della migrazione 008, tornare al vecchio codice dei saldi può
ricontabilizzare i movimenti annullati. Per un database da preservare serve una
correzione in avanti revisionata o un ripristino pianificato che mantenga audit,
annullamenti e ricevute. Non disabilitare le protezioni per rendere possibile il downgrade.
