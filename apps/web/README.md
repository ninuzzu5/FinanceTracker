# Dashboard web

La parte web di FinanceTracker: React 19, TypeScript e Vite. Mostra i dati che
registro dal bot, in sola lettura. Da qui non si inserisce e non si modifica nulla.

## Cosa mostra

- Saldo complessivo, entrate e uscite del periodo, con vista per giorno,
  settimana, mese o anno.
- I conti con il loro saldo. Contanti è un conto come gli altri: la chiusura di
  cassa si fa dal bot.
- La torta "Dove vanno i soldi?" con tutte le categorie.
- Il calendario del mese e le cinque spese più grosse.
- La tabella dei movimenti, filtrabile per conto e categoria.

Quasi tutto è cliccabile e apre una finestra con il dettaglio. Trasferimenti e
movimenti annullati compaiono in tabella ma restano fuori da totali e grafici.
Se a un conto manca il saldo, il totale risulta non disponibile invece di
mostrare una somma parziale.

## Configurazione

Crea `apps/web/.env.local` partendo da `apps/web/.env.example`:

| Variabile | Valore |
| --- | --- |
| `VITE_SUPABASE_URL` | URL HTTPS del progetto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chiave pubblica `sb_publishable_…` (o la vecchia chiave `anon`) |
| `VITE_SUPABASE_WEB_USER_ID` | UUID dell’account web, diverso da quello del bot |

Questi tre valori finiscono nel JavaScript e chiunque apra la pagina può
leggerli: non sono segreti. Password, token e chiavi `service_role` qui non ci
vanno mai, e la build si rifiuta di partire se trova una chiave privilegiata.
Il `.env.local` della root è del bot: non va copiato qui.

## Avvio

Dalla root del repository:

```bash
npm ci
npm run web:dev
```

Poi apri `http://127.0.0.1:5173/`. Per provare la dashboard non serve avviare il bot.

## Accesso

Si entra con email, password e codice a sei cifre di un’app Authenticator. Al
primo accesso la pagina genera il QR da scansionare. Registrazione e recupero
password non esistono: l’account lo creo io dalla console Supabase.

L’account web è separato da quello del bot, così l’Authenticator sul web non
tocca le sessioni del bot. Il database risponde solo a una sessione che ha
passato il secondo fattore e che è associata al proprietario dei dati.

La sessione resta nel browser (localStorage) finché è valida. **Esci** chiude
solo la sessione di quel browser. Su un computer non mio esco sempre.

Se perdo il telefono non c’è un recupero dalla pagina: tolgo il vecchio fattore
dalla console Supabase, sull’account web, e ne associo uno nuovo al login
successivo.

## Dati

La dashboard chiama due funzioni di sola lettura, `get_dashboard_balances` e
`get_dashboard_movements`, aggiunte dalle migrazioni 010 e 011. Gli importi sono
gestiti in centesimi interi e restano in memoria: niente cache su disco.

## Codice

- `src/auth`: configurazione, client Supabase e gestione della sessione.
- `src/features/access`: login e secondo fattore.
- `src/features/dashboard`: lettura dei dati, calcoli, grafici, calendario, tabella.
- `src/styles`: tema, CSS e font (licenze in `src/styles/fonts/LICENZE.txt`).

## Test e build

```bash
npm run test -w @finance-tracker/web
npm run typecheck
npm run web:build
```

I test usano Supabase simulato e dati inventati, senza chiamate di rete.

## Da fare

- Mettere la dashboard online sul VPS, con HTTPS e una Content Security Policy.
- Mostrare la descrizione dei movimenti: oggi le funzioni di lettura non la
  restituiscono.
