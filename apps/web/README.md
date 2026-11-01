# Dashboard web

Frontend React 19, TypeScript e Vite 8 nel workspace `@finance-tracker/web`.
Richiede Node.js almeno 22.12. L'accesso email/password usa Supabase Auth;
la dashboard conserva esclusivamente i dati sintetici di `src/data/demo.ts`.
Non vengono lette tabelle, chiamate RPC contabili o modificate transazioni.

## Configurazione e avvio locale

Dalla root del repository:

```bash
npm ci
# Crea solo se assente; non sovrascrivere configurazioni già presenti.
if [ ! -e apps/web/.env.local ]; then
  cp apps/web/.env.example apps/web/.env.local
fi
```

Compila privatamente `apps/web/.env.local` con queste due variabili:

| Variabile | Valore necessario |
| --- | --- |
| `VITE_SUPABASE_URL` | URL pubblico HTTPS del progetto, senza credenziali, query o percorsi aggiuntivi |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chiave pubblica `sb_publishable_…`; in alternativa, chiave legacy JWT con ruolo `anon` |

Il file è ignorato da Git. Non copiare il `.env.local` della root: appartiene al
bot e contiene credenziali private. Non aggiungere password Auth, token Telegram,
secret key o chiavi `service_role` alle variabili web. Email e password si inseriscono
solo nel modulo di accesso, non nella configurazione Vite.

Vite legge l'ambiente di `apps/web`, senza usare il file privato del bot. Le
variabili di processo hanno precedenza; dopo modifiche riavvia Vite o ricompila.
URL e chiave pubblica sono incorporati nel JavaScript e leggibili dagli utenti.
La configurazione mantiene `envPrefix: []` e usa `define` per consentire soltanto
i due nomi esatti: un prefisso, anche completo, esporrebbe anche eventuali nomi
con suffissi privati. Le chiavi privilegiate e gli URL non validi vengono rifiutati
prima della build. Con entrambe le variabili assenti la build riesce, ma il modulo
spiega la configurazione mancante e disabilita l'accesso; una configurazione
parziale o non valida impedisce l'avvio/build con un errore privo di valori.

```bash
npm run web:dev
```

Apri `http://127.0.0.1:5173/`. Senza una sessione verificata viene mostrato
`/accesso`. Dopo il login riuscito si apre `/`, con il banner Dati di esempio.
Non eseguire `npm run bot:dev` per provare il frontend.

## Controlli manuali nella console Supabase

Usa il progetto già previsto per il frontend; non occorre crearne uno nuovo.
Nessuna impostazione remota è stata modificata da questa attività.

1. Recupera URL pubblico e chiave publishable dalle impostazioni API del progetto.
   Non utilizzare una chiave privilegiata, nemmeno per risolvere errori di login.
2. Verifica che il provider Email e l'accesso con password siano abilitati e che
   l'account autorizzato esista e sia confermato, se la conferma email è richiesta.
   L'interfaccia non offre registrazione né recupero password. Se occorre un
   account, predisponilo manualmente nella console con la procedura amministrativa.
3. Per un'app personale, verifica che la registrazione pubblica sia disabilitata
   anche nel progetto: nascondere il pulsante non disabilita l'API di signup.
   Prima di cambiare un'impostazione condivisa considera gli altri client.
4. Il login email/password non usa redirect OAuth, link email o un callback URL:
   non è necessario modificare Site URL o l'allowlist dei redirect per questo flusso.
5. Non attivare limiti di sessione singola o revoche globali per provare il logout:
   potrebbero interrompere il bot se usa lo stesso account. Usa esclusivamente
   credenziali utente autorizzate e un profilo browser fidato.

Non sono richieste modifiche a schema, RLS, RPC o migrazioni. Se il progetto
richiede CAPTCHA o MFA, questi passaggi non sono implementati dal modulo:
non disabilitare le protezioni del progetto; occorre una successiva integrazione.

## Sessione, verifica e logout

`AuthProvider` centralizza gli stati iniziale, anonimo, autenticato e di errore.
Ripristina la sessione con `getSession()` e verifica l'utente con `getUser(token)`
prima di montare la dashboard; il contenuto resta nascosto durante la verifica.
Ascolta `onAuthStateChange()` per accesso, aggiornamento token e uscita anche
tra schede. Le operazioni Auth sono differite fuori dal callback, per evitare
l'attesa del lock Auth. Le risposte obsolete vengono ignorate e le sottoscrizioni
rimosse allo smontaggio, anche con React StrictMode.

