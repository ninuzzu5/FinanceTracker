# Dashboard web

Frontend React 19, TypeScript e Vite 8 nel workspace `@finance-tracker/web`.
Richiede Node.js almeno 22.12. L’accesso email/password e il secondo fattore TOTP
usano Supabase Auth. La dashboard legge saldi e movimenti con due RPC di sola
lettura, tramite la sessione web verificata a livello `aal2`.

## Configurazione e avvio locale

Dalla root del repository:

```bash
npm ci
# Crea solo se assente; non sovrascrivere configurazioni già presenti.
if [ ! -e apps/web/.env.local ]; then
  cp apps/web/.env.example apps/web/.env.local
fi
```

Compila privatamente `apps/web/.env.local` con queste tre variabili:

| Variabile | Valore necessario |
| --- | --- |
| `VITE_SUPABASE_URL` | URL pubblico HTTPS del progetto, senza credenziali, query o percorsi aggiuntivi |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chiave pubblica `sb_publishable_…`; in alternativa, chiave legacy JWT con ruolo `anon` |
| `VITE_SUPABASE_WEB_USER_ID` | UUID di un account Auth dedicato al web, distinto dall’utente del bot |

Il file è ignorato da Git. Non copiare il `.env.local` della root: appartiene al
bot e contiene credenziali private. Non aggiungere password Auth, token Telegram,
secret key o chiavi `service_role` alle variabili web. Email e password si inseriscono
solo nel modulo di accesso, non nella configurazione Vite.

Vite legge l'ambiente di `apps/web`, senza usare il file privato del bot. Le
variabili di processo hanno precedenza; dopo modifiche riavvia Vite o ricompila.
URL, chiave pubblica e UUID dell’account web sono incorporati nel JavaScript e leggibili dagli utenti; l’UUID è un identificativo, non un segreto né una policy di autorizzazione.
La configurazione mantiene `envPrefix: []` e usa `define` per consentire soltanto
i tre nomi esatti: un prefisso, anche completo, esporrebbe anche eventuali nomi
con suffissi privati. Le chiavi privilegiate e gli URL non validi vengono rifiutati
prima della build. Con entrambe le variabili assenti la build riesce, ma il modulo
spiega la configurazione mancante e disabilita l'accesso; una configurazione
URL/chiave parziali o valori non validi impediscono l’avvio/build con un errore privo di valori. Se manca solo l’UUID, la build riesce ma Auth resta disabilitato, senza inizializzare il client.

```bash
npm run web:dev
```

Apri `http://127.0.0.1:5173/`. Senza una sessione verificata viene mostrato
`/accesso`. Dopo email e password viene richiesto Authenticator. La dashboard
carica i dati soltanto dopo la verifica di `aal2`.
Non eseguire `npm run bot:dev` per provare il frontend.

## Controlli manuali nella console Supabase

Usa il progetto già previsto per il frontend; non occorre crearne uno nuovo.
Nessuna impostazione remota è stata modificata da questa attività.

1. Recupera URL pubblico e chiave publishable dalle impostazioni API del progetto.
   Non utilizzare una chiave privilegiata, nemmeno per risolvere errori di login.
2. Verifica che il provider Email e l'accesso con password siano abilitati e che
   l'account autorizzato esista e sia confermato, se la conferma email è richiesta.
   Prepara un account web distinto dal bot e confronta manualmente i due UUID
   nella console prima di impostare `VITE_SUPABASE_WEB_USER_ID`. Non cambiare
   email, password, fattori o sessioni del bot.
   L’interfaccia non offre registrazione né recupero password. Se occorre un
   account, predisponilo manualmente nella console con la procedura amministrativa.
3. Per un'app personale, verifica che la registrazione pubblica sia disabilitata
   anche nel progetto: nascondere il pulsante non disabilita l'API di signup.
   Prima di cambiare un'impostazione condivisa considera gli altri client.
4. Il login email/password non usa redirect OAuth, link email o un callback URL:
   non è necessario modificare Site URL o l'allowlist dei redirect per questo flusso.
5. Non attivare limiti di sessione singola o revoche globali per provare il logout:
   potrebbero interrompere il bot se usa lo stesso account. Usa esclusivamente
   credenziali utente autorizzate e un profilo browser fidato.

Verifica che il fattore TOTP sia disponibile nelle impostazioni MFA del progetto.
Non sono richieste modifiche a schema, RLS, RPC o migrazioni. Non aggiungere policy
MFA globali: il bot usa sessioni password `aal1`. Se è richiesto CAPTCHA, occorre
un’integrazione successiva; non disabilitare le protezioni per aggirare un errore.

## Sessione, verifica e logout

