# Sicurezza

## Cosa tengo fuori da Git

Non pubblicare token Telegram, webhook secret, chat ID personali, credenziali Auth,
chiavi Supabase secret/service role, sessioni, JWT, URL di database con password o
UUID personali. I file `.env*` restano privati, tranne `.env.example` con soli segnaposto.

Anche movimenti, saldi, esportazioni bancarie/Notion, screenshot con dati personali e
frasi di addestramento ricavate dallo storico devono restare privati. Controlla
contenuto e provenienza degli eventuali modelli generati prima di pubblicarli.
Usa dati sintetici per test, esempi e immagini. Prima di pubblicare controlla anche
nomi ed email nei metadati Git: impostare una email noreply non corregge i vecchi commit.

## Se viene esposto un segreto

Revocalo o ruotalo subito. Cancellare il valore dal file non lo elimina dalla
cronologia e non lo rende inutilizzabile. Valuta l’esposizione di branch, tag,
artefatti e copie prima di rendere pubblico il repository. Un’eventuale pulizia
della cronologia va pianificata; non riscrivere commit o fare force push alla cieca.
Non aprire issue pubbliche contenenti segreti o dettagli sfruttabili: contattami in privato.

## Auth, RLS e browser

Il bot usa la chiave pubblica e un utente Supabase Auth dedicato. La sessione resta
in memoria e `getUser` ne verifica il proprietario. Letture e scritture usano
quell’identità. RLS e vincoli di proprietà isolano le righe; le RPC di scrittura
`SECURITY DEFINER` controllano esplicitamente `auth.uid()`, proprietario e conti,
con `search_path` vuoto. Le letture usano `SECURITY INVOKER` e RLS.

La chiave pubblica non sostituisce Auth o le policy. Non usare secret/service role
nel flusso ordinario. Non inviare al browser credenziali Auth del bot, password,
access/refresh token, sessioni o chiavi privilegiate. Il frontend attuale usa solo
fixture locali e non espone configurazioni Supabase.

Gli endpoint remoti richiedono HTTPS senza userinfo. HTTP è ammesso solo per
`localhost`, `127.0.0.1` e `[::1]` letterali, con porta opzionale. Il validatore
rifiuta anche forme ambigue normalizzate da `URL`. I log non devono includere
URL sensibili, errori SDK grezzi, messaggi Telegram o valori finanziari.

## Precauzioni operative

- Autorizza una sola chat privata. Il polling usa la lista consentita; il webhook richiede il proprio secret. Non usarli insieme e mantieni una sola istanza: lo stato conversazionale non è condiviso.
- Segui [ordine delle migrazioni e preflight](supabase/README.md#migration-order). Non rieseguire baseline o migrazioni già applicate. Auth, conti EUR e aperture verificate vanno predisposti separatamente. I vincoli storici `NOT VALID` non certificano i dati precedenti.
- Non modificare il namespace delle chiavi operative e non associare più bot allo stesso proprietario senza un piano di compatibilità. Solo `save_transaction_once` garantisce il retry dello stesso inserimento; non copre inserimenti diretti o storico precedente alla migrazione 006.
- Dopo un esito incerto usa lo stesso pulsante. La chiusura della conversazione non è un rollback. Una risposta Telegram mancata non prova che il database non abbia salvato.
- Le correzioni passano da `manage_transaction_once`, con verifica di versione, conti attivi EUR e registro prima/dopo immutabile. `authenticated` non può aggiornare o cancellare direttamente `transactions`. L’annullamento preserva riga e ricevuta e non consente riattivazione.
- Non disabilitare trigger, ampliare grant o modificare manualmente il ledger per aggirare una chiusura Contanti. Le protezioni controllano sia i riferimenti precedenti sia quelli nuovi. Un amministratore può alterarle: l’audit applicativo non è un audit completo degli amministratori, delle aperture o degli inserimenti esterni.
- Dopo le correzioni della migrazione 008, il vecchio codice dei saldi ricontabilizzerebbe gli annullati. Usa una migrazione correttiva revisionata o un ripristino pianificato, conservando audit e ricevute.

## Verifiche e recupero

La [CI](docs/ci.md) controlla anche dipendenze e database locali isolati. Queste
prove non verificano Auth/JWT, RLS e grant installati, cast PostgREST, consegna
Telegram o backup del progetto remoto. Le regole di protezione dei branch vanno
verificate separatamente; la nuova definizione CI non ha una verifica hosted documentata.

Non è documentata una prova completata di ripristino: questo non dimostra che i
backup siano assenti. Prima di affidarti al recupero verifica disponibilità e
retention e prova il restore su una copia isolata, con controlli di proprietari,
annullamenti, ricevute, saldi e chiusure. Registra punto recuperabile, perdita
massima e tempo di ripartenza. Non reinviare alla cieca messaggi successivi al
backup: perdere una ricevuta può perdere anche la deduplicazione.
La [procedura di recupero](supabase/README.md#backup-e-ripristino) conserva i controlli necessari.

Il codice locale ignora gli edit Telegram estranei al flusso attivo. La correzione,
verificata localmente il 22 ottobre 2026, non modifica la release v1.0.0 pubblicata.
Per compilare un campo invia una nuova risposta e verifica il riepilogo prima di confermare.
