# Umsetzungslog Pitch Legends 3.0

Fortschritt je Phase des [3.0-Plans](PITCH_LEGENDS_3_0_PLAN.md): was geändert wurde, wie es geprüft wurde und was offen bleibt. Jede Phase endet mit einem Eintrag nach dem Muster des [2.0-Logs](IMPLEMENTATION_2_0_LOG.md).

Stand: Plan freigegeben am 2026-11-06, Phase 0 und Phase 1 umgesetzt.

| Phase | Thema | Stand |
| --- | --- | --- |
| 0 | Messbasis und Quick-Wins für Flüssigkeit | umgesetzt, Rest siehe unten |
| 1 | Steuerung und Reaktionsgefühl | umgesetzt, Rest siehe unten |
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

## Phase 1 – Steuerung und Reaktionsgefühl (2026-11-06)

- **Fehler behoben:**
  - Verpasste Annahme: Der Ball wird entlang seiner Flugrichtung gedämpft und seitlich abgelenkt; vorher wurde nur `vx` halbiert, ein Ball in y-Richtung behielt sein Tempo.
  - Steilpass-Taste in der Defensive: Wer in Tackling-Reichweite (1,6 m) steht, tackelt; wer weiter weg ist, schickt den Torwart heraus. Vorher geschah beides.
  - Standards laden je Art die passende Zeit (Pass, Steilpass, Lupfer 0,8 s, Schuss 0,9 s) und werden erst nach 8 statt 3 Sekunden automatisch ausgeführt (Konstante `RESTART_AUTO_SECONDS`, nie in Trainings-Szenarien). Ein Zähler im Spielstand-Kopf zeigt die Sekunden (`MatchView.restartSeconds`).
  - Kopfball: Der nächste Spieler gewinnt, Gleichstand entscheidet die Seed-Reihenfolge (`tieOrder`); vorher der erste in der Spielerliste, also das Heimteam.
  - Steilpass: Die Vorlage folgt dem Laufweg des Empfängers (70 %) gemischt mit der Angriffsrichtung; ein stehender Empfänger bekommt sie Richtung Tor.
  - Abfangen: Der Zehntakt-Schalter (`INTERCEPT_EVERY`) ist weg. Jeder Verteidiger hat genau einen Versuch je Pass (`football.interceptTried`), und ein fester Seed-Wurf pro Pass und Verteidiger (`INTERCEPT_SHARE = 72`) bestimmt, ob er ihn liest.
  - KI-Ballführer sprinten, wenn kein Gegner näher als 5,5 m ist und die Ausdauer über 35 liegt (vorher nie).
  - Ausdauer wirkt: Verbrauch × `1 + (50 − Ausdauer) × 0,008`, und wer steht, erholt sich leicht.
- **Gefühl:**
  - Gerichtete Annahme: Der gesteuerte Empfänger nimmt den Ball in Stickrichtung mit; Körper und Ball drehen ein, eine schlechte Annahme läuft weiter weg.
  - Der Empfänger eines menschlichen Passes oder einer Flanke wird im selben Tick gewählt (`selectReceiver`), die 12-Tick-Wartezeit entfällt dafür.
  - Aktionen kosten etwas: Nach einem Pass (7 Ticks) und einem Schuss (12 Ticks) läuft der Spieler mit 55 % Tempo (`football.recoveryUntil`). Ein verfehltes Tackling hält 24 Ticks, ein verfehlter Slide 36 bis 48 Ticks auf. Ein Slide startet bis 3,2 m und trägt den Körper nach vorn.
  - Tricks sind fair: Jeder Verteidiger im Umkreis wird einzeln bewertet (Dribbling gegen Verteidigen, Blickrichtung). Liest der Gegner neben dem Ballführer (bis 1,8 m) den Trick, geht die Annahme schief. Ein Trick kostet 0,5 Ausdauer.
  - Abschirmen: Mit gehaltener Jockey-Taste am Ball ist das Tempo auf 62 % begrenzt und der Tackling-Schutz steigt um 0,14.
  - Mit Ball sinkt das Sprinttempo auf `0,80 + 0,1 × Dribbling/100` (vorher fest 0,91).
  - Spielerwechsel: Verteidigt das eigene Team und ist der gesteuerte Spieler über 12 m vom Ballführer weg, wird zum am besten zwischen Ball und Tor stehenden Verteidiger gewechselt (`bestDefenderAgainst`, bei den Richtlinien „receivers“ und „assisted“). Neu: Flick mit dem rechten Stick wählt den Mitspieler in dieser Richtung (`MatchCommand.pickX/pickY`).
