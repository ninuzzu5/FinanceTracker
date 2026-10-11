# Guida del bot Telegram

Dalla root del progetto, configura privatamente `.env.local`. Se il file esiste già, mantienilo; altrimenti crealo partendo da `.env.example`.

- `TELEGRAM_BOT_TOKEN`: token fornito da BotFather (obbligatorio).
- `TELEGRAM_ALLOWED_CHAT_ID`: ID numerico positivo della tua chat privata (obbligatorio).
- `APP_TIMEZONE`: fuso orario, predefinito `Europe/Rome`.
- `DEFAULT_ACCOUNT`: `revolut` (predefinito), `isybank` oppure `contanti`.

Il programma carica `.env.local` a runtime tramite `process.loadEnvFile`, nativo di Node.js 22+. Le variabili già presenti nell'ambiente della shell hanno precedenza. Il file è escluso da Git: non pubblicare token, ID o contenuto del file. Per il polling non servono webhook secret o hosting. Per usare il flusso attuale servono le quattro variabili Supabase indicate sotto; vengono validate alla prima operazione Supabase, anche lettura di ricevute o storico. La validazione locale controlla formato e presenza delle impostazioni; Telegram verifica il token alla prima richiesta.

Avvia dalla root:

```bash
npm run bot:dev
```

Il comando compila il progetto e avvia una singola istanza del bot. Per applicare modifiche al codice, arrestalo e rilancia il comando. All'avvio verifica `getWebhookInfo`: se esiste un webhook, si ferma senza cancellarlo. Per passare al polling occorre disattivare esplicitamente il webhook. Un conflitto con un'altra istanza di polling interrompe il programma: tieni attiva una sola istanza.

Quando compare “Bot locale attivo”, apri la chat privata con il bot configurato:

1. Invia `/start` o `/menu`: riceverai il menu per Movimento, Trasferimento, Storico e Contanti. `/help` mostra la guida con esempi.
2. Invia `8,30 tabacco`: riceverai una risposta personale con importo in euro, conto e data in formato giorno/mese/anno, con l’indicazione che è soltanto un’anteprima.
3. Invia `ciao`: riceverai una richiesta di importo valido e un esempio.
4. Puoi anche provare `ieri 12,50 spesa` oppure `20 benzina isybank`.

Arresta con **Ctrl+C** nel terminale. Il bot funziona soltanto mentre il programma è acceso e il Mac è connesso; durante stop o sospensione non risponde. Al riavvio può ricevere messaggi ancora in coda su Telegram.

Accetta esclusivamente messaggi testuali, nuovi o modificati, e callback dei pulsanti della chat privata autorizzata. Le altre chat e gli aggiornamenti non supportati vengono ignorati. Conserva la proposta attiva in memoria; soltanto la conferma salva il movimento in Supabase. Il parser usa la grammatica esplicita documentata sotto, senza interpretazione libera del linguaggio naturale.

L’offset Telegram è mantenuto **solo in memoria durante la sessione** e avanza dopo l’elaborazione o lo scarto di un aggiornamento. Non garantisce consegna unica delle risposte: un arresto prima della conferma dell'offset, oppure un invio riuscito con risposta di rete persa, può produrre una risposta duplicata. Questo riguarda la consegna Telegram, non la duplicazione finanziaria: la RPC B1 rende persistente l’idempotenza della stessa chiave di salvataggio, anche dopo timeout o riavvio.

Nel polling getUpdates/getWebhookInfo/sendMessage hanno timeout fino a 40 secondi (long polling Telegram di 30 secondi). Le chiamate accessorie per pannelli, callback e menu hanno un tentativo e timeout massimo di 5 secondi; il webhook imposta un tentativo e 2 secondi per il trasporto Telegram. Rete, risposte malformate, errori server e rate limit ricevono fino a 5 tentativi totali, con pause esponenziali e rispetto di `retry_after`. Esauriti i tentativi il bot termina con un errore sintetico: controlla la connessione e riavvialo. Ctrl+C interrompe anche richieste e pause. I log non includono token, URL del bot, chat ID o testo dei messaggi.

I test automatici usano trasporto simulato e non caricano `.env.local` né contattano Telegram. Il webhook resta disponibile e condivide elaborazione e trasporto con il bot locale; non usarlo contemporaneamente al polling.

Verifiche e audit separato per produzione/sviluppo:

```bash
npm run build
npm run typecheck
npm test
npm audit --omit=dev
npm audit --include=dev
```

### Menu e inserimento guidato

