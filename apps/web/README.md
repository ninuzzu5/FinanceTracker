# Dashboard web — da implementare

Questa directory contiene soltanto documentazione: nessuna applicazione web, package.json, build o comando di avvio dedicato. Vite/React è un’ipotesi di stack, non una dipendenza implementata. Il campo description del package.json root menziona una dashboard realtime come visione di prodotto: non attesta una funzionalità esistente; questo metadato potrà essere corretto in una task dedicata.

Il bot Telegram già salva movimenti idempotenti, legge lo storico e riconcilia Contanti. Supabase contiene la fonte contabile: aperture, transazioni e rettifiche; la RPC get_account_balances calcola i saldi senza duplicarli.

La futura dashboard leggerà direttamente Supabase con autenticazione e RLS. Durante lo sviluppo usare dati sintetici da eliminare prima dell'uso effettivo, senza modalità demo/reale separate. Non inviare al browser credenziali o sessioni Auth del bot. Saldi NULL indicano stati non configurati/prima dell'apertura, non zero; preservare precisione decimale e formattare timestamp con fuso esplicito.

Autenticazione web, visualizzazioni, statistiche, budget e realtime sono da progettare. Vedi [architettura attuale](../../docs/architecture.md) e [schema/istruzioni Supabase](../../supabase/README.md).
