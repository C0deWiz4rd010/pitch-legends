# Umsetzungslog Pitch Legends 3.0

Fortschritt je Phase des [3.0-Plans](PITCH_LEGENDS_3_0_PLAN.md): was geändert wurde, wie es geprüft wurde und was offen bleibt. Jede Phase endet mit einem Eintrag nach dem Muster des [2.0-Logs](IMPLEMENTATION_2_0_LOG.md).

Stand: Plan freigegeben am 2026-11-06, Phasen 0 bis 6 umgesetzt.

| Phase | Thema | Stand |
| --- | --- | --- |
| 0 | Messbasis und Quick-Wins für Flüssigkeit | umgesetzt, Rest siehe unten |
| 1 | Steuerung und Reaktionsgefühl | umgesetzt, Rest siehe unten |
| 2 | Ball, Aktionen, Torwart, Standards | teilweise umgesetzt, Rest siehe unten |
| 3 | KI mit Fußballverständnis | umgesetzt, Rest siehe unten |
| 4 | Animation 2.0 (Hybrid) | umgesetzt, Rest siehe unten |
| 5 | Grafik-Politur und Präsentation | teilweise umgesetzt, Rest siehe unten |
| 6 | Leistung und Mobile | teilweise umgesetzt, Rest siehe unten |
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

## Phase 2 – Ball, Aktionen, Torwart, Standards (2026-11-06)

- **Alle neun Hooks sind verdrahtet** und haben Grenzen in `EFFECT_CAPS` (`core/rpg/effects.ts`):
  - `shotPower` (Schussgeschwindigkeit), `curve` (Effet bei Schüssen und Flanken), `throughLead` (Vorlage des Steilpasses), `firstTouch` (Annahme), `shielding` (Tackling-Schutz), `aerial` (Luftduell), `keeperReach` (Reichweite des Torwarts), `staminaRecovery` (Erholung im Stehen) und `composure` (Streuung der Schüsse).
  - `injuryRisk` wirkt jetzt auch bei Kontaktverletzungen im Match (`injuryChance`, direkt über `resolveHook`, weil er ein Hook außerhalb des Platzes ohne Zwischenspeicher bleibt).
  - Noch gibt es für die neun Hooks keine Datenquellen (Traits, Talente, Signaturen); das folgt in Phase 7. Der Test belegt, dass ein Modifier wirkt.
- **Ball:** Der Luftwiderstand ist teils quadratisch (`airDrag 0,064 + 0,0038 × Geschwindigkeit`; bei 25 m/s wie vorher). Schnelle Bälle verlieren mehr, langsame tragen weiter. Flanken und Ecken haben Effet nach innen (`3` Spin, über den Hook `curve`).
- **Torwart** (`handlePostsAndKeeper`): Statt eines einzigen Würfelwurfs, sobald der Ball in Reichweite kommt, hat jeder Schuss eine feste Torwartform (`ActiveShot.keeperQuality`). In jedem Teilschritt wird der Ball an der wirklich erreichbaren Reichweite (Reichweite × `0,55 + Reaktion × 0,3 + Form × 0,3 − Tempo × 0,004`) gemessen. Ein Ball, der nah vorbeigeht, trifft immer eine Hand; ein zu weiter nie. Neu: hohe Schüsse werden zur Hälfte über die Latte gelenkt (Ecke). Beim Elfmeter wählt ein menschlicher Torwart die Ecke mit dem Stick (hoch oder runter); ohne Stick bleibt er in der Mitte.
- **Flanken:** Der Stick wählt das Ziel: Richtung wählt den Läufer in dieser Richtung, Zurückziehen sucht den Rückpass an den Strafraumrand (9 bis 30 m vor dem Tor).
- **Ecken und Standards:** Ecken sind echte Flanken in den Strafraum. Beide Mannschaften nehmen vor Ecken und Freistößen aus 17 bis 40 m ohne Mauer Positionen im Strafraum ein (`placeBoxPlayers`: Elfmeterpunkt, kurzer und langer Pfosten, Strafraumrand; Verteidiger stehen eine Stufe tormitte-wärts). Freistöße dieser Art werden ebenfalls geflankt (`isCrossedRestart`).
- **Luftduell:** Die Sprunghöhe hängt von Physis und `aerial` ab (2,2 bis 2,9 m; vorher für alle 2,45 m), den Zweikampf entscheiden Luftkraft, Position und ein Zufallsanteil.
- **Balance:** Die erste Fassung mit gemessener Torwartreichweite ließ 3,26 Tore pro Spiel zu (die alte Würfelei fing fast jeden Ball im Radius). `KEEPER_REACH_BASE` steht nach drei Läufen bei 0,55.

  | Wert | Phase 1 | Phase 2 | Ziel |
  | --- | --- | --- | --- |
  | Tore pro Spiel | 2,79 | 2,92 | 2,2–3,4 |
  | Schüsse pro Team | 13,2 | 13,7 | 8–18 |
  | Passquote | 67,7 % | 67,8 % | 65–88 % |
  | Unentschieden | 25,4 % | 27,4 % | 20–32 % |
  | Heimsiege | 45,0 % | 43,6 % | 42–52 % |
  | Abseits | 1,89 | 1,74 | 1,5–3 |
  | Rechenzeit | 552 ms | 538 ms | ≤ 600 |