Il testo libero continua a funzionare senza `/start`, anche quando è visualizzato il menu. In alternativa:

- `/start` e `/menu`: aprono il menu con **Movimento**, **Trasferimento**, **Storico** e **Contanti**. Chiudono l'eventuale wizard o proposta precedente, dichiarandolo nella risposta.
- `/help`: mostra esempi e comandi senza interrompere il flusso attivo.
- `/cancel`: chiude lo stato attivo, inclusi storico e riconciliazione, senza cancellare dati già salvati.

**Movimento:** Spesa/Entrata → importo testuale → categoria → conto → data → anteprima standard. Le categorie sono quelle del dominio, filtrate per tipo; per le entrate sono Stipendio, Regali e Progetti personali. L'importo riusa il parser esistente (`12`, `12,50`, `12.50`); un valore non valido lascia attivo lo stesso passaggio.

**Trasferimento:** importo → origine → destinazione → data → anteprima standard, senza categoria. I conti sono Revolut, Isybank e Contanti. La destinazione esclude il conto di origine; anche una callback manipolata con conti uguali viene rifiutata.

La data offre **Oggi**, **Ieri**, **📅 Altra data**. Quest'ultima richiede una data testuale della grammatica seguente, validata in `APP_TIMEZONE`; una data non valida non viene sostituita con oggi. **⬅️ Indietro** torna al passaggio precedente conservando i valori; cambiando tipo viene azzerata una categoria incompatibile e cambiando origine viene azzerata una destinazione che diventerebbe uguale. I passaggi successivi vanno comunque riconfermati. **❌ Annulla** elimina la compilazione.

Durante il wizard il testo serve al campo richiesto (importo o data); negli altri passaggi il bot invita a usare i pulsanti. Un movimento completo valido in testo libero sostituisce il wizard con una proposta; un importo standalone continua a compilare il campo richiesto. Puoi anche chiudere il wizard con `/cancel` o tornare al menu con `/menu`.

Lo store condiviso usa uno stato discriminato `menu | wizard | proposal | reconciliation | history`. Il wizard contiene modalità, passaggio, cronologia per Indietro, valori parziali e revisione dei pulsanti. Non conserva il testo originale. Menu e wizard scadono dopo 30 minuti dalla creazione, senza rinnovo a ogni passaggio; a compilazione completa nasce la normale proposta con la propria durata di 30 minuti e gli stessi Conferma/Modifica/Annulla del testo libero. I pulsanti di stati sostituiti o passaggi precedenti sono invalidati. Riavviando il bot si perdono menu, wizard e proposte non confermate; i movimenti già salvati restano in Supabase.

Prova manuale completa, in un progetto di test isolato con dati sintetici, dopo l’avvio con `npm run bot:dev`:

1. **Testo libero:** invia `ieri 8,30 tabacco isybank` senza aprire il menu. Verifica anteprima e premi Conferma: deve dichiarare che la transazione è stata registrata dopo il salvataggio RPC. Invia anche `20 pizza revolut`: il testo viene accettato, con eventuali classificazioni sconosciute da completare con Modifica.
2. **Spesa guidata:** `/start` → Movimento → Spesa → scrivi `12,50` → Cibo → Revolut → Oggi. Verifica la proposta; prova Modifica → Importo → `15`, poi Conferma.
3. **Entrata guidata:** `/menu` → Movimento → Entrata → `100` → Regali → Isybank → Altra data → `18/09/2026`. Verifica anteprima e Annulla.
4. **Trasferimento guidato:** `/menu` → Trasferimento → `50` → Isybank → Revolut → Ieri. Verifica che la destinazione non offra Isybank e che l'anteprima non contenga Categoria. Conferma deve salvare un trasferimento con origine e destinazione corrette.
5. **Errori e navigazione:** ripeti un wizard, invia `zero` come importo e `31/02/2026` come data personalizzata: deve chiedere correzione. Prova Indietro, Annulla, `/help` e `/menu` a metà compilazione. I vecchi pulsanti non devono modificare il nuovo stato.

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

**Conto:** `revolut`, `isybank`, `isy`, `isy bank`, `contanti`, `cash`, `in contanti`, `liquidi`, senza distinzione maiuscole/minuscole. Per entrate e spese un conto esplicito prevale su `DEFAULT_ACCOUNT`; in sua assenza si usa il default configurato. Se compaiono più conti distinti senza una direzione di trasferimento, il bot chiede un solo conto. I nomi devono essere parole intere, non parti di altre parole.

### Trasferimenti tra conti personali

