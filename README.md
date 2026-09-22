# Finance Tracker

Personal finance tracker designed around a low-friction Telegram bot and a realtime web dashboard.

The local bot accepts short messages such as `8,30 tabacco`, extracts amount, date and account, classifies type/category with deterministic rules, and replies with a temporary proposal and inline Confirm/Edit/Cancel buttons. **No transaction is permanently saved, even after confirmation.** Persistence, budgets and the dashboard are future work.

## Project status

Local preview MVP available through Telegram long polling. The future end-to-end milestone is:

```text
Telegram message
  → deterministic amount/date parsing
  → category/type classification
  → validation
  → Supabase insert
  → confirmation with remaining budget
```

## Principles

- No calls to external AI APIs.
- Amounts and dates are parsed using deterministic rules.
- Type and category currently use deterministic rules; a small local classifier may later handle unknown cases.
- Unknown classifications remain “da confermare”; inline editing lets the user resolve them before confirmation.
- Transfers affect account balances but never income or expense totals.
- Personal transactions and secrets never belong in this repository.

## Repository structure

```text
apps/
  bot/        Telegram bot and webhook
  web/        React dashboard (next phase)
packages/
  domain/     Shared parsing and financial domain rules
supabase/     Database schema, policies and safe example seeds
model/        Training code and non-personal example data
docs/         Architecture and project decisions
```

## Local development

Requirements: Node.js 22 or newer.

```bash
npm install
npm run build
npm test
npm run typecheck
```

### Bot Telegram locale (Mac)

Dalla root del progetto, configura privatamente `.env.local`. Se il file esiste già, mantienilo; altrimenti crealo partendo da `.env.example`.

- `TELEGRAM_BOT_TOKEN`: token fornito da BotFather (obbligatorio).
- `TELEGRAM_ALLOWED_CHAT_ID`: ID numerico positivo della tua chat privata (obbligatorio).
- `APP_TIMEZONE`: fuso orario, predefinito `Europe/Rome`.
- `DEFAULT_ACCOUNT`: `revolut` (predefinito) oppure `isybank`.

Il programma carica `.env.local` a runtime tramite `process.loadEnvFile`, nativo di Node.js 22+. Le variabili già presenti nell'ambiente della shell hanno precedenza. Il file è escluso da Git: non pubblicare token, ID o contenuto del file. Per il polling non servono webhook secret, Supabase o hosting. La validazione locale controlla formato e presenza delle impostazioni; Telegram verifica il token alla prima richiesta.

Avvia dalla root:

```bash
npm run bot:dev
```

Il comando compila il progetto e avvia una singola istanza del bot. Per applicare modifiche al codice, arrestalo e rilancia il comando. All'avvio verifica `getWebhookInfo`: se esiste un webhook, si ferma senza cancellarlo. Per passare al polling occorre disattivare esplicitamente il webhook. Un conflitto con un'altra istanza di polling interrompe il programma: tieni attiva una sola istanza.

Quando compare “Bot locale attivo”, apri la chat privata con `@niuzzu_bot`:

1. Invia `/start` o `/menu`: riceverai il menu per movimento o trasferimento guidato. `/help` mostra la guida con esempi.
2. Invia `8,30 tabacco`: riceverai una risposta personale con importo in euro, conto e data in formato giorno/mese/anno, con la dicitura “Solo anteprima: non ho salvato nulla”.
3. Invia `ciao`: riceverai una richiesta di importo valido e un esempio.
4. Puoi anche provare `ieri 12,50 spesa` oppure `20 benzina isybank`.

Arresta con **Ctrl+C** nel terminale. Il bot funziona soltanto mentre il programma è acceso e il Mac è connesso; durante stop o sospensione non risponde. Al riavvio può ricevere messaggi ancora in coda su Telegram.

Accetta esclusivamente messaggi testuali, nuovi o modificati, e callback dei pulsanti della chat privata autorizzata. Le altre chat e gli aggiornamenti non supportati vengono ignorati. Conserva soltanto la proposta attiva in memoria, senza salvare permanentemente movimenti o stato. Il parser usa la grammatica esplicita documentata sotto, senza interpretazione libera del linguaggio naturale.