- **Nachweis:** 379 Unit-Tests (11 neu in `gameplay-balls-v3.spec.ts`: Luftwiderstand, Torwart-Reichweite und -Mehrfachprüfung, Abfälschen über die Latte, Elfmeter-Stick, Hook-Grenzen und -Wirkung, Luftduell, Rückpass, Strafraumpositionen und geflankte Ecke, Verletzungsrisiko). Typecheck, Style-, i18n-, Format-Check und Produktionsbuild grün.
- **Nicht umgesetzt (verschoben oder gestrichen):**
  - Scharfer Flachpass, „Lauf anfordern“, KI-Doppelpässe, Fake-Schuss und Pass-Abbruch, Timing-Abschluss, Flugkopfball sowie Seitfall- und Fallrückzieher: noch offen für eine spätere Gameplay-Runde, weil jede Aktion eine eigene Eingabe und Animation braucht (Phase 4).
  - Torwart: Fausten bei Flanken, Abtauchen im 1-gegen-1; der Strafstoß ist im Match weiter ein echter Schuss mit Würfelwurf für die KI-Torwartecke.
  - Netzphysik und Netzbeule (Renderer, Phase 5), Zielhilfe mit Bogenvorschau und Effet-Eingabe bei Standards (HUD), springende Mauer (Animation, Phase 4).
  - Regeln: Fouls von Angreifern beim Abschirmen und am Torwart sowie die verzögerte Karte bei Vorteil (rein kosmetisch).
  - Echte Volleys gab es schon; ein eigener Volley-Modus fehlt.
- **Offen:** Playwright-E2E nicht gelaufen; die Wirkung der Strafraumpositionen bei Standards ist nur durch Tests, nicht in einem echten Spiel gesehen.

## Phase 3 – KI mit Fußballverständnis (2026-11-06)

- **Entscheidung des Ballführers** (neu `core/football/xt.ts`, `ArcadeMatch.bestPassOption`):
  - Ein statisches 12×8-Raster für Expected Threat (auf die Platzmaße skaliert, auch im Käfig) bewertet Pass, Dribbling und Verlust: `actionValue = Erfolgschance × Gewinn − (1 − Chance) × (0,012 + 0,5 × Gefahr am Ball)`.
  - Die Passchance kommt aus Passweg, Länge und dem Raum des Empfängers (`passCompletion`), das Dribbling aus Dribbelwert und Abstand zum nächsten Gegner (`dribbleSuccess`).
  - Der Münzwurf (16–40 % je Entscheidung) ist weg. Gepasst wird, wenn die Passoption das Dribbling um einen Tempowert schlägt, bei Druck oder wenn ein Schuss sinnvoll ist. Die gewählte Anspielstation wird als `forced` an `pass()` übergeben, vorher wählte `pass()` das Ziel noch einmal nach eigener Regel.
  - Steilpass bei einem Läufer, der mehr als 16 m voraus ist und schneller als 4 m/s läuft; lang ab 30 m. Mögliche Abseitsziele werden mit einem Preis (`OFFSIDE_PASS_COST`) noch gefunden, sonst hätte die KI kaum Abseits (0,3 pro Spiel).
