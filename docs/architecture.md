# Architettura

Quattro pezzi, ognuno con un compito solo.

| Percorso | Compito |
| --- | --- |
| `packages/domain` | Tipi, conti, categorie, importi, date, parser e classificazione a regole |
| `apps/bot` | Chat Telegram: conversazioni, pannelli, chiamate a Supabase |
| `apps/web` | Dashboard React in sola lettura, con login e secondo fattore |
| `supabase` | Schema, funzioni SQL e test del database |

Il bot richiede le migrazioni fino a 009, la dashboard anche 010 e 011.

## Le scelte di fondo

- **I conti li fa il database.** Né il bot né la dashboard tengono un saldo:
  lo chiedono ogni volta.
- **Si scrive solo tramite funzioni SQL.** I client non hanno permessi di
  scrittura sulle tabelle. Ogni funzione controlla chi la chiama.
- **Niente numeri con la virgola mobile.** Gli importi viaggiano come testo
  decimale, in TypeScript diventano centesimi interi (`BigInt`), in SQL sono
  `numeric`. Nessun arrotondamento automatico.
- **Un dato mancante non è zero.** Un conto senza saldo iniziale è "non
  disponibile", e rende non disponibile anche il totale.
- **Non si cancella.** Un movimento sbagliato si corregge o si annulla, e resta
  traccia di com’era.
- **Un trasferimento non è una spesa.** Ha origine e destinazione, nessuna
  categoria, e resta fuori dai totali di entrate e uscite.

## Dominio

Il parser legge importo, data e conto con una grammatica fissa. La
classificazione cerca parole chiave e, se non è sicura, lascia tipo e categoria
da scegliere a mano. Nessun modello, nessuna API esterna.

`transaction_date` è una data di calendario nel fuso `APP_TIMEZONE`;
`created_at` e `updated_at` sono istanti UTC. Chiusure di cassa e `/saldi` usano
sempre `Europe/Rome`.

## Bot

`telegram.ts` lascia passare solo la chat autorizzata. Polling e webhook
condividono la stessa logica (`flow-delivery.ts`, `proposal-flow.ts`), ma uso
solo il polling, con una sola istanza.

Lo stato delle conversazioni (`proposals.ts`) è in memoria: uno per chat, scade
dopo 30 minuti, si perde al riavvio. Non conserva il testo dei messaggi.

Prima di proporre un movimento il bot chiede al database se quel messaggio è già
stato salvato. La chiave (`sourceOperationKey`) si ricava da chat e messaggio ed
è opaca: nel database non finisce nulla di Telegram.

`supabase.ts` entra con l’utente dedicato al bot, tiene la sessione in memoria e
usa solo la chiave pubblica.

## Database

- `save_transaction_once` salva movimento e ricevuta nella stessa transazione.
  Un secondo tentativo con la stessa chiave restituisce il movimento esistente.
- `manage_transaction_once` modifica o annulla controllando la versione del
  movimento (`ledger_version`) e salva lo stato prima e dopo in
  `transaction_changes`.
- `reconcile_cash` chiude una giornata di contanti: ricalcola il teorico sotto
  lock, rifiuta un’anteprima non più valida e registra una rettifica. Dopo, i
  movimenti di contanti fino a quella data sono bloccati dai trigger.
- `get_account_balances` calcola i saldi: saldo iniziale, più entrate, meno
  uscite, più o meno trasferimenti, più rettifiche, senza i movimenti annullati.

RLS e chiavi esterne composte tengono separati i proprietari. Le funzioni di
scrittura sono `SECURITY DEFINER` con `search_path` vuoto, quelle di lettura
`SECURITY INVOKER`. I dettagli sono nella [guida Supabase](../supabase/README.md).

## Dashboard

Non scrive nulla. Legge con `get_dashboard_balances` e `get_dashboard_movements`,
che rispondono solo a una sessione dell’account web che ha passato il secondo
fattore ed è associata al proprietario dei dati. L’account web è diverso da
quello del bot.

I movimenti arrivano a pagine, con un cursore su data e id. Totali e grafici si
calcolano nel browser in centesimi interi; trasferimenti e annullati restano
fuori. Nulla viene salvato su disco. Vedi la [guida web](../apps/web/README.md).

## Cosa non c’è

- Più valute: solo EUR, imposto dal database.
- Più utenti o più bot sullo stesso proprietario.
- Riapertura di una giornata di contanti chiusa.
- Bozze che sopravvivono a un riavvio del bot.
- Inserimento o modifica dalla dashboard.
