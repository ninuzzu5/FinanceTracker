# Architettura

FinanceTracker separa dominio, bot, frontend e database. Il codice locale richiede
le migrazioni fino a 009; la presenza dei file non certifica lo schema remoto.
Per avvio e uso vedi la [guida Telegram](bot-guide.md); per lo schema la
[guida Supabase](../supabase/README.md).

## Componenti

| Percorso | Responsabilità |
| --- | --- |
| `packages/domain` | Tipi, conti e alias, categorie, importi, date, parser e classificazione a regole |
| `apps/bot` | Autorizzazione Telegram, conversazioni, viste, trasporto e repository Supabase |
| `apps/web` | React/TypeScript/Vite con Supabase Auth e dati finanziari sintetici locali |
| `supabase` | Migrazioni, preflight e prove SQL isolate |

Il dominio non usa AI o un modello addestrato. Le regole privilegiano espressioni
specifiche e lasciano da completare i campi sconosciuti o conflittuali. Il valore
0.98 è un punteggio convenzionale, non una probabilità. Un trasferimento ha origine
e destinazione distinte e nessuna categoria; non si deducono controparti mancanti.

Gli importi sono positivi, con massimo sette cifre intere e due decimali negli
input del bot. Segni, importi multipli, migliaia e frazioni di centesimo vengono
rifiutati senza arrotondamenti. `transaction_date` è una data in `APP_TIMEZONE`;
`created_at` e `updated_at` sono istanti UTC. Date impossibili o ambigue non diventano oggi.
La riconciliazione e `/saldi` usano sempre `Europe/Rome`: con un altro fuso i giorni possono divergere.

## Conversazioni e consegna

`telegram.ts` autorizza la chat privata. Polling e webhook condividono
`flow-delivery.ts` e `ProposalFlow`; il percorso supportato è una sola istanza di
polling. Il webhook richiede un secret e non coordina lo stato fra processi.

`commands.ts` registra sette comandi. Il wizard e le modifiche aggiornano lo stesso
pannello; se Telegram rifiuta l’edit, viene inviato un nuovo messaggio e i vecchi
pulsanti rimangono invalidi. Non vengono cancellati messaggi utente o ricevute.

`proposals.ts` conserva uno stato per chat per 30 minuti, senza rinnovo a ogni
modifica. Bozze, pannelli, offset e ordine delle fonti non salvate sono in memoria;
il riavvio li perde. Lo store non conserva il testo grezzo. Il timeout di una
scrittura congela valori e chiave per il retry; chiudere il flusso non annulla il database.

Prima di creare una proposta si legge la ricevuta della fonte: se è già salvata
si mostra soltanto l’esito; se la lettura fallisce non si apre una nuova anteprima.
Un edit senza ricevuta deve appartenere alla proposta attiva, con verifica ripetuta
dopo la lettura asincrona e nel gestore sincrono. Non compila mai un campo come una
nuova risposta. `/help` conserva il flusso, ma una fonte trasformata in comando lo invalida.

Le consultazioni dei saldi sono messaggi autonomi con data/ora Roma. Aggiorna ne
crea uno nuovo. Ogni invio ha un tentativo e gli update già trattati sono ricordati
entro 1024 ID nel processo: non è una garanzia di consegna unica dopo un riavvio.

## Persistenza e proprietà

`persistence.ts` definisce i contratti; `supabase.ts` usa chiave pubblica,
`signInWithPassword`, sessione in memoria e `getUser`. Le richieste hanno timeout
di 15 secondi. La configurazione serve anche alle letture di storico e ricevute.
Endpoint remoti HTTPS senza userinfo; HTTP soltanto su loopback letterale verificato
prima della normalizzazione dell’URL. Gli errori di configurazione non espongono valori.

`sourceOperationKey` genera UUIDv8 opachi da namespace, chat e messaggio, senza
conservarne il testo. Il guidato eredita la chiave del comando iniziale. Un nuovo
messaggio resta una nuova operazione anche quando il contenuto è identico.

`save_transaction_once` risolve conti attivi posseduti in EUR e salva movimento e
ricevuta nella stessa transazione. La richiesta usa importi decimali testuali.
Unicità proprietario/richiesta, lock advisory e payload canonico proteggono retry
e conflitti. Una ricevuta coerente viene restituita prima dei controlli su conti
poi disattivati o giornate poi chiuse. La protezione non copre lo storico precedente
a 006. La migrazione 009 vieta nuove scritture dirette dai client applicativi.
Il namespace presuppone un bot per proprietario.

