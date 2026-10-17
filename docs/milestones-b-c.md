# Milestone B/C — saldi e gestione dei movimenti

Implementate sul codice `dev`; l’utente ha comunicato l’applicazione riuscita di 008 su Supabase. Questa rifinitura UX non interroga il database remoto, non riesegue migrazioni e non dichiara completata la Release v1. Tutte le scritture automatiche di collaudo usano database temporanei e dati sintetici.

## Scelte e dipendenze

- B usa `get_account_balances(p_as_of)` esistente, con proiezione PostgREST `balance::text`. La RPC calcola apertura + movimenti attivi + rettifiche Contanti; il bot somma soltanto i risultati in centesimi BigInt. Nessun download dell'intero ledger o saldo corrente duplicato.
- Il totale include tutti i conti del proprietario, anche inattivi e aggiuntivi. Se un conto è non configurato/prima dell'apertura, o manca uno dei tre conti principali, il totale è non disponibile. I NULL non valgono zero. Valute inattese, numeric non testuali/sub-cent e risultati incoerenti producono un errore sicuro.
- C conserva il tipo originale: categoria e direzioni restano coerenti, trasferimenti con due conti distinti e categoria NULL. Gli importi storici rimangono stringhe esatte; un nuovo importo riusa il parser esistente (sette cifre intere e due decimali). Cambiare tipo è fuori scope.
- 008 aggiunge stato/versione alla stessa transazione. `transaction_changes` è audit append-only e ricevuta idempotente, non una seconda fonte per calcolare i saldi. L'annullamento è logico: riga e ricevuta B1 originali rimangono, ma l'effetto viene escluso da tutti i saldi, anche storici. Nessuna scrittura compensativa fittizia o riattivazione.
- Prima di scrivere, SQL rilegge sotto lock e confronta `ledger_version` con quella dell'anteprima. Ricevute di richieste già riuscite sono recuperate prima dei controlli sulla versione attuale o sulle chiusure successive. Stessa chiave/payload diverso è un conflitto; una nuova operazione esplicita ha una nuova chiave.

## Oggetti della migrazione 008

File: [008_transaction_management.sql](../supabase/migrations/008_transaction_management.sql).

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

UPDATE/DELETE diretti su transactions sono revocati ad authenticated. INSERT resta conforme alle policy precedenti; solo il percorso B1 offre idempotenza dei nuovi movimenti. Il registro è leggibile solo dal proprietario e non modificabile direttamente. Nessuna modifica delle migrazioni 001–007 o delle ricevute di creazione.

I lock sono: advisory richiesta → conti Contanti propri ordinati per UUID → riga transazione. Le correzioni bancarie acquisiscono anch'esse i lock Contanti per mantenere un unico ordine prudente. Il trigger 005 resta invariato e verifica OLD/NEW anche per l'annullamento; riconciliazione e correzione non possono superarsi senza ricalcolo/conflitto. Serve READ COMMITTED.

## Applicazione manuale su Supabase

Procedura per ambienti non ancora allineati: **non rieseguire 008 nel progetto già migrato**.

1. **Prima su un progetto di test separato.** Predisporre utente e conti sintetici. Per le aperture usare un dataset di test documentato, oppure una consistenza verificata per quell'ambiente; non copiare importi di esempio nei conti personali.
2. Fermare il bot e altre scritture durante la finestra DDL. Nel progetto corretto, SQL Editor con amministratore fidato, eseguire l'intero [preflight 008](../supabase/preflight/008_transaction_management.sql). È `BEGIN READ ONLY` e restituisce metadati/conteggi.
3. Confrontare lo schema con 001/002/004/005/006/007: RLS sulle quattro tabelle contabili, tre vincoli 007, RPC B1 e riconciliazione, trigger Contanti abilitati, FK di proprietà. Gli oggetti/colonne 008 devono essere assenti. Dati monetari/date incompatibili o conti non EUR richiedono revisione esplicita: niente arrotondamenti, conversioni o cancellazioni automatiche. Il preflight non certifica policy personalizzate né l'intero catalogo.
4. Database nuovo: **001 → 002 → 004 → 005 → 006 → 007 → 008**. La 003 è solo legacy. Su database esistente applicare solo i passaggi mancanti verificati; non rieseguire baseline o 004–008 già applicate.
5. Incollare **l'intero file 008**, BEGIN/COMMIT inclusi, una volta. Non modificare trigger o policy per farlo passare. In caso di errore eseguire ROLLBACK nella sessione, confrontare lo schema e correggere il piano; non aggiungere DROP improvvisati. La migrazione aggiunge metadati e vincoli ma non riscrive i valori finanziari o gli snapshot B1.
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