Il client ufficiale usa `persistSession: true` e `autoRefreshToken: true`, con
storage key dedicata `financetracker-web-auth`. Il SDK gestisce access token,
refresh token, persistenza in localStorage e rinnovo. Non viene mantenuta una
copia applicativa dei token. La password non entra nello stato React o nello
storage: il campo viene svuotato subito dopo l'invio. L'autocompletamento usa
`username`/`current-password` per i password manager gestiti dall'utente.

La sessione resta disponibile dopo refresh e chiusura del browser finché valida
o rinnovabile. localStorage è leggibile da JavaScript della stessa origine:
un attacco XSS potrebbe sottrarre i token. La scelta è quella ufficiale per una
SPA senza backend; non equivale a una sessione con cookie HttpOnly. Mantieni
l'origine fidata, evita script terzi non necessari, usa HTTPS nell'eventuale
hosting futuro e termina la sessione sui dispositivi condivisi. Con storage
bloccato la persistenza dopo refresh non è garantita.

Oltre al refresh ufficiale, un timer ricontrolla la sessione alla scadenza del
token: se manca il rinnovo o la verifica fallisce, il contenuto viene nascosto
ed è necessario accedere di nuovo. Le richieste hanno un timeout di 20 secondi.
Il browser può sospendere i timer nelle schede inattive: questa protezione è
solo un controllo dell'interfaccia, non una garanzia di revoca istantanea.
Le future letture finanziarie dovranno essere sempre autorizzate da RLS e dalle
RPC del database, indipendentemente dallo stato React. Non viene usato
`user_metadata` per autorizzare operazioni.

**Esci**, nella barra laterale o nel footer, chiama
`supabase.auth.signOut({ scope: "local" })`: rimuove la sessione corrente senza
revocare le altre sessioni dello stesso account, inclusa quella del bot.
Il contenuto della dashboard viene smontato subito e, al successo, si torna a
`/accesso`. Se l'uscita fallisce, viene mostrato un errore con Riprova a uscire;
non viene simulato un logout riuscito e i dati restano nascosti. La sessione
potrebbe ancora esistere nello storage: completa il retry prima di chiudere un
browser condiviso. Il logout revoca il refresh token della sessione; un access
token già emesso può restare valido fino alla propria scadenza.

## Prova locale del flusso

1. Visita `/` senza sessione: attendi la verifica e controlla il redirect a `/accesso`.
2. Prova campi vuoti e credenziali errate: resta nel modulo, senza dettagli SDK.
3. Usa un account autorizzato: durante l'invio il pulsante è disabilitato; al
   successo compare la dashboard con soli dati sintetici.
4. Ricarica `/`: la sessione deve essere ripristinata e verificata prima dei dati.
5. Apri `/accesso` con sessione attiva: torna a `/` senza redirect loop.
6. Premi Esci: il contenuto scompare e si torna al modulo. Ricarica per controllare
   che la sessione corrente sia stata rimossa. Verifica anche una seconda scheda.
7. Per scadenza, errori di rete e revoca usa inizialmente i test simulati; non
   modificare le impostazioni globali o revocare sessioni di produzione del bot.

Il login reale non è stato verificato durante l'implementazione: non sono state
usate credenziali reali né eseguite richieste al progetto Supabase.

## Dati e componenti

I valori restano in `src/data/demo.ts`, con tipi di conti e categorie dal dominio.
Totali e grafici sono quelli dimostrativi esistenti, non una lettura del ledger.
Movimenti, Analisi e Conti portano alle sezioni della pagina; Budget resta
indisponibile. Mostra tutti espande soltanto la tabella sintetica.

- `src/auth`: configurazione pubblica, client browser e provider Auth.
- `src/features/access`: modulo email/password, senza signup o recupero password.
- `src/features/dashboard`: interfaccia esistente e comandi Esci.
- `src/components` e `src/styles`: componenti e stile condivisi.

## Test e build

Dalla root:

```bash
npm run web:build
npm run typecheck
npm test
npm run test -w @finance-tracker/web
```

`web:build` compila solo dominio e web. `npm test` include ora anche la suite web:
Vitest, React Testing Library e jsdom (versione compatibile con il requisito Node
22.12 del progetto). Supabase è simulato e le richieste fetch reali sono bloccate;
Vitest non carica file `.env`. Sono verificati login, errore, invii duplicati,
configurazione assente/privilegiata, ripristino, eventi Auth, scadenza, logout,
risposte obsolete e l'allowlist esatta di Vite. Queste prove non certificano
credenziali, configurazione o autenticazione remota.

## Riferimenti

- [Supabase: login email/password](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase: verifica utente](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase: eventi Auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase: logout e scope](https://supabase.com/docs/reference/javascript/auth-signout)
- [Supabase: client e persistenza](https://supabase.com/docs/reference/javascript/initializing)
- [Vite: variabili d'ambiente e define](https://vite.dev/config/shared-options.html)
