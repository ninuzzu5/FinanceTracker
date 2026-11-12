# Test e CI

Il workflow [`ci.yml`](../.github/workflows/ci.yml) parte a ogni push su `dev` e
`main` e a ogni PR verso questi due rami. Ha due job indipendenti:

| Job | Cosa controlla |
| --- | --- |
| `test` | `npm ci`, build, typecheck, test di bot, web e dominio, `npm audit` |
| `SQL integration` | Migrazioni e test SQL in memoria, poi le prove di concorrenza su un PostgreSQL vero |

Gira su Ubuntu 24.04 con Node 22. Le Actions sono fissate a uno SHA preciso, i
permessi sono di sola lettura e non serve nessun segreto: tutto usa servizi
simulati o database temporanei.

## In locale

Con Node 22.12 o successivo:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm audit
```

I comandi per i test SQL sono nella [guida Supabase](../supabase/README.md#test).

## Quando qualcosa fallisce

- Lo riproduco in locale con la stessa versione di Node e lo stesso lockfile.
- Un avviso di `npm audit` lo guardo nel merito: niente `audit fix --force` alla
  cieca, e l’audit non si disattiva.
- Un test SQL che fallisce è una regressione finché non dimostro il contrario.
  Non tolgo il test e non allargo i permessi per tornare al verde.

## Cosa non copre

Due job verdi dicono che il codice compila, i test passano e lo schema nel
repository si comporta come previsto. Non verificano il progetto Supabase vero,
la consegna dei messaggi Telegram o i backup.
