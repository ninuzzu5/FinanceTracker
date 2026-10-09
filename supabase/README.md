# Supabase

This directory versions the Supabase 01 application schema and ownership policies. Migrations 001 and 002 are a baseline for a fresh Supabase database. Migration 003 is the separate category-constraint correction for an existing database. No migration has been applied remotely by this task.

## Migration order

1. `migrations/001_initial_schema.sql` creates `public.accounts` and `public.transactions`, their defaults, primary keys, user foreign keys, account foreign keys, composite ownership foreign keys, and transaction checks.
2. `migrations/002_rls_policies.sql` explicitly enables RLS on both tables, grants CRUD privileges to the `authenticated` role, and creates separate SELECT, INSERT, UPDATE and DELETE policies for each table.
3. `migrations/003_enforce_transaction_category.sql` replaces only `transactions_category_by_type_check` in legacy databases where that constraint exists but does not enforce the correct category rule. Skip 003 for fresh databases created with the corrected 001 and for the existing Supabase project: its constraint has already been verified as correct, so no migration is needed.

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

Normal application tests mock the SDK and never contact the real database. See [the bot guide](../docs/bot-guide.md) for manual application checks. The SQL has been reviewed locally against the supplied DDL and domain categories; it has not been executed or validated by a PostgreSQL server in this task. Database policy/isolation execution tests require a separate disposable Supabase environment and are not added to CI here.


## Configurazione manuale del conto Contanti

Lo schema verificato è quello versionato in `migrations/001_initial_schema.sql`.
Non è stata verificata la corrispondenza con il catalogo del database remoto.
`public.accounts` richiede `user_id`, `name`, `type`; le altre colonne hanno default.
`type` è testo obbligatorio senza CHECK/enum nello schema locale. Non esistono
colonne per il saldo iniziale e non occorre modificare lo schema.

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

Questa operazione crea soltanto un conto: non inserire transazioni iniziali,
importi o saldi di apertura. Il bot non crea automaticamente la riga remota.

Riferimenti per l'interfaccia: [inserimento di righe dal Table Editor](https://supabase.com/docs/guides/database/arrays)
e [utenti Auth nel Dashboard](https://supabase.com/docs/guides/auth/managing-user-data).
