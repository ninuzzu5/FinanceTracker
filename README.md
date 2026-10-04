# FinanceTracker

FinanceTracker è un progetto personale per registrare spese, entrate e trasferimenti tramite un bot Telegram. TypeScript e Node.js gestiscono parsing, classificazione deterministica e flusso di conferma; Supabase conserva i movimenti con Auth e Row Level Security (RLS).

## Stato attuale

Il bot funziona localmente tramite long polling, in una sola istanza e per una chat privata autorizzata. Supporta testo libero e inserimento guidato. Dashboard, budget, saldi, statistiche e realtime non sono ancora implementati.

```text
Messaggio o inserimento guidato
  → parsing di importo, data e conti
  → classificazione deterministica
  → anteprima e modifiche
  → conferma esplicita
  → INSERT autenticato in Supabase
  → risposta di successo
```

**Anteprima, modifica e annullamento non salvano nulla.** Dopo la conferma, il bot comunica il successo solo quando l'INSERT riesce. Le classificazioni sconosciute o ambigue richiedono una scelta manuale; non vengono inventati valori mancanti.

Esempi sintetici:

- `ieri 12,50 spesa isybank`
- `100 stipendio revolut`
- `50 da revolut a isybank`

Con `/start` o `/menu` si apre il flusso guidato; `/help` mostra gli esempi e `/cancel` annulla lo stato corrente. I pulsanti consentono Conferma, Modifica e Annulla. Le proposte scadono dopo 30 minuti e si perdono al riavvio.

## Architettura

- `packages/domain`: parser, classificazione a regole, categorie e tipi condivisi. Nessuna API AI esterna.
- `apps/bot`: flusso Telegram, proposte temporanee in memoria e repository di persistenza.
- `supabase`: documentazione del database esistente. Schema, constraint e policy RLS **non sono ancora versionati come SQL**.
- `apps/web`: documentazione della dashboard futura, senza applicazione implementata.
- `model`: documentazione del possibile classificatore locale futuro, senza modello addestrato.
- `docs`: [decisioni architetturali](docs/architecture.md) e [guida del bot con grammatica e collaudo manuale](docs/bot-guide.md).

Il bot usa una chiave Supabase pubblica anon e le credenziali di un utente Auth dedicato. `signInWithPassword` crea una sessione in memoria sullo stesso client delle query; `getUser` verifica l'utente prima del salvataggio. Le query restano soggette a RLS. La service role non viene utilizzata.

Revolut e Isybank sono identificatori logici: il repository risolve gli UUID dai conti attivi dell'utente, senza hardcoding o creazione automatica. Una spesa usa `from_account_id`, un'entrata `to_account_id`, un trasferimento entrambi con conti distinti e categoria NULL. Non vengono spostati fondi presso le banche.

## Sviluppo locale

Requisito: Node.js 22 o successivo. Dalla root:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Per avviare il bot, copia `.env.example` in `.env.local` e compila privatamente:

| Variabile | Uso |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token del proprio bot |
| `TELEGRAM_ALLOWED_CHAT_ID` | Chat privata autorizzata |
| `SUPABASE_URL` | URL del progetto |
| `SUPABASE_ANON_KEY` | Chiave pubblica anon, mai service role |
| `SUPABASE_USER_EMAIL` | Email dell'utente Auth dedicato |
| `SUPABASE_USER_PASSWORD` | Password dello stesso utente |
| `APP_TIMEZONE` | Default `Europe/Rome` |
| `DEFAULT_ACCOUNT` | Default `revolut`, alternativa `isybank` |

`TELEGRAM_WEBHOOK_SECRET` serve soltanto al webhook. Il polling locale carica `.env.local` con il loader nativo di Node; le variabili già presenti nella shell hanno precedenza.

Il progetto Supabase deve già contenere tabelle, constraint, account e policy: questo repository non dispone ancora delle migration per creare un database da zero. Vedi [supabase/README.md](supabase/README.md).

```bash
npm run bot:dev
```

Mantieni una sola istanza; un webhook già configurato impedisce il polling e non viene cancellato automaticamente. Il bot richiede che il processo e la connessione restino attivi. Arresta con Ctrl+C.

## Test e CI

La suite usa dati sintetici, mock Telegram e mock Supabase. Non carica `.env.local`, non richiede credenziali e non contatta servizi reali.

GitHub Actions parte sui push a `main` e `dev` e sulle pull request. Usa Node 22, cache npm, permessi `contents: read` ed esegue `npm ci`, build, typecheck e test. Non esegue deploy o migration.

Audit delle dipendenze:

```bash
npm audit --omit=dev
npm audit --include=dev
```

## Privacy e limiti

Pubblica soltanto codice, configurazioni senza segreti ed esempi sintetici. Credenziali, messaggi privati, export bancari, dataset personali e screenshot finanziari devono restare fuori da Git. Vedi [SECURITY.md](SECURITY.md).

I dati confermati sono salvati nel proprio progetto Supabase; i messaggi attraversano Telegram. Le proposte non conservano il testo originale. I log applicativi riportano errori sintetici senza token o payload finanziari.

Non esiste idempotenza persistente: se la risposta del database si perde, verifica la tabella prima di riprovare. Un INSERT riuscito resta salvato anche se Telegram non consegna la conferma. Il webhook mantiene lo stato solo nel processo corrente e non è adatto a coordinare più istanze.

## Roadmap

- Versionare lo schema e le policy del database, senza dati personali.
- Implementare la dashboard web.
- Aggiungere budget, saldi e statistiche.
- Valutare realtime e un classificatore locale per i casi non riconosciuti dalle regole.

## Licenza

Non è stata scelta una licenza open source. Tutti i diritti restano riservati finché non viene aggiunta una licenza.