`AuthProvider` centralizza gli stati iniziale, anonimo, autenticato e di errore.
Ripristina la sessione con `getSession()` e verifica l'utente con `getUser(token)`
prima di montare la dashboard. Controlla anche `getAuthenticatorAssuranceLevel(token)`
e `listFactors()`: occorrono `currentLevel === "aal2"`, un fattore TOTP verificato
e l’identità web configurata. Il contenuto resta nascosto durante la verifica.
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
3. Usa l’account web dedicato, mai quello del bot. Dopo email/password completa
   Authenticator; il pulsante resta disabilitato durante le richieste e la dashboard
   compare solo dopo la verifica `aal2`.
4. Ricarica `/`: la sessione deve essere ripristinata e verificata prima dei dati.
5. Apri `/accesso` con sessione attiva: torna a `/` senza redirect loop.
6. Premi Esci: il contenuto scompare e si torna al modulo. Ricarica per controllare
   che la sessione corrente sia stata rimossa. Verifica anche una seconda scheda.
7. Per scadenza, errori di rete e revoca usa inizialmente i test simulati; non
   modificare le impostazioni globali o revocare sessioni di produzione del bot.

Il login email/password è stato verificato manualmente prima di queste modifiche.
Il nuovo flusso MFA non è stato provato sul progetto reale: i test automatici
usano solo mock e dati sintetici, senza richieste al progetto Supabase.

## Attivazione e verifica di Authenticator

L’attivazione MFA può revocare le altre sessioni dello stesso account. Il vincolo
sull’UUID serve a evitare l’attivazione accidentale sull’utente del bot; non può
verificare che un valore configurato manualmente sia davvero distinto. Se oggi
usi le credenziali del bot anche sul web, fermati e predisponi prima l’identità web
separata. L’app non attiva fattori automaticamente e non rimuove fattori esistenti.

Dopo email/password, se manca un TOTP verificato, scegli **Genera QR per
Authenticator**, scansiona il QR con un’app Authenticator e inserisci il codice
di sei cifre. Solo una conferma riuscita e una successiva verifica del nuovo
livello `aal2` aprono la dashboard. Il QR resta soltanto in memoria e viene
renderizzato come immagine SVG isolata; non copiarlo in log, screenshot o report.
Codici e password vengono svuotati subito dopo l’invio, senza storage applicativo.

Il QR restituito dal SDK può contenere una dichiarazione XML prima di `<svg>`.
Il frontend valida il documento SVG e lo normalizza in un data URI codificato,
conservando la geometria del QR e senza inserire HTML nella pagina. Sono gestiti
SVG diretto e data URI SVG, anche con percent-encoding o base64. URL remoti,
formati diversi da SVG e XML malformato vengono rifiutati.

`enroll()` crea un fattore non verificato prima di restituire il QR: un errore
di visualizzazione non annulla la creazione. In quel caso il modulo mostra
subito lo stato incompleto e permette di generare un nuovo QR. Non riutilizzare
il codice di un vecchio QR per confermare quello nuovo; ogni QR corrisponde
al proprio fattore. La dashboard resta bloccata fino alla verifica `aal2`.

Dopo Esci e un nuovo login occorre il codice del fattore verificato, senza creare
un nuovo QR. Il refresh durante il secondo fattore non apre la dashboard. Una
sessione già valida a `aal2` può invece essere ripristinata senza un nuovo codice:
non è prevista una richiesta MFA a ogni refresh o un limite di età della verifica.
Le sessioni precedenti all’attivazione, ancora `aal1`, restano bloccate.

Se ricarichi durante l’attivazione, il segreto non viene recuperato dallo storage.
Se hai già scansionato il QR puoi confermare il fattore incompleto; altrimenti
puoi generare un nuovo QR. I fattori incompleti precedenti restano presenti e
possono raggiungere il limite configurato sul progetto: l’amministratore deve
rivedere e rimuovere soltanto quelli non verificati e non più usati, sull’account
web. Nessun fattore viene eliminato automaticamente dal frontend.

La verifica `aal2` protegge la navigazione, non impone MFA alle API del database.
Prima dei dati reali occorre progettare una policy distinta per il web e il bot:
non applicare indiscriminatamente `aal2` al ledger. Un nuovo account web ha un
UUID diverso e non eredita l’accesso ai dati dell’utente del bot; non aggiungere
mapping, grant o eccezioni alle RLS in questa fase.

## Recupero se perdi il dispositivo

Se esiste un altro TOTP già verificato, selezionalo nel modulo. Altrimenti il
recupero è amministrativo, fuori dalla SPA: nessun bypass, chiave privilegiata
o comando di disattivazione MFA è disponibile nel browser.

1. Interrompi i tentativi e verifica l’identità del proprietario tramite un canale
   indipendente. Conoscere soltanto la password o avere accesso alla casella email
   non è sufficiente per autorizzare la rimozione del secondo fattore.
2. Un amministratore autorizzato accede alla console Supabase con il proprio
   account amministrativo protetto e identifica esattamente l’UUID web configurato,
   confrontandolo con quello del bot. Non agire sull’account del bot.
3. Da un ambiente amministrativo fidato, rivede i fattori dell’utente web, rimuove
   soltanto quello perso con le funzionalità amministrative ufficiali e revoca le
   sessioni compromesse dell’utente web. Non creare API amministrative nel frontend.
