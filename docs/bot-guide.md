# Guida del bot Telegram

Dalla root del progetto, configura privatamente `.env.local`. Se il file esiste già, mantienilo; altrimenti crealo partendo da `.env.example`.

- `TELEGRAM_BOT_TOKEN`: token fornito da BotFather (obbligatorio).
- `TELEGRAM_ALLOWED_CHAT_ID`: ID numerico positivo della tua chat privata (obbligatorio).
- `APP_TIMEZONE`: fuso orario, predefinito `Europe/Rome`.
- `DEFAULT_ACCOUNT`: `revolut` (predefinito), `isybank` oppure `contanti`.

Il programma carica `.env.local` a runtime tramite `process.loadEnvFile`, nativo di Node.js 22+. Le variabili già presenti nell'ambiente della shell hanno precedenza. Il file è escluso da Git: non pubblicare token, ID o contenuto del file. Per il polling non servono webhook secret o hosting. Per salvare servono le quattro variabili Supabase indicate sotto; vengono validate al primo salvataggio. La validazione locale controlla formato e presenza delle impostazioni; Telegram verifica il token alla prima richiesta.

Avvia dalla root:

```bash
npm run bot:dev
```

Il comando compila il progetto e avvia una singola istanza del bot. Per applicare modifiche al codice, arrestalo e rilancia il comando. All'avvio verifica `getWebhookInfo`: se esiste un webhook, si ferma senza cancellarlo. Per passare al polling occorre disattivare esplicitamente il webhook. Un conflitto con un'altra istanza di polling interrompe il programma: tieni attiva una sola istanza.

Quando compare “Bot locale attivo”, apri la chat privata con il bot configurato:

1. Invia `/start` o `/menu`: riceverai il menu per movimento o trasferimento guidato. `/help` mostra la guida con esempi.
2. Invia `8,30 tabacco`: riceverai una risposta personale con importo in euro, conto e data in formato giorno/mese/anno, con la dicitura “Solo anteprima: non ho salvato nulla”.
3. Invia `ciao`: riceverai una richiesta di importo valido e un esempio.
4. Puoi anche provare `ieri 12,50 spesa` oppure `20 benzina isybank`.

Arresta con **Ctrl+C** nel terminale. Il bot funziona soltanto mentre il programma è acceso e il Mac è connesso; durante stop o sospensione non risponde. Al riavvio può ricevere messaggi ancora in coda su Telegram.

Accetta esclusivamente messaggi testuali, nuovi o modificati, e callback dei pulsanti della chat privata autorizzata. Le altre chat e gli aggiornamenti non supportati vengono ignorati. Conserva la proposta attiva in memoria; soltanto la conferma salva il movimento in Supabase. Il parser usa la grammatica esplicita documentata sotto, senza interpretazione libera del linguaggio naturale.

L'offset è mantenuto **solo in memoria durante la sessione** e avanza dopo l'elaborazione o lo scarto di un aggiornamento. Non è idempotenza persistente: un arresto prima della conferma dell'offset, oppure un invio riuscito con risposta di rete persa, può produrre una risposta duplicata. La conferma è protetta dai clic duplicati nello stesso processo; non esiste ancora idempotenza persistente.

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

### Menu e inserimento guidato

Il testo libero continua a funzionare senza `/start`, anche quando è visualizzato il menu. In alternativa:

- `/start` e `/menu`: aprono il menu con **➕ Nuovo movimento** e **💸 Trasferimento**. Chiudono l'eventuale wizard o proposta precedente, dichiarandolo nella risposta.
- `/help`: mostra esempi e comandi senza interrompere il flusso attivo.
- `/cancel`: elimina qualsiasi menu, wizard o proposta attiva.

**Nuovo movimento:** Spesa/Entrata → importo testuale → categoria → conto → data → anteprima standard. Le categorie sono quelle del dominio, filtrate per tipo; per le entrate sono Stipendio, Regali e Progetti personali. L'importo riusa il parser esistente (`12`, `12,50`, `12.50`); un valore non valido lascia attivo lo stesso passaggio.

