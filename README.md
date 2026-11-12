# FinanceTracker

Il mio tracker di finanze personali. Registro entrate, uscite e trasferimenti
scrivendo a un bot Telegram, i dati stanno su Supabase (PostgreSQL) e una
dashboard web me li fa vedere in sola lettura.

Il progetto è fatto su misura per me: tre conti (Revolut, Isybank, Contanti),
solo euro, un solo utente.

## Come funziona

- **Bot Telegram** (`apps/bot`): scrivo `12 pranzo contanti`, lui capisce importo,
  categoria, conto e data con regole scritte a mano, mi mostra un riepilogo e
  salva solo quando confermo. Niente AI.
- **Database** (`supabase`): fa i conti lui. Saldi, chiusure di cassa e correzioni
  passano da funzioni SQL; i client non scrivono mai direttamente nelle tabelle.
- **Dashboard** (`apps/web`): saldi, entrate e uscite per giorno, settimana, mese
  o anno, torta delle categorie, calendario e tabella dei movimenti. Si entra con
  email, password e codice Authenticator.
- **Dominio** (`packages/domain`): parser, categorie e importi condivisi.

## A che punto sono

- Il bot è in uso e gira su un mio VPS dentro un container Podman.
- La dashboard gira in locale e legge dal database. Non è ancora online.
- Prossimi passi: collaudo completo della dashboard, pulizia dei dati di prova,
  messa online.

## Usare il bot

```text
ieri 12,50 spesa isybank
100 stipendio revolut
50 da revolut a contanti
```

`/menu` apre l’inserimento guidato, `/saldi` mostra i saldi, `/movimenti` lo
storico (da lì si modifica o si annulla un movimento), `/riconcilia` chiude la
giornata dei contanti, `/cancel` esce. Il bot registra soltanto: non muove soldi
in banca. Il resto è nella [guida del bot](docs/bot-guide.md).

## Avvio in locale

Serve Node.js 22.12 o successivo.

```bash
npm ci
npm run bot:dev   # bot in polling
npm run web:dev   # dashboard su http://127.0.0.1:5173/
```

Il bot legge `.env.local` nella root (parti da `.env.example`), la dashboard
legge `apps/web/.env.local`: sono due file diversi e non vanno mescolati.
Il database va preparato a mano seguendo la [guida Supabase](supabase/README.md);
per la dashboard c’è la [guida web](apps/web/README.md).

| Variabile del bot | Uso |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token del bot |
| `TELEGRAM_ALLOWED_CHAT_ID` | L’unica chat privata autorizzata |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Progetto e chiave pubblica, mai la service role |
| `SUPABASE_USER_EMAIL`, `SUPABASE_USER_PASSWORD` | Utente Auth dedicato al bot |
| `APP_TIMEZONE` | Predefinito `Europe/Rome`, meglio non cambiarlo |
| `DEFAULT_ACCOUNT` | `revolut` (predefinito), `isybank` o `contanti` |
| `TELEGRAM_WEBHOOK_SECRET` | Solo se si usa il webhook al posto del polling |

## Limiti che conosco

- Una sola istanza del bot alla volta. Le bozze non confermate stanno in memoria:
  scadono dopo 30 minuti e si perdono al riavvio.
- Dopo un timeout si riprova dallo stesso pulsante. Riscrivere il messaggio
  crea un secondo movimento.
- I saldi iniziali dei conti si impostano a mano nel database. Un conto senza
  saldo iniziale risulta "non disponibile", non zero.
- Una giornata di contanti chiusa non si riapre.
- Non ho ancora provato un ripristino completo da backup.
- La release v1.0.0 ha un difetto sui messaggi modificati, corretto nel codice
  successivo.

Altro: [architettura](docs/architecture.md), [sicurezza](SECURITY.md),
[test e CI](docs/ci.md).
