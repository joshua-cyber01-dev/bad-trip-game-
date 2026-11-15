# BAD TRIP

Mobile-First-Horrorspiel in der Ego-Perspektive. Fünf Substanzen, fünf eigene Welten –
gebaut mit **Three.js + TypeScript**, als installierbare **PWA** für iOS und Android.

> Fiktion. Das Spiel verherrlicht keinen Drogenkonsum, es zeigt, wie er enden kann.

## Die fünf Trips

| Substanz | Level | Welt | Kernmechanik | Gegner |
| --- | --- | --- | --- | --- |
| LSD | Die Tapete atmet | Endloser, atmender Hotelflur | Blickkontakt: Gegner bewegen sich nur unbeobachtet, erzwungenes Blinzeln | Die Lächelnden |
| Pilze | Myzel | Nachtwald | Licht & Dunkel: pulsierende Pilzkreise sind die einzigen sicheren Zonen | Der Gehörnte |
| Ketamin | K-Hole | Klinikstege über dem Nichts | Trägheit, sich auflösende Kacheln, „Nicht bewegen“-Phasen | Die Stille |
| DMT | Durchbruch | Neon-Tempel | Farbfolgen merken (Simon) unter 4-Minuten-Countdown | Wächter |
| Datura | Delirium | Stockdunkles Haus | Verstecken (Ducken unter Tischen), echte vs. halluzinierte Schlüssel | Der Hutmann |

Jedes Level hat eigene Geometrie, Texturen, Post-Effekte, Klangkulisse und Ereignisse.
Karten werden bei jedem Start neu generiert.

## Starten

```bash
npm install
npm run dev        # Dev-Server, im WLAN erreichbar (https nötig für PWA-Installation)
npm run build      # Produktions-Build nach dist/
npm run preview    # dist/ lokal ausliefern
npm run build:single   # alles in EINER index.html (dist-single/) – z. B. zum schnellen Teilen
```

### Auf dem iPhone testen

1. **GitHub Pages:** Branch nach `main` mergen, unter *Settings → Pages* als Quelle
   „GitHub Actions“ wählen. Der Workflow `.github/workflows/pages.yml` baut und veröffentlicht automatisch.
2. URL in **Safari** öffnen → *Teilen* → *Zum Home-Bildschirm*. Die App startet dann im Vollbild,
   läuft offline und bleibt im Querformat nutzbar.

Android/Chrome zeigt im Titelbildschirm einen „Installieren“-Button.

## Steuerung (Touch)

- **Linker Daumen:** virtueller Joystick (erscheint dort, wo man aufsetzt, und folgt dem Daumen)
- **Rechte Bildschirmhälfte:** Wischen = umsehen
- **Sprint** (halten, Ring = Ausdauer), **Ducken** (umschalten), **Aktion** (erscheint kontextabhängig)
- Einstellungen → *Steuerung anpassen*: alle Buttons frei verschieben und skalieren, Linkshänder-Modus
- Optional am Desktop: WASD, Maus ziehen, Shift, C, E, Esc

## Performance-Konzept

- **Ein Render-Pass + ein Post-Pass:** alle Trip-Effekte (Verzerrung, Kaleidoskop, Farbrotation,
  Doppelbilder, Vignette, Korn) stecken in einem einzigen Fullscreen-Shader.
- **Dynamische Auflösung:** die Engine misst die Frame-Zeit und skaliert die Renderauflösung (50–100 %),
  im Auto-Modus wird notfalls die Qualitätsstufe gesenkt. Ziel: stabile 60 FPS.
- **Qualitätsstufen** Niedrig / Mittel / Hoch (Pixelbudget, Lichter, Partikel, Schatten) + 30-FPS-Akkumodus.
- **Wenige Draw Calls (~15–25):** Levelgeometrie wird zu Chunks verschmolzen (verdeckte Flächen entstehen
  gar nicht erst), Requisiten sind instanziert.
- **Licht-Pooling:** Dutzende Lampen pro Level, aber nur 1–3 echte Lichtquellen, die zu den nächsten Lampen springen.
- **Schatten:** Blob-Schatten überall; eine einzige 512er Shadow-Map (Taschenlampe) nur auf „Hoch“.
- **LOD:** Wald in Chunk-LODs (Detailbaum → 14-Dreieck-Impostor → ausgeblendet hinter dem Nebel).
- **Texturen & Audio prozedural:** winzige Canvas-Texturen (≤ 256 px) und WebAudio-Synthese –
  kein einziger Asset-Download, JS-Bundle ≈ 170 kB gzip.
- **Akku:** kein Rendering in Menüs/Pause, Auto-Pause beim App-Wechsel.

## Architektur

```
src/
  main.ts            Spielzustand, Game-Loop
  core/engine.ts     Renderer, Qualitätsstufen, dyn. Auflösung, Post-Shader
  core/input.ts      Touch-Joystick, Look-Zone, Buttons (+ Tastatur-Fallback)
  core/player.ts     First-Person-Controller, Kollision, Ausdauer
  core/audio.ts      Prozedurales WebAudio
  world/grid.ts      Kachelraster, Generatoren, Sichtlinien, Flow-Field-Pfadsuche
  world/build.ts     Texturen, Chunk-Meshes, Licht-Pool, Partikel
  world/entities.ts  Kreaturen + Verfolger-Logik
  levels/*.ts        je ein Level pro Substanz (Level-Interface in base.ts)
  ui/ui.ts           Menüs, HUD, Einstellungen, Layout-Editor
public/              Manifest, Service Worker, Icons
```

Ein neues Level = eine Klasse, die `Level` erweitert, plus ein Eintrag in `levels/index.ts`.

## Später: native App (iOS / Android)

Der Build ist ein statisches Web-Bundle mit relativen Pfaden und ohne Server-Abhängigkeit –
er lässt sich unverändert mit **Capacitor** verpacken (`capacitor.config.json` liegt bereit):

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npm run build
npx cap add ios && npx cap add android
npx cap sync
npx cap open ios      # Xcode → signieren → TestFlight / App Store
```

Sinnvolle native Ergänzungen dann: `@capacitor/screen-orientation` (Querformat-Lock),
`@capacitor/haptics` (Vibration auch auf iOS), `@capacitor/status-bar`.
