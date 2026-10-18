---
id: creazione-profilo
author: alfredomorresi
updated_at: "2026-10-02"
tags:
  - configurazione
  - onboarding
  - docenti
  - studenti
---

# Configurazione del profilo utente

Una volta effettuato l'accesso, è consigliabile completare la configurazione del proprio profilo per facilitare le comunicazioni interne.

## Dati principali e preferenze

Recati nel menu in alto a destra e seleziona **Il mio profilo > Impostazioni**:

- **Foto profilo**: carica un'immagine in formato quadrato (`PNG` o `JPG`, max 2 MB).
- **Fuso orario e lingua**: verifica che siano impostati su `Europe/Rome (GMT+1)` e `Italiano`.
- **Notifiche email**: scegli se ricevere un riepilogo giornaliero o notifiche istantanee.

```yaml
# Esempio di configurazione consigliata per le notifiche
notifiche:
  avvisi_urgenti: immediata
  nuovi_materiali: riepilogo_giornaliero
  promemoria_scadenze: 24h_prima
```

> [!NOTE]
> Il nome e il cognome anagrafico sono sincronizzati con il registro centrale e non possono essere modificati direttamente dall'utente.
