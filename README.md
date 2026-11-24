# Agricultural Fleet - replay di simulazione

Replay statico di un **volo reale registrato su simulatore PX4 SITL** (2 droni, campo di prova, missione pianificata e approvata dal sistema).

- **Solo simulazione**: nessun drone reale, nessun comando, nessuna chiamata a servizi esterni (salvo le tile di OpenStreetMap e la libreria Leaflet da cdnjs).
- Il codice del sistema di controllo (API, pianificatore, motore di sicurezza) **resta privato**. Qui c'e solo la pagina di replay e il file `flight.json` con la telemetria registrata.
- La pagina mostra mappa, rotta pianificata, scie dei droni, quota, batteria e modo di volo, avanzamento missione, copertura geometrica e registro di audit, con play/pausa, velocita 1x/4x/16x e cursore.

## Uso

Apri la pagina su GitHub Pages, oppure in locale:

```
python3 -m http.server 8080
```

e visita http://localhost:8080.

## Nota

La copertura e solo una stima geometrica dalla traccia simulata: non e una prova di trattamento del campo.
