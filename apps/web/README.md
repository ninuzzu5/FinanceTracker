# Dashboard web

Interfaccia React, TypeScript e Vite nel workspace `@finance-tracker/web`.
Richiede Node.js almeno 22.12 e le dipendenze installate dalla root con `npm ci`.

```bash
npm run web:dev
```

Apri `http://127.0.0.1:5173/`. Il percorso `/accesso` mostra soltanto il modulo
grafico: Accedi e Password dimenticata mostrano un messaggio di indisponibilità.
Non ci sono sessioni, invii o salvataggi dei campi. Non inserire credenziali reali.

## Dati e componenti

Tutti i valori sono sintetici e si trovano in `src/data/demo.ts`. Tipi di conti e
categorie vengono dal dominio condiviso. I totali mensili sono aggregati statici,
non somme della selezione di movimenti mostrata. I trasferimenti non hanno categoria
e non contribuiscono a entrate o uscite. Le quote delle categorie sono arrotondate;
le separazioni dell’anello SVG sono soltanto ottiche. Il grafico rappresenta le
spese cumulative dell’intero mese di esempio, ottobre 2026.

Il frontend non importa client Supabase, non legge il database e non espone
variabili d’ambiente (`envPrefix: []`). Non c’è una modalità reale da attivare.
Supabase rimane l’unica fonte contabile del prodotto; non aggiungere calcoli dei saldi qui.

- `src/features/access`: modulo di accesso grafico.
- `src/features/dashboard`: riepilogo, grafici e tabella.
- `src/components`: componenti condivisi.
- `src/styles/theme.css`: token di colori, superfici, tipografia, spaziature e movimento.
- `src/styles/app.css`: layout responsive e stati di interazione.

Il tema iniziale è scuro. I token permettono un futuro tema chiaro; non c’è un
selettore tema. Font di sistema, icone Lucide e grafici SVG evitano richieste
esterne e librerie aggiuntive. Sono presenti descrizioni testuali dei grafici,
intestazioni della tabella, navigazione da tastiera e collegamento al contenuto.
Le preferenze di movimento e trasparenza ridotti sono rispettate.

Movimenti, Analisi e Conti portano alle sezioni della pagina. Budget resta disabilitato.
Mostra tutti espande la selezione della tabella; nessuna azione modifica i dati.

## Verifiche

Dalla root: `npm run build`, `npm run typecheck`, `npm test`.
La build comprende dominio, bot e web; i test esistenti coprono bot e dominio,
non una suite automatica web. `npm run web:build` compila soltanto dominio e web;
`npm run preview -w @finance-tracker/web` serve la build web già generata.

I controlli non verificano Telegram o Supabase remoti. Vedi
[architettura](../../docs/architecture.md) e [CI](../../docs/ci.md).
Il [resoconto iniziale](../../docs/w1-frontend.md) conserva le verifiche del frontend.