- **Ohne Ball** (`core/football/tactical-intent.ts`):
  - **Passwege zustellen:** Ein Verteidiger oder Mittelfeldspieler ohne Pressing-Aufgabe und ohne Manndeckung stellt sich zu 60 % auf die Linie zwischen Ballführer und dem gefährlichsten Gegner seiner Zone.
  - **Pressing-Auslöser:** Ein Ballführer an der Seitenlinie (letzte 6 m) oder nach verlorener Kontrolle (`heavy-touch`) bekommt einen zusätzlichen Presser.
  - **Überlaufen und Aufbau:** Außenverteidiger (`fb`) laufen an einem Flügelspieler vorbei, der den Ball auf ihrer Seite hat; die nächsten Innenverteidiger bieten beim Aufbau aus dem eigenen Drittel schräge Optionen hinter dem Ballführer an.
  - **Manndeckung:** Eine gierige Zuordnung nimmt die engsten Paare zuerst, kein Gegner bekommt zwei Bewacher (vorher nahm jeder Verteidiger den Gegner, der seinem Posten am nächsten war).
  - **Ziel pro Tick:** Wer den Ball jagt (`press`), zielt jeden Tick neu auf ihn, statt zu einem bis zu 0,5 s alten Punkt zu laufen.
- **Schwierigkeit:** Passwege zustellen, Pressing-Auslöser und Überlaufen gibt es nicht gegen „leicht“; der Torwart liest Schüsse bei „schwer“ etwas besser (+0,04) und bei „leicht“ schlechter (−0,05). Neu: Einstellung „Mitspieler-KI“ (`GameSettings.teammateAi`, `MatchConfig.teammateAi`, Einstellungsseite), vorher spielten die eigenen Mitspieler immer „normal“.
- **Leistung:**
  - Die Teamdaten einer Seite (Gegner, Mitspieler, Pressing-Reihenfolge, Deckungszuordnung, Abseitslinie) werden je Tick und Seite einmal berechnet und wiederverwendet (`frameFor`), ohne neue Listen im Normalfall.
  - `isOffsidePosition` findet den vorletzten Verteidiger in einem Durchlauf statt mit Filter und Sortierung; ein Test vergleicht gegen die alte Fassung.
  - `betterPlacedTeammate` ist unverändert (wird nur bei Schussentscheidungen gerufen).
- **Balance:** Die neue KI verteidigt besser (weniger Tore, mehr Paraden). `KEEPER_REACH_BASE` ist von 0,55 auf 0,45 gesenkt, damit die Tore wieder im Korridor liegen.

  | Wert | Phase 2 | Phase 3 | Ziel |
  | --- | --- | --- | --- |
  | Tore pro Spiel | 2,92 | 2,41 | 2,2–3,4 |
  | Schüsse pro Team | 13,7 | 12,0 | 8–18 |
  | Passquote | 67,8 % | 67,6 % | 65–88 % |
  | Pässe pro Team | 94,7 | 93,1 | – |
  | Unentschieden | 27,4 % | 27,2 % | 20–32 % |
  | Heimsiege | 43,6 % | 43,8 % | 42–52 % |
  | Abseits | 1,74 | 1,81 | 1,5–3 |
  | Rechenzeit | 538 ms | 550 ms | ≤ 600 |

  Auf dem Weg dahin lag die Passquote bei 62 % (die Optionen bevorzugten lange Steilpässe), Abseits bei 0,3 und die Tore bei 2,1; Passweite und Dribbel-Vorzug wurden nachgezogen.
