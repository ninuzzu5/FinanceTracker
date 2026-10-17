# Architettura attuale

Fonte di verità: codice del branch `dev` e migrazioni versionate. La presenza dei file SQL non dimostra che siano applicati sul database remoto. Per l'operatività vedi [guida Telegram](bot-guide.md) e [Supabase](../supabase/README.md).

## Dominio deterministico

`packages/domain` separa tipi, conti/alias, categorie/etichette, importi, date, parser e classificazione lessicale. Non usa AI o un modello addestrato. Le regole riconoscono frasi complete, privilegiano evidenze specifiche e lasciano sconosciuti/conflittuali i campi da completare manualmente. La confidenza 0.98 è un punteggio convenzionale, non probabilità statistica.

Un movimento ha conto, tipo e categoria; un trasferimento ha origine e destinazione distinte, senza categoria. Il percorso esplicito `da <conto> a <conto>` precede le regole entrata/uscita. Non si inferiscono controparti; menzioni aggiuntive, anche alias fuori dal percorso, richiedono chiarimento. Contanti riconosce cash/liquidi; i nomi delle righe Supabase rimangono Revolut, Isybank e Contanti.

Il parser rifiuta zero, segni anche Unicode attorno alla valuta, più importi, separatori delle migliaia e frazioni di centesimo: non recupera sottostringhe positive né arrotonda. Accetta massimo sette cifre intere e due decimali. Le date sono giorni di calendario in APP_TIMEZONE (default Europe/Rome), non timestamp UTC; date impossibili/ambigue non diventano oggi. La grammatica completa e le categorie sono nella guida.

## Flusso Telegram e quattro milestone UX

`telegram.ts` autorizza una sola chat privata; `polling.ts`/`local.ts` gestiscono polling e offset in memoria. `apps/bot/api/telegram.ts` espone il webhook con secret, senza coordinamento multiistanza. Entrambi usano `flow-delivery.ts` e `ProposalFlow`.

1. **Menu comandi:** `commands.ts` registra start, menu, saldi, movimenti, riconcilia, help e cancel nella chat autorizzata; polling all'avvio, webhook al primo POST autenticato del processo.
2. **Storico:** `history.ts` e repository leggono cinque transazioni per pagina, più lookahead, ordinando data/UUID decrescenti con cursore. Un trasferimento compare una volta. Le rettifiche non sono transazioni e restano escluse.
3. **Wizard compatto:** `wizard-state.ts`, `wizard.ts` e viste gestiscono entrata/uscita o trasferimento, navigazione Indietro e campi validati. Il pannello viene aggiornato con editMessageText; un testo libero completo può sostituire il wizard.
4. **Anteprime:** uno stato attivo per chat; revisione/sessione invalidano callback precedenti. Modifiche della fonte aggiornano l'anteprima; fonti già salvate vengono riconosciute leggendo la ricevuta B1 prima del parsing operativo. Lettura fallita: niente nuova anteprima. Pulizia pulsanti best effort, fallback a nuovo messaggio; ricevute e messaggi utente non vengono cancellati.

`proposals.ts` conserva menu/wizard/proposal/reconciliation/history/balances/management con TTL di 30 minuti e timer di rimozione della memoria; la pulizia visiva avviene su attività. Nessun testo grezzo è conservato nello store. Riavvio perde bozze/pannelli/ordinamento delle fonti non salvate. `/help` normale conserva il flusso; una fonte attiva modificata in un comando lo invalida. La conferma produce un effetto di persistenza; solo il successo chiude la proposta. Esiti incerti congelano valori e chiave per il retry.

## Persistenza, proprietà e B1

`persistence.ts` definisce contratto, validazione/mapping ed errori; `supabase.ts` implementa transazioni, ricevute, storico e riconciliazione. Usa chiave pubblica, signInWithPassword, sessione in memoria e getUser per verificarne il proprietario. Fetch limitato a 15 secondi; niente service role. Configurazione richiesta anche per le letture di storico/ricevute, non solo al salvataggio.