La struttura esplicita `da <conto> a <conto>` rappresenta un trasferimento, mai una spesa o un'entrata. Esempi:

```text
100 da revolut a isybank
trasferimento 100 da revolut a isybank
ieri 50 da isybank a revolut
```

Le regole esistenti di importo e data continuano a valere. La direzione viene riconosciuta prima degli alias di categoria. Il parser conserva origine e destinazione separatamente, senza utilizzare il conto predefinito o dedurre il conto opposto. `100 da revolut` e `100 a isybank` richiedono correzione; `100 da revolut a revolut` viene rifiutato con l'indicazione che i conti devono essere diversi. Un conto sconosciuto non viene sostituito con uno dei conti disponibili. Più direzioni o conti aggiuntivi fuori dal percorso, anche alias di una controparte già nominata, sono ambigui (B5): `12 da contanti a revolut e isybank` e `20 da revolut a isybank o contanti` richiedono chiarimento, senza destinazione arbitraria.

La proposta usa l'unione discriminata `TransactionDraft`: entrate/spese (o tipo ancora sconosciuto) hanno `account` e `category`; `transfer` ha esclusivamente `fromAccount` e `toAccount`, oltre a importo e data. Non contiene `account` o `category`. Il metadato di classificazione mantiene `category: null` per compatibilità con il contratto del classificatore, senza assegnare una categoria al trasferimento.

L'anteprima di un trasferimento mostra importo, data, Tipo: Trasferimento, Da e A, senza riga Categoria. Il menu Modifica offre importo, data, conto di origine, conto di destinazione e tipo. Sono selezionabili Revolut, Isybank e Contanti; una scelta che renderebbe i conti uguali viene rifiutata. **Scambia conti** inverte atomicamente una coppia completa: utile per invertire direttamente la direzione senza scegliere un conto intermedio.

Passando da entrata/spesa a trasferimento, `account` e `category` vengono eliminati e origine/destinazione partono entrambe da confermare. Occorre sceglierle esplicitamente, diverse tra loro. Tornando a entrata/spesa, `fromAccount` e `toAccount` vengono eliminati e si devono selezionare nuovamente conto e categoria. Nessun campo incompatibile viene mantenuto. Conferma rimane bloccata finché i campi necessari non sono completi.

Per provare il flusso, invia uno degli esempi, apri Modifica → Conto di origine/destinazione e verifica il rifiuto del conto uguale all'altro; usa Scambia conti per invertire la direzione. Prova anche Modifica → Tipo → Entrata e seleziona conto/categoria, oppure passa da una spesa a Trasferimento e scegli entrambi i conti. Conferma e Annulla restano disponibili. La conferma salva la transazione nel database; non calcola saldi e non sposta denaro presso le banche.

### Messaggi modificati su Telegram

Il polling richiede `message`, `edited_message` e `callback_query`. Una fonte non salvata modificata aggiorna l'anteprima nel pannello, invalidando i vecchi pulsanti; se diventa invalida o un comando, la proposta collegata viene chiusa. Una fonte già contabilizzata viene riconosciuta tramite ricevuta B1 prima di creare l'anteprima, anche dopo riavvio: solo avviso di registrazione, nessuna modifica al movimento. Se la lettura della ricevuta fallisce, non viene creata una nuova anteprima. L'ordinamento delle fonti non salvate è protetto soltanto nel processo attivo.

L'offset segue `update_id`, non `message_id`: una modifica ha un nuovo aggiornamento pur riferendosi allo stesso messaggio. La gestione dell'offset rimane solo in memoria; i movimenti confermati sono persistiti in Supabase. Anche il webhook usa la stessa elaborazione; un eventuale webhook registrato con un filtro `allowed_updates` deve includere `edited_message` e `callback_query`. La sua configurazione non viene cambiata automaticamente.

### Conferma, modifica e annullamento

Il flusso locale è: messaggio → parsing → classificazione → anteprima → **✅ Conferma / ✏️ Modifica / ❌ Annulla**.