**Trasferimento:** importo → origine → destinazione → data → anteprima standard, senza categoria. I conti sono Revolut, Isybank e Contanti. La destinazione esclude il conto di origine; anche una callback manipolata con conti uguali viene rifiutata.

La data offre **Oggi**, **Ieri**, **📅 Altra data**. Quest'ultima richiede una data testuale della grammatica seguente, validata in `APP_TIMEZONE`; una data non valida non viene sostituita con oggi. **⬅️ Indietro** torna al passaggio precedente conservando i valori; cambiando tipo viene azzerata una categoria incompatibile e cambiando origine viene azzerata una destinazione che diventerebbe uguale. I passaggi successivi vanno comunque riconfermati. **❌ Annulla** elimina la compilazione.

Durante il wizard il testo serve al campo richiesto (importo o data); negli altri passaggi il bot invita a usare i pulsanti. Per tornare al testo libero usa `/cancel` oppure `/menu`. Lo stesso vale per un messaggio modificato durante la compilazione: non apre una seconda proposta indipendente.

Lo store condiviso usa uno stato discriminato `menu | wizard | proposal`. Il wizard contiene modalità, passaggio, cronologia per Indietro, valori parziali e revisione dei pulsanti. Non conserva il testo originale. Menu e wizard scadono dopo 30 minuti dalla creazione, senza rinnovo a ogni passaggio; a compilazione completa nasce la normale proposta con la propria durata di 30 minuti e gli stessi Conferma/Modifica/Annulla del testo libero. I pulsanti di stati sostituiti o passaggi precedenti sono invalidati. Riavviando il bot si perdono menu, wizard e proposte non confermate; i movimenti già salvati restano in Supabase.

Prova manuale completa, dopo l'avvio con `npm run bot:dev`:

1. **Testo libero:** invia `ieri 8,30 tabacco isybank` senza aprire il menu. Verifica anteprima e premi Conferma: deve dichiarare che la transazione è stata registrata dopo l'INSERT. Invia anche `20 pizza revolut`: il testo viene accettato, con eventuali classificazioni sconosciute da completare con Modifica.
2. **Spesa guidata:** `/start` → Nuovo movimento → Spesa → scrivi `12,50` → Cibo → Revolut → Oggi. Verifica la proposta; prova Modifica → Importo → `15`, poi Conferma.
3. **Entrata guidata:** `/menu` → Nuovo movimento → Entrata → `100` → Regali → Isybank → Altra data → `18/09/2026`. Verifica anteprima e Annulla.
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

Le regole esistenti di importo e data continuano a valere. La direzione viene riconosciuta prima degli alias di categoria. Il parser conserva origine e destinazione separatamente, senza utilizzare il conto predefinito o dedurre il conto opposto. `100 da revolut` e `100 a isybank` richiedono correzione; `100 da revolut a revolut` viene rifiutato con l'indicazione che i conti devono essere diversi. Un conto sconosciuto non viene sostituito con uno dei conti disponibili. Più direzioni nello stesso messaggio vengono considerate ambigue.

La proposta usa l'unione discriminata `TransactionDraft`: entrate/spese (o tipo ancora sconosciuto) hanno `account` e `category`; `transfer` ha esclusivamente `fromAccount` e `toAccount`, oltre a importo e data. Non contiene `account` o `category`. Il metadato di classificazione mantiene `category: null` per compatibilità con il contratto del classificatore, senza assegnare una categoria al trasferimento.

L'anteprima di un trasferimento mostra importo, data, Tipo: Trasferimento, Da e A, senza riga Categoria. Il menu Modifica offre importo, data, conto di origine, conto di destinazione e tipo. Sono selezionabili Revolut, Isybank e Contanti; una scelta che renderebbe i conti uguali viene rifiutata. **Scambia conti** inverte atomicamente una coppia completa: utile per invertire direttamente la direzione senza scegliere un conto intermedio.