`save_transaction_once` risolve gli UUID dei conti attivi posseduti, verificando nomi univoci ed EUR, e inserisce movimento e ricevuta atomicamente. L'importo validato dal dominio passa alla RPC come stringa decimale esatta. Spesa: from_account_id; entrata: to_account_id; trasferimento: entrambi e categoria NULL. Nessuna operazione presso le banche.

`operation-key.ts` deriva UUIDv8 opachi da namespace/chat/message_id, non dal contenuto. Il guidato eredita la chiave dal comando iniziale. Retry e replay riusano la chiave; due messaggi identici distinti possono creare due movimenti. Unicità user_id/request_id, lock advisory e payload canonico in 006 impediscono duplicati o riuso con payload diverso. La ricevuta coerente viene restituita prima dei controlli su conti successivamente disattivati o giornate chiuse.

RLS e FK di proprietà isolano i dati. Le RPC di scrittura riservate sono SECURITY DEFINER con search_path vuoto, auth.uid e filtri espliciti; le letture sono SECURITY INVOKER. Ricevute immutabili e FK impediscono cancellazioni che riabiliterebbero una chiave. La garanzia presuppone un bot per proprietario e non copre inserimenti diretti o storico senza ricevute. Callback B1 dopo riavvio possono solo leggere una ricevuta, senza reinserire un payload perso.

## Saldi e riconciliazione

004 aggiunge apertura/data nullable con presenza congiunta. Apertura = inizio giornata; intervallo inclusivo da opening_date a p_as_of. `get_account_balances` distingue not_configured/before_opening con saldo NULL da configured. Include conti inattivi e, dopo 005, rettifiche non annullate. Dopo 008 esclude transazioni annullate. Nessun saldo corrente duplicato:

`apertura + entrate − uscite + trasferimenti ricevuti − inviati + rettifiche`

Ogni conto usa la propria apertura: un trasferimento compensa il patrimonio solo quando entrambi i lati sono inclusi. Aperture bancarie negative consentite; apertura Contanti non negativa, ma saldo teorico può scendere sotto zero. Numeric SQL esatto; il bot usa stringhe/BigInt per saldi Contanti e formattazione dello storico.

005 introduce account_adjustments e `/riconcilia`: oggi/ieri a fine giornata Europe/Rome, saldo dichiarato non negativo (zero valido), anteprima del teorico/differenza, conferma o annullamento. Apertura mancante impedisce l'operazione. La RPC ricalcola sotto lock, rifiuta anteprime obsolete e registra delta senza entrate/uscite fittizie. Request_id idempotente, unicità della chiusura e lock condivisi proteggono gare con movimenti/trasferimenti; READ COMMITTED richiesto.

Chiusura blocca INSERT/UPDATE/DELETE che coinvolgono Contanti fino a quella data e modifiche contabili del conto riconciliato. account_adjustments contiene voided_at, ma nessuna API/comando di annullamento delle rettifiche o riapertura. L’annullamento dei normali movimenti è invece disponibile con 008. Dopo timeout, annullare il flusso non annulla il database; la conversazione di riconciliazione non viene recuperata dopo riavvio.

007 protegge INSERT e UPDATE diretti: importi positivi, finiti, massimo due decimali, date finite; nessun arrotondamento. I CHECK transazioni NOT VALID preservano lo storico senza certificarlo. EUR è vincolo di tutti i conti, anche inattivi: impedisce trasferimenti FX e modifiche incoerenti; non converte dati. Preflight obbligatorio, nessuna riparazione automatica.

## Limiti e sviluppi futuri

Dashboard in `apps/web` non implementata: leggerà Supabase autenticato; niente dataset demo parallelo. Stack web e realtime sono ipotesi, non contratti attuali. created_at/updated_at sono istanti UTC e non compaiono nel bot; una futura UI dovrà formattarli esplicitamente nel fuso desiderato. transaction_date resta una data.

APP_TIMEZONE diverso da Europe/Rome può divergere dalla riconciliazione: uniformare questo contratto in una task dedicata. Mancano gestione aperture via bot, riaperture/cambio tipo e storico rettifiche. Stato UX multiistanza, snapshot dello storico e indici per ledger grandi richiedono valutazione separata.