### Rollback praticabile

Un errore prima del COMMIT annulla l'intera migrazione, compresi i grant. Dopo COMMIT, non esiste un downgrade automatico sicuro: **non distribuire il vecchio codice dei saldi** o la RPC precedente, perché ricontrebbero le transazioni annullate. In un ambiente usa e getta si può ricreare il database; su un database da preservare serve una migrazione correttiva in avanti o un ripristino da backup pianificato, conservando audit, annullamenti e ricevute. Prima della Release v1 verificare concretamente il ripristino su una copia isolata.

## Collaudo Telegram per Release v1

Solo progetto di test con schema 008 e aperture coerenti con il dataset; annotare i saldi attesi iniziali, senza introdurre saldi personali arbitrari.

1. `/saldi`: tre conti, data italiana, banca anche negativa e Contanti zero; controllare totale. Aggiungere nel solo dataset un conto inattivo con saldo: deve comparire e contribuire. Un'apertura mancante o futura deve rendere il totale non disponibile, senza mostrarla a zero. Provare Aggiorna e Menu principale, anche rapidamente: ogni nuova consultazione/refresh conserva il messaggio precedente e aggiunge data/ora, mentre Menu apre un pannello distinto.
2. `/menu` → **Saldi**: stessa lettura e stile. Inviare `/help` e verificare i sette comandi; provare vecchi pulsanti dopo un nuovo flusso e dopo riavvio.
3. Su una giornata **non chiusa**, inviare `0,29 pranzo revolut 2026-10-17`, controllare l'anteprima e confermare. `/movimenti` → il pulsante descrittivo sulla riga corretta (numero, importo, categoria e data) → **Modifica** → Importo → `0,31` → riepilogo automatico Prima/Dopo. Per ulteriori campi usa **Modifica ancora**; alla fine premi **✅ Conferma modifiche**. Prima di Conferma verificare che nulla sia cambiato; dopo Conferma controllare una versione/audit aggiuntiva e `/saldi` coerente. Il tipo rimane Uscita.
4. Inviare `0,20 stipendio revolut 2026-10-17` e `0,10 da revolut a isybank 2026-10-17`, confermarli. Modificare il trasferimento scegliendo origine e destinazione distinte: categoria assente, patrimonio invariato se entrambi i lati rientrano nelle aperture. Provare un conto uguale: rifiuto.
5. Da un dettaglio premere **Annulla movimento**, poi **Annulla operazione**: nessun annullamento contabile. Ripetere e Confermare su spesa/entrata/trasferimento di test: righe ANNULLATO, ricevute originali intatte, effetti esclusi dai saldi, nessuna ulteriore modifica consentita. Controllare autore/data in transactions e snapshot in transaction_changes.
6. Aprire due dettagli/anteprime da client di test diversi; confermare il primo, poi il secondo basato sulla vecchia versione: conflitto leggibile, nessuna sovrascrittura. I test automatici coprono le gare effettive; il bot locale resta a singolo processo.
7. Registrare tutti i movimenti Contanti della giornata di prova, quindi `/riconcilia` con il denaro effettivo del dataset. Dopo chiusura provare modifica/annullamento di una spesa e trasferimento Contanti inclusi; provare anche una spesa bancaria spostata su Contanti con data chiusa. Ogni tentativo deve fallire senza nuovo audit o variazione del saldo. Non riaprire/disabilitare trigger.
8. In un ambiente di test con fault injection controllata perdere la risposta dopo commit: **Riprova stessa richiesta** deve recuperare il successo senza seconda correzione. Dopo riavvio il vecchio pulsante legge soltanto la ricevuta. Non simulare il fault nei dati reali o cambiando/disabilitando vincoli. Questa prova è già simulata localmente con repository/bot reali e ponte SQL.
9. Per paginazione creare più di cinque movimenti sintetici, usare Avanti/Indietro e aprire un movimento della seconda pagina. Dopo modifica della data riaprire `/movimenti`: le pagine non sono uno snapshot congelato. Gli annullati restano elencati; le rettifiche non compaiono come entrate/uscite.

