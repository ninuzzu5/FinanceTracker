# Hardening pre-release — 19 ottobre 2026

> Nota storica: le sezioni sulla qualificazione manuale descrivono la preparazione iniziale. È stato successivamente riportato il successo della CI Linux su `7464879fe6e1be5c07002b2584cf08825ac8f867`. La configurazione finale locale abilita entrambi i check su push dev/main e PR verso questi branch; il nuovo workflow deve ancora essere eseguito su GitHub. Per lo stato corrente e le procedure, consultare la [guida CI](ci.md). Le evidenze originali sono conservate di seguito.

Modifiche locali sul branch `dev`, base `c489fa158c272c9d4071d669655a1fe0c0edc97e`. Nessun commit, push, branch, PR, merge, tag o deploy. Migrazioni 001–008, contratti RPC, dati reali e credenziali non modificati. Nessun accesso a Supabase/Telegram remoti o a `.env.local`.

Questo documento registra il seguito dell’[audit del 17 ottobre](audit-v1-2026-10-17.md), senza dichiarare completata la release.

## Stato dei finding

| Finding | Stato verificato | Limite residuo |
| --- | --- | --- |
| SEC-01 | Corretto localmente: Vitest/mocker 4.1.12, Tinypool rimosso, source-map-js 1.2.2; zero advisory negli audit completo e produttivo | Ripetere audit e verifiche sul commit finale; gli advisory possono cambiare |
| SEC-02 | Corretto e verificato con 46 nuovi casi di test | Nessuna verifica della configurazione privata o della rete hosted |
| QA-01 | Parziale: audit automatici e qualificazione SQL Linux manuale predisposti, errori non soppressi | Runner Linux pulito non disponibile; nessuna prova hosted della nuova CI e nessun required check SQL attivato |
| SEC-03 | Corretto nella definizione locale: SHA completi ufficiali e actionlint superato | Esecuzione hosted da verificare dopo revisione e pubblicazione |
| UX-01 | Rischio noto accettato per la v1 personale | Difetto confermato, non corretto; usare nuove risposte nei flussi e controllare la preview |
| OPS-01 | Aperto | Prova manuale di backup/ripristino ancora necessaria |

## Dipendenze e compatibilità

Vitest 3.x era affetto dagli advisory indicati nel report. La linea 4.1.x corretta evita il salto alla major 5 suggerito dall’audit originale. Il registry ha risolto la patch **4.1.12** per entrambi i workspace, con i moduli Vitest allineati. `@vitest/mocker` è oltre la soglia corretta 4.1.11; Tinypool non è più una dipendenza del runner. `source-map-js` è ora 1.2.2.

Non sono state aggiunte dipendenze dirette al progetto. L’aggiornamento transitivo risolto da npm include Vite 8.3.4 e i suoi pacchetti opzionali di piattaforma; è toolchain di test, non una dashboard o una nuova build web. Nessun override forzato delle dipendenze. Il requisito Node dichiarato passa da `>=22` a `>=22.12.0`, coerente con Vite, mentre la CI continua a selezionare Node 22 LTS aggiornato. Le versioni dei pacchetti produttivi preesistenti sono invariate.

Manifest dei workspace e lockfile sono coerenti; le risoluzioni registry mantengono integrity. Nessun `npm audit fix --force` eseguito. Audit completo e produttivo del 19 ottobre: **zero advisory residui**. Questo riscontro è temporale e non dimostra assenza di vulnerabilità sconosciute.