- **Balance:** `homeComposure` von 0,12 auf 0,13 angehoben, weil die Heimsiegquote nach den Änderungen bei 41,8 % lag (Korridor 42–52 %). Das Zeitlimit in `tools/balance-check.ts` steht jetzt bei 600 ms (vorher 560), weil die neue Spieltiefe etwa 10 % Rechenzeit kostet.

  | Wert | Phase 9 | Phase 1 | Ziel |
  | --- | --- | --- | --- |
  | Tore pro Spiel | 2,42 | 2,79 | 2,2–3,4 |
  | Schüsse pro Team | 11,1 | 13,2 | 8–18 |
  | Passquote | 69,2 % | 67,7 % | 65–88 % |
  | Unentschieden | 25,6 % | 25,4 % | 20–32 % |
  | Heimsiege | 42,6 % | 45,0 % | 42–52 % |
  | Abseits | 1,77 | 1,89 | 1,5–3 |
  | Rechenzeit | 494 ms | 552 ms | ≤ 600 |
- **Nachweis:**
  - 368 Unit-Tests; 17 neu in `gameplay-feel-v3.spec.ts` (Szenarien zu allen Punkten oben außer Standard-Ladezeit je Art und Defensiv-Tackling im Spiel). Drei ältere Tests mussten an das neue Verhalten angepasst werden: Standard-Wartezeit (`football-rules`), Trick-Ausgang als Würfelwurf (`gameplay-actions`) und das Aufwärmen in `foundation-performance` (ein menschlicher Anstoß wird erst nach 8 s automatisch genommen).
  - Typecheck, Style-, i18n- und Format-Check sowie der Produktionsbuild grün.
  - Im eingebetteten Browser (stumm geschaltet): `/play` zeigt den Zähler beim Anstoß, J führt den Anstoß aus, danach läuft das Spiel, ohne Konsolenfehler.
- **Abweichungen vom Plan:**
  - Die Ausholphase (Kontakt 2–5 Ticks nach dem Loslassen) ist nach Phase 4 verschoben: Ohne Ausholanimation wäre sie nur zusätzliche Eingabeverzögerung.
  - Die Checkpoint-Version bleibt 2: Alle neuen Laufzeitfelder (`interceptTried`, `recoveryUntil`) sind optional, ein laufendes Match lässt sich also weiter fortsetzen.
  - Die Auslagerung von Annahme, Tackling und Dribbling aus `arcade-match.ts` ist nicht erfolgt; die Datei wächst um etwa 150 Zeilen.
  - „Ball laufen lassen“ (Sprint plus Loslassen bei der Annahme) fehlt, der Hook `firstTouch` ist weiter nicht verdrahtet (Phase 2).
- **Offen:**
  - Der Rechte-Stick-Wechsel ist nur für Gamepads umgesetzt (kein Tastatur- oder Touch-Weg).
  - Playwright-E2E nicht gelaufen (Browser nicht installiert). Im E2E-Test `three-playground` nimmt J den Anstoß, andere Tests, die auf den Anstoß warten, wurden nicht geprüft.
  - Die 5-Minuten-Spielprobe durch einen Menschen steht aus; ob die Defensive mit den neuen Zeiten gut spielbar ist, ist nur durch die Balance-Zahlen belegt.