L'offset è mantenuto **solo in memoria durante la sessione** e avanza dopo l'elaborazione o lo scarto di un aggiornamento. Non è idempotenza persistente: un arresto prima della conferma dell'offset, oppure un invio riuscito con risposta di rete persa, può produrre una risposta duplicata. La deduplicazione persistente verrà introdotta con il database.

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

**Trasferimento:** importo → origine → destinazione → data → anteprima standard, senza categoria. I conti sono Revolut e Isybank. La destinazione esclude il conto di origine; anche una callback manipolata con conti uguali viene rifiutata.

La data offre **Oggi**, **Ieri**, **📅 Altra data**. Quest'ultima richiede una data testuale della grammatica seguente, validata in `APP_TIMEZONE`; una data non valida non viene sostituita con oggi. **⬅️ Indietro** torna al passaggio precedente conservando i valori; cambiando tipo viene azzerata una categoria incompatibile e cambiando origine viene azzerata una destinazione che diventerebbe uguale. I passaggi successivi vanno comunque riconfermati. **❌ Annulla** elimina la compilazione.

Durante il wizard il testo serve al campo richiesto (importo o data); negli altri passaggi il bot invita a usare i pulsanti. Per tornare al testo libero usa `/cancel` oppure `/menu`. Lo stesso vale per un messaggio modificato durante la compilazione: non apre una seconda proposta indipendente.

Lo store condiviso usa uno stato discriminato `menu | wizard | proposal`. Il wizard contiene modalità, passaggio, cronologia per Indietro, valori parziali e revisione dei pulsanti. Non conserva il testo originale. Menu e wizard scadono dopo 30 minuti dalla creazione, senza rinnovo a ogni passaggio; a compilazione completa nasce la normale proposta con la propria durata di 30 minuti e gli stessi Conferma/Modifica/Annulla del testo libero. I pulsanti di stati sostituiti o passaggi precedenti sono invalidati. Riavviando il bot si perde tutto: **anche Conferma non salva realmente nulla**.

Prova manuale completa, dopo l'avvio con `npm run bot:dev`:

1. **Testo libero:** invia `ieri 8,30 tabacco isybank` senza aprire il menu. Verifica anteprima e premi Conferma: deve dichiarare che non c'è salvataggio reale. Invia anche `20 pizza revolut`: il testo viene accettato, con eventuali classificazioni sconosciute da completare con Modifica.
2. **Spesa guidata:** `/start` → Nuovo movimento → Spesa → scrivi `12,50` → Cibo → Revolut → Oggi. Verifica la proposta; prova Modifica → Importo → `15`, poi Conferma.
3. **Entrata guidata:** `/menu` → Nuovo movimento → Entrata → `100` → Regali → Isybank → Altra data → `18/09/2026`. Verifica anteprima e Annulla.
4. **Trasferimento guidato:** `/menu` → Trasferimento → `50` → Isybank → Revolut → Ieri. Verifica che la destinazione non offra Isybank e che l'anteprima non contenga Categoria. Conferma deve restare senza salvataggio reale.
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

**Conto:** `revolut`, `isybank`, `isy`, `isy bank`, senza distinzione maiuscole/minuscole. Per entrate e spese un conto esplicito prevale su `DEFAULT_ACCOUNT`; in sua assenza si usa il default configurato. Se compaiono entrambi i conti senza una direzione di trasferimento, il bot chiede un solo conto. I nomi devono essere parole intere, non parti di altre parole.

### Trasferimenti tra conti personali

La struttura esplicita `da <conto> a <conto>` rappresenta un trasferimento, mai una spesa o un'entrata. Esempi:

```text
100 da revolut a isybank
trasferimento 100 da revolut a isybank
ieri 50 da isybank a revolut
```

Le regole esistenti di importo e data continuano a valere. La direzione viene riconosciuta prima degli alias di categoria. Il parser conserva origine e destinazione separatamente, senza utilizzare il conto predefinito o dedurre il conto opposto. `100 da revolut` e `100 a isybank` richiedono correzione; `100 da revolut a revolut` viene rifiutato con l'indicazione che i conti devono essere diversi. Un conto sconosciuto non viene sostituito con uno dei conti disponibili. Più direzioni nello stesso messaggio vengono considerate ambigue.

