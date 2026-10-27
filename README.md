# FinanceTracker

Uso FinanceTracker per registrare entrate, uscite e trasferimenti da Telegram.
Il bot interpreta il testo con regole TypeScript, mostra un riepilogo e salva
solo dopo la conferma. Supabase/PostgreSQL conserva i dati contabili.
La dashboard web mostra per ora dati di esempio: non legge il database e non autentica utenti.

## Uso del bot

Apri la chat privata autorizzata e invia un messaggio, per esempio:

- `ieri 12,50 spesa isybank`
- `100 stipendio revolut`
- `12 pranzo contanti`
- `50 da revolut a contanti`

Controlla conto, categoria, importo e data, poi conferma o modifica il riepilogo.
`/menu` avvia l’inserimento guidato, `/saldi` legge i saldi, `/movimenti` apre lo
storico e `/riconcilia` chiude una giornata Contanti. `/cancel` chiude il flusso.
Un trasferimento sposta fondi tra i conti, senza diventare un’entrata o un’uscita.
Il bot registra operazioni: non muove denaro presso le banche.
Dettagli nella [guida Telegram](docs/bot-guide.md).

## Avvio locale

Serve Node.js aggiornato, almeno 22.12. Esegui dalla root:

```bash
npm ci
npm run build
npm run bot:dev
```

Per il bot crea privatamente `.env.local` da `.env.example`, senza sovrascrivere
un file già presente. Prepara utente, conti EUR e aperture verificate seguendo la
[guida Supabase](supabase/README.md). Il comando non applica migrazioni.
Il bot resta attivo finché il processo e la connessione sono disponibili;
per fermarlo premi Ctrl+C. Dopo una modifica al codice fermalo e riavvialo.

Per la dashboard, in un altro terminale:

```bash
npm run web:dev
```

Apri `http://127.0.0.1:5173/`; `/accesso` è soltanto una schermata grafica.
Per il web non servono credenziali. Vedi la [guida web](apps/web/README.md).

## Variabili d’ambiente del bot

| Variabile | Uso |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token del bot |
| `TELEGRAM_ALLOWED_CHAT_ID` | ID della chat privata autorizzata |
| `SUPABASE_URL` | Endpoint HTTPS, senza credenziali nell’URL |
| `SUPABASE_ANON_KEY` | Chiave pubblica; mai secret/service role |
| `SUPABASE_USER_EMAIL`, `SUPABASE_USER_PASSWORD` | Utente Auth dedicato |
| `APP_TIMEZONE` | Predefinito `Europe/Rome`; mantienilo per coerenza con Contanti |
| `DEFAULT_ACCOUNT` | `revolut`, `isybank` o `contanti`; predefinito `revolut` |
| `TELEGRAM_WEBHOOK_SECRET` | Solo se usi il webhook al posto del polling |

Le variabili della shell hanno precedenza su `.env.local`. Non pubblicare segreti,
ID personali, saldi o esportazioni reali: vedi [sicurezza](SECURITY.md).

## Limiti noti

- Usa una sola istanza di polling, senza webhook attivo. Bozze e offset sono in memoria; le bozze scadono dopo 30 minuti e si perdono al riavvio. Le risposte Telegram possono mancare o duplicarsi anche con una scrittura riuscita.
- Dopo un timeout ritenta dallo stesso pulsante: un nuovo messaggio è una nuova operazione. Annullare il flusso non annulla una scrittura già riuscita. Gli inserimenti diretti e lo storico precedente alla migrazione 006 non hanno la stessa protezione dai duplicati.
- Le aperture sono manuali. Un saldo non configurato non vale zero. Le giornate Contanti chiuse non si possono riaprire; le correzioni mantengono il tipo del movimento e l’annullamento lo esclude anche dai saldi storici.
- Lo schema remoto e Auth/RLS non sono stati verificati da questa pulizia. Non è documentata una prova completata di backup/ripristino. Le [verifiche locali](docs/ci.md) non sostituiscono queste prove o il collaudo Telegram reale.
- La versione pubblicata v1.0.0 conserva un problema con le modifiche a messaggi estranei; il codice locale lo corregge. Per compilare i campi invia nuove risposte e controlla sempre il riepilogo.
- La dashboard usa solo dati sintetici. Accesso, recupero password e budget non sono operativi.
