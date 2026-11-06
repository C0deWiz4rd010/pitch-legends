# Umsetzungslog Pitch Legends 3.0

Fortschritt je Phase des [3.0-Plans](PITCH_LEGENDS_3_0_PLAN.md): was geändert wurde, wie es geprüft wurde und was offen bleibt. Jede Phase endet mit einem Eintrag nach dem Muster des [2.0-Logs](IMPLEMENTATION_2_0_LOG.md).

Stand: Plan freigegeben am 2026-11-06, Phase 0 umgesetzt (nicht committet).

| Phase | Thema | Stand |
| --- | --- | --- |
| 0 | Messbasis und Quick-Wins für Flüssigkeit | umgesetzt, Rest siehe unten |
| 1 | Steuerung und Reaktionsgefühl | offen |
| 2 | Ball, Aktionen, Torwart, Standards | offen |
| 3 | KI mit Fußballverständnis | offen |
| 4 | Animation 2.0 (Hybrid) | offen |
| 5 | Grafik-Politur und Präsentation | offen |
| 6 | Leistung und Mobile | offen |
| 7 | RPG I: Spieler vertiefen | offen |
| 8 | RPG II: Trainer und Verein | offen |
| 9 | Meta und Sammeln | offen |
| 10 | QA, Balance, Release 3.0 | offen |

## Phase 0 – Messbasis und Quick-Wins für Flüssigkeit (2026-11-06)

- **Interpolation:** `MatchRenderState.discontinuityKey` (String je Tick) ist durch `teleportEpoch` (Zahl) ersetzt. Die Engine erhöht ihn nur dort, wo Spieler oder Ball gesetzt statt bewegt werden (`setRestart`, `resetKickoff`, `setupScenario`, Wechsel, Wiederherstellung aus Checkpoint oder Sicherheits-Snapshot). Vorher wurde auch bei Wechseln wie „spielen → Vorteil“ oder „Replay → Spiel“ nicht interpoliert. Der Wert ist reine Darstellung, nicht im Zustands-Hash.
- **Halbzeit:** Der Renderer wird nicht mehr zerstört. Das Spielfeld bleibt im DOM (`match-shell--parked`, `display: none`), die Schleife stoppt und startet in `resumeSecondHalf` neu. Stadion-Aufbau, Shader-Compile und Einlauf-Kamerafahrt entfallen in der zweiten Halbzeit. Im Browser geprüft: gleiche Renderer-Instanz vor und nach der Halbzeit, Canvas wieder in voller Größe.
- **Qualitätswechsel:** Der Composer wird einmal angelegt und bleibt erhalten; inaktiv schrumpft sein MSAA-Ziel auf 1 Pixel. Stufe hoch (balanced → high) kostet im Browser etwa 7 ms.
- **Jubelszene:** Die Schrittphase (`animationDistance`) folgt der zurückgelegten Strecke, der Tick ist gebrochen (glatt bei 120/144 Hz), Spieler und Ausgabe-Frame stammen aus einem Pool.
- **Zeitlupe:** Pose-Überblendungen und Ballrollen laufen auf einer Simulationsuhr (`poseClock`, aus den gezeigten Ticks). Pause und Sprünge halten sie an, Zeitlupe verlangsamt sie. Der Ball rollt über ein Quaternion um die Achse senkrecht zur Bewegungsrichtung statt über Euler-x/z.
- **Allokationen pro Frame entfernt:** `new Set` der wachen Signaturen, Kamera-Vektoren, Torwart- und Kontakt-IK (`pointHand`, Kontaktfuß), gespiegelte Ziele und Kontakte, Replay-Interpolation, Jubel-Frame, `safeSnapshot` alle 30 Ticks (`snapshotInto`), `MatchMetrics.record`. Nicht in der Chrome-Allocation-Timeline gemessen (siehe offen).
- **Messung:** `MatchMetrics` nutzt Typed Arrays und sortiert je Reihe einmal pro Sekunde statt sechsmal. Neu: `inputLatencyP95` (Tastenflanke bis abgeschickter Frame, `TickInputBuffer.takeConsumedAt`) und `inputSamples` im `data-performance` des Canvas.
- **Kleinigkeiten:**
  - `challengeHud` wird höchstens alle 100 ms gesetzt.
  - Das HUD-Canvas folgt der Pixeldichte (höchstens 2×); Regel-Hinweise und „Grafik wird wiederhergestellt“ gibt es auf Deutsch und Englisch.
  - Der Ball-Blobschatten ist auf „hoch“ schwächer (0,18 statt 0,50), weil dort schon ein echter Schatten fällt.
  - Beim Tor wackelt nur das getroffene Netz.
  - Die Spielergeometrie ist über `mergeVertices` indiziert.
  - `stadium-night.png` (1,79 MB) ist als `stadium-night.jpg` (238 KB, Qualität 85) ersetzt und im Browser unauffällig; WebP war mit den vorhandenen Werkzeugen nicht möglich.
- **Nachweis:**
  - 351 Unit-Tests (8 neu in `phase0-fluidity.spec.ts`: Epoche, Interpolation durch harmlose Regelwechsel, Replay-Scratch, Spiegelung, indizierte Geometrie, Metriken, Eingabe-Latenz).
  - `typecheck`, `styles:check`, `i18n:check` (46 Altbestände), `format:check`, `version:check` und Produktionsbuild grün.
  - `balance:check` (500 Matches) unverändert zu Phase 9: 2,42 Tore, 69,21 % Pässe, 25,6 % Remis, 42,6 % Heimsiege, 1,77 Abseits; 494 ms pro Match (Grenze 560). Das bestätigt, dass die Änderungen die Simulation nicht berühren.
  - Browser (Dev-Server, eingebetteter Browser): `/play` startet auf „hoch“ ohne Konsolenfehler, Anstoß-Hinweis im HUD, Halbzeit → zweite Halbzeit wie oben.
- **Offen:**
  - Der Abstieg hoch → ausgewogen kompiliert einmal etwa 20 Programme (im Test-Browser ~370 ms). Ein Vorwärmen scheiterte: three.js gibt das Programm beim Zurückschalten sofort frei, und der Wechsel zwischen Composer und Direktausgabe erzeugt andere Programme. Lösung gehört in Phase 6 (immer über den Composer rendern oder Stufen ohne Pfadwechsel).
  - Kein Herunterstufen bei 30-Hz-Anzeigen: Ein vsync-gebundenes, überlastetes Gerät sieht von außen gleich aus; das braucht die GPU-Zeitmessung aus Phase 6.
  - Die Allokationen sind nicht mit der Chrome-Allocation-Timeline gemessen, der Gewinn durch die Indizierung der Spielergeometrie nicht als Vertex-Zahl erfasst, und die Playwright-E2E-Tests konnten nicht laufen (Browser nicht installiert, `npx playwright install` nötig).
  - `icon-maskable-512.png` ist bytegleich zu `icon-512.png`; das Manifest verweist auf beide Zweckangaben, deshalb nicht entfernt.
  - Pro Sekunde werden weiter drei `JSON.stringify`-Schreibvorgänge in `canvas.dataset` gemacht (unkritisch).
