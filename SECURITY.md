# Sicurezza

Qui dentro ci sono i miei soldi, quindi tengo poche regole e le rispetto.

## Cosa resta fuori da Git

- Token Telegram, secret del webhook, ID della chat.
- Credenziali Supabase, chiavi `secret` o `service_role`, sessioni, JWT, UUID
  degli utenti.
- I file `.env*`, tranne i due `.env.example` con soli segnaposto.
- Movimenti, saldi, esportazioni bancarie, screenshot con dati veri.

Test, esempi e immagini usano dati inventati.

## Se scappa un segreto

Lo revoco o lo rigenero subito. Cancellarlo dal file non basta: resta nella
cronologia e resta valido finché non lo cambio.

Se trovi un problema di sicurezza scrivimi in privato, non aprire una issue
pubblica con i dettagli.

## Come sono protetti i dati

- Bot e dashboard usano solo la chiave pubblica di Supabase. La `service_role`
  non sta in nessuna configurazione.
- Hanno due utenti diversi. Quello della dashboard entra solo con password e
  codice Authenticator, e può soltanto leggere.
- RLS separa i proprietari. I client non possono scrivere direttamente nelle
  tabelle: le scritture passano da funzioni SQL che controllano chi le chiama.
- Il bot risponde a una sola chat privata e accetta solo endpoint HTTPS.
- I log non contengono token, ID della chat o testo dei messaggi.

Nel browser finiscono URL del progetto, chiave pubblica e UUID dell’account web:
sono leggibili da chiunque apra la pagina e non sono segreti. La sessione web
resta in localStorage, quindi su un computer non mio esco sempre. Vedi la
[guida web](apps/web/README.md#accesso).

## Cose da non fare

- Usare polling e webhook insieme, o due istanze del bot.
- Disattivare un trigger o allargare un permesso per far passare una modifica.
- Correggere i dati a mano nelle tabelle per aggirare una giornata di contanti
  chiusa.
- Rieseguire migrazioni già applicate: vedi l’[ordine](supabase/README.md#ordine-delle-migrazioni).
- Riscrivere un messaggio dopo un timeout invece di ripremere lo stesso pulsante.

## Cosa non ho ancora verificato

- Un ripristino completo da backup: vedi [backup e ripristino](supabase/README.md#backup-e-ripristino).
- La dashboard esposta su internet. Per ora gira solo in locale.

La [CI](docs/ci.md) prova codice e schema su database temporanei. Non dice nulla
su come è configurato il progetto Supabase vero.
