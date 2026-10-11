# Classificatore locale — ipotesi futura

Il classificatore attuale è deterministico: [classification.ts](../packages/domain/src/classification.ts), con tassonomia, alias ed etichette in moduli distinti del dominio. Percorsi espliciti identificano trasferimenti senza categoria; regole lessicali classificano entrate/uscite. Risultati sconosciuti o conflittuali richiedono scelta manuale e conferma nel bot; nessuna categoria residuale inventata.

Questa directory non contiene un modello implementato o addestrato. Un eventuale fallback locale potrà consumare risultati unknown ed estendere ClassificationSource, riusando la [tassonomia documentata](../docs/bot-guide.md#classificazione-iniziale-a-regole). Importo, data e conto resteranno responsabilità del parser deterministico; nessuna API AI esterna è usata. È una possibilità da valutare, non una milestone già iniziata.

Conservare nel repository soltanto esempi sintetici revisionati e codice sicuro. Frasi private/dataset personali devono restare fuori da Git: model/data/private/ è ignorata, così come gli artefatti da revisionare in model/artifacts/. Il database Supabase conserva separatamente i valori contabili confermati, non un dataset di messaggi Telegram grezzi. Vedi [architettura](../docs/architecture.md) e [sicurezza](../SECURITY.md).