- **Nachweis:** 389 Unit-Tests (10 neu in `gameplay-ai-v3.spec.ts`: Expected Threat, Aktionswerte, freie gegen blockierte Anspielstation, gewählter Pass, eindeutige Manndeckung, Pressing-Auslöser, Passweg-Deckung, Neuausrichtung beim Pressing, Mitspieler-KI, Abseitslinie gegen die Referenz). Ein Test aus Phase 2 musste in der Geometrie angepasst werden. Typecheck, Style-, i18n-, Format-Check und Build grün.
- **Nicht umgesetzt:**
  - Läufe des dritten Mannes und gezielte Rückwärtsläufe nach Ballverlust (der Rückzug über die bestehende Tiefenbegrenzung bleibt).
  - Anspieldreiecke für den Angriff über Mittelfeld und Innenverteidiger hinaus.
  - Die Zusatzeinstellung ist nur in der Einstellungsseite zu sehen; ich habe sie nicht im Browser angeschaut.
  - Die Taktikregler (Pressing, Breite, Mentalität) sind nicht über eine eigene Telemetrie-Kennzahl im Balance-Check nachgewiesen; die Unit-Tests belegen die neuen Auslöser, nicht die gemittelten Laufwege.
- **Offen:** Playwright-E2E nicht gelaufen, kein Spielgefühl-Test durch einen Menschen.

## Phase 4 – Animation 2.0, prozeduraler Teil (2026-11-06)

- **Gangart** (neu `features/match/animation/locomotion.ts`):
  - Die Schrittlänge hängt vom Tempo ab (`strideFor`: 1,5 m beim Gehen bis 4,4 m im Sprint, skaliert mit der Körpergröße). Vorher waren es immer 3 m, deshalb wirkte das Joggen zu langsam und der Sprint zu hektisch.
  - Die Phase wird aus der zurückgelegten Strecke aufsummiert (`advanceGait`) statt aus der Gesamtstrecke berechnet, ein Tempowechsel lässt sie also nie springen. Ein Rücksprung (Replay) oder ein großer Sprung setzt sie neu.
  - Ein langsamer Spieler, der sich dreht, tritt auf der Stelle (`turnStepAmount`) statt mit festgenagelten Füßen mitzurotieren.
  - `measureFootSlide` misst die Drift eines Standfußes gegen den Boden. Für 3, 5 und 8 m/s liegt sie unter 3 cm pro 5 cm Laufweg (Test).
- **Füße:**
  - Annahme, Zweikampf und Grätsche nutzen den Fuß auf der Seite, auf der der Ball liegt (aus dem Blickpunkt des Balls in Kamerakoordinaten, deshalb auch nach dem Seitenwechsel richtig); vorher immer den rechten.
  - Die Dribbelberührung wechselt den Fuß (`dribbleFoot`: der starke Fuß zwei von drei Berührungen, ein beidfüßiger Spieler abwechselnd); vorher immer der starke.
- **Neue und überarbeitete Posen:**
  - Stolpern (Arme heraus, Körper nach vorn, ein Knie knickt) hat eine eigene Pose und teilt sie nicht mehr mit Grätsche und Verletzung; die schwere Annahme zeigt dieselbe Pose in schwächerer Form.
  - Einwurf für Feldspieler: beide Arme über den Kopf, Rücken gebogen, Wurf nach vorn (Torwart bleibt bei seinem Abwurf; neues Modellfeld `goalkeeper`).
  - Abschirmen: Ein menschlicher Ballführer mit gehaltener Jockey-Taste zeigt die breite, tiefe Haltung (`jockey`).
  - Kopfball: Der Sprung folgt der Höhe des Kontakts (ein Ball auf 2,8 m braucht einen echten Sprung), dazu Rückbeuge und Nackenstoß.
