# FinanceTracker

[![CI](https://github.com/ninuzzu5/FinanceTracker/actions/workflows/ci.yml/badge.svg)](https://github.com/ninuzzu5/FinanceTracker/actions/workflows/ci.yml)

FinanceTracker registra uscite, entrate e trasferimenti tramite Telegram, con parser e classificatore deterministici TypeScript. Supabase conserva movimenti, ricevute idempotenti e rettifiche Contanti; Auth e RLS isolano i proprietari. Nessuna API AI esterna.

## Stato attuale

Implementati sul codice di `dev`:

- Testo libero e wizard per Revolut, Isybank e Contanti, categorie separate per entrate/uscite, anteprima modificabile e conferma esplicita.
- Quattro milestone UX Telegram: menu dei sei comandi, storico `/movimenti`, wizard compatto sullo stesso pannello e gestione delle anteprime/fonti modificate.
- Aperture manuali e RPC dei saldi teorici; `/riconcilia` registra rettifiche Contanti a fine giornata e protegge le giornate chiuse.
- B1: salvataggio atomico e idempotenza persistente per operazione; B2/B3: importi/date validi e conti EUR; B4/B5: rifiuto di importi con segno e trasferimenti ambigui.

Queste funzionalità richiedono lo schema corrispondente alle migrazioni locali fino a 007. **L'allineamento del database remoto non è verificato da questa revisione.** Dashboard, budget, statistiche, realtime, riapertura delle giornate e correzioni retroattive avanzate restano da sviluppare.

```text
Testo libero o wizard → parsing/classificazione → anteprima e modifiche
  → conferma → RPC save_transaction_once → transazione + ricevuta atomiche
  → conferma Telegram
```

Prima della conferma non vengono scritti dati finanziari. Annulla chiude la conversazione: dopo un tentativo dal risultato incerto non elimina eventuali scritture riuscite. In caso di timeout usa il pulsante della stessa operazione; un nuovo messaggio è una nuova operazione, anche con valori identici.

Esempi: `ieri 12,50 spesa isybank`, `100 stipendio revolut`, `12 pranzo cash`, `50 da revolut a contanti`. Il parser chiede chiarimenti per importi invalidi, date impossibili o conti ambigui; tipo e categoria sconosciuti si completano con Modifica.

## Componenti e documentazione

- `packages/domain`: tipi, parser, date, importi, conti, categorie e regole lessicali.
- `apps/bot`: polling/webhook, stato temporaneo, wizard, viste, storico e repository Supabase.
- `supabase`: migrazioni 001–007, preflight e test SQL isolati.
- `apps/web`: solo documentazione; nessuna dashboard o applicazione React attuale.
- `model`: proposta di eventuale classificatore locale; nessun modello attivo.

Consulta [architettura](docs/architecture.md), [guida Telegram e collaudo](docs/bot-guide.md), [configurazione/migrazioni Supabase](supabase/README.md), [audit storico e stato delle correzioni](docs/audit-2026-10-09.md) e [sicurezza](SECURITY.md).

## Sviluppo locale

Node.js **22+**, comandi dalla root:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run bot:dev
```

`bot:dev` compila dominio e bot e avvia il polling; non è un watcher. Per applicare modifiche arresta con Ctrl+C e riavvia. Non esiste uno script `bot:local`.

Crea privatamente `.env.local` da `.env.example`, preservando un file già esistente:

| Variabile | Uso |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token del proprio bot |
| `TELEGRAM_ALLOWED_CHAT_ID` | Chat privata autorizzata |
| `SUPABASE_URL` | URL del progetto |
| `SUPABASE_ANON_KEY` | Chiave pubblica, mai secret/service role |
| `SUPABASE_USER_EMAIL`, `SUPABASE_USER_PASSWORD` | Utente Auth dedicato |
| `APP_TIMEZONE` | Default `Europe/Rome` |
| `DEFAULT_ACCOUNT` | `revolut` (default), `isybank` o `contanti` |

Il loader nativo Node carica `.env.local`; l'ambiente della shell ha precedenza. `TELEGRAM_WEBHOOK_SECRET` serve al webhook. Mantieni una sola istanza: un webhook configurato impedisce il polling e non viene rimosso automaticamente. Il percorso supportato è polling locale, processo e connessione attivi.

Auth e conti vanno predisposti manualmente: UUID risolti da nomi attivi univoci del proprietario, nessuna creazione automatica. Non inserire saldi arbitrari; apertura e data devono essere verificate e configurate insieme. Segui l'ordine e i preflight della [guida Supabase](supabase/README.md), senza rilanciare la baseline su database esistenti.

## Verifiche e limiti

`npm test` esegue Vitest nei workspace bot/dominio, con dati sintetici e servizi simulati. `build` compila entrambi; `typecheck` compila prima il dominio e controlla i workspace. Nessuno di questi comandi testa Supabase remoto. I runner SQL e stress sono separati da Vitest e CI: istruzioni nella guida Supabase.

GitHub Actions esegue su push a `main`/`dev` e pull request: `npm ci`, build, typecheck e test su Node 22. Non applica migrazioni né esegue deploy. Per audit delle dipendenze: `npm audit --omit=dev` e `npm audit --include=dev` (comandi npm, non script del progetto).

Bozze, pannelli e offset sono in memoria, con scadenza di 30 minuti per lo stato conversazionale. Riavviando si perdono le bozze; i pulsanti B1 possono recuperare una ricevuta, senza ricostruire un payload mancante. Il webhook non coordina lo stato UX fra più istanze.

L'idempotenza copre la stessa fonte/chiave tramite RPC, non inserimenti diretti o storico precedente a 006. Lo storico mostra solo transazioni, non rettifiche; la paginazione non è uno snapshot congelato. Non esiste un comando generale per impostare aperture o mostrare tutti i saldi. Movimenti e riconciliazione sono coerenti nel fuso predefinito; la riconciliazione usa Europe/Rome fisso anche se APP_TIMEZONE viene cambiato.

Credenziali, messaggi grezzi, export e dati personali restano fuori da Git. Il database conserva valori contabili e chiavi opache, senza messaggi Telegram grezzi. I log riportano errori sintetici. Una scrittura riuscita rimane persistita anche se Telegram non consegna la risposta.

## Sviluppi futuri

Dashboard autenticata che legga direttamente Supabase, senza modalità demo/reale separate; riapertura tracciabile delle giornate, correzioni retroattive e storico rettifiche. Budget, statistiche, eventuale realtime e classificatore locale richiedono progettazione separata: non sono funzionalità presenti.

## Licenza

[MIT](LICENSE).
