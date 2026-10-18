# AGENTS.md — Edulogia Guide Builder

Questo file documenta l'architettura, le convenzioni e lo storico delle implementazioni del progetto **Edulogia Guide Builder** per tutti gli agenti di coding AI.

## Panoramica del Progetto

**Edulogia Guide Builder** è un generatore modulare di guide PDF basato su:
1. **Frammenti Markdown (`fragments/**/*.md`)**: piccoli blocchi di istruzioni autonomi con frontmatter YAML rigorosamente validato (`id`, `author`, `updated_at`, `tags`). Il titolo del frammento viene estratto direttamente dal primo heading Markdown (`# ...`) nel corpo del file.
2. **Catalogo Tag Centrale (`guides/tags.yaml`)**: definisce la lista fissa dei tag ammessi. Nessun frammento può utilizzare tag assenti da questo file.
3. **Ricette di Ricomposizione (`guides/*.yaml`)**: file YAML che definiscono i metadati di copertina, le opzioni di impaginazione e la sequenza di capitoli e frammenti da assemblare per generare una guida finale in PDF.
4. **Motore di Build (`src/`)**: scritto in Node.js + TypeScript, valida i file con `zod`, converte e normalizza il Markdown con `markdown-it` (inclusi callout GitHub `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`, tabelle e immagini incorporate in Base64) e genera il PDF in formato A4 tramite **Playwright (Chromium)** senza intestazione né piè di pagina.
5. **CI/CD (`.github/workflows/build-guides.yml`)**: GitHub Action attivata ad ogni commit/PR che esegue validazione, test e generazione PDF, caricando i PDF risultanti come Artifact della Action (senza pubblicazione su GitHub Pages).

## Regole e Convenzioni Tecniche

- **Frontmatter dei frammenti (`fragments/**/*.md`)**:
  - `id`: identificativo univoco del frammento composto esclusivamente da lettere, numeri e il carattere `-` (`^[a-zA-Z0-9-]+$`, es. `login-base`), svincolato dalla struttura delle directory in cui è memorizzato il file.
  - `author`: username del profilo GitHub dell'autore del file (es. `alfredomorresi`).
  - `updated_at`: data di ultimo aggiornamento in formato `YYYY-MM-DD`.
  - `tags`: lista di tag scelti esclusivamente tra quelli registrati in `guides/tags.yaml`.
  - Non è previsto il campo `title` nel frontmatter (viene usato il titolo `# ...` nel Markdown).
- **Scansione di `guides/`**:
  - `guides/tags.yaml` contiene il registro dei tag e viene escluso automaticamente quando il loader cerca le ricette delle guide in `guides/*.yaml`.
  - Viene verificata l'assenza di collisioni su `id` e `output_filename` tra ricette diverse e vengono segnalati eventuali frammenti "orfani" (non referenziati in nessuna guida).
- **Impaginazione PDF e Riferimenti Incrociati**:
  - Copertina dedicata + Indice (Table of Contents) automatico cliccabile + Capitoli/Frammenti.
  - I link Markdown tra frammenti (`./altro.md`, `fragment:altro-id`, `#altro-id`) vengono risolti automaticamente in ancore interne cliccabili nel PDF se il frammento di destinazione fa parte della guida.
  - Nessun header o footer con numerazione pagine.
- **Git e Documentazione Agenti**:
  - Utilizzare esclusivamente `AGENTS.md` come file di documentazione per gli agenti AI nel repository (senza creare o mantenere `GEMINI.md`).
  - Non eseguire mai `git add` o `git commit` a meno che l'utente non lo richieda esplicitamente.

## Comandi Principali

- `npm run validate`: valida `guides/tags.yaml`, tutti i frammenti Markdown e tutte le ricette YAML.
- `npm run catalog`: elenca a terminale i tag ammessi e tutti i frammenti disponibili.
- `npm run build`: genera i file PDF (e l'HTML di ispezione) in `dist/`.
- `npm test`: esegue la suite di test automatici con Vitest.

## Registro delle Implementazioni

- **2026-10-02**: Creazione dell'architettura iniziale del progetto:
  - Configurazione TypeScript, Zod, Markdown-it, Playwright e Vitest.
  - Creazione del catalogo centrale `guides/tags.yaml` e validazione rigorosa dei tag e dello username GitHub (`author`) nel frontmatter dei frammenti.
  - Creazione di 4 frammenti di esempio in `fragments/` e 2 ricette di guida in `guides/` (`guida-docenti.yaml`, `guida-studenti.yaml`).
  - Creazione del tema di stampa A4 (`themes/default/template.html` e `themes/default/print.css`) con copertina, indice cliccabile e supporto callout GitHub.
  - Configurazione del workflow GitHub Actions `.github/workflows/build-guides.yml` con upload dei PDF come Artifact.
- **2026-10-15**: Ottimizzazioni architetturali e regole sugli ID dei frammenti:
  - **Formato ID Frammenti**: vincolato il campo `id` dei frammenti a contenere solo lettere, numeri e `-` (`FRAGMENT_ID_REGEX = /^[a-zA-Z0-9-]+$/`), disaccoppiandolo dalla struttura delle directory (`login-base`, `recupero-password`, `creazione-profilo`, `caricamento-materiali`).
  - **Callout GitHub a livello di token (#2)**: sostituito il post-processing regex su HTML con una regola core di `markdown-it` sui token (`blockquote_open`/`blockquote_close`), supportando paragrafi multipli e citazioni annidate con istanza `MarkdownIt` condivisa.
  - **Controllo collisioni e frammenti orfani (#6)**: aggiunto controllo di unicità su `id` e `output_filename` nelle ricette YAML e rilevamento automatico dei frammenti orfani (`findOrphanFragments`) in `validate` e `catalog`.
  - **Riferimenti incrociati tra frammenti (#8)**: trasformazione automatica dei link Markdown tra frammenti in ancore interne cliccabili nel PDF (`#fragment-<id>` o sottotitoli) quando il frammento di destinazione è incluso nella guida.
  - **Test e CI/CD (#9, #10)**: rimossi i conteggi cablati dei file nei test di workspace (`tests/builder.test.ts`), aggiunti test per le nuove funzionalità e inserito lo step `npm run typecheck` nel workflow GitHub Actions.
- **2026-10-18**: Impostazione licenza CC-BY-SA-4.0 e importazione guida Android Family Link:
  - Aggiunto il file `LICENSE` con il testo integrale della licenza Creative Commons Attribution-ShareAlike 4.0 International (`CC-BY-SA-4.0`).
  - Aggiunto il campo `"license": "CC-BY-SA-4.0"` in `package.json` e aggiornata la documentazione in `README.md`.
  - Aggiunti 4 nuovi tag in `guides/tags.yaml`: `android`, `family-link`, `genitori`, `controllo-parentale`.
  - Estratte 82 immagini in `assets/images/android/family_link/` e creati 18 frammenti modulari in `fragments/android/family_link/` a partire dal documento sorgente su Google Family Link.
  - Creata la ricetta `guides/family_link_completo.yaml` (`family_link_completo.pdf`) che assembla tutti i 18 frammenti nell'ordine del documento originale.