- **Conferma:** richiede conto, tipo e categoria risolti per entrate/spese; per `transfer` richiede origine e destinazione riconosciute e diverse, senza categoria. Avvia il salvataggio; solo dopo il successo della RPC chiude il flusso e rimuove la proposta dalla memoria. La risposta dichiara “Transazione registrata”. Se fallisce, mostra un errore e conserva la proposta fino alla scadenza.
- **Annulla:** rimuove la proposta e invia una conferma di annullamento.
- **Modifica:** consente di scegliere Importo, Data, Conto, Tipo o Categoria. Per i trasferimenti offre invece origine e destinazione e nasconde la categoria. Conti, tipi e categorie usano pulsanti inline e gli ID già definiti nel dominio. Le categorie sono filtrate per tipo; cambiando tipo, una categoria incompatibile viene azzerata. Prima di selezionare una categoria occorre scegliere il tipo.
- **Importo/Data:** il messaggio testuale successivo viene interpretato come valore del campo selezionato. Scrivi solo `12,50`, oppure una data supportata come `18/09/2026`, `ieri` o `mercoledì`. Il parser esistente valida il valore; un errore lascia attiva la modifica. `eskere` non diventa la data di oggi. Il pulsante “↩️ Anteprima” esce dalla modifica senza cambiare il valore.

Dopo ogni modifica il bot aggiorna il pannello con l’anteprima completa e i tre pulsanti. Se Telegram rifiuta l’aggiornamento, invia un nuovo messaggio; i pulsanti precedenti restano obsoleti. Alla conferma/annullamento tenta anche di rimuovere i pulsanti dal messaggio cliccato; se Telegram non lo consente, rimangono comunque inutilizzabili.

Esiste **una sola proposta attiva per chat**. Un nuovo messaggio valido la sostituisce, salvo quando il bot sta aspettando un valore testuale di modifica. La proposta scade **30 minuti dopo la creazione**, senza rinnovo alle modifiche, ed è cancellata anche se il bot resta inattivo. Stop, errore che termina il polling o riavvio eliminano lo stato temporaneo, non le transazioni persistite. Un clic obsoleto non salva: se Conferma contiene una chiave B1 può soltanto leggere un’eventuale ricevuta già presente, altrimenti mostra un avviso.

Lo stato è isolato in `proposals.ts`, la logica del flusso in `proposal-flow.ts`, le viste in `proposal-view.ts` e l'invio Telegram in `flow-delivery.ts`. La memoria contiene soltanto i valori proposti e i metadati necessari al flusso, non il testo originale. Le scelte manuali aggiornano la proposta senza fingere una nuova classificazione automatica. Non esistono file di stato o servizi aggiuntivi per le proposte; Supabase conserva i movimenti confermati.

**Limiti:** i movimenti confermati sono persistiti; la conferma non trasferisce fondi e non calcola saldi. Il webhook conserva lo stato solo nello stesso processo: riavvii o istanze diverse possono far risultare la proposta scaduta. Il flusso supportato è il polling locale in una singola istanza. Lo stato cambia in memoria prima dell'invio delle risposte: una perdita di rete può impedire la consegna dell'ultima schermata; non c’è garanzia di consegna Telegram, mentre l’idempotenza finanziaria è persistente tramite B1.

Prova manuale in un progetto di test separato:

1. Riavvia con `npm run bot:dev` dalla root e invia `ieri 8,30 tabacco isybank`.
2. Verifica importo, data, Isybank, Uscita, Tabacco e i tre pulsanti.
3. Premi Modifica → Importo. Invia `zero`: il bot mantiene la modifica attiva. Invia `12,50`: torna l'anteprima aggiornata.
4. Prova Modifica → Conto → Revolut, oppure Modifica → Tipo → Entrata e poi Categoria → Regali.
5. Premi Conferma: ricevi la conferma del salvataggio dopo il salvataggio RPC riuscito. Ripremere un vecchio pulsante non ripete la conferma.
6. Invia una nuova proposta e premi Annulla. Prova anche `12 eskere`: prima della conferma dovrai scegliere tipo e categoria.

### Classificazione iniziale a regole

Il dominio espone `classifyMessage(text)` con `{ type, category, confidence, source }`. Gli identificatori sono stabili e separati dalle etichette italiane. I tipi sono `expense` (Uscita), `income` (Entrata), `transfer` (Trasferimento). Le direzioni esplicite tra conti personali identificano i trasferimenti prima delle regole lessicali di entrata/spesa, senza categoria.

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

Una corrispondenza completa non in conflitto ha `source: "rule"` e `confidence: 0.98`; è un punteggio convenzionale della regola, non una probabilità statistica. Un risultato incompleto o conflittuale usa `source: "unknown"`, confidenza 0 e almeno un campo `null`; le informazioni comuni alle regole possono restare note. `12 eskere` conserva l'anteprima di importo/data/conto con tipo e categoria “da confermare”, risolvibili dai pulsanti Modifica. Nessun salvataggio prima della conferma.