La proposta usa l'unione discriminata `TransactionDraft`: entrate/spese (o tipo ancora sconosciuto) hanno `account` e `category`; `transfer` ha esclusivamente `fromAccount` e `toAccount`, oltre a importo e data. Non contiene `account` o `category`. Il metadato di classificazione mantiene `category: null` per compatibilità con il contratto del classificatore, senza assegnare una categoria al trasferimento.

L'anteprima di un trasferimento mostra importo, data, Tipo: Trasferimento, Da e A, senza riga Categoria. Il menu Modifica offre importo, data, conto di origine, conto di destinazione e tipo. Sono selezionabili soltanto Revolut e Isybank; una scelta che renderebbe i conti uguali viene rifiutata. **Scambia conti** inverte atomicamente una coppia completa: utile perché con due soli conti non è possibile invertirli uno alla volta senza renderli temporaneamente uguali.

Passando da entrata/spesa a trasferimento, `account` e `category` vengono eliminati e origine/destinazione partono entrambe da confermare. Occorre sceglierle esplicitamente, diverse tra loro. Tornando a entrata/spesa, `fromAccount` e `toAccount` vengono eliminati e si devono selezionare nuovamente conto e categoria. Nessun campo incompatibile viene mantenuto. Conferma rimane bloccata finché i campi necessari non sono completi.

Per provare il flusso, invia uno degli esempi, apri Modifica → Conto di origine/destinazione e verifica il rifiuto del conto uguale all'altro; usa Scambia conti per invertire la direzione. Prova anche Modifica → Tipo → Entrata e seleziona conto/categoria, oppure passa da una spesa a Trasferimento e scegli entrambi i conti. Conferma e Annulla restano disponibili. Non si sposta denaro realmente: nessun database, saldo, doppia registrazione contabile o salvataggio permanente.

### Messaggi modificati su Telegram

Il polling richiede `message`, `edited_message` e `callback_query`. Se modifichi il testo di un messaggio nella chat privata autorizzata, il bot lo ricalcola e invia **un nuovo messaggio** con “Anteprima aggiornata, bro”: la precedente risposta resta nella chat, ma i vecchi pulsanti non possono più agire sulla nuova proposta. La nuova proposta sostituisce quella attiva, comprese eventuali correzioni manuali. Se modifichi il messaggio sorgente della proposta attiva rendendolo invalido, quella proposta viene rimossa e ricevi una richiesta di chiarimento.

L'offset segue `update_id`, non `message_id`: una modifica ha un nuovo aggiornamento pur riferendosi allo stesso messaggio. La gestione rimane solo in memoria e senza persistenza. Anche il webhook usa la stessa elaborazione; un eventuale webhook registrato con un filtro `allowed_updates` deve includere `edited_message` e `callback_query`. La sua configurazione non viene cambiata automaticamente.

### Conferma, modifica e annullamento

Il flusso locale è: messaggio → parsing → classificazione → anteprima → **✅ Conferma / ✏️ Modifica / ❌ Annulla**.

- **Conferma:** richiede conto, tipo e categoria risolti per entrate/spese; per `transfer` richiede origine e destinazione riconosciute e diverse, senza categoria. Chiude il flusso e rimuove la proposta dalla memoria. La risposta dichiara “Transazione confermata” e “Nessun salvataggio reale”: non esiste uno storico delle conferme.
- **Annulla:** rimuove la proposta e invia una conferma di annullamento.
- **Modifica:** consente di scegliere Importo, Data, Conto, Tipo o Categoria. Per i trasferimenti offre invece origine e destinazione e nasconde la categoria. Conti, tipi e categorie usano pulsanti inline e gli ID già definiti nel dominio. Le categorie sono filtrate per tipo; cambiando tipo, una categoria incompatibile viene azzerata. Prima di selezionare una categoria occorre scegliere il tipo.
- **Importo/Data:** il messaggio testuale successivo viene interpretato come valore del campo selezionato. Scrivi solo `12,50`, oppure una data supportata come `18/09/2026`, `ieri` o `mercoledì`. Il parser esistente valida il valore; un errore lascia attiva la modifica. `eskere` non diventa la data di oggi. Il pulsante “↩️ Anteprima” esce dalla modifica senza cambiare il valore.