Passando da entrata/spesa a trasferimento, `account` e `category` vengono eliminati e origine/destinazione partono entrambe da confermare. Occorre sceglierle esplicitamente, diverse tra loro. Tornando a entrata/spesa, `fromAccount` e `toAccount` vengono eliminati e si devono selezionare nuovamente conto e categoria. Nessun campo incompatibile viene mantenuto. Conferma rimane bloccata finché i campi necessari non sono completi.

Per provare il flusso, invia uno degli esempi, apri Modifica → Conto di origine/destinazione e verifica il rifiuto del conto uguale all'altro; usa Scambia conti per invertire la direzione. Prova anche Modifica → Tipo → Entrata e seleziona conto/categoria, oppure passa da una spesa a Trasferimento e scegli entrambi i conti. Conferma e Annulla restano disponibili. La conferma salva la transazione nel database; non calcola saldi e non sposta denaro presso le banche.

### Messaggi modificati su Telegram

Il polling richiede `message`, `edited_message` e `callback_query`. Se modifichi il testo di un messaggio nella chat privata autorizzata, il bot lo ricalcola e invia **un nuovo messaggio** con “Anteprima aggiornata, bro”: la precedente risposta resta nella chat, ma i vecchi pulsanti non possono più agire sulla nuova proposta. La nuova proposta sostituisce quella attiva, comprese eventuali correzioni manuali. Se modifichi il messaggio sorgente della proposta attiva rendendolo invalido, quella proposta viene rimossa e ricevi una richiesta di chiarimento.

L'offset segue `update_id`, non `message_id`: una modifica ha un nuovo aggiornamento pur riferendosi allo stesso messaggio. La gestione dell'offset rimane solo in memoria; i movimenti confermati sono persistiti in Supabase. Anche il webhook usa la stessa elaborazione; un eventuale webhook registrato con un filtro `allowed_updates` deve includere `edited_message` e `callback_query`. La sua configurazione non viene cambiata automaticamente.

### Conferma, modifica e annullamento

Il flusso locale è: messaggio → parsing → classificazione → anteprima → **✅ Conferma / ✏️ Modifica / ❌ Annulla**.

- **Conferma:** richiede conto, tipo e categoria risolti per entrate/spese; per `transfer` richiede origine e destinazione riconosciute e diverse, senza categoria. Avvia il salvataggio; solo dopo INSERT riuscito chiude il flusso e rimuove la proposta dalla memoria. La risposta dichiara “Transazione registrata”. Se fallisce, mostra un errore e conserva la proposta fino alla scadenza.
- **Annulla:** rimuove la proposta e invia una conferma di annullamento.
- **Modifica:** consente di scegliere Importo, Data, Conto, Tipo o Categoria. Per i trasferimenti offre invece origine e destinazione e nasconde la categoria. Conti, tipi e categorie usano pulsanti inline e gli ID già definiti nel dominio. Le categorie sono filtrate per tipo; cambiando tipo, una categoria incompatibile viene azzerata. Prima di selezionare una categoria occorre scegliere il tipo.
- **Importo/Data:** il messaggio testuale successivo viene interpretato come valore del campo selezionato. Scrivi solo `12,50`, oppure una data supportata come `18/09/2026`, `ieri` o `mercoledì`. Il parser esistente valida il valore; un errore lascia attiva la modifica. `eskere` non diventa la data di oggi. Il pulsante “↩️ Anteprima” esce dalla modifica senza cambiare il valore.

Dopo ogni modifica il bot invia una nuova anteprima completa con i tre pulsanti. Le precedenti schermate possono restare visibili, ma i loro pulsanti diventano obsoleti. Alla conferma/annullamento tenta anche di rimuovere i pulsanti dal messaggio cliccato; se Telegram non lo consente, rimangono comunque inutilizzabili.

Esiste **una sola proposta attiva per chat**. Un nuovo messaggio valido la sostituisce, salvo quando il bot sta aspettando un valore testuale di modifica. La proposta scade **30 minuti dopo la creazione**, senza rinnovo alle modifiche, ed è cancellata anche se il bot resta inattivo. Stop, errore che termina il polling o riavvio eliminano lo stato temporaneo, non le transazioni persistite. Un clic su una proposta scaduta, chiusa o sostituita mostra un avviso e non esegue l'azione.