- **Gelenke:** Die Skin-Gewichte sind jetzt auch an Leiste (Hüfte ↔ Oberschenkel), Knöchel (Schienbein ↔ Fuß) und Hals (Brust ↔ Kopf) gemischt. Die Testfiguren zeigen im Studio keine Brüche; eine Sichtabnahme aller 128 Identitäten steht aus.
- **Schiedsrichter** (`features/match/animation/referee.ts`): eine rein visuelle schwarze Figur aus derselben Spielerfabrik, die dem Ball etwa 9 m versetzt folgt und von derselben Gangart bewegt wird. Nicht Teil der Simulation, auf niedriger Qualität und Software-GL ausgeblendet.
- **Studio:** Die Bewegungsliste enthält „Schwere Annahme“ und „Abschirmen / Stellen“.
- **Nachweis:** 403 Unit-Tests (14 neu in `animation-v3.spec.ts`: Schrittlänge, stetige Phase, Rücksprung, Drehschritt, Fußrutsch bei drei Tempi, Fußseite, Stolpern, Einwurf, Kopfballsprung, normierte Gewichte, Schiedsrichter, Dribbelfuß, Abschirmen). Typecheck, Style-, i18n-, Format-Check und Build grün. Im Browser (stumm geschaltet): Spiel mit Schiedsrichter ohne Konsolenfehler, das Studio zeigt die Stolper-Pose wie vorgesehen.
- **Nicht umgesetzt – wartet auf eine Entscheidung:** Der Import von Clips (Quaternius Universal Animation Library, CC0) mit `tools/bake-animations.mjs` und `clip-store.ts` ist nicht begonnen. Er erfordert einen Download (Datei, Quelle und Größe müssen vorher freigegeben werden) und ein Retargeting auf das 16-Knochen-Skelett, dessen Qualität erst im Studio beurteilt werden kann. Die Architektur ist vorbereitet: Gangart, Aktionsposen und Kontakt-IK sind getrennt, die Posen bleiben Rückfallebene.
- **Weitere offene Punkte:** Humpeln nach einer Verletzung (der Renderzustand kennt die Verletzung nicht), Volley- und Fallrückzieherpose (keine Auslöser in der Engine), springende Mauer, Ausholphase (Kontakt-Tick der Simulation, siehe Phase 1) und die Fußrutsch-Anzeige im Studio (die Messung existiert als Funktion und Test, aber noch nicht als Anzeige). Kein Chrome-Test der Bildabstände.

### Phase 4 – Nachtrag: aufgenommene Clips (2026-11-06)

