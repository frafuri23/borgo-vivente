# Borgo Vivente

Simulazione di un piccolo borgo toscano abitato da 7 cittadini autonomi, animati
da Claude. Tutto il gioco vive in un unico file React ([src/App.jsx](src/App.jsx)).

## Versione pubblica (GitHub Pages)

Il sito statico viene pubblicato automaticamente a ogni push su `main` (workflow
in `.github/workflows/deploy.yml`). Non avendo un backend, chiede al visitatore
la **sua** chiave API Anthropic: resta nel browser (localStorage) e le chiamate
vanno dirette ad `api.anthropic.com` (header
`anthropic-dangerous-direct-browser-access`). Anche lo stato del borgo, sul
sito pubblico, è salvato in localStorage.

## Avvio in locale

```sh
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Poi apri http://localhost:5173. Al primo avvio il borgo viene generato con una
chiamata API dedicata; ogni turno successivo è **una sola** chiamata API che
orchestra azioni, dialoghi, relazioni e memorie di tutti i cittadini.

## Come funziona

- **Proxy locale** — il dev server Vite ([vite.config.js](vite.config.js)) espone
  `/api/anthropic` e inoltra le richieste a `api.anthropic.com` iniettando la
  chiave da `ANTHROPIC_API_KEY`: la chiave non arriva mai al browser.
- **Persistenza** — `window.storage` (shim in [src/main.jsx](src/main.jsx))
  salva lo stato in `.borgo-data/borgo-stato.json` tramite il dev server.
  Niente localStorage. "Nuovo villaggio" cancella tutto e rigenera.
- **Robustezza** — parsing JSON difensivo (strip dei backtick, slice tra `{` e
  `}`, retry singolo). Se un turno fallisce comunque, il villaggio "sonnecchia"
  e si riprova al turno dopo: la simulazione non si blocca mai.

## Scelte rispetto al prompt originale

- Modello: `claude-sonnet-4-6` al posto di `claude-sonnet-4-20250514`, che
  viene ritirato il 15/06/2026 (è il sostituto ufficiale). Cambialo nella
  costante `MODEL` in cima ad App.jsx se vuoi.
- `max_tokens` del turno: 4000 invece di 1000 — con budget più bassi il JSON
  del turno (azioni di 7 cittadini + dialoghi + relazioni + memorie + cronaca)
  viene troncato, che è la prima causa di "JSON malformato". Verificato sul
  campo: a 2000 il troncamento capitava quasi a ogni turno.