RLS e FK composite isolano i proprietari. Le RPC di scrittura sono
`SECURITY DEFINER`, con `auth.uid()`, filtri espliciti e `search_path` vuoto;
le letture sono `SECURITY INVOKER`. Ricevute e audit sono immutabili e non
memorizzano messaggi Telegram grezzi.

## Saldi e chiusure Contanti

Il database calcola i saldi: non esiste un saldo corrente duplicato nel frontend.

`apertura + entrate − uscite + trasferimenti ricevuti − inviati + rettifiche`

L’apertura è l’inizio della giornata; l’intervallo va da `opening_date` a `p_as_of`,
estremi inclusi. Ogni conto ha la propria apertura: un trasferimento compensa il
patrimonio solo quando entrambi i lati sono inclusi. Le banche possono avere
apertura negativa; Contanti richiede apertura non negativa, ma il teorico può esserlo.

`get_account_balances` include conti inattivi e rettifiche e scarta gli annullati.
Distingue `not_configured`, `before_opening` e `configured`: un `NULL` non vale zero.
Il bot legge `balance::text` e somma centesimi BigInt per tutti i conti. Aperture
incomplete o un conto principale mancante impediscono un totale parziale fuorviante.

`/riconcilia` confronta teorico e contato per oggi/ieri a fine giornata Roma.
La RPC ricalcola sotto lock, rifiuta anteprime obsolete e registra una rettifica,
senza entrate o uscite fittizie. Anche una differenza zero chiude il giorno.
La chiusura blocca scritture retroattive che coinvolgono Contanti. Non sono esposte
riapertura o annullamento delle rettifiche; la conversazione non si recupera dopo riavvio.

## Correzioni e storico

La migrazione 008 aggiunge `ledger_version`, `voided_at`, `voided_by` e
`transaction_changes`. Il saldo dipende dalla riga corrente; gli snapshot prima/dopo
sono audit, non un secondo ledger. L’annullamento conserva la riga ma la esclude
anche dai saldi storici. Non esistono cancellazione fisica, riattivazione o cambio tipo.

`manage_transaction_once` verifica proprietario, chiave, payload, conti e versione;
salva audit e modifica atomicamente. I lock seguono richiesta → conti Contanti
ordinati → movimento. Anche le correzioni bancarie acquisiscono i lock Contanti
per mantenere l’ordine comune con le chiusure. Serve `READ COMMITTED`.
I trigger controllano vecchi e nuovi riferimenti anche nell’annullamento.

Con 009, `anon`, `authenticated` e `PUBLIC` non hanno permessi diretti di scrittura
su conti e transazioni, neppure di colonna. Privilegi residui tramite altri ruoli
fanno fallire e annullare la migrazione, senza revocare appartenenze condivise.
Le aperture sono leggibili ma non modificabili dai client; eventuali correzioni
amministrative richiedono una procedura revisionata e tracciata.
I trigger richiedono stato iniziale valido e incremento di versione con audit coerente.
Le ricevute di creazione restano valide dopo le correzioni. Dopo riavvio un vecchio
pulsante può soltanto leggere una ricevuta, senza ricostruire o reinviare una scrittura.

Lo storico legge cinque transazioni più lookahead con cursore data/UUID decrescente,
importo testuale e filtro proprietario. Non include rettifiche e non è uno snapshot
congelato: dopo una modifica della data va riaperto. Non ci sono indici specifici
per grandi ledger; prima di aggiungerli occorre misurare le query.

## Frontend e verifiche

La dashboard usa solo aggregati statici in `apps/web/src/data/demo.ts` e tipi del
dominio. Usa Supabase Auth per login email/password, ripristino e logout locale,
senza leggere tabelle finanziarie o calcolare saldi. I trasferimenti sono esclusi
dai totali di entrate/uscite. `/` richiede una sessione verificata; `/accesso` mostra
il modulo agli utenti non autenticati. Configurazione pubblica e limiti della
protezione frontend sono descritti nella [guida web](../apps/web/README.md).
I dati temporanei andranno sostituiti con la futura integrazione, senza un ledger parallelo.

I test applicativi simulano i servizi. Le prove SQL locali mantengono RLS, trigger
e vincoli attivi; non certificano Auth, PostgREST o schema remoti. Dopo le
correzioni non è sicuro ripristinare il vecchio codice dei saldi. La
[guida Supabase](../supabase/README.md#backup-e-ripristino) descrive i controlli di recupero;
non è documentata una prova completata di restore. Per CI e limiti delle evidenze
vedi [controlli locali](ci.md).
