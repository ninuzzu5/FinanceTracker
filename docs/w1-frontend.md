# W1 — Fondazione frontend

Verifica locale del 26 ottobre 2026, con Node.js 24.16.0 e npm 11.13.0.
Modifiche lasciate locali, senza branch, commit, push, PR o deploy.

## File

Creati in `apps/web`:

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`.
- `src/main.tsx`, `src/App.tsx`.
- `src/components/Brand.tsx`.
- `src/data/demo.ts`.
- `src/features/access/Access.tsx`.
- `src/features/dashboard/Dashboard.tsx`, `Charts.tsx`, `Movements.tsx`.
- `src/styles/theme.css`, `src/styles/app.css`.

Aggiornati `apps/web/README.md`, `README.md`, `docs/architecture.md`,
`package.json` e `package-lock.json`. Creato questo resoconto.
Nessuna modifica ai file versionati di `apps/bot`, `packages/domain` o `supabase`.

## Dipendenze

- React e React DOM 19.3.1.
- Lucide React 1.61.0.
- Vite 8.3.5 e plugin React 6.1.2.
- Tipi React e React DOM 19.3.0.
- TypeScript riutilizzato dalla toolchain esistente; dominio riutilizzato come workspace locale.

Versioni e compatibilità verificate tramite metadati npm. Lockfile risolto senza
script di installazione e sottoposto ad audit prima dell’installazione. Anche
l’installazione è avvenuta con `--ignore-scripts`. Vite, già dipendenza transitiva
di Vitest, passa da 8.3.4 a 8.3.5 e viene dichiarato direttamente dal workspace web.

## Risultati

| Verifica | Esito |
| --- | --- |
| `npm run typecheck` | Passato: dominio, bot e web |
| `npm run build` | Passato: dominio, bot e web |
| `npm test` | Passato: 437 test bot e 229 test dominio, 23 file |
| `npm audit` | Zero vulnerabilità |
| `npm audit --omit=dev` | Zero vulnerabilità |
| `git diff --check` | Passato |
| File protetti | Diff vuoto per bot, dominio e Supabase |

Collaudo browser locale della dashboard a 320, 390, 600, 768, 850, 1024, 1280 e
1672 pixel: nessun overflow orizzontale della pagina. La tabella mantiene il suo
scorrimento interno su mobile. Accesso controllato a 320, 390, 768 e 1672 pixel,
senza overflow. Verificati menu mobile, chiusura con Esc, navigazione ai conti,
espansione dei movimenti da cinque a sette righe e visibilità del patrimonio nella
sidebar.

Verificati mostra/nascondi password, invio con dati sintetici e recupero password:
entrambi i pulsanti mostrano messaggi italiani di indisponibilità, senza uscire
da `/accesso` o simulare un’autenticazione riuscita. Nessun avviso o errore nella
console durante il collaudo finale. Verifica visiva svolta sia su desktop sia su mobile.

Non sono state aggiunte suite automatiche web. Non eseguiti test su dispositivi
fisici, verifica con screen reader o matrice multipiattaforma/browser. Nessuna
verifica su servizi Supabase/Telegram reali o runner SQL separati: fuori dall’ambito
frontend W1, senza modifiche ai relativi componenti.

## Avvio e decisioni

`npm run web:dev` dalla root avvia Vite su `http://127.0.0.1:5173/`;
`/accesso` è un percorso indipendente di anteprima grafica.

Budget è visibile e dichiarato non disponibile. Nessun pulsante inserisce o modifica
movimenti. Tema iniziale scuro, token semantici predisposti per un futuro tema chiaro;
nessun selettore tema in W1. Font locali di sistema e grafici SVG senza librerie
aggiuntive. Le fixture sintetiche sono temporanee e andranno rimosse con la futura
integrazione autenticata.

## W1.1 — Rifinitura visiva, 27 ottobre 2026

L’analisi dei riferimenti e dello screenshot W1 ha evidenziato testi secondari
troppo piccoli, superfici poco differenziate, tre pannelli analitici compressi
sulla stessa riga e ripetizioni del patrimonio nella sidebar e nei conti.

Il sistema di token ora comprende una palette antracite/smeraldo attenuata,
riflessi e ombre stratificate, raggi coerenti, scala tipografica, spaziature e
tempi di transizione condivisi. La sidebar desktop passa da 255 a 216 pixel;
saldo ripetuto e relativo pulsante vengono rimossi. Anche il totale ripetuto
nel pannello conti viene eliminato. I grafici occupano una griglia a due colonne,
seguita dalla fascia dei tre conti. La tabella mantiene le interazioni originali.

L’anello usa segmenti SVG e una legenda più leggibile. La serie cumulativa resta
identica; linea, area, griglia e indicatore adottano i colori del tema. Nel modulo
demo cambiano esclusivamente colori e geometria di presentazione dell’anello;
nessun importo, categoria, percentuale o movimento viene modificato.

File interessati: `src/styles/theme.css`, `src/styles/app.css`,
`src/features/dashboard/Dashboard.tsx`, `src/features/dashboard/Charts.tsx`,
`src/data/demo.ts` e questa documentazione con il README web.
Nessuna dipendenza aggiunta, nessuna modifica a manifest o lockfile rispetto a W1.

Verifiche W1.1: typecheck e build del monorepo riusciti; 437 test bot e 229 test
dominio passati; audit npm completo e di produzione con zero vulnerabilità.
Dashboard verificata nel browser a 320, 360, 390, 600, 768, 850, 1024, 1150, 1280,
1440 e 1672 pixel, senza overflow della pagina o delle card riepilogative.
Confermate espansione della tabella e chiusura del menu mobile con Esc.
Accesso resta un’anteprima senza autenticazione. Nessun errore o avviso in console.
Restano i limiti del collaudo locale riportati sopra, senza matrice di browser,
dispositivi fisici o verifica con screen reader.