Vitest usa servizi simulati; runner SQL separati applicano migrazioni in database sintetici isolati con RLS/trigger/vincoli attivi. PostgreSQL nativo verifica lock e concorrenza; Auth locale minimo non certifica Auth/JWT, catalogo o rete Supabase remoti.

## Milestone B/C: saldi e correzioni controllate

`balances.ts` usa get_account_balances con proiezione PostgREST balance::text; lo SDK non decodifica numeric in Number. Somma in BigInt tutti i conti restituiti, anche inattivi o aggiuntivi. Not_configured/before_opening/mancanza dei conti principali rendono il totale non disponibile, senza NULL→zero. Default e Aggiorna usano Europe/Rome. Sessione/revisione e loading impediscono callback obsolete; un risultato di lettura sostituito viene ignorato. Le rilevazioni `/saldi` sono messaggi autonomi con data/ora: anche Aggiorna ne crea una nuova. Restano fuori dalla mappa dei pannelli modificabili e dalla pulizia generica. Invio a tentativo singolo e memoria limitata degli update `/saldi` evitano reinvii automatici; non costituiscono una garanzia di consegna exactly-once dopo riavvio.

`management.ts` riusa storico, dominio e formattazione. Selezione indicizzata nella pagina in memoria con etichette descrittive e numeri corrispondenti nel testo, dettaglio riletto dal database, editor a tipo fisso, prima/dopo automatico dopo un campo valido e conferma esplicita. Lo stato di successo offre il ritorno allo storico riletto, senza consentire nuove scritture dalla vecchia conferma. Importi originali rimangono stringhe esatte; i nuovi input riusano parseAmountInput (massimo sette cifre intere) e parseDateInput. Nessuna conversione Number degli importi storici. Gli UUID dei conti sono quelli della lettura autenticata, ricontrollati in SQL.

008 aggiunge transactions.ledger_version, voided_at/voided_by e transaction_changes. La riga corrente è l'unica fonte per i saldi; gli snapshot prima/dopo sono un audit append-only, non un secondo ledger. Ogni richiesta edit/void ha UUID stabile, payload canonico e ricevuta persistente nello stesso audit. Non esiste DELETE fisico né riattivazione. L'annullamento esclude il movimento per tutte le date di lettura: è una rettifica dello storico, non una scrittura compensativa alla data odierna. I movimenti modificati cambiano posizione nello storico se cambia la data; riaprire /movimenti dopo la conferma.

manage_transaction_once autentica auth.uid, serializza per proprietario/chiave, recupera ricevute prima dei controlli correnti, poi acquisisce i lock Contanti ordinati prima del lock del movimento. Ricontrolla versione, stato, conti posseduti attivi EUR e dati finanziari, aggiunge audit e applica UPDATE atomico. Il trigger 005 controlla ancora OLD/NEW, incluso void: nessuna riapertura implicita. Reconcile_cash non prende lock sulle righe transazione, quindi questo ordine evita il ciclo conto/movimento. Le operazioni sullo stesso Contanti vengono serializzate anche per correzioni bancarie: compromesso prudente per tre conti personali.

UPDATE/DELETE diretti sono revocati ad authenticated; un nuovo trigger richiede versione incrementale e snapshot di audit coerenti per UPDATE, stato iniziale valido per INSERT e vieta DELETE. RLS sul registro consente solo letture proprie; scritture riservate alla RPC SECURITY DEFINER con search_path vuoto e owner esplicito. Le ricevute 006 non vengono modificate: un replay originario recupera lo stesso ID anche dopo correzione/annullamento. Chiavi delle correzioni e B1 hanno registri e namespace di lock separati.

Dopo timeout l'editor congela chiave/payload; stesso pulsante ritenta. Dopo riavvio il pulsante con chiave può solo leggere get_transaction_change_receipt: niente ricostruzione della scrittura. La bozza non è persistente. Dettagli in [guida B/C](milestones-b-c.md).