Queste sono regole lessicali per messaggi brevi, non comprensione del linguaggio naturale: negazioni, rimborsi e contesti complessi non sono interpretati. Gli alias sono volutamente essenziali. Un futuro classificatore locale potrà intervenire dopo un risultato sconosciuto, estendendo `ClassificationSource` con `model`; non è implementato né addestrato ora e non cambierà importo, data o conto. Nessuna API AI esterna e nessun dato personale nel repository: solo esempi sintetici nei test.


## Supabase: configurazione e collaudo manuale

Aggiungi privatamente a `.env.local`:

- `SUPABASE_URL`: URL del progetto già configurato.
- `SUPABASE_ANON_KEY`: chiave pubblica anon del progetto, mai service role.
- `SUPABASE_USER_EMAIL`: email dell'utente Auth dedicato già esistente.
- `SUPABASE_USER_PASSWORD`: password dello stesso utente.

Il bot esegue `signInWithPassword` alla prima operazione Supabase e quando la sessione manca o sta per scadere. La sessione resta in memoria sullo stesso client delle query. Prima dell’operazione verifica l’utente con `getUser`. Nel salvataggio, la RPC risolve UUID da nomi attivi univoci Revolut, Isybank e Contanti del proprietario e verifica EUR; storico e letture usano sessione autenticata e RLS. Nessun UUID è configurato nel codice. I log riportano soltanto codici applicativi, senza payload o errori grezzi dell'SDK.

Esegui questi controlli esclusivamente su un progetto di test con dati sintetici, osservando transactions e transaction_receipts:

1. Avvia una sola istanza con `npm run bot:dev`. Invia una spesa sintetica e verifica che l'anteprima non aggiunga righe. Modifica importo o conto: ancora nessuna riga. Conferma: esattamente una riga expense con categoria/importo/data confermati, `from_account_id` corretto e `to_account_id` NULL.
2. Conferma un'entrata sintetica con categoria Stipendio: `to_account_id` corretto e `from_account_id` NULL.
3. Conferma un transfer Revolut → Isybank: entrambi gli UUID corretti e categoria NULL.
4. Conferma un transfer Isybank → Revolut: direzione inversa e categoria NULL.
5. Annulla una nuova proposta: nessuna riga aggiunta. Ripremi un vecchio pulsante Conferma: nessun nuovo INSERT.
6. Facoltativamente, nel solo ambiente di test usa temporaneamente credenziali errate e riavvia: la lettura preventiva della ricevuta deve bloccare la nuova anteprima con errore leggibile, senza falso successo o scritture. Ripristina la configurazione privata prima di proseguire.

In caso di risposta DB persa, usa Riprova stessa operazione con la stessa chiave; non copiare il testo in un nuovo messaggio. Annulla non cancella scritture dall’esito incerto. Se l'INSERT riesce ma la risposta Telegram fallisce, la riga resta salvata. Il collaudo reale non fa parte della suite automatica e non è stato eseguito dall'agente.


## Contanti

Contanti è supportato per entrate, uscite e trasferimenti. Nel testo libero gli
alias `contanti`, `cash`, `in contanti` e `liquidi` individuano lo stesso conto.
Due conti distinti in un movimento ordinario restano ambigui; più alias dello
stesso conto non lo sono. Il conto predefinito resta Revolut; facoltativamente
`DEFAULT_ACCOUNT=contanti` permette di usare Contanti quando il conto è omesso.

Il wizard e Modifica offrono Contanti insieme a Revolut e Isybank. La conferma
continua a essere necessaria per salvare. Esempi:

- `12 pranzo in contanti`: uscita, Cibo, Contanti.
- `100 stipendio cash`: entrata, Stipendio, Contanti.
- `100 da revolut a contanti`: trasferimento verso Contanti.
- `50 da liquidi a isybank`: trasferimento da Contanti.
- `100 da cash a contanti`: rifiutato, perché i conti sono uguali.

I trasferimenti richiedono ancora la forma esplicita `da <conto> a <conto>` e
non vengono trattati come spese o entrate, anche se il testo contiene parole
come spesa o stipendio. La categoria resta nulla.