4. Il proprietario effettua di nuovo email/password e associa un nuovo Authenticator.
   Prima di usare la dashboard deve tornare a `aal2`. Registra l’intervento senza
   password, codici, QR, segreti o token e verifica un nuovo login completo.

Questa procedura richiede verifica umana e privilegi amministrativi; non è stata
eseguita sul progetto reale. Non sono attivati codici di recupero sperimentali.

## CSP per l’eventuale hosting HTTPS

Non è stata applicata una policy al server o al browser in questa fase. Sul futuro
reverse proxy prova prima una CSP in modalità `Content-Security-Policy-Report-Only`,
poi applicala dopo una verifica completa di login, refresh, QR e logout. Un punto
di partenza per la build di produzione è il seguente header; sostituisci solo
l’host pubblico Supabase con quello effettivamente configurato:

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://PROJECT.supabase.co; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'
```

`data:` serve per QR e favicon SVG, senza consentire script inline. La deroga
`style-src-attr` conserva i colori inline della legenda esistente; non autorizza
script. La build attuale non usa Realtime: non occorre autorizzare WebSocket verso
Supabase. Se in futuro cambia il traffico, rivedi `connect-src` senza wildcard.
`frame-ancestors` richiede un header HTTP: una meta CSP non lo sostituisce.

Non riutilizzare questa policy alla cieca su Vite dev: React Refresh usa codice
inline, Vite inietta gli stili e HMR richiede il WebSocket locale. Tieni la policy
di produzione sul futuro proxy della build statica; per eventuali prove dev usa
una policy separata limitata all’origine locale. Non ampliare la CSP di produzione
per risolvere errori del server di sviluppo. Nessun proxy o HTTPS è stato configurato.

## Dati e componenti

La dashboard richiede le migrazioni 010 e 011 e un’associazione privata attiva tra
l’identità web e il proprietario del ledger. Usa `get_dashboard_balances` e
`get_dashboard_movements` tramite GET autenticati. Il mese corrente termina alla
data civile odierna di Roma e i mesi precedenti al loro ultimo giorno. Il saldo
complessivo somma i saldi in EUR restituiti dal database, inclusi quelli dei
conti inattivi. Se un saldo manca, il totale è indisponibile.

I movimenti sono letti con cursore data e UUID fino alla prima pagina vuota.
I grafici aspettano tutte le pagine del mese ed escludono trasferimenti e
annullamenti. La tabella include entrambi e mostra i movimenti a gruppi.
Gli importi sono elaborati in centesimi interi. I dati finanziari restano in memoria
e le richieste pendenti vengono annullate al cambio di periodo o sessione.

La firma attuale delle RPC fornisce i nomi dei conti e il tipo di movimento.
Per mostrare anche il tipo di conto o le descrizioni occorre estendere una RPC
di lettura o introdurne una versione con quei campi. Budget resta indisponibile
finché il progetto non definisce come memorizzare e leggere i budget.

- `src/auth`: configurazione pubblica, client browser e provider Auth.
- `src/features/access`: modulo email/password, senza signup o recupero password.
- `src/features/dashboard`: letture, riepilogo mensile, grafici, conti e movimenti.
- `src/components` e `src/styles`: componenti e stile condivisi.

## Verifica della dashboard in locale

1. Usa la configurazione pubblica descritta sopra e avvia `npm run web:dev`.
2. Apri l’indirizzo locale mostrato da Vite, accedi con l’account web dedicato
   e inserisci il codice Authenticator. Prima di completare MFA, nel pannello
   Rete non devono esserci richieste alle RPC della dashboard.
3. Seleziona un mese con movimenti. Confronta il saldo alla data mostrata con il
   saldo del bot alla stessa data. Controlla che trasferimenti e annullamenti
   compaiano nella tabella e restino fuori da entrate, uscite e grafici.
4. Passa a un mese senza movimenti. La tabella deve mostrare il suo stato vuoto.
   Su un ledger senza conti né movimenti compare lo stato «Nessun dato disponibile».
5. Esci durante un caricamento. La dashboard deve scomparire e le richieste
   del periodo devono essere annullate.

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
configurazione assente/privilegiata, ripristino, eventi Auth, scadenza, logout, MFA,
risposte obsolete e l'allowlist esatta di Vite. Queste prove non certificano
credenziali, configurazione o autenticazione remota.

## Riferimenti

- [Supabase: login email/password](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase: verifica utente](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase: MFA TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp)
- [Supabase: livello AAL](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel)
- [Supabase: rimozione amministrativa di un fattore](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor)
- [Supabase: eventi Auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase: logout e scope](https://supabase.com/docs/reference/javascript/auth-signout)
- [Supabase: client e persistenza](https://supabase.com/docs/reference/javascript/initializing)
- [Vite: variabili d'ambiente e define](https://vite.dev/config/shared-options.html)
