# Guida del bot Telegram

Il bot accetta messaggi di testo e pulsanti da una sola chat privata, la mia.
Tutto il resto viene ignorato. Capisce i messaggi con una grammatica fissa, non
con un modello linguistico, e salva solo dopo la mia conferma.

## Avvio

Nella root crea `.env.local` partendo da `.env.example` (le variabili sono nel
[README](../README.md#avvio-in-locale)), poi:

```bash
npm run bot:dev
```

Compila e avvia il bot in polling. Si ferma con Ctrl+C e va riavviato dopo ogni
modifica al codice. Se trova un webhook registrato si ferma senza cancellarlo:
polling e webhook non vanno usati insieme, e l’istanza deve essere una sola.
In produzione gira in un container Podman (`Containerfile` e `deploy/quadlet`).

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `/start`, `/menu` | Menu con Movimento, Trasferimento, Saldi, Storico, Contanti |
| `/saldi` | Saldo di ogni conto e patrimonio a oggi |
| `/movimenti` | Storico, cinque righe per pagina, con dettaglio, modifica e annullamento |
| `/riconcilia` | Chiusura di cassa dei contanti |
| `/help` | Esempi e comandi, senza interrompere quello che sto facendo |
| `/cancel` | Chiude il flusso in corso, senza toccare ciò che è già salvato |

## Scrivere un movimento

Un messaggio descrive un solo movimento: importo, parola chiave, eventuale
conto e data.

```text
8,30 tabacco
ieri 12,50 spesa isybank
100 stipendio revolut
10/09 20 pranzo contanti
```

**Importo.** Un solo numero positivo, al massimo sette cifre intere e due
decimali: `12`, `12,50`, `12.50`, `€12`, `12 EUR`. Segni, separatori delle
migliaia, più importi nello stesso messaggio e zero vengono rifiutati. Niente
arrotondamenti.

**Data.** Se manca è oggi, nel fuso `Europe/Rome`.

| Scrivo | Con oggi venerdì 18/09/2026 |
| --- | --- |
| `ieri`, `l'altro ieri`, `avantieri` | 17/09, 16/09 |
| `3 giorni fa`, `una settimana fa` | 15/09, 11/09 |
| `mercoledì`, `mercoledì scorso` | 16/09 |
| `mercoledì prossimo` | 23/09 |
| `10/09`, `10-09-2026`, `2026-09-10`, `10 settembre` | 10/09/2026 |

Senza anno vale quello corrente. Una data impossibile (`31/02`) o due date nello
stesso messaggio fanno chiedere un chiarimento: non diventano mai "oggi".
`domani` non è supportato.

**Conto.** `revolut`, `isybank` (anche `isy`), `contanti` (anche `cash`,
`in contanti`, `liquidi`). Se manca vale `DEFAULT_ACCOUNT`.

**Trasferimenti.** Solo con la forma `da <conto> a <conto>`:

```text
50 da revolut a contanti
ieri 100 da isybank a revolut
```

Un trasferimento non ha categoria e non conta come entrata o uscita. I due conti
devono essere diversi e non ne indovino mai uno mancante.

## Categorie

Le categorie si riconoscono da parole chiave (`packages/domain/src/classification-aliases.ts`).
Se la parola non è nota, o ce ne sono due in conflitto, tipo e categoria restano
da scegliere a mano prima di confermare.

| Uscite | Entrate |
| --- | --- |
| Spesa, Cibo, Mezzi di trasporto, Voli, Vacanze, Tabacco, Sport, Svago & uscite, Affitto, Personal Care, Abbonamenti, Regali, Imprevisti | Stipendio, Regali, Progetti personali |

Spesa è il supermercato, Cibo è mangiare fuori. Regali vale in entrambe le
direzioni: `regalo per Marco` è un’uscita, `regalo ricevuto` un’entrata.

## Conferma, modifica, annulla

Ogni messaggio valido produce un riepilogo con **Conferma**, **Modifica** e
**Annulla**. Modifica permette di cambiare importo, data, conto, tipo e categoria
(origine e destinazione per i trasferimenti). Finché non confermo non viene
salvato nulla.

C’è una sola proposta attiva alla volta: un nuovo messaggio sostituisce la
precedente. Le proposte scadono dopo 30 minuti e si perdono se il bot riparte.
L’inserimento guidato da `/menu` porta allo stesso riepilogo.

Se correggo su Telegram un messaggio non ancora confermato, il riepilogo si
aggiorna. Se il movimento è già salvato, la modifica del messaggio non cambia
nulla: per correggere si passa da `/movimenti`.

## Se qualcosa va storto

Ogni conferma porta una chiave legata al messaggio di partenza, e il database
salva una ricevuta insieme al movimento. Dopo un timeout basta premere
**Riprova stessa operazione**: se il movimento era già stato salvato, il bot lo
riconosce e non lo duplica. Funziona anche dopo un riavvio.

Riscrivere lo stesso testo in un messaggio nuovo è invece una nuova operazione:
due messaggi uguali possono essere due spese vere.

## Storico e correzioni

Da `/movimenti` apro un movimento e posso:

- **Modificarlo**: importo, data, categoria e conti. Il tipo non cambia. Prima di
  salvare vedo il confronto prima/dopo.
- **Annullarlo**: resta nello storico come annullato ed esce dai saldi. Non si
  cancella e non si riattiva.

Ogni correzione lascia traccia nel database con lo stato precedente.

## Saldi

`/saldi` mostra i conti con il saldo calcolato dal database e il totale. Se a un
conto manca il saldo iniziale, quel conto e il totale risultano non disponibili:
niente somme parziali spacciate per complete.

## Contanti

Contanti è un conto come gli altri, più la chiusura di cassa. Con `/riconcilia`
scelgo oggi o ieri, scrivo quanti soldi ho davvero in tasca e il bot mi mostra
saldo teorico, saldo contato e differenza. Confermando viene registrata una
rettifica (non una spesa finta) e la giornata si chiude.

In una giornata chiusa non si possono più aggiungere, modificare o annullare
movimenti che toccano i contanti, e la chiusura non si riapre. Chiudere oggi
vuol dire non poter più registrare contanti oggi.

## Limiti

- Bozze, pannelli e posizione nella coda dei messaggi stanno in memoria: un
  riavvio li perde. I movimenti confermati no.
- Telegram può non consegnare una risposta anche se il salvataggio è riuscito.
  In dubbio controllo `/movimenti` prima di riscrivere.
- I movimenti salvati prima della migrazione 006 non hanno ricevuta, quindi per
  loro la protezione dai duplicati non vale.
- Le chiusure di cassa usano sempre `Europe/Rome`: con un altro `APP_TIMEZONE`
  i giorni possono non coincidere.
- I saldi iniziali si impostano a mano, vedi la [guida Supabase](../supabase/README.md#conti-e-saldi-iniziali).

## Provare le modifiche

I test automatici simulano Telegram e Supabase. Le prove a mano che salvano
movimenti le faccio su un progetto Supabase di test, mai sui conti veri.