- **Quelle:** Quaternius „Universal Animation Library [Standard]“ (CC0), von OpenGameArt geladen (14,5 MB, etwas mehr als die geschätzten 10 MB; SHA-256 und Quelle stehen in `docs/THIRD_PARTY_ASSETS.md`). Das Archiv liegt nicht im Repository.
- **Inhalt des Pakets:** 46 Clips auf einem 53-Knochen-Skelett. Es gibt keine Fußballaktionen und keine Seit- oder Rückwärtsbewegung (die „120+“ der Beschreibung gehören zur Pro-Fassung). Verwendet werden Idle, Walk, Jog, Sprint und Dance.
- **Backwerkzeug** (`tools/bake-animations.mjs`, ohne zusätzliche Abhängigkeit, nur `three`): liest das GLB selbst, tastet die Clips mit 30 fps ab und übersetzt sie auf das 16-Knochen-Skelett. Rumpf, Brust und Kopf übernehmen die Änderung ihrer Weltrotation gegenüber der Bindepose, Gliedmaßen die Weltrichtung jedes Knochens (Hüfte → Knie → Knöchel → Zeh, Schulter → Ellbogen → Hand), geschwungen aus der Ruhehaltung der Spielerfigur; Proportionen und Bindepose der Quelle spielen so keine Rolle. Die Gangarten sind so rotiert, dass Bild 0 der Fersenkontakt des linken Fußes ist, damit sie sich überblenden lassen. Ergebnis: `public/assets/anim/clips.json` und `clips.bin`, zusammen 52 KB.
- **Warum nur Oberkörper:** Die Schrittlängen des Pakets sind kurz (Sprint 2,2 m pro Zyklus bei 0,67 s, also eine Grundgeschwindigkeit von 3,3 m/s; die Spieler laufen bis 9,4 m/s). Die Beine aus den Clips würden bei Spielertempo rutschen oder mit absurder Schrittfrequenz laufen. Deshalb treiben die Clips Arme, Rumpf, Kopf und das Auf und Ab der Hüfte, die Beine bleiben die Fuß-verriegelte prozedurale Gangart (`measureFootSlide` bleibt unter 3 cm).
- **Laufzeit** (`features/match/animation/clip-store.ts`, Anwendung in `three-player.factory.ts`):
  - Gewichte nach Tempo für Idle (bis 0,3 m/s), Walk (bis 2 m/s), Jog (bis 5 m/s) und Sprint; alle Gangarten teilen die Phase der Schrittuhr, Idle läuft je Spieler auf eigener Uhr (Seed).
  - Vorwärts und Stehen folgen dem Clip; Seitschritte und Rückwärtslaufen (die es im Paket nicht gibt) blenden mit Gewicht innerhalb von etwa 0,2 s zurück auf die prozedurale Pose, ohne zu springen. Die Neigung in Kurven und Seitschritten bleibt obenauf.
  - Aktionsposen (Pass, Schuss, Tackling, Kopfball …) liegen weiter über der Basis; Grätsche, Verletzung und Jubel ersetzen sie ganz. Torhüter nutzen die Clips nicht.
  - Der Tanz ist die sechste Jubelvariante (ganzer Körper); ohne Clips oder bei reduzierter Bewegung hebt der Spieler die Arme.
  - Laden: Der Renderer lädt die Clips in `prepare()`, ein Fehlschlag ist nicht fatal; der Service Worker legt sie wie alle Dateien unter `/assets/**` vorab ab.
- **Studio:** Neuer Schalter „Aufgenommene Clips“ (A/B-Vergleich). Im Browser gesehen: Der Sprint mit Clips ist kompakter mit Vorlage und angewinkelten Armen, ohne Clips steht die Figur aufrechter mit weit schwingenden Armen; der Tanz erscheint als lesbare Jubelpose.
- **Nachweis:** 410 Unit-Tests (7 neu in `animation-clips.spec.ts` mit handgemachten Clips: Gewichte, Mischung, Schleife, Mittelwert der Hüfte, Oberkörper aus dem Clip statt prozedural, Torwart unberührt, Beine unverändert, weiches Zurückblenden, Tanz mit und ohne Clips). Zwei Anpassungen: Jubelvarianten höchstens 5 statt 4 (`presentation-v2.spec`), Baseline des i18n-Checks für das Studio um einen Text auf 24.
- **Nicht gemacht:** Eine Sichtabnahme aller 128 Identitäten mit Clips, ein Test der echten Dateien in den Unit-Tests (sie sind im Browser nur geladen und angeschaut), und die Clips für Hechten, Fallen oder Aufstehen (das Standardpaket hat keine fußballtypischen).

## Phase 5 – Grafik-Politur und Präsentation (2026-11-06)