Lo stato è isolato in `proposals.ts`, la logica del flusso in `proposal-flow.ts`, le viste in `proposal-view.ts` e l'invio Telegram in `flow-delivery.ts`. La memoria contiene soltanto i valori proposti e i metadati necessari al flusso, non il testo originale. Le scelte manuali aggiornano la proposta senza fingere una nuova classificazione automatica. Non esistono file di stato o servizi aggiuntivi per le proposte; Supabase conserva i movimenti confermati.

**Limiti:** i movimenti confermati sono persistiti; la conferma non trasferisce fondi e non calcola saldi. Il webhook conserva lo stato solo nello stesso processo: riavvii o istanze diverse possono far risultare la proposta scaduta. Il flusso supportato è il polling locale in una singola istanza. Lo stato cambia in memoria prima dell'invio delle risposte: una perdita di rete può impedire la consegna dell'ultima schermata; non c'è garanzia di consegna o idempotenza persistente.

Prova manuale:

1. Riavvia con `npm run bot:dev` dalla root e invia `ieri 8,30 tabacco isybank`.
2. Verifica importo, data, Isybank, Uscita, Tabacco e i tre pulsanti.
3. Premi Modifica → Importo. Invia `zero`: il bot mantiene la modifica attiva. Invia `12,50`: torna l'anteprima aggiornata.
4. Prova Modifica → Conto → Revolut, oppure Modifica → Tipo → Entrata e poi Categoria → Regali.
5. Premi Conferma: ricevi la conferma del salvataggio dopo l'INSERT riuscito. Ripremere un vecchio pulsante non ripete la conferma.
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


## Supabase 02: configurazione e collaudo manuale

Aggiungi privatamente a `.env.local`:

- `SUPABASE_URL`: URL del progetto già configurato.
- `SUPABASE_ANON_KEY`: chiave pubblica anon del progetto, mai service role.
- `SUPABASE_USER_EMAIL`: email dell'utente Auth dedicato già esistente.
- `SUPABASE_USER_PASSWORD`: password dello stesso utente.

Il bot esegue `signInWithPassword` al primo salvataggio e quando la sessione manca o sta per scadere. La sessione resta in memoria sullo stesso client delle query. Prima del lookup verifica l'utente con `getUser`. I conti sono letti tramite RLS, filtrati per `user_id` e `is_active = true`, poi risolti dai nomi Revolut, Isybank e Contanti. Nessun UUID è configurato nel codice. I log riportano soltanto codici applicativi, senza payload o errori grezzi dell'SDK.

Esegui personalmente questi controlli dal bot, osservando la tabella transactions in Supabase:

1. Avvia una sola istanza con `npm run bot:dev`. Invia una spesa sintetica e verifica che l'anteprima non aggiunga righe. Modifica importo o conto: ancora nessuna riga. Conferma: esattamente una riga expense con categoria/importo/data confermati, `from_account_id` corretto e `to_account_id` NULL.
2. Conferma un'entrata sintetica con categoria Stipendio: `to_account_id` corretto e `from_account_id` NULL.
3. Conferma un transfer Revolut → Isybank: entrambi gli UUID corretti e categoria NULL.
4. Conferma un transfer Isybank → Revolut: direzione inversa e categoria NULL.
5. Annulla una nuova proposta: nessuna riga aggiunta. Ripremi un vecchio pulsante Conferma: nessun nuovo INSERT.
6. Facoltativamente, arresta il bot e configura temporaneamente una password errata solo nell'ambiente privato. Riavvia e conferma una proposta sintetica: errore leggibile, nessun falso successo e proposta ancora disponibile. Ripristina la password e riavvia prima di proseguire.

In caso di risposta DB persa, verifica la tabella prima di riprovare: non è implementata idempotenza persistente. Se l'INSERT riesce ma la risposta Telegram fallisce, la riga resta salvata. Il collaudo reale non fa parte della suite automatica e non è stato eseguito dall'agente.


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
Non sono implementati saldi iniziali, riconciliazione o descrizioni.