Riferimenti primari: [migrazione Vitest](https://vitest.dev/guide/migration/), [advisory mocker](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [Tinypool worker](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3), [Tinypool run](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Le versioni effettive sono verificabili nel lockfile e tramite `npm ls`.

## Configurazione Supabase

`readSupabaseConfig` richiede un URL assoluto HTTPS per endpoint remoti. HTTP è ammesso solo per le autorità letterali `localhost`, `127.0.0.1` e `[::1]`, con porta opzionale. La verifica usa l’autorità originale prima delle normalizzazioni WHATWG: forme come `127.1`, IPv4 ottale/esadecimale/decimale intero, localhost codificato, trailing dot, domini simili e IPv6 alternativo non ottengono l’eccezione HTTP.

Sono rifiutati userinfo anche vuoto (`@host`), username/password incorporate, whitespace e backslash. Le URL HTTPS hosted esistenti restano compatibili e vengono restituite senza trasformazioni. Errori sintetici senza URL/password. I test usano esclusivamente configurazioni sintetiche e non inviano richieste.

## CI predisposta e qualificazione Linux

Il job ordinario, su push a `main`/`dev` e PR, eseguirà `npm ci`, build, typecheck, test, `npm audit` e `npm audit --omit=dev` con Node 22. Nessuna soglia che nasconda advisory, `continue-on-error` o `|| true`.

In questa fase non era disponibile un runner Linux: per provare il setup prima di renderlo obbligatorio, il job `sql-qualification` era limitato a **workflow_dispatch**. Prepara due runtime con versioni esplicite sotto `RUNNER_TEMP`:

1. PGlite 0.5.8, installato senza lifecycle script; runner delle migrazioni/fixture.
2. Embedded PostgreSQL 18.4.0-beta.17, script di installazione abilitati per i symlink dei binari; runner completo `--b1 --audit` dopo la build del bot.

PostgreSQL crea un cluster nuovo con password casuale sintetica e socket Unix, senza listener TCP, URL remoti o credenziali applicative. Non si usa un servizio Supabase, né un database già esistente. Il job manuale fallisce se installazione, avvio o asserzioni falliscono: **un errore non viene trasformato in successo**. Un verde su push/PR attesta soltanto il job ordinario, non l’esecuzione del job SQL saltato per il suo trigger manuale.

Le Actions mantengono la major 4:

| Action | Versione | SHA completo verificato |
| --- | --- | --- |
| checkout | v4.3.1 | `34e114876b0b11c390a56381ad16ebd13914f8d5` |
| setup-node | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |

Verificate contro le [release ufficiali checkout](https://github.com/actions/checkout/releases/tag/v4.3.1) e [setup-node](https://github.com/actions/setup-node/releases/tag/v4.4.0) e i relativi commit completi. Permessi `contents: read`; checkout con `persist-credentials: false`; nessun secret configurato referenziato. Actionlint 1.7.12 dalla [release ufficiale](https://github.com/rhysd/actionlint/releases/tag/v1.7.12), con checksum verificato, non segnala errori di sintassi/semantica.

### Passaggio a SQL automatico/obbligatorio

Dopo la revisione e una pubblicazione, avviare manualmente la qualificazione sulla revisione da validare. La [documentazione GitHub](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) richiede che il workflow con `workflow_dispatch` sia disponibile sul branch predefinito per offrirne l’avvio manuale: pianificare la qualificazione prima del tag, senza presumere che sia già eseguibile dal solo checkout locale.

Registrare SHA, runner Linux, Node/npm, versioni runtime, risultati e assenza di segreti applicativi. Dopo una prova pulita riuscita e revisionata, rendere almeno PGlite automatico in una modifica separata e valutare il required check. La configurazione di branch protection non è stata modificata. Se il nativo non risulta stabile su Linux, documentare il motivo e mantenere un gate manuale locale riproducibile; non introdurre eccezioni silenziose.

I comandi locali completi sono nella [guida Supabase](../supabase/README.md#test-senza-dati-reali-né-aperture-arbitrarie). Prima del tag resta necessario eseguirli sul commit finale. Non è stata dichiarata affidabile su Linux una suite provata soltanto su macOS.

## Revisione architetturale mirata

### Miglioramenti applicati

- **Runner SQL meno accoppiato al runtime JS.** Su Node 22 il runner PGlite originale falliva confrontando date SQL infinite decodificate come `Invalid Date`; Node 24 aveva accettato quel confronto. Ora gli snapshot selezionano tutti i campi della baseline come valori SQL testuali pertinenti e ordinano per ID. Il confronto preserva importi, date, timestamp e distingue esplicitamente `infinity` da `-infinity`. Dopo 008 confronta anche i campi della baseline prima esclusi dal confronto parziale. Le asserzioni non vengono eliminate o aggirate.
- **Metadati aderenti al prodotto.** Descrizione root riferita al bot e al ledger esistenti; engine Node allineato ai requisiti della toolchain. Documentazione web chiarisce che Vite transitivo di Vitest non implementa una dashboard.
- **Documentazione corretta.** Rimossi riferimenti obsoleti all’assenza di `/saldi`, all’immutabilità di `updated_at` anche nelle correzioni 008 e a una futura cancellazione fisica dei movimenti B1; ordine 007/008 corretto nella checklist Supabase. Setup temporaneo con `mktemp`, build esplicita prima dei test bot/nativi e distinzione fra CI ordinaria e qualificazione manuale.
- **Report pubblicabile.** Percorsi locali personali e temporanei non necessari generalizzati; risultati del 17 ottobre conservati come evidenze storiche e stati aggiornati separatamente. UX-01 non viene dichiarato inesistente; OPS-01 non viene chiuso senza prova.

Il controllo TypeScript con `--noUnusedLocals --noUnusedParameters` passa per dominio e bot. Non dimostra che ogni export pubblico sia utilizzato: non sono stati rimossi export o introdotte astrazioni generali senza una prova del loro inutilizzo. Le mappe di errori delle diverse RPC restano separate per preservare i contratti UX attuali.

### Raccomandazioni separate, non implementate

| Priorità | Raccomandazione | Motivazione / limite |
| --- | --- | --- |
| P1 | Qualificazione Linux e prova backup/restore | Mancano evidenze di release; nessun refactoring può sostituirle |
| P2 | Riprendere UX-01 e il contratto di instradamento nuovi messaggi/edit | Difetto reale accettato per v1 personale; eventuale correzione con test di delivery e replay |
| P2 | Separare gradualmente dispatch dei flussi e gestione della consegna in `proposal-flow.ts` / `flow-delivery.ts` | Molti percorsi di stato condivisi; richiede un intervento dedicato che preservi le invarianti di callback, pannelli e retry |
| P3 | Valutare suddivisione del repository Supabase e uniformità degli errori | Utile se crescono i percorsi; ora le differenze fra ricevute, cash e management hanno semantica da preservare |
| P3 | Ridurre duplicazione delle guide storiche e misurare query prima di aggiungere indici | Conservare evidenze e compatibilità; nessuna giustificazione per riscritture o indici preventivi durante l’hardening |

`packages/domain`, bot e schema mantengono responsabilità distinte; `apps/web` e `model` restano documentazione di sviluppi futuri. `.gitignore` e licenza MIT sono stati revisionati e non richiedono cambiamenti in questo intervento. Non è stata ripetuta una scansione completa della cronologia: valgono i limiti euristici dell’audit originale. Nessuna verifica legale completa delle dipendenze o degli artefatti ignorati.

## Verifiche effettivamente eseguite

Ambiente: **macOS, Node 22.23.3, npm 11.13.0**. Node 22 temporaneo esterno al progetto. PGlite eseguito anche con Node 24.16.0. Nessuna `.env.local` caricata.

| Verifica | Esito |
| --- | --- |
| `npm ci` da lockfile | Superato, cache locale in modalità offline, lifecycle script abilitati |
| `npm run build` | Superato dominio e bot su Node 22 |
| `npm run typecheck` | Superato dominio e bot su Node 22 |
| `npm test` | **649 pass: 420 bot in 18 file + 229 dominio in 4 file**; 46 nuovi test configurazione |
| `npm audit` completo e `npm audit --omit=dev` | Superati, endpoint advisory interrogato online, zero advisory |
| Runner PGlite aggiornato | Superato su Node 22 e 24, comprese tutte le fixture 008 |
| Runner PostgreSQL nativo `--b1 --audit` | Superato completo con Node 22: B1/B2/B3/B/C, RLS, ownership, rollback e gara chiusura/modifica |
| Concorrenza | 25 sessioni; 383 tentativi cash nella singola esecuzione, 25 retry B1/C, 25 edit incompatibili, risposta persa dopo commit e riavvio; numero cash dipendente dall’interleaving |
| Controllo negativo SQL | In una copia temporanea una fixture resa intenzionalmente falsa termina con exit 1; nessuna modifica alle fixture del checkout o alle migrazioni |
| Controlli statici | Actionlint, noUnusedLocals/noUnusedParameters per bot/dominio e `git diff --check` superati |
| Package/lockfile | Manifest, engine e workspace coerenti; Tinypool assente; pacchetti produttivi invariati; integrity registry presente |

Il primo tentativo PGlite con Node 22 è fallito per il confronto degli `Invalid Date`; è stato corretto il runner e ripetuta l’intera suite. Non si conteggia quel fallimento come successo. La correzione confronta i valori originali, senza arrotondamenti o rimozione delle righe legacy invalide sintetiche. Lo stress usa aperture e importi sintetici.

Non eseguiti: runner Linux pulito, nuova CI hosted, branch protection/required checks, servizi Supabase/Telegram reali, prova di backup/restore. I runtime SQL temporanei locali sono quelli delle versioni indicate nelle guide; l’installazione su un runner Linux pulito resta parte della qualificazione da fare.

## File modificati durante l’hardening

- Dipendenze/metadati: `package.json`, `package-lock.json`, `apps/bot/package.json`, `packages/domain/package.json`.
- Configurazione e regressioni: `apps/bot/src/supabase.ts`, nuovo `apps/bot/test/supabase-config.test.ts`.
- CI e runner: `.github/workflows/ci.yml`, `supabase/tests/run-account-balances.mjs`.
- Documentazione: `README.md`, `SECURITY.md`, `docs/architecture.md`, `docs/bot-guide.md`, `supabase/README.md`, `apps/web/README.md`.
- Report: `docs/audit-v1-2026-10-17.md` e questo documento.

All’inizio dell’hardening il report del 17 ottobre non era ancora tracciato; è stato aggiornato senza aggiungerlo all’indice. Al termine dell’intervento tutte le modifiche erano locali e da revisionare. Questi controlli, da soli, non erano sufficienti a dichiarare pronta la release.