- **Licht aus dem Himmel** (`applySkyEnvironment`): Die Umgebung für Reflexe und Streulicht kommt nicht mehr aus einem Innenraum (`RoomEnvironment`), sondern aus dem Himmel des jeweiligen Stadions: Kuppel mit Verlauf, Boden mit Grasfarbe, tagsüber und bei Dämmerung eine helle Sonne, nachts vier helle Flutlichter. Sie wird je Atmosphäre beim Aufbau des Stadions erzeugt (PMREM, Software-GL ohne). Stärke 0,8 (Tag), 0,7 (Dämmerung), 0,5 (Nacht); die alten Werte 0,3/0,18 waren für den hellen Innenraum gewählt. Statt einer externen HDRI (Poly Haven, 1,5 MB) wird nichts nachgeladen.
- **Partikel:** Rasenfetzen und Konfetti sind weiche runde Punkte (`createSoftDot`) statt harter Quadrate.
- **Wetter:** Regen und Sturm ziehen den Nebel heran (Sichtweite 85/230 m bei Regen, 60/190 m bei Sturm statt 140/300 m). Im Sturm blitzt es alle neun Sekunden (`lightningFlash`, rein aus der Renderzeit, bei reduzierter Bewegung aus).
- **Kamera bei Standards:** Ecken, Freistöße und Elfmeter im Angriffsdrittel rahmen das Tor: Die Kamera fährt dorthin und rückt auf 32 m (Elfmeter 24 m) Sichtbreite zusammen.
- **Anzeige:** Über dem gesteuerten Spieler stehen sein Nachname und ein Ausdauerbalken (grün, gelb, rot; folgt der Einstellung für die Minimap). Die Minimap wird jedes Bild gezeichnet, nur Software-GL bleibt bei 11 Hz.
- **Bewegungseinstellung des Betriebssystems:** `prefers-reduced-motion` erreicht jetzt auch den Renderer und die Engine (`MatchConfig.camera.reducedMotion`); vorher zählte nur die Einstellung im Spiel.
- **Ton:** Musik und Fangesänge werden im Audio-Kontext vorausgeplant (`startBeat`, 0,3 s Vorlauf) statt über unzuverlässige `setInterval`-Takte; ein belegter Hauptthread (Wiederholung, Layout) bringt den Rhythmus nicht mehr ins Stolpern.
- **Nachweis:** 412 Unit-Tests (2 neu in `presentation-v3.spec.ts` für den Blitz); zwei bestehende Audio-Tests mussten die Planung im Voraus berücksichtigen (die Uhr der Test-Audiokontexts läuft jetzt mit der Zeit, und die Musik wird nicht mehr nach genau einer Note, sondern nach einer Zahl vorausgeplanter Noten gezählt). Typecheck, Style-, i18n-, Format-Check und Build grün. Im Browser (stumm geschaltet) gesehen: Tagbild heller und freundlicher als mit der Innenraum-Umgebung (nach der Anpassung der Stärke), Sturm bei Nacht mit Nebel und Regen, Spielername mit Balken am gesteuerten Spieler, Kamera fährt bei einer Ecke zum Tor.
- **Nicht umgesetzt:**
  - Rasen als Shader (Mähstreifen blickwinkelabhängig, Abnutzung): Die 2048er Canvas-Textur bleibt.
  - SMAA statt MSAA im Composer, Farbtabellen je Atmosphäre, Tiefenschärfe in Wiederholungen und Bloom nur für Flutlicht (der Bloom-Schwellenwert 2,2 wirkt ohnehin fast nur dort).
  - Flutlicht-Schatten je Mast, Lichtkegel, Stadion-Ausbau über `standStyle`, `bannerPattern` und `sponsorSeed`, LED-Banden.
  - Publikum als Billboards aus einem Atlas, Schnee, Spritzer und nasser Glanz im Regen, Torjubel mit rotierenden Konfetti-Plättchen.
  - Einlauf und Aufstellung, Anstoß-, Halbzeit- und Schlusskamera, Spielerkamera, Stereo-Panning der Ballkontakte und ein Samplepaket.
  - Diese Punkte sind Optik und Präsentation, die ohne Sichtkontrolle auf mehreren Geräten riskant wären; sie sind für eine zweite Runde vorgemerkt.
- **Offen:** Playwright-E2E nicht gelaufen; keine Messung der Bildabstände mit der neuen Umgebung (die Pass-Kosten der Umgebung fallen einmalig beim Stadionaufbau an).

## Phase 6 – Leistung und Mobile (2026-11-06)