Dopo ogni modifica il bot invia una nuova anteprima completa con i tre pulsanti. Le precedenti schermate possono restare visibili, ma i loro pulsanti diventano obsoleti. Alla conferma/annullamento tenta anche di rimuovere i pulsanti dal messaggio cliccato; se Telegram non lo consente, rimangono comunque inutilizzabili.

Esiste **una sola proposta attiva per chat**. Un nuovo messaggio valido la sostituisce, salvo quando il bot sta aspettando un valore testuale di modifica. La proposta scade **30 minuti dopo la creazione**, senza rinnovo alle modifiche, ed è cancellata anche se il bot resta inattivo. Stop, errore che termina il polling o riavvio eliminano tutto. Un clic su una proposta scaduta, chiusa o sostituita mostra un avviso e non esegue l'azione.

Lo stato è isolato in `proposals.ts`, la logica del flusso in `proposal-flow.ts`, le viste in `proposal-view.ts` e l'invio Telegram in `flow-delivery.ts`. La memoria contiene soltanto i valori proposti e i metadati necessari al flusso, non il testo originale. Le scelte manuali aggiornano la proposta senza fingere una nuova classificazione automatica. Non esistono file di stato, database o servizi esterni aggiuntivi.

**Limiti:** tutti i movimenti, inclusi i trasferimenti, restano proposte temporanee: la conferma non trasferisce fondi e non calcola saldi. Il webhook conserva lo stato solo nello stesso processo: riavvii o istanze diverse possono far risultare la proposta scaduta. Il flusso supportato è il polling locale in una singola istanza. Lo stato cambia in memoria prima dell'invio delle risposte: una perdita di rete può impedire la consegna dell'ultima schermata; non c'è garanzia di consegna o idempotenza persistente.

Prova manuale:

1. Riavvia con `npm run bot:dev` dalla root e invia `ieri 8,30 tabacco isybank`.
2. Verifica importo, data, Isybank, Uscita, Tabacco e i tre pulsanti.
3. Premi Modifica → Importo. Invia `zero`: il bot mantiene la modifica attiva. Invia `12,50`: torna l'anteprima aggiornata.
4. Prova Modifica → Conto → Revolut, oppure Modifica → Tipo → Entrata e poi Categoria → Regali.
5. Premi Conferma: ricevi l'avviso che nessun dato è stato salvato realmente. Ripremere un vecchio pulsante non ripete la conferma.
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

Una corrispondenza completa non in conflitto ha `source: "rule"` e `confidence: 0.98`; è un punteggio convenzionale della regola, non una probabilità statistica. Un risultato incompleto o conflittuale usa `source: "unknown"`, confidenza 0 e almeno un campo `null`; le informazioni comuni alle regole possono restare note. `12 eskere` conserva l'anteprima di importo/data/conto con tipo e categoria “da confermare”, risolvibili dai pulsanti Modifica. Nessun salvataggio permanente.

Queste sono regole lessicali per messaggi brevi, non comprensione del linguaggio naturale: negazioni, rimborsi e contesti complessi non sono interpretati. Gli alias sono volutamente essenziali. Un futuro classificatore locale potrà intervenire dopo un risultato sconosciuto, estendendo `ClassificationSource` con `model`; non è implementato né addestrato ora e non cambierà importo, data o conto. Nessuna API AI esterna e nessun dato personale nel repository: solo esempi sintetici nei test.

## Security and privacy

This is intended to be a public repository. Only source code, synthetic examples and safe configuration templates are allowed. Read [SECURITY.md](SECURITY.md) before publishing data, model artifacts or deployment configuration.

## Roadmap

1. Telegram bot and webhook skeleton.
2. Deterministic acquisition of amount, date and account.
3. Local category/type classifier with confidence threshold.
4. Supabase persistence with RLS.
5. React dashboard.
6. Realtime dashboard updates.

## License

No open-source license has been selected yet. All rights are reserved until a license is added.
