# CI e controlli prima del merge

Il workflow `CI` in `.github/workflows/ci.yml` avvia entrambi i job su:

- push ai branch `dev` e `main`;
- pull request con **branch di destinazione** `dev` o `main`, anche da branch di origine diversi;
- `workflow_dispatch`, quando disponibile per il workflow sul branch predefinito.

Nessun filtro sui percorsi e nessuna condizione che salti il job SQL su questi eventi. Push ad altri branch/tag e PR verso altri branch non avviano il workflow. Non si usa `pull_request_target`.

## Check e branch protection

| Nome esatto del check | ID del job | Controlli |
| --- | --- | --- |
| `test` | `test` | `npm ci`, build, typecheck, test applicativi, `npm audit`, `npm audit --omit=dev` |
| `SQL integration` | `sql-qualification` | Installazione e build, migrazioni/fixture PGlite, PostgreSQL nativo con concorrenza e integrazione bot (`--b1 --audit`) |

Prima del merge verso `main` è raccomandato rendere **entrambi** required checks, con sorgente **GitHub Actions**, dopo averli osservati nel primo run riuscito della nuova configurazione. Gli stessi check sono adatti alla protezione di `dev`. Nella vista PR possono apparire sotto il workflow `CI`; nelle impostazioni selezionare i nomi `test` e `SQL integration`. Il vecchio nome `Linux SQL qualification (not yet a required check)` non identifica il nuovo check.

Le regole remote non sono state modificate. Selezionare i check dopo il push e la conferma dei nomi effettivi sullo SHA corrente; verificare che altri workflow non creino check omonimi. Valutare anche l’obbligo di aggiornamento rispetto al branch base. Queste impostazioni sono raccomandate, ma non ancora attive. Riferimento: [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).

I due job sono indipendenti e senza matrix. Checkout/installazione/build ripetuti sono necessari perché ogni job ha un ambiente isolato e il test SQL integra il bot compilato; non vengono aggiunti job intermedi o trasferimenti di artefatti. Nessun `continue-on-error`, `|| true`, skip condizionale o intercettazione che trasformi un fallimento in successo. Un errore fa fallire il rispettivo job; gli step successivi di quel job possono essere saltati perché il precedente è fallito.

## Runner, Actions e versioni