Le date degli esempi sono esplicite: scegliere giornate appropriate alle aperture e ancora aperte nel dataset di test. Nessun esempio autorizza modifiche ai conti personali reali.

## Verifiche locali e limiti

Comandi dalla root:

```sh
npm run build
npm run typecheck
npm test
node supabase/tests/run-account-balances.mjs /private/tmp/financetracker-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js
node supabase/tests/run-cash-concurrency.mjs /private/tmp/financetracker-concurrency-runtime/node_modules/embedded-postgres/dist/index.js --b1 --audit
```

Installazione runtime temporanei: [guida Supabase](../supabase/README.md#test-senza-dati-reali-né-aperture-arbitrarie). Non sono dipendenze del progetto. PostgreSQL nativo può richiedere autorizzazione alla memoria condivisa fuori sandbox, mantenendo socket locale e cluster temporaneo.

- Build/typecheck e suite applicativa: 603 test (374 bot, 229 dominio), inclusi 32 B/C iniziali e 17 ulteriori test di rifinitura UX/trasporto.
- SQL in memoria: migrazione incrementale su storico sintetico invariato, fixture precedenti e nuova transaction_management.sql; saldi/stati, edit, void, versioni, payload, rollback, RLS due utenti, protezioni Contanti e ricevute B1.
- PostgreSQL nativo: suite audit/B1/B2/B3 e nuova suite B/C con 25 retry simultanei, 25 modifiche concorrenti incompatibili, annullamento contro modifica, chiusura contro correzioni di vecchi/nuovi riferimenti e rollback. Bot/repository effettivi con SDK sintetico perdono la risposta post-commit e recuperano la stessa ricevuta anche dopo reset dello stato.
- Il controllo della proiezione RPC tramite SDK verifica il parametro PostgREST balance::text; non equivale a una prova HTTP su PostgREST ospitato.

Da verificare durante Release v1: catalogo/grant/RLS effettivi del progetto di test, Auth/JWT reale con due utenti, cast testuale numeric via PostgREST, tempi/retry di rete, collaudo Telegram e backup/ripristino. Nessuno di questi controlli remoti è stato eseguito in questa task.

Restano fuori scope dashboard, cambio tipo, riapertura delle giornate, annullamento di rettifiche Contanti, UI dell'audit completo e persistenza delle bozze. Il dettaglio mostra lo stato corrente; le versioni precedenti sono consultabili nel registro tramite accesso autenticato. Le aperture restano manuali. APP_TIMEZONE diverso da Europe/Rome conserva la divergenza preesistente dei movimenti; `/saldi` e riconciliazione usano Europe/Rome. Lo storico incompatibile segnalato dal preflight non viene riparato automaticamente; non è gestibile dal bot finché non viene esaminato separatamente.

## File creati o modificati

- Modificato: [README.md](../README.md).
- Modificato: [SECURITY.md](../SECURITY.md).
- Modificato: [apps/bot/src/commands.ts](../apps/bot/src/commands.ts).
- Modificato: [apps/bot/src/flow-delivery.ts](../apps/bot/src/flow-delivery.ts).
- Modificato: [apps/bot/src/history.ts](../apps/bot/src/history.ts).
- Modificato: [apps/bot/src/proposal-flow.ts](../apps/bot/src/proposal-flow.ts).
- Modificato: [apps/bot/src/proposals.ts](../apps/bot/src/proposals.ts).
- Modificato: [apps/bot/src/supabase.ts](../apps/bot/src/supabase.ts).
- Modificato: [apps/bot/src/wizard-view.ts](../apps/bot/src/wizard-view.ts).
- Modificato: [apps/bot/test/ux.test.ts](../apps/bot/test/ux.test.ts).
- Modificato: [apps/bot/test/wizard.test.ts](../apps/bot/test/wizard.test.ts).
- Modificato: [docs/architecture.md](architecture.md).
- Modificato: [docs/bot-guide.md](bot-guide.md).
- Modificato: [supabase/README.md](../supabase/README.md).
- Modificato: [supabase/tests/run-account-balances.mjs](../supabase/tests/run-account-balances.mjs).
- Modificato: [supabase/tests/run-cash-concurrency.mjs](../supabase/tests/run-cash-concurrency.mjs).
- Creato: [apps/bot/src/balances.ts](../apps/bot/src/balances.ts).
- Creato: [apps/bot/src/management.ts](../apps/bot/src/management.ts).
- Creato: [apps/bot/test/balances-management.test.ts](../apps/bot/test/balances-management.test.ts).
- Creato: [docs/milestones-b-c.md](milestones-b-c.md).
- Creato: [supabase/migrations/008_transaction_management.sql](../supabase/migrations/008_transaction_management.sql).
- Creato: [supabase/preflight/008_transaction_management.sql](../supabase/preflight/008_transaction_management.sql).
- Creato: [supabase/tests/management-concurrency.mjs](../supabase/tests/management-concurrency.mjs).
- Creato: [supabase/tests/transaction_management.sql](../supabase/tests/transaction_management.sql).

## Rifinitura UX prima del commit

- Pulsanti dello storico numerati e descrittivi (importo, categoria/conti, data), testo ANNULLATO e icona distinta. Etichette limitate conservativamente a 64 punti di codice; i riferimenti lunghi sono abbreviati con … senza alterare i dati o arrotondare gli importi. Callback indicizzate nella pagina/revisione: nessun UUID nell’etichetta. L’elenco rimane unico, senza filtri aggiuntivi.
- Un campo valido apre direttamente Prima/Dopo. **Conferma modifiche** e **Annulla operazione** sono distinti; **Modifica ancora** permette altri campi. Dopo successo, **Torna ai movimenti** effettua una nuova lettura. Request_id, payload congelato, versione e ricevute conservano le garanzie precedenti.
- Le osservazioni Saldi sono messaggi autonomi con orario Europe/Rome, mai modificati dalla pulizia dei pannelli. Aggiorna crea una nuova osservazione e invalida i pulsanti precedenti. Non sono salvate come nuovi dati contabili: rimangono nella chat Telegram.
- Per saldi l’invio Telegram ha un tentativo, senza reinvio automatico dopo esito incerto; gli update già gestiti sono ricordati fino a 1024 ID nel processo. Dopo riavvio quella memoria non è disponibile: non è promessa una consegna exactly-once. Le vecchie callback sono rifiutate, senza modificare il testo o la tastiera del vecchio saldo. In caso di mancata consegna usare esplicitamente un nuovo `/saldi`.
- Migrazioni 001–008, repository e SQL contabile non modificati dalla rifinitura; annullamento, audit e saldi sono verificati nel codice/fixture già esistenti e nelle regressioni applicative. Nessuna esecuzione remota o riesecuzione della migrazione 008 in questa task.

Checklist aggiornata: [guida Telegram](bot-guide.md#collaudo-rapido-della-rifinitura-bc).

### File della rifinitura UX

- [apps/bot/src/balances.ts](../apps/bot/src/balances.ts).
- [apps/bot/src/flow-delivery.ts](../apps/bot/src/flow-delivery.ts).
- [apps/bot/src/history.ts](../apps/bot/src/history.ts).
- [apps/bot/src/management.ts](../apps/bot/src/management.ts).
- [apps/bot/src/proposal-flow.ts](../apps/bot/src/proposal-flow.ts).
- [apps/bot/src/proposals.ts](../apps/bot/src/proposals.ts).
- [apps/bot/src/transport.ts](../apps/bot/src/transport.ts).
- [apps/bot/test/balances-management.test.ts](../apps/bot/test/balances-management.test.ts).
- [apps/bot/test/transport.test.ts](../apps/bot/test/transport.test.ts).
- [docs/architecture.md](architecture.md).
- [docs/bot-guide.md](bot-guide.md).
- [docs/milestones-b-c.md](milestones-b-c.md).
- [supabase/tests/management-concurrency.mjs](../supabase/tests/management-concurrency.mjs).