- **Qualitätswechsel ohne Hänger** (löst den offenen Punkt aus Phase 0): Beginnt ein Match auf der hohen Stufe, bleiben Schattenkarte und Composer für das ganze Match bestehen. Beim Herunterschalten hört die Schattenkarte nur auf, sich zu aktualisieren (`shadowMap.autoUpdate`, `sun.shadow.intensity = 0`), und Bloom und Vignette werden abgeschaltet; die Materialien behalten ihre Programme. Im Browser gemessen: hoch → mittel → niedrig → hoch lässt die Zahl der Shader-Programme bei 57 und kostet einen Frame von etwa 4 ms; vorher waren es rund 20 neue Programme und etwa 370 ms.
- **Grafik-Einstellungen** (Einstellungsseite, `GraphicsPrefsService`, Schlüssel `pitch-legends:graphics:v1`, pro Gerät, nicht im Spielstand):
  - Stufe: Auto, Hoch, Mittel, Niedrig. „Auto“ startet je nach Gerät (Handy mittel, sonst hoch) und passt sich während des Spiels an; eine feste Stufe ändert sich nie.
  - Bildrate: Auto, 30 oder 60 (`RenderCadence` mit dem gewählten Takt).
  - Renderauflösung: 60, 80 oder 100 % der Stufenauflösung.
  - Im Browser geprüft: Mit Niedrig, 30 und 60 % läuft der Renderer fest auf niedrig (Auflösung 0,51), ohne Composer und ohne Anpassung, Zielrate 30.
- **GPU-Zeitmessung** (`gpu-timer.ts`, Erweiterung `EXT_disjoint_timer_query_webgl2`, wo vorhanden): Das Ergebnis eines Frames wird einige Bilder später gelesen, geglättet; die ersten zwölf Ergebnisse (Shader und Uploads) und Ergebnisse nach einem „Disjoint“-Ereignis werden verworfen. Ohne Erweiterung bleibt alles wie bisher.
- **Qualitätsregel** (`quality-policy.ts`, `decideQuality`): Mit GPU-Zeit wird nur heruntergeschaltet, wenn die GPU wirklich Grenze ist (über 15 ms pro Frame); hinaufgeschaltet wird nur mit Luft (unter 9 ms). Damit führt eine 30-Hz-Anzeige oder ein CPU-gebundenes Bild nicht mehr zu einem falschen Herunterschalten (offener Punkt aus Phase 0). Ohne Zeitmessung gilt die alte Regel über die Bildabstände, die einen Vsync-Deckel nicht von einer überlasteten GPU unterscheiden kann.
- **Nachweis:** 420 Unit-Tests (8 neu in `performance-v3.spec.ts`: Einstellungen und Speichern, Regel mit und ohne GPU-Zeit, Bildratendeckel auf 144 Hz, GPU-Timer mit einem simulierten Kontext). Typecheck, Style-, i18n-, Format-Check und Build grün. Der Balance-Lauf blieb unberührt (keine Engine-Änderung).
- **Nicht umgesetzt:**
  - Eine Detailstufe für ferne Spieler und der gemeinsame Glyphen-Atlas für Rückennummern (die 22 Rücken-Texturen bleiben).
  - Messungen auf einem Pixel 6a oder iPhone 12, ein 15-Minuten-Match und fünf Matches in Folge mit Speichermessung, eine Live-Worker für die Simulation (die Messung dafür steht aus; sie bleibt bei etwa 22 µs pro Tick auf dem Hauptthread).
  - Die neuen Zeilen auf der Einstellungsseite habe ich nicht gesehen, weil die Seite einen Spielstand braucht; geprüft sind Übersetzung und Funktion über den Dienst und den Renderer.
  - Die Pixel-Zeitmessung im Test-Browser meldete beim ersten Versuch unplausible 1,7 s, bevor ich die Anlaufphase verwerfen ließ; echte Werte auf echter Hardware stehen aus.
- **Hinweis zum Testen:** Der Ton muss schon vor dem Laden der Spielseite stumm sein (neues Browserfenster = leerer Speicher); das ist als Regel gespeichert.