Entrambi i job usano **`ubuntu-24.04`**: un’etichetta esplicita evita il passaggio automatico a una nuova distribuzione durante la migrazione di `ubuntu-latest`. È una scelta prudente pre-release, da rivalutare con un run dedicato prima di passare a Ubuntu 26.04. Non congela l’intera immagine: GitHub continua ad aggiornarne gli strumenti. [Immagini ufficiali e politica di migrazione](https://github.com/actions/runner-images#available-images).

| Action | Release stabile verificata | SHA completo |
| --- | --- | --- |
| checkout | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| setup-node | [v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) | `949feb2413d6458794dcd2491c4babbbce0c15c1` |

Release non draft e non prerelease verificate tramite API ufficiale, pagine release e relativi commit. Entrambi i manifest dichiarano `runs.using: node24`: [checkout al pin](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml), [setup-node al pin](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/action.yml). Questo aggiorna il runtime **interno delle Actions**, mentre `node-version: 22` mantiene **Node 22 per FinanceTracker**. I runner hosted supportano il runtime richiesto; eventuali runner self-hosted richiederebbero una verifica separata. Il warning Node 20 e quello relativo a `ubuntu-latest` non sono attesi da queste configurazioni, ma l’assenza effettiva va confermata nelle annotazioni del nuovo run.

Permessi globali solo `contents: read`; checkout con `persist-credentials: false`. Non vengono configurati registry privati, token npm o segreti applicativi. Le nuove regole checkout per eventi privilegiati non richiedono eccezioni perché il workflow usa il normale evento `pull_request`.

Le installazioni temporanee SQL restano quelle già qualificate: PGlite **0.5.8** e wrapper embedded-postgres **18.4.0-beta.17**, invariati. La versione del wrapper è precedente a questo aggiornamento e resta quella già collaudata; le nuove Actions sono release stabili. PGlite si installa senza lifecycle script; il wrapper nativo mantiene gli script necessari ai symlink. Entrambi vivono sotto `RUNNER_TEMP`, fuori dalle dipendenze applicative. PostgreSQL crea un cluster nuovo con password sintetica casuale e socket Unix, senza TCP o connessioni Supabase. Migrazioni e asserzioni restano invariate.

## Significato del risultato

Una CI verde con **entrambi i job eseguiti** verifica la revisione selezionata rispetto a compilazione, tipi, test, advisory noti e contratti contabili locali: saldi, RLS/ownership sintetici, ricevute, correzioni, annullamenti, retry, concorrenza e rollback. Non dimostra assenza di ogni vulnerabilità e non certifica Auth/PostgREST o configurazione del database Supabase reale, consegna Telegram, backup/ripristino o completamento della release. UX-01, accettato nella v1 pubblicata, è corretto e verificato localmente il 22 ottobre 2026, con modifica ancora da pubblicare; OPS-01 resta aperto.

In caso di fallimento aprire il primo step rosso:

- **Installazione/build/typecheck/test:** correggere incompatibilità o regressione e riprodurre dalla stessa versione Node e lockfile. La cache npm non sostituisce `npm ci`.
- **Audit npm:** esaminare pacchetto, advisory e raggiungibilità; aggiornare con revisione oppure documentare una decisione esplicita. Non disabilitare il controllo o usare automaticamente `audit fix --force`.
- **Runtime SQL/setup:** controllare log di download, binari, librerie di sistema, symlink, memoria condivisa e socket del runner; non sostituire il database temporaneo con quello personale.
- **Asserzione SQL/concorrenza:** considerarla una regressione finché non è spiegata e riprodotta. Non eliminare verifiche, ampliare permessi o disabilitare trigger per ottenere verde.

Non registrare credenziali o dati personali per diagnosticare un errore. Un singolo retry per un problema infrastrutturale deve mantenere evidenza del fallimento iniziale; errori ripetuti richiedono indagine.

## Riproduzione locale

Dalla root, con Node 22 LTS aggiornato (almeno 22.12), senza caricare `.env.local`:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm audit
npm audit --omit=dev
git diff --check
```

Per entrambe le suite SQL, nella stessa shell:

```sh
FT_SQL_RUNTIME="$(mktemp -d)"
npm install --prefix "$FT_SQL_RUNTIME" --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node supabase/tests/run-account-balances.mjs "$FT_SQL_RUNTIME/node_modules/@electric-sql/pglite/dist/index.js"

FT_NATIVE_RUNTIME="$(mktemp -d)"
npm install --prefix "$FT_NATIVE_RUNTIME" --no-save --package-lock=false embedded-postgres@18.4.0-beta.17
node supabase/tests/run-cash-concurrency.mjs "$FT_NATIVE_RUNTIME/node_modules/embedded-postgres/dist/index.js" --b1 --audit
```

Il nativo richiede socket Unix, esecuzione dei binari e memoria condivisa; in un sandbox possono servire permessi locali aggiuntivi. Non usare credenziali o URL di database reali. Con actionlint disponibile: `actionlint .github/workflows/ci.yml`.

## Evidenze e verifica dopo il push

È stato riportato il successo su Linux dei job applicativo e SQL del commit **`7464879fe6e1be5c07002b2584cf08825ac8f867`**. Il risultato riguarda la configurazione precedente, non quella con Actions aggiornate e versione Ubuntu esplicita.

Controlli eseguiti localmente durante la finalizzazione della CI su macOS/Node 22.23.3: build, typecheck, **649 test** (420 bot e 229 dominio), audit completo/produttivo con zero advisory, actionlint e controllo del diff. La validazione degli eventi comprende push dev/main, PR verso entrambi i branch, avvio manuale e scarto degli eventi fuori scope. Controllati SHA/runtime ufficiali, ordine installazione/build e conservazione dei comandi SQL. Nessuna suite o asserzione SQL modificata e nessuna nuova esecuzione hosted dichiarata superata.

Dopo la revisione delle modifiche, il commit e il push:

1. Aprire **Actions → CI** sul nuovo SHA di `dev`; attendere **entrambi** `test` e `SQL integration` riusciti, senza skip.
2. Verificare in **Set up job** Ubuntu 24.04, negli step checkout/setup i pin v7, e nel setup applicativo Node 22. Controllare le annotazioni per i warning precedenti.
3. Nel job SQL verificare che PGlite e PostgreSQL nativo siano entrambi eseguiti e che i log completino B1/B2/B3/B/C, concorrenza e rollback. Il solo successo dell’installazione non basta.
4. Sulla successiva PR verso `main` o `dev`, verificare i due check sullo SHA della PR/merge di test. Solo dopo il primo run della nuova definizione scegliere i nomi esatti nelle regole di protezione del branch.

Nessuna regola di branch protection è stata attivata da questa modifica. La nuova CI hosted e i warning restano da verificare dopo il push; la release v1.0.0 non è ancora conclusa.