Prima di confermare un movimento Contanti, crea manualmente il conto come
descritto in [supabase/README.md](../supabase/README.md#configurazione-manuale-del-conto-contanti).
Se manca o non è attivo, il bot mostra l'errore esistente per conto non disponibile.
Saldi iniziali e riconciliazione sono implementati dalle migrazioni 004/005; la configurazione dell’apertura rimane manuale.

## Riconciliazione Contanti (migrazione 005)

Dopo l'applicazione manuale di 005, `/riconcilia` legge l'unico conto Contanti attivo
in EUR del proprietario del bot. Scegli oggi o ieri a fine giornata, inserisci il
saldo contato (anche `0`), verifica teorico/dichiarato/rettifica e premi Conferma.
`Cambia saldo` torna all'importo; Annulla e `/cancel` chiudono il flusso senza scrivere,
finché non è partita una conferma. Dopo un timeout, Annulla non annulla eventuali
scritture già completate: ritenta dalla stessa anteprima per mantenere la chiave.
Un conto senza entrambe le aperture configurate viene rifiutato.

La chiusura include tutto il giorno, fuso Europe/Rome; chiudere oggi impedisce altri
movimenti Contanti oggi. Date successive restano utilizzabili. Nessuna rettifica
è una spesa, entrata o trasferimento. Riapertura e annullamento di rettifiche
confermate non sono disponibili. Una differenza zero chiude comunque la giornata.

Test manuali **nel progetto di test**, dopo l'allineamento del database:

1. Con apertura assente: `/riconcilia` → Contanti oggi. Atteso: errore apertura,
   nessuna richiesta di importo e nessuna scrittura.
2. Con apertura verificata per l'ambiente di test: `/riconcilia` → Contanti ieri
   → `12,50` (sostituisci con il saldo realmente contato per il test). Controlla
   la differenza, premi Cambia saldo → `0` → Annulla. Nessuna rettifica salvata.
3. Ripeti con il saldo contato e Conferma. Controlla una sola riga in
   account_adjustments e saldo RPC uguale al dichiarato a fine giornata. Premi
   nuovamente il vecchio pulsante: nessuna riga aggiuntiva.
4. Dopo chiusura di ieri: `1 caffè contanti ieri` e `trasferisci 1 da Revolut a
   Contanti ieri`. Conferma ciascuna proposta: atteso errore giornata riconciliata,
   nessuna transazione inserita. Prova anche il trasferimento nella direzione inversa.
5. `/riconcilia` → ieri già chiuso: atteso blocco con richiesta di riapertura non
   disponibile. Un movimento oggi (se non chiuso) deve ancora funzionare.
6. Prima della conferma, registra da un altro client autenticato di test un movimento
   Contanti dello stesso giorno: la vecchia anteprima deve fallire per saldo cambiato.
   Avvia una nuova `/riconcilia`. Per timeout e concorrenza usa anche i test automatici.

Non usare questi esempi per inserire denaro inventato nei conti personali; gli
importi sono input di prova da adattare nell'ambiente isolato.

## Retry sicuri dei movimenti (migrazione 006, B1)

La conferma ora salva tramite RPC atomica con una chiave legata alla fonte.
Dopo un timeout usa **Riprova stessa operazione**: non cambiare i valori e non
copiare il messaggio in uno nuovo. Anche dopo un riavvio il vecchio pulsante può
verificare una ricevuta già salvata senza inserire un altro movimento. Annulla
chiude soltanto la conversazione e non elimina eventuali scritture riuscite.

Una nuova fonte identifica una nuova operazione: due messaggi identici possono
registrare due spese legittime. Nel guidato vale il comando /menu o /start iniziale.
Il controllo preventivo delle ricevute riconosce una fonte già contabilizzata e
mostra un avviso senza anteprima; la RPC rifiuta comunque una stessa chiave con
payload diverso. Non corregge il movimento originale. Persistenza delle bozze
e correzioni retroattive avanzate restano fuori dal flusso attuale.

Dopo aver applicato 006 in un ambiente di test:

1. Invia `0,29 tabacco revolut`, conferma due volte: una transazione e una ricevuta.
2. Modifica **quel messaggio** in `0,30 tabacco revolut`: deve comparire solo l’avviso di movimento già registrato,
   senza anteprima e con numero di transazioni invariato.
3. Invia **due messaggi distinti** `0,29 tabacco revolut`, conferma entrambi: due
   ulteriori operazioni con chiavi diverse, entrambe valide.
4. Per timeout, replay e riavvio usa i test automatici isolati. Il pulsante di una
   proposta scaduta senza ricevuta deve effettuare solo una lettura.

La migrazione non deduplica lo storico o le operazioni della vecchia versione:
prima dell'aggiornamento controlla i vecchi esiti incerti. Non provare questi
messaggi nei conti personali reali.

## Quattro milestone UX Telegram implementate

1. **UX 1 — Menu dei comandi:** registro unico dei sei comandi e aggiornamento nella chat autorizzata.
2. **UX 2 — `/movimenti`:** lettura autenticata dello storico reale, paginazione a cursore e trasferimenti singoli.
3. **UX 3 — Wizard compatto:** campi e riepiloghi sullo stesso pannello, Indietro/Annulla e passaggio al testo libero.
4. **UX 4 — Anteprime:** modifica del pannello, invalidazione delle vecchie callback e verifica preventiva delle ricevute B1 per fonti già salvate.

### Registrazione comandi e pannelli

All'avvio del polling il bot registra `/start`, `/menu`, `/movimenti`, `/riconcilia`,
`/help`, `/cancel` tramite `setMyCommands`, con scope della chat autorizzata. Il
webhook registra al primo POST autenticato di ciascun processo. Un errore non
interrompe il bot e non espone il motivo grezzo. Non occorre modificare BotFather.
Dopo build/riavvio apri la chat privata autorizzata, digita `/` o riapri la chat se
Telegram mantiene il menu in cache. Il registro è `apps/bot/src/commands.ts`.

Il menu contiene Movimento, Trasferimento, Storico e Contanti. Menu, wizard,
modifiche di campi e riepilogo usano il message_id restituito da Telegram per
aggiornare lo stesso pannello. Conferma e annullamento chiudono i pulsanti; la
ricevuta conservata include i dati del movimento. Un nuovo flusso invalida il
precedente e prova a rimuoverne i pulsanti. Un fallimento di modifica usa un nuovo
messaggio; il vecchio stato rimane invalido. Non vengono eliminati messaggi utente
o ricevute. L'errore Telegram “message is not modified” è un no-op riuscito.

Un importo/data standalone continua a compilare il campo del wizard; un movimento
completo in testo libero sostituisce il wizard. `/help` normale mostra la guida
senza interrompere il flusso. Se la fonte della proposta viene modificata in
`/help`, la proposta viene invece invalidata.

Prima di creare un'anteprima da una fonte Telegram, il percorso di consegna legge
`get_transaction_receipt` con **la stessa chiave B1**, senza un nuovo sistema di
deduplicazione persistente. Una fonte già salvata mostra direttamente un avviso,
anche dopo un riavvio e anche se modificata in un comando. Una lettura fallita
blocca l'anteprima; una conferma con esito incerto mantiene la chiave B1. Fonti
non salvate aggiornate in ritardo non possono sostituire una sessione più recente
nel processo attivo. Due nuovi message_id identici nel contenuto rimangono due
operazioni distinte.

### Storico reale e paginazione

`/movimenti` legge solo `transactions`, cinque operazioni per pagina, con una
sesta riga di lookahead. La query usa sessione autenticata, filtro user_id e RLS,
embedding dei due conti tramite FK esistenti. Ordine: transaction_date DESC,
id DESC; il cursore contiene data e UUID dell'ultima riga visibile. Nessun conteggio
completo, download del ledger o offset crescente. L'importo viene richiesto a
PostgREST come `amount::text` e formattato con BigInt: niente perdita di centesimi
per valori grandi. Valori storici incompatibili o valute non EUR producono un
errore sicuro, senza arrotondamenti.

Un trasferimento è una sola riga con origine → destinazione; non ha categoria né
segno di entrata/uscita. Entrate e uscite mostrano +/− e categoria. Le rettifiche
Contanti stanno in `account_adjustments` e **non** vengono mescolate allo storico
delle transazioni o rappresentate come spese/entrate fittizie; lo storico lo
precisa. Questa task non aggiunge uno storico dedicato delle rettifiche.

Le callback di pagina hanno sessione e revisione; pagine non valide, letture in
corso, scadenza, nuova operazione o riavvio impediscono navigazioni obsolete.
Una lettura fallita invita a riaprire `/movimenti`; non permette modifiche,
eliminazioni o annullamenti retroattivi. Nessuna nuova migrazione richiesta.

### Limiti tecnici

- I pannelli, le bozze e l'ordinamento degli update non salvati sono in memoria.
  Dopo riavvio le vecchie callback non ricostruiscono bozze: solo quelle B1 con
  chiave possono leggere una ricevuta. Non è introdotta persistenza delle bozze o
  coordinamento UX multiistanza; polling unico rimane il percorso supportato.
- La scadenza ripulisce il messaggio quando viene rilevata da un aggiornamento;
  nessun nuovo servizio di background. Telegram può rifiutare modifiche di
  messaggi non disponibili; fallback e invalidazione restano sicuri.
- B1 non associa ricevute alle transazioni anteriori a 006: non è possibile
  riconoscere automaticamente una vecchia fonte contabilizzata da quella versione.
- La paginazione non è uno snapshot congelato tra richieste. Inserimenti recenti
  non spostano le pagine successive; modifiche manuali retroattive del ledger
  possono cambiarne il contenuto. Il cursore e il tie-break UUID sono stabili.
- Nessun indice nuovo: limit e cursore evitano offset/download, ma grandi ledger
  possono richiedere un futuro indice su user_id/transaction_date/id. Le FK e il
  supporto PostgREST al cast testuale devono essere quelli della baseline. Il
  catalogo remoto e Auth reale non sono stati interrogati durante questa task.
- L'aggiornamento del menu Telegram avviene quando si avvia il bot aggiornato;
  non è stato eseguito su Telegram durante lo sviluppo. Non sono stati letti token.

### Collaudo manuale dopo il riavvio

Usa esclusivamente un progetto di test separato, con schema allineato a 007. Le
verifiche che confermano movimenti/rettifiche scrivono dati sintetici: non eseguirle
nei conti personali reali.

1. Digita `/`: devono apparire i sei comandi; `/start` e `/menu` mostrano quattro
   opzioni. Apri Storico e Contanti dal menu.
2. `/movimenti`: verifica importi, date/categorie/conti; su più di cinque righe usa
   Avanti e Indietro. Un trasferimento deve apparire una volta con la freccia.
3. Movimento → Entrata/Uscita → `12,50` → categoria → conto → oggi; torna indietro,
   modifica l'importo nell'anteprima e annulla. Il messaggio principale si aggiorna
   e nessun movimento viene salvato con Annulla.
4. Trasferimento → `10` → Revolut → Contanti → ieri; conferma una sola volta e
   riclicca: resta un movimento e una ricevuta leggibile.
5. Nel wizard scrivi `12 pranzo contanti`: il testo libero sostituisce la
   compilazione. Fuori dal wizard usa `100 stipendio revolut`.
6. Prima di confermare `12 pranzo revolut`, modifica la fonte in `13 pranzo
   contanti`: anteprima aggiornata e vecchi pulsanti invalidi. Modificala invece in
   `/help`: proposta chiusa.
7. Su dati di test conferma un movimento e modifica la sua fonte: solo avviso di
   registrazione, nessuna anteprima. Invia lo stesso testo con un nuovo messaggio:
   è una nuova operazione legittima. Riavvia e riprova il vecchio pulsante: solo
   lettura di ricevuta, nessun nuovo salvataggio.
8. Sostituisci una proposta con `/menu`, prova callback vecchie, `/cancel` e una
   proposta oltre 30 minuti: nessuna conferma possibile. La pulizia è best effort.
9. Ripeti `-€12 spesa revolut`, `−€12 spesa revolut`, `- EUR 12 spesa revolut`,
   `–12 spesa revolut`, `12 da contanti a revolut e isybank`,
   `20 da revolut a isybank o contanti`: nessuna anteprima confermabile.
10. `/riconcilia`: prova annullamento e, solo con dati sintetici e apertura
    configurata, conferma/doppio clic; il giorno chiuso resta protetto.

## Integrità contabile e fuso orario

La versione attuale richiede migrazioni fino a 007, da applicare manualmente secondo
[ordine e preflight](../supabase/README.md#migration-order). B2 rifiuta importi
non finiti/non positivi/sub-cent e date non finite anche con INSERT/UPDATE diretti;
non arrotonda né corregge lo storico. B3 impone EUR a tutti i conti e verifica la
valuta nel salvataggio. B4 rifiuta l’intera espressione monetaria con segni prima
o dopo valuta/importo, inclusi minus Unicode e spazi: niente sottostringa positiva.
B5 richiede chiarimenti sui conti aggiuntivi nei trasferimenti.

transaction_date è una data in APP_TIMEZONE; created_at è un istante timestamptz,
non mostrato nel bot. 17:08 UTC e 19:08 Europe/Rome durante l’ora legale sono lo
stesso istante: non cambiare timezone del database o aggiungere ore ai dati.
La riconciliazione usa Europe/Rome fisso: mantieni il fuso predefinito per coerenza;
l’unificazione con APP_TIMEZONE diverso richiede una task separata.

Le aperture sono configurate manualmente, non tramite wizard; non esiste un
comando generale dei saldi. `/riconcilia` legge il teorico Contanti, mentre la RPC
get_account_balances è disponibile ai client autenticati per tutti i conti.
