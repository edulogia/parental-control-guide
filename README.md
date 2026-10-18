# Edulogia Guide Builder

Sistema modulare per comporre e generare **guide in formato PDF** a partire da piccoli blocchi di istruzioni scritti in **Markdown** (**frammenti**) e assemblati tramite file di configurazione **YAML** (**ricette**).

Ad ogni nuovo commit, una **GitHub Action** valida tutti i frammenti e le ricette e genera automaticamente i PDF finali, rendendoli scaricabili come **Artifact** della Action.

---

## Struttura del Repository

```text
edulogia-guide/
├── .github/workflows/
│   └── build-guides.yml        # GitHub Action: valida e genera i PDF ad ogni commit
├── assets/images/              # Immagini e loghi condivisi
├── fragments/                  # "Pezzi" di istruzioni in Markdown divisi per argomento
│   ├── accesso/
│   ├── configurazione/
│   └── didattica/
├── guides/                     # Ricette delle guide finali e catalogo tag
│   ├── tags.yaml               # Lista fissa dei tag utilizzabili nei frammenti
│   ├── guida-docenti.yaml      # Ricetta per la Guida Docenti
│   └── guida-studenti.yaml     # Ricetta per la Guida Studenti
├── themes/default/             # Template HTML e foglio di stile CSS per stampa A4
├── src/                        # Motore di validazione, assemblaggio e generazione PDF
└── tests/                      # Test automatici (Vitest)
```

---

## Come scrivere un nuovo "Pezzo" di Istruzioni (Frammento)

1. Crea un file `.md` nella cartella `fragments/` (es. `fragments/didattica/valutazione-compiti.md`).
2. Inserisci in testa al file il **frontmatter YAML** obbligatorio:
   - `id`: identificativo univoco del pezzo contenente **solo lettere, numeri e il carattere `-`** (non deve riflettere la struttura delle cartelle né contenere `/`).
   - `author`: **username del profilo GitHub** dell'autore del file (es. `alfredomorresi`).
   - `updated_at`: data di ultimo aggiornamento nel formato `YYYY-MM-DD`.
   - `tags`: elenco di uno o più tag scelti **esclusivamente** tra quelli presenti in [`guides/tags.yaml`](./guides/tags.yaml).
3. Scrivi il contenuto in Markdown iniziando con un titolo di primo livello (`# Titolo del pezzo`):

```markdown
---
id: valutazione-compiti
author: alfredomorresi
updated_at: "2026-10-02"
tags:
  - didattica
  - docenti
---

# Valutazione dei compiti consegnati

Testo delle istruzioni... Puoi anche inserire riferimenti ad altri frammenti (es. `[Recupero password](../accesso/recupero-password.md)` o `[Recupero password](#recupero-password)`), che verranno convertiti automaticamente in link interni cliccabili nel PDF se il frammento di destinazione è incluso nella stessa guida.

> [!NOTE]
> Puoi usare gli avvisi in stile GitHub: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.
```

---

## Come aggiungere un nuovo Tag

Se ti serve un nuovo tag per classificare i frammenti, aggiungilo prima in [`guides/tags.yaml`](./guides/tags.yaml):

```yaml
tags:
  - id: nuovo-tag
    description: Breve descrizione dello scopo del tag
```

Durante la validazione (`npm run validate`), qualsiasi frammento che utilizzi un tag non elencato in `guides/tags.yaml` verrà segnalato come errore.

---

## Come comporre una Guida Finale (Ricetta YAML)

Per creare una nuova guida (o modificare quelle esistenti), crea un file `.yaml` nella cartella `guides/` (es. `guides/guida-nuovi-assunti.yaml`) indicando quali frammenti includere e in quale ordine:

```yaml
id: guida-nuovi-assunti
output_filename: guida-nuovi-assunti.pdf

cover:
  title: "Guida di Benvenuto"
  subtitle: "Istruzioni operative per il personale"
  author: "Team Edulogia"
  version: "1.0.0"
  date: "Ottobre 2026"
  logo: "assets/images/logo-placeholder.svg"

options:
  include_toc: true
  toc_title: "Indice dei Contenuti"
  chapter_page_break: true

sections:
  - title: "Capitolo 1: Primi Passi"
    description: "Come accedere e configurare il proprio account."
    fragments:
      - login-base
      - creazione-profilo
```

---

## Utilizzo Locale da Terminale

Assicurati di avere **Node.js (>= 20)** installato.

```bash
# 1. Installa le dipendenze e il browser Chromium per l'esportazione PDF
npm install
npx playwright install chromium

# 2. Mostra il catalogo di tutti i tag e i frammenti disponibili
npm run catalog

# 3. Valida tags.yaml, tutti i frammenti e tutte le ricette
npm run validate

# 4. Esegui i test automatici
npm test

# 5. Genera tutti i PDF nella cartella dist/
npm run build

# Opzionale: genera una singola guida
npm run build -- --guide guides/guida-docenti.yaml
```
