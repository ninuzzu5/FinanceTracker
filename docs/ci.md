# Verifiche e CI

Il workflow `CI` avvia i job su push a `dev`/`main`, PR verso questi branch e
`workflow_dispatch` quando disponibile sul branch predefinito. Non ha filtri sui
percorsi, non usa `pull_request_target` e non parte su altri branch/tag o destinazioni.

| Check | Controlli |
| --- | --- |
| `test` | Installazione da lockfile, build, typecheck, test, audit completo e di produzione |
| `SQL integration` | Migrazioni e fixture PGlite, PostgreSQL nativo, concorrenza e integrazione bot |

I job sono indipendenti e ricompilano nel proprio ambiente. Un errore fa fallire
il job: non ci sono eccezioni che nascondono test o audit falliti. Prima di rendere
obbligatori i due check, verifica un run completo sulla revisione interessata e
seleziona i nomi esatti con sorgente GitHub Actions. Le regole remote non sono
state modificate né verificate da questa pulizia.

## Ambiente

Il workflow usa Ubuntu 24.04 e Node 22 per l’applicazione. Il requisito locale è
Node almeno 22.12. Le Actions checkout 7.0.1 e setup-node 7.1.0 sono vincolate a
SHA completi nel [workflow](../.github/workflows/ci.yml); il loro runtime interno
Node 24 non cambia la versione di Node usata dall’applicazione. L’immagine Ubuntu
continua a ricevere aggiornamenti; un runner self-hosted richiede una verifica propria.

I permessi sono `contents: read`, checkout senza credenziali persistite e nessun
segreto applicativo. PGlite 0.5.8 ed embedded-postgres 18.4.0-beta.17 si installano
in directory temporanee: nessuna dipendenza applicativa aggiuntiva. PGlite non
esegue lifecycle script; il wrapper PostgreSQL li richiede per i symlink.
Il database nativo usa password sintetica, cluster temporaneo e socket Unix, senza TCP.

## Come interpretare i risultati

Due job verdi verificano compilazione, tipi, test, advisory noti e contratti SQL
locali: proprietà, saldi, ricevute, correzioni, annullamenti, retry e concorrenza.
Non certificano Auth/JWT, RLS/grant installati o PostgREST remoti, consegna Telegram,
backup/ripristino o assenza di ogni vulnerabilità. I test applicativi usano servizi
simulati. La prova del ripristino rimane da documentare: vedi [sicurezza](../SECURITY.md).

Se un controllo fallisce:

- Riproduci errori di installazione, build, tipi e test con la stessa versione Node e lockfile. La cache non sostituisce `npm ci`.
- Per un advisory verifica pacchetto, gravità e uso effettivo. Non disabilitare l’audit e non usare automaticamente `audit fix --force`.
- Per problemi del runtime SQL controlla binari, librerie, symlink, socket e memoria condivisa. Non usare il database personale come alternativa.
- Considera un’asserzione SQL fallita una regressione finché non è spiegata. Non rimuovere test, ampliare permessi o disabilitare trigger per ottenere verde.

Non registrare segreti o dati personali. Un retry infrastrutturale deve conservare
l’evidenza del fallimento; errori ripetuti richiedono indagine.

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

## Evidenze disponibili

I risultati seguenti sono osservazioni datate, non nuove verifiche remote:

- Il 19 ottobre 2026 su macOS/Node 22.23.3 sono passati build, typecheck, 649 test, audit, actionlint e prove SQL, comprese 25 sessioni concorrenti e recupero dopo risposta persa. PGlite è stato verificato anche su Node 24; gli snapshot testuali distinguono date infinite e conservano le righe legacy senza arrotondamenti.
- È stato riportato un run Linux riuscito sul commit `7464879fe6e1be5c07002b2584cf08825ac8f867`. Riguarda la configurazione precedente: non dimostra l’esecuzione della nuova definizione con Actions aggiornate e Ubuntu esplicito.
- Il 22 ottobre la correzione degli edit Telegram estranei è stata verificata localmente. La release pubblicata v1.0.0 non è stata modificata.
- Il [resoconto del frontend](w1-frontend.md) conserva le prove locali successive e i limiti del collaudo visuale.

Non risulta documentata una verifica hosted della nuova definizione o delle
protezioni dei branch. In un futuro run controlla lo SHA, entrambi i job senza
skip, versioni del runner, annotazioni, fixture SQL e concorrenza completate.
L’installazione riuscita da sola non verifica le asserzioni. Per il controllo
manuale del database di test usa la [guida Supabase](../supabase/README.md).
