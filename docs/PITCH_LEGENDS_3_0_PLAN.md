# Pitch Legends 3.0 – Plan: Spielgefühl, Animation, Grafik, Flüssigkeit und RPG

## Kontext

Version 2.0 ist fertig: deterministische 60-Hz-Engine (`src/app/core/services/arcade-match.ts`, 2 776 Zeilen), prozeduraler Three.js-Renderer (`features/match/three-pitch.renderer.ts`, `three-player.factory.ts`) und eine RPG-Schicht (Effekt-Pipeline, Seltenheit, Signaturen, Quirks, Evolutionen, Training 2.0).

Die Analyse von Engine, Renderer und RPG-Code hat drei Arten von Schwächen gezeigt:

- **Spielgefühl:** konkrete Fehler, fehlende Tiefe bei Ballannahme, Zweikampf und Torwart sowie eine KI, die teils per Münzwurf entscheidet.
- **Darstellung:** Animationen ohne Clips und mit Fußrutschen, Ruckler durch Zustandssprünge und Qualitätswechsel, viele Allokationen pro Frame.
- **RPG:** Systeme, die versprochen, aber nicht verdrahtet sind. Die Form ändert sich nie, 9 von 20 Hooks sind ungenutzt, KI-Spieler verteilen keine Skillpunkte.

**Entscheidungen des Nutzers (06.11.2026):**

1. Spielgefühl zuerst, danach Animation und Grafik, danach RPG.
2. Hybrid-Animation: prozedurale Körper und Identitäten bleiben, dazu echte Clips über AnimationMixer und prozedurale IK für den Ballkontakt.
3. Stilisierter, aber polierter Look; kein Realismus, kein Pixel-Stil.
4. RPG wächst in drei Richtungen: Spieler-RPG vertiefen, Trainer/Verein-RPG und Meta/Sammeln. Ein „Be a Legend“-Modus ist nicht gewünscht.

**Ergebnis nach Freigabe:** Dieser Plan wird als `docs/PITCH_LEGENDS_3_0_PLAN.md` abgelegt (deutsch, wie die übrigen Docs). Dazu kommen ein leeres `docs/IMPLEMENTATION_3_0_LOG.md` und je ein Verweis im README und im Masterplan. Die Phasen werden danach einzeln beauftragt.

## Leitplanken (gelten für jede Phase)

- **Determinismus:**
  - Gleicher Seed plus gleiche Eingaben ergeben denselben Zustands-Hash. Die bestehenden Hash- und Checkpoint-Tests bleiben grün.
  - Ändert sich das Engine-Verhalten, steigt `MatchCheckpoint.version` (`models/match.model.ts:354`) von 2 auf 3. `MatchCheckpointService` behandelt alte Checkpoints wie den Legacy-v1-Pfad: Das Match wird ohne Wertung neu angeboten.
- **Balance-Korridore** (`npm run balance:check`):
  - 2,2–3,4 Tore pro Spiel
  - 65–88 % Passquote
  - 20–32 % Remis
  - 42–52 % Heimsiege
  - höchstens 560 ms pro Match
  - zusätzlich 1,5–3 Abseits pro Match
- **RPG-Prinzipien bleiben:**
  - Alle Effekte laufen über die Effekt-Pipeline mit `EFFECT_CAPS`.
  - Aussehen gibt keinen Vorteil, Seltenheit gibt keine Attribute, Schwierigkeit ändert keine Werte.
  - Kein Echtgeld, alles offline.
- **Pro Phase:** Tests, `typecheck`, `i18n:check`, `format:check`, `styles:check`, Build und ein Eintrag im 3.0-Log. Nach jeder Gameplay-Phase gibt es eine 5-Minuten-Spielprobe als Spielspaß-Prüfpunkt.
- **arcade-match.ts schrittweise zerlegen:** Jede Phase lagert die Teile aus, die sie anfasst, nach `core/football/actions/*`, `core/football/ai/*` und `core/football/rules/*`. Jede Auslagerung allein ist hash-neutral und wird vor der Verhaltensänderung committet.

## Reihenfolge

```
Phase 0  Messbasis + Flüssigkeits-Quick-Wins      (klein, sofort spürbar)
Phase 1  Steuerung & Reaktionsgefühl              ← Priorität 1
Phase 2  Ball, Aktionen, Torwart, Standards
Phase 3  KI mit Fußballverständnis
Phase 4  Animation 2.0 (Hybrid)
Phase 5  Grafik-Politur & Präsentation
Phase 6  Leistung & Mobile
Phase 7  RPG I – Spieler vertiefen      (kann ab Phase 2 parallel laufen)
Phase 8  RPG II – Trainer & Verein      (parallel möglich, eigene Dateien)
Phase 9  Meta & Sammeln
Phase 10 QA, Balance, Release 3.0
```

**Was parallel laufen kann:**

- Track A ist die Engine (0 → 1 → 2 → 3).
- Track B ist der Renderer (4 → 5 → 6). Er startet nach Phase 0 und braucht für den Kontakt-Zeitpunkt die Ausholphase aus Phase 1.
- Track C ist das RPG (7 → 8 → 9). Er berührt nur `core/rpg`, `core/services`, `features/*` und `data/*`. Einzige Abhängigkeit: Phase 7 braucht die Hook-Verdrahtung aus Phase 2.

---

## Phase 0 – Messbasis und Quick-Wins für Flüssigkeit

**Ziel:** Ruckler und Hänger beseitigen, die ohne Umbau lösbar sind, und Latenz messbar machen.

**Ruckeln und Sprünge:**

- **Interpolation nur bei echten Teleports aussetzen.**
  - Heute wird bei jedem Wechsel von Phase oder Regelzustand die Interpolation übersprungen, auch bei harmlosen Wechseln wie „spielen → Vorteil“ (`arcade-match.ts:644–646`, `three-render-state.ts:44`).
  - Neu: ein numerischer `teleportEpoch`. Er wird nur bei Anstoß, Restart-Aufstellung, Halbzeit und Wechsel erhöht und spart nebenbei die String-Allokation pro Tick.
- **Renderer über die Halbzeit behalten** (`match.page.ts:907`). Heute laufen Stadion-Neuaufbau, Shader-Compile und Kamerafahrt in der zweiten Halbzeit erneut.
- **Qualitätswechsel ohne Hänger** (`three-pitch.renderer.ts:468–501`):
  - Composer nur einmal anlegen, `shadowMap.enabled` nicht umschalten (stattdessen `castShadow`/Lichtintensität), `renderer.compile()` für alle Stufen beim Laden, Resize entprellen.
  - Kein Herunterstufen, wenn das Gerät auf 30 Hz begrenzt ist.
- **Jubelszene:** `animationDistance` mitführen und gebrochene Ticks verwenden (`match.page.ts:971–985`). Heute gleiten die Spieler mit eingefrorenen Beinen.
- **Zeitlupe:**
  - Ballrotation und Posen-Überblendung laufen in Simulationszeit (`three-pitch.renderer.ts:969–971`, `three-player.factory.ts:530`).
  - Die Drehachse des Balls kommt aus dem Geschwindigkeitsvektor, als Quaternion statt Euler-x/z.

**Allokationen pro Frame entfernen** (Scratch-Objekte wiederverwenden):

- `three-pitch.renderer.ts`: Zeile 371 (Set) und 586–604 (Vector3)
- `three-player.factory.ts`: Zeilen 558, 570–571, 598 und 653–668 (Torwart-IK-Klone, `updateMatrixWorld`)
- `three-render-state.ts`: Zeilen 63–78
- `match.page.ts`: Zeilen 980–984
- `match-metrics.ts`: Zeile 6
- `arcade-match.ts`: Zeile 2304

**Kleinigkeiten:**

- Messwerte über Histogramme statt sechs Sortierungen mit je 3 600 Werten pro Sekunde (`match.page.ts:766–774`).
- `challengeHud.set` drosseln; heute läuft es jeden Frame (`match.page.ts:747`).
- HUD-Canvas berücksichtigt die Pixeldichte und hat übersetzte Labels (`three-pitch.renderer.ts:534, 1087`).
- Den doppelten Ballschatten auf „hoch“ entfernen (`three-pitch.renderer.ts:233–237`).
- Nur das getroffene Netz wackelt (`three-pitch.renderer.ts:1025`).
- Spielergeometrie indizieren (`mergeVertices` in `three-player.factory.ts:68`), rund 3× weniger Vertices beim Skinning.
- Assets:
  - `icon-maskable-512.png` ist bytegleich mit `icon-512.png`; das Duplikat entfernen.
  - `pixel/stadium-night.png` (1,8 MB) nach WebP umwandeln, Ziel unter 250 KB.
- **Latenzmessung:** `MatchMetrics` misst Eingabe → verbrauchender Tick → Render-Übergabe (Ziel aus dem Masterplan: p95 ≤ 50 ms, Touch ≤ 80 ms).

**Abnahme:**

- `e2e/gameplay-performance.spec.ts` ist grün; neue Unit-Tests für `teleportEpoch` und die Zeitlupen-Zeitbasis.
- Halbzeit ohne erneuten Aufbau, belegt über die Draw-Call- und Compile-Zähler in `renderer.diagnostics()`.
- Im Ruhezustand des Matches keine wiederkehrenden Allokationen im Renderpfad (Chrome-Allocation-Timeline, Ergebnis im Log festhalten).

---

## Phase 1 – Steuerung und Reaktionsgefühl (Priorität 1)

**Ziel:** Jede Eingabe fühlt sich direkt, lesbar und fair an. Defensive braucht Können statt Glück.

**Fehler beheben:**

1. **Fehlannahme bremst nur die x-Geschwindigkeit** (`arcade-match.ts:1828`). Neu: entlang des Ballvektors dämpfen und seitlich ablenken.
2. **Die Steilpasstaste löst in der Defensive Tackling und Torwart-Herauslaufen gleichzeitig aus** (`arcade-match.ts:1142` und `:383`). Beides auf getrennte Kontexte legen.
3. **Restart-Kraft nutzt für jede Art das Schuss-Maximum von 0,9 s** (`arcade-match.ts:2008`). Je Art die passende Ladezeit verwenden.
4. **Kopfballduelle entscheidet die Reihenfolge der Spielerliste, das Heimteam zuerst** (`arcade-match.ts:1836`). Neu: Abstand plus Seed-Hash (`tieOrder` aus Phase 9 der 2.0-Arbeit), ab Phase 2 der Luftzweikampf.
5. **Steilpässe führen nur entlang der Torachse** (`arcade-match.ts:1261`). Neu: Vorlage entlang Laufweg und Geschwindigkeit des Empfängers.
6. **Pässe gehen durch Verteidiger hindurch, weil nur jeder 5. Tick geprüft wird** (`INTERCEPT_EVERY`, `arcade-match.ts:122, 1757`):
   - Der Kontakt wird jeden Tick geometrisch geprüft (Strecke gegen Spieler).
   - Die Abfangwahrscheinlichkeit gilt einmal pro Pass statt pro Tick, damit die Passquote im Korridor bleibt.
7. **KI-Ballführer sprinten nie**, weil ihr Ziel immer 8 m entfernt ist und Sprint erst ab 14 m greift (`arcade-match.ts:1042, 1066`).
8. **Das Ausdauer-Attribut beeinflusst den Verbrauch nicht** (`arcade-match.ts:1000–1004`). Außerdem fehlt eine leichte Erholung beim Gehen im Spiel.
9. **Menschliche Standards werden nach 3 s automatisch ausgeführt** (`arcade-match.ts:2012`). Neu: 8 s mit sichtbarem Timer; im Training ohne Automatik.

**Gefühl und Tiefe:**

- **Sofortige Kontrolle des Empfängers:**
  - Beim Abspiel wird der Empfänger vorausgewählt. Die 12-Tick-Verzögerung (`handleSelection`, `arcade-match.ts:900–942`) entfällt für Pässe.
  - So steuert der Stick schon den Laufweg des Empfängers.
- **Gerichtete Ballannahme** (`arcade-match.ts:1790–1795`):
  - Heute übernimmt der Ball einfach die Geschwindigkeit des Empfängers.
  - Neu: Der erste Kontakt legt den Ball in Stickrichtung vor; Weite und Qualität kommen aus dem Hook `firstTouch`.
  - Ball laufen lassen: Sprint plus Loslassen beim Annehmen.
- **Aktionen kosten etwas:**
  - Pass, Schuss und Tackling bremsen den Körper für einige Ticks (Standbein). Grätschen haben einen Vorwärtsimpuls.
  - Ein verfehltes Tackling bringt eine Erholungszeit von etwa 0,4 s. Heute haben Fehlversuche keine Folgen, und `setAction` ändert nur die Animation.
- **Ausholphase:**
  - Zwischen Loslassen und Ballkontakt liegen 2–3 Ticks bei Pässen und 4–5 bei Schüssen, für Mensch und KI gleich.
  - Ziel aus dem Masterplan: Kontakt höchstens 50 ms (Pass) bzw. 100 ms (Schuss) nach dem Loslassen.
  - Das liefert der Animation sichtbares Ausholen; heute zeigt sie nur den Nachschwung.
- **Tricks fair machen** (`arcade-match.ts:1350–1392`):
  - Heute frieren alle Verteidiger im Umkreis von 1,05–3,6 m ein.
  - Neu: Der Erfolg hängt von Dribbling gegen Verteidigen ab, von der Blickrichtung des Verteidigers und vom Abstand, und betrifft nur den angegangenen Gegner.
  - Ausdauerkosten statt reiner Abklingzeit. Ein Fehlschlag ergibt eine Fehlannahme.
- **Abschirmen:** Im Ballbesitz wird LT zu „Abschirmen“: langsamer, Körper zwischen Ball und Gegner, Hook `shielding`.
- **Dribbling-Tempo:** Mit Ball sinkt das Sprinttempo von 91 % auf 84–90 %, abhängig vom Dribbling (`ARCADE_MATCH_TUNING`, `arcade-match.ts:65–79`). Das macht Verteidigen möglich; die Balance muss nachgemessen werden.
- **Spielerwechsel in der Defensive:**
  - Neue Standard-Richtlinie: automatischer Wechsel zum Verteidiger, der am besten zwischen Ball und Tor steht, wenn der eigene Spieler mehr als 12 m entfernt und nicht im Zweikampf ist. Mit Sperrzeit.
  - Rechter Stick: in Richtung schnippen wählt den Spieler in dieser Richtung. Heute ist der rechte Stick ungenutzt.
- **Neue Module:** `core/football/actions/reception.ts`, `actions/tackle.ts`, `actions/dribble.ts` und `controls/selection.ts`, ausgelagert aus `arcade-match.ts`.

**Abnahme:**

- **Szenario-Tests** (auf `setupScenario` aufbauend), neu in `gameplay-feel-v3.spec.ts`:
  - gerichtete Annahme in alle vier Richtungen
  - Fehlannahme bei Querpass dämpft den Betrag
  - kein Pass „durch“ einen Verteidiger im Korridor
  - verfehltes Tackling kostet Zeit
  - Trick betrifft nur den angegangenen Verteidiger
  - Wechsel nach Pass innerhalb von 1 Tick
- Latenz-p95 im Ziel. Balance im Korridor. Checkpoint-Version 3.
- Spielprobe von 5 Minuten. Die Rückmeldung wird ins Log eingetragen.

---

## Phase 2 – Ball, Aktionen, Torwart, Standards

**Ziel:** Mehr Ausdrucksmittel im Angriff, glaubhafte Paraden, Standards mit Steuerung.

**Ball** (`core/football/ball-physics.ts`):

- Luftwiderstand quadratisch statt rein exponentiell.
- Effet auch bei Flanken, Steilpässen und Standards; heute haben sie keine Kurve.
- Netzphysik: Der Ball bleibt im Netz hängen. Der Renderer zeigt die Netzbeule am Kontaktpunkt.

**Pässe und Flanken:**

- Scharfer Flachpass (Pass plus Modifikator).
- Flanken mit Stickrichtung: kurzer Pfosten, langer Pfosten, Elfmeterpunkt. Dazu frühe Flanke und flache Hereingabe. Heute wird der Stick ignoriert (`arcade-match.ts:1179–1213`).
- „Lauf anfordern“: Eine Taste schickt den nächsten Stürmer in die Tiefe.
- Die KI spielt Doppelpässe.
- Fake-Schuss und Pass-Abbruch.

**Schüsse:**

- Ein Timing-Abschluss als zweiter Tastendruck im Kontaktfenster, optional und in der Assistenzstufe abschaltbar.
- Echte Volleys und Halbvolleys.
- Flugkopfball sowie Seitfallzieher und Fallrückzieher (kontextabhängig, selten, abhängig von `aerial` und Physis).

**Luftzweikampf:**

- Sprunghöhe aus Physis und dem Hook `aerial`; Kopfball bis etwa 2,9 m.
- Das Duell entscheiden Timing und Position (`tryHeader`, `arcade-match.ts:1834–1873`).

**Torwart** (`core/football/keeper-ai.ts`, neu `actions/keeper.ts`):

- Statt eines einzigen Würfelwurfs pro Schuss (`arcade-match.ts:1616–1664`) wird je Teilschritt die Reichweite von Körper und Hand gegen die Flugbahn geprüft.
- Mögliche Ergebnisse: Fangen, Abwehren weg vom Tor, über die Latte lenken, Fausten, im 1-gegen-1 abtauchen.
- Reaktion aus `keeperReaction`, Reichweite aus `keeperReach`.
- Beim Elfmeter wählt der menschliche Torwart die Sprungrichtung; der Strafstoß wird als echter Schuss ausgeführt.

**Standards** (`core/football/set-pieces.ts`, neu `rules/restarts.ts`):

- Zielhilfe mit Bogenvorschau. Effet und Kraft für Freistöße und Ecken.
- Laufwege in den Strafraum: kurzer Pfosten, langer Pfosten, Strafraumgrenze. Heute bleiben alle stehen.
- Die Mauer springt; kurze Ecke als Option.
- Ecken werden als echte Flanken getreten statt als Lupfer an irgendeinen Mitspieler (`arcade-match.ts:2037`).

**Regeln:**

- Fouls von Angreifern beim Abschirmen, Fouls am Torwart.
- Bei Vorteil wird die Karte erst an der nächsten Unterbrechung gezeigt (das Feld existiert, ist aber ungenutzt, `arcade-match.ts:2415`).
- Kontaktverletzungen nutzen den Hook `injuryRisk` (`arcade-match.ts:1540`).

**Alle 9 ungenutzten Hooks verdrahten** (`shotPower`, `curve`, `throughLead`, `firstTouch`, `shielding`, `aerial`, `keeperReach`, `staminaRecovery`, `composure`):

- Jeder bekommt einen Eintrag in `EFFECT_CAPS` (`core/rpg/effects.ts:127–136`). Heute würden ungedeckte Hooks auf ±1 bzw. 0,5–1,5 zurückfallen.
- Datenquellen folgen in Phase 7.

**Abnahme:**

- Szenario-Tests für Flankenziele, Netz, Paradentypen, Kopfballduell und Standard-Laufwege.
- Balance-Lauf. Hash-Tests. Spielprobe.

---

## Phase 3 – KI mit Fußballverständnis

**Ziel:** Gegner und Mitspieler treffen nachvollziehbare Entscheidungen. Taktikregler wirken messbar.

**Entscheidung des Ballführers** (`arcade-match.ts:1058–1100`, neu `ai/carrier-decision.ts`):

- Bewertet werden alle Optionen: Pass (Raumgewinn über ein xT-Raster × Ankommwahrscheinlichkeit), Dribbling (Raum, Druck), Schuss (xG) und Flanke. Das ersetzt den Münzwurf mit 16–40 % Passchance.
- Neu `core/football/xt.ts`: ein statisches 12×8-Raster für Expected Threat, auf die Feldgröße skaliert (auch 5v5).

**Ohne Ball** (`core/football/tactical-intent.ts`):

- Passwege zustellen (Deckungsschatten).
- Pressing-Auslöser: Rückpass, schlechte Annahme, Seitenlinie.
- Rückwärtsläufe; Hinterlaufen und Innenlaufen der Außenverteidiger; Läufe des dritten Mannes.
- Anspieldreiecke in allen Mannschaftsteilen, nicht nur im Mittelfeld.

**Manndeckung eindeutig zuordnen.** Heute können zwei Verteidiger denselben Angreifer nehmen (`tactical-intent.ts:56–63`). Neu: eine gierige Zuordnung, einmal pro Entscheidungstakt.

**Zwischen den Entscheidungen** wird das Ziel jeden Tick günstig nachgeführt; heute laufen die Spieler auf ein veraltetes Ziel zu.

**Schwierigkeit:**

- Sie wirkt auch auf Stellungsspiel, Pressing-Abstimmung und den Torwart.
- Neue Einstellung „Mitspieler-KI“; heute spielen die eigenen Mitspieler immer auf „normal“ (`arcade-match.ts:2452`).

**Leistung:**

- `tacticalIntent` ohne `Map` und Sortierung pro Aufruf.
- Abseitslinie einmal pro Tick zwischenspeichern (`pitch-analysis.ts:18`).
- `betterPlacedTeammate` nicht mehr quadratisch rechnen.

**Abnahme:**

- Neue Szenarien in `football-tactics.spec.ts`: freie Anspielstation, Überzahl, Rückpass unter Druck, abgestimmtes Pressing.
- Taktikregler verändern die mittleren Laufwege messbar, belegt durch eine Telemetrie-Kennzahl im Balance-Check.
- Höchstens 560 ms pro Match.

---

## Phase 4 – Animation 2.0 (Hybrid)

**Ziel:** Flüssige, lesbare Bewegungen ohne Fußrutschen. Ballkontakt sichtbar synchron.

**Architektur** (neu `features/match/animation/`):

- `locomotion.ts`: Blend Space aus Stehen, Gehen, Joggen, Sprinten, Seitwärts und Rückwärts über Tempo und Laufrichtung relativ zur Blickrichtung.
- `action-layer.ts`: Ganz- oder Oberkörper-Clips mit Kontaktmarkern. Der Kontakt-Frame liegt auf dem Kontakt-Tick der Simulation (Ausholphase aus Phase 1).
- `ik-pass.ts`: Fuß-IK und Fußverriegelung, Ballkontakt-IK für Fuß, Kopf und Hände, Torwarthände, Blick zum Ball.
- `clip-store.ts`: lädt gebackene Clips.
- `poseFootballer` (`three-player.factory.ts:381–607`) wird zur Rückfallebene und zur Quelle prozeduraler Fußballclips.

**Clip-Quellen:**

- **Quaternius Universal Animation Library (CC0)** für Fortbewegung, Gesten, Jubel, Idle, Aufstehen und Verletzungs-Humpeln.
  - Das Werkzeug `tools/bake-animations.mjs` retargetet die Clips offline auf das eigene 16-Knochen-Skelett (`SkeletonUtils.retargetClip`).
  - Es schreibt kompakte Quaternion-Spuren mit 30 fps nach `public/assets/anim/*.bin`.
  - Lizenz und Prüfsumme kommen in `docs/THIRD_PARTY_ASSETS.md`. Budget: höchstens 600 KB.
- **Fußballkontakte** (Pass, Schuss, Grätsche, Kopfball, Torwartaktionen) bleiben prozedural. Sie werden aber als Clips mit drei Phasen gebaut: Ausholen, Kontakt, Nachschwung.

**Konkrete Korrekturen:**

- **Schrittlänge mit dem Tempo** von 1,4 m beim Gehen bis 3,2 m beim Sprint. Heute sind es immer 3 m, deshalb wirkt das Joggen zu langsam (`three-player.factory.ts:387`). Dazu die `moving`-Skalierung reparieren (`:408, 437`).
- **Fußverriegelung auch beim Drehen:** Der Standfuß dreht sich nicht mehr mit dem Körper.
- **Fuß für die Dribbelberührung aus der Gangphase**, statt immer des starken Fußes (`arcade-match.ts:1588`).
- **Annahme, Tackling und Grätsche nutzen den Fuß auf der Seite des Balls.** Heute ist es fest der rechte (`three-player.factory.ts:477, 496, 505`).
- **Eigene Posen** für Stolpern, Verletzung/Humpeln, Einwurf, Abschirmen, Volley und Fallrückzieher. Kopfball mit Sprung und Kopf-IK. Heute teilen sich Grätsche, Stolpern und Verletzung eine Pose.
- **Jubel aus der Clip-Bibliothek.** Wählbare Jubel kommen in Phase 9 dazu.
- **Gelenke:**
  - Hüfte↔Oberschenkel, Hals und Knöchel gewichten.
  - Trikotübergänge verfeinern (offener Punkt C aus `ASSET_ANIMATION_QUALITY_PLAN.md`).
- **Rein visueller Schiedsrichter**, aus der Spielerfabrik mit schwarzem Trikot. Er folgt dem Ball versetzt; die Simulation bleibt unberührt.
- **Spielerwerkstatt** (`features/match/player-lab.page.ts`):
  - Clip-Auswahl, Blend-Vorschau, Kontaktmarker.
  - Fußrutsch-Anzeige: Drift des Standfußes in cm pro Frame.

**Abnahme:**

- Automatischer Test: In der Standphase driftet der Fuß unter 3 cm. Fuß-Ball-Kontakt innerhalb von 10 cm und 1 Tick (Ziel aus dem Masterplan).
- Galerie der 128 Identitäten ohne kollabierende Gelenke.
- Draw-Calls bleiben unter 250 (`e2e/three-playground.spec.ts`).
- Spielprobe.

---

## Phase 5 – Grafik-Politur und Präsentation (stilisiert)

**Ziel:** Ein deutlich hochwertigerer Look bei gleichem Stil; Stimmung und Höhepunkte im Stadion.

**Rasen:**

- Shader statt einer 2048er Canvas-Textur, die beim Laden auf dem Hauptthread entsteht (`three-pitch.renderer.ts:1167–1206`).
- Mähstreifen ändern sich mit dem Blickwinkel; Rauschen gegen Kachelmuster.
- Eine Abnutzungs-Textur wächst mit den Laufwegen im Spiel.

**Licht:**

- **Tageslicht:** Eine CC0-HDRI von Poly Haven (1k, höchstens 1,5 MB, oder ein selbst gebackenes Sky-PMREM) ersetzt die Innenraum-Umgebung `RoomEnvironment`.
- **Flutlicht:** Vier weiche Blob-Schatten je Spieler, je einer pro Mast, als günstige Instanzen, dazu Lichtkegel als Decals.
- **Farbgebung:** eine LUT je Atmosphäre (Tag, Abend, Nacht, Regen).

**Nachbearbeitung:**

- SMAA statt MSAA-HalfFloat plus Standard-AA; heute wird doppelt geglättet (`three-pitch.renderer.ts:166, 489`).
- Bloom nur fürs Flutlicht. Tiefenschärfe nur in Wiederholungen und beim Jubel.

**Stadion:**

- Die ungenutzten Felder `standStyle`, `bannerPattern` und `sponsorSeed` (`models/visual.model.ts:65–68`) verwenden.
- Laufende LED-Banden, wehende Fahnen per Vertex-Shader, sichtbarer Ausbau je Stadionstufe.
- Nahe Tribüne in Wiederholungs- und Tiefkameras.

**Publikum:**

- Billboard-Figuren aus einem prozedural erzeugten Atlas statt Zylinder.
- Doppelte Dichte bei gleichen Kosten, Vereinsfarben, Aufspringen bei Toren, Welle.

**Wetter:** Schnee, Nebel, Spritzer und nasser Glanz bei Regen, Blitze bei Sturm, Ballgischt.

**Partikel:**

- Weiche, texturierte Sprites für Rasenfetzen und Konfetti (mit Rotation) statt Quadraten.
- Torblitz nur, wenn reduzierte Bewegung aus ist.

**Präsentation:**

- Einlauf und Aufstellung, Anstoß-Kamera, Standard-Kamera, Halbzeit- und Schlussbild, Spielerkamera (offener Punkt aus dem Log).
- Alles überspringbar und mit reduzierter Bewegung verträglich.
- Das Betriebssystem-`prefers-reduced-motion` wird an den Renderer weitergereicht (`match.page.ts:519, 581`).

**Audio** (`core/services/audio.service.ts`):

- Musik und Gesänge werden über den AudioContext geplant statt über `setInterval`.
- Ballkontakte mit Stereo-Panning; Fangesänge im Wechsel.
- Optional ein kleines CC0-Samplepaket (Kick, Pfiff, Netz, höchstens 500 KB).

**HUD:** Name und Ausdauer über dem Spieler, Schuss- und Passbogen, Minimap mit voller Bildrate.

**Abnahme:**

- Screenshots vorher und nachher je Atmosphäre im Log.
- Asset-Budget für das Match höchstens 8 MB.
- Die Bildzeit-Ziele aus Phase 6 halten.

---

## Phase 6 – Leistung und Mobile

**Ziel:** 60 FPS auf Desktop und Mittelklasse-Handys. Bildabstände: Median ca. 16,7 ms, p95 ≤ 20 ms, p99 ≤ 34 ms.

**Detailstufen für Spieler:**

- Ferne Spieler bekommen eine Variante mit weniger Segmenten aus derselben Erscheinungsrezeptur. Augen und Pupillen kosten heute je 80 Dreiecke.
- Rückennummern aus einem gemeinsamen Glyphen-Atlas mit UVs je Spieler. Heute gibt es 22 Canvas-Texturen auf transparenten Flächen (`three-player.factory.ts:104–130`).

**Adaptive Auflösung:**

- Gesteuert über die GPU-Zeit (`EXT_disjoint_timer_query_webgl2`, falls vorhanden), nicht über den Bildabstand.
- Erkennen, ob das Gerät auf 30 Hz begrenzt ist.

**Grafik-Einstellungen für Spieler:**

- Stufe: Auto, Hoch, Ausgewogen, Niedrig.
- Bildratenlimit: 30, 60 oder offen.
- Renderskalierung.

Heute gibt es keine solche Einstellung (`models/game.model.ts:134–149`).

**Simulation bleibt auf dem Hauptthread** (rund 22 µs pro Tick). Ein Live-Worker kommt nur, wenn Messungen auf dem Handy mehr als 2 ms Simulation pro Frame zeigen.

**Echte Geräte:** Messungen auf Pixel 6a und iPhone 12 sind nur mit Hilfe des Nutzers möglich und werden als offen geführt, bis sie durchgeführt sind.

**Abnahme:**

- `gameplay-performance.spec.ts` mit verschärften Grenzen.
- 15 Minuten Match und 5 Matches in Folge ohne wachsenden Speicherverbrauch.

---

## Phase 7 – RPG I: Spieler vertiefen

**Ziel:** Fortschritt ist im Match sichtbar, und versprochene Systeme funktionieren.

**Fehlende Grundlagen reparieren:**

- **Dynamische Form.** Heute wird sie nur bei der Generierung gesetzt (`data/generators.ts:152`), obwohl `match.page.html:413` Updates verspricht.
  - Neu: gleitender Mittelwert aus Note gegen Erwartung, nach jedem Spiel in `season.service.ts` (bei `applyToTeam`).
  - Trendpfeil in der Oberfläche.
- **Live-Noten mit Abzügen** (`arcade-match.ts:1503–1931`): Ballverlust, Fehler vor Gegentor, Karten, Gegentore für Abwehr und Torwart. Die XP-Formel neu austarieren (`season.service.ts:286–293`).
- **KI-Spieler verteilen Skillpunkte automatisch nach Archetyp.** Generierte Spieler erhalten Punkte und Talente passend zu ihrem Level (`data/generators.ts:106, 143, 147`). Die Logik kommt in `core/rpg/auto-build.ts`.
- **Den Hook `xpGain` auflösen**, statt `wonderkid` fest zu prüfen (`rpg.service.ts:29`). `growthChance` anschließen.
- **Signatur-Fortschritt auch für KI-Vereine** (`season.service.ts:248`).

**Neue Tiefe:**

- **Datenquellen für die neu verdrahteten Hooks:** neue Traits, Talentknoten und Signaturen, die `firstTouch`, `curve`, `aerial`, `shielding`, `keeperReach`, `composure`, `shotPower`, `throughLead` und `staminaRecovery` nutzen (`data/traits.ts`, `talents.ts`, `signatures.ts`).
- **Talentbaum 2.0:**
  - 8–9 Knoten je Archetyp in drei Stufen.
  - Vorschau und Bestätigen; heute kostet ein Klick sofort Punkte (`talent-tree.component.ts:234`).
  - Ein Umverteilen pro Saison gegen Geld als Trainer-Gespräch.
- **Spielstile:** Talente schalten echte Aktionen frei, die in Phase 2 und 4 als Grundlage entstehen.
  - Beispiele: Trivela-Pass, Power-Kopfball, Rabona, Kaiser-Grätsche, Torwart-Abwurf mit Effet.
  - Ohne das Talent stehen die Aktionen nicht zur Verfügung.
- **Ausrüstung mit Zielkonflikt:**
  - Schuhtyp je Spieler, z. B. Tempo (+Antritt, −Annahme) oder Kontrolle (umgekehrt), begrenzt durch die Caps.
  - Die Stufe kommt über einen Ausrüstervertrag des Vereins.
  - **Das Aussehen ist frei wählbar und von der Wirkung getrennt**, so bleibt das Prinzip „Aussehen gibt keinen Vorteil“ gewahrt.
- **Offene Punkte aus dem 2.0-Log:**
  - Evolutions-Zeremonie als Vorher-/Nachher-Bildschirm mit 3D-Figur.
  - Signatur-Partikelschweif im Match.
  - Quirks gegen Meisterschaft abtrainieren.
  - Quirk-Evolutionen über die Quest-Infrastruktur.
  - Trainings-Minispiel mit Note: `plan.grade` aus `medalFor` (`core/football/challenges.ts:28`).
- **Persönliche Ziele jede Saison neu**, auch vom Typ `rating`/`appearances` (`core/career/lifecycle.ts:82`). Rückmeldung bei Level-ups (Toast und Nachricht).
- **Traits und Talente auf Deutsch und Englisch.** Heute sind sie nur englisch.
- **Spielerakte** auch vom Transfermarkt und von Legends-Karten aus öffnen. `attributeSources` zwischenspeichern.

**Abnahme:**

- Form ändert sich nach Siegen und Niederlagen.
- KI-Kader haben nach 10 Saisons keine angehäuften Punkte (`career-longrun.spec.ts` erweitern).
- Jeder Hook hat mindestens eine Quelle (Test).
- Balance-Lauf mit `--effects=on`/`off`.

---

## Phase 8 – RPG II: Trainer und Verein

**Ziel:** Der Trainer und die Kabine werden zu einem eigenen Rollenspiel-Strang.

**Trainerfigur:**

- **Wachsende Attribute:** Motivation, Taktik, Jugend, Verhandlung, Medien. Heute stehen sie fest bei 55 (`features/start/start.component.ts:61`).
- **Trainer-Traits wirken.** Heute werden sie gespeichert, aber nie gelesen (`generators.ts:492`).
- **Der Perk „Jugendförderung“ wirkt.** Heute hat er keine Wirkung.
- **Eigene Seite „Trainerbüro“ mit Perk-Baum.** Heute liegt das versteckt in den Einstellungen.

**Personal:**

- **Rollen:** Co-Trainer, Torwarttrainer, Fitness, Scout, Physio, Jugendtrainer.
- **Je Person:** Wertung, Gehalt und Spezialisierung, angeschlossen an die vorhandenen Multiplikatoren (Trainings-XP, Reha, Scouting-Genauigkeit, Akademie).
- **Datenmodell:** neu `models/staff.model.ts`.

**Kabine:**

- **Teamgeist** von 0 bis 100.
- **Spielzeit-Erwartung je Rolle:** Star, Stammspieler, Rotation, Ergänzung, Talent.
- **Folgen von Unzufriedenheit:** Moral sinkt, Wechselwunsch.
- **Persönlichkeiten und soziale Quirks** (Egoist, Teamplayer, Einzelgänger) wirken jetzt zwischen Spielern.
- **Der Kapitän** hebt den Teamgeist. Heute bringt er nur +0,03 Passgeduld (`arcade-match.ts:1077–1092`).

**Duo-Chemie in der Karriere:**

- Spieler, die oft zusammen gespielt haben, oder aus derselben Nation oder Akademie kommen, werden zu Partnern.
- Bei Pässen zwischen Partnern sinken `passError`/`firstTouch` leicht.
- Umsetzung über eine neue Situation `linkPartner` in der Pipeline, damit sichtbar im Match.

**Ereignisse:**

- Kabinen-Ereignisse als Karten mit Wahl, deterministisch wie die Camp-Events (`data/camp-events.ts`).
- Pressekonferenz vor großen Spielen mit drei Antwortstilen. Wirkung auf Moral, Teamgeist, Vorstand und Motivation des Gegners.

**Rivalitäten:** `intensity` wird genutzt (heute nie gelesen, `models/world.model.ts:40–44`). Die Hitze wächst mit Ergebnissen und Transfers und wirkt auf Publikum, Derby-Stärke und Nachrichten.

**Save v8:**

- `SAVE_VERSION = 8` (`models/game.model.ts:173`).
- `SaveService.migrateToV8` nach dem Muster von `migrateToV7`: Backup vorher, idempotent, neue Felder optional.

**Abnahme:**

- `save-v8.spec.ts` (Migration v7 → v8).
- Zehn Saisons ohne Ausreißer bei Teamgeist und Wechselwünschen.
- Kabinen-Ereignisse deterministisch.

---

## Phase 9 – Meta und Sammeln

**Ziel:** Gründe, immer wiederzukommen, über alle Modi hinweg, ohne Echtgeld und ohne Vorteile durch Aussehen.

**Erfolge:**

- Neu `core/meta/achievements.ts`, etwa 60 Erfolge aus Können, Karriere und Sammeln.
- Gespeichert in einem eigenen Bereich, getrennt vom Karrierespielstand (`core/storage/persistent-store.ts`).
- Toast und eigene Seite.

**Profilstufe „Legenden-Weg“:**

- XP aus allen Modi schalten kosmetische Belohnungen frei: Schuhfarben, Jubel, Balldesigns, Stadion-Deko, Trikotmuster.

**Legends Team:**

- Karten-XP und Kartenstufen.
- Karten-Aufstieg über Duplikate und Aufgaben (heute fest an die Kartenstufe gebunden).
- Album mit Belohnung für komplette Sets.
- Wöchentlich generierte SBCs.
- Draft-Gegner skalieren mit der eigenen Leistung (heute `72 + Runde × 3`, `core/legends/legends-engine.ts:251`).

**Saisonrückblick und Ruhmeshalle:**

- RPG-Rückblick im Saisonrückblick: Level-ups, Evolutionen, beste Signaturen.
- Rekorde in der Ruhmeshalle.

**Abnahme:**

- Erfolge lösen in Unit-Tests korrekt und nur einmal aus.
- Kosmetik ändert nachweislich keine Werte (Test über `buildStatBlock`).

---

## Phase 10 – QA, Balance, Release 3.0

- 500er Balance-Lauf, Zehn-Saisons-Lauf, Läufe in Firefox und WebKit mit Markierung `@cross`, Messung auf echten Geräten (Nutzer).
- Changelog, README, Screenshots und Steuerungs-Handbuch (`data/control-bindings.ts`) aktualisieren.
- Release 3.0 mit dem Footer `Release-As: 3.0.0`, erst nach Freigabe des Nutzers.

---

## Wichtige Dateien

| Bereich | Dateien |
|---|---|
| Engine | `core/services/arcade-match.ts` (wird zerlegt), `core/football/{ball-physics,keeper-ai,tactical-intent,set-pieces,pitch-analysis,tick-input}.ts` |
| Steuerung | `features/match/match.page.ts` (Eingabe 1146–1197), `core/controls/control-prefs.ts`, `data/control-bindings.ts` |
| Renderer | `features/match/three-pitch.renderer.ts`, `three-player.factory.ts`, `three-render-state.ts`, `player-lab.page.ts` |
| RPG | `core/rpg/{effects,stat-block,signatures,quirks,evolution}.ts`, `core/services/{rpg,season,training}.service.ts`, `data/{traits,talents,signatures}.ts` |
| Speichern | `core/services/save.service.ts`, `models/game.model.ts`, `core/services/match-checkpoint.service.ts`, `models/match.model.ts` |
| Werkzeuge | `tools/balance-check.ts`, neu `tools/bake-animations.mjs` |

**Wiederverwendet werden:**

- `setupScenario` (Szenario-Tests)
- `tieOrder`/Seed-Hash (Gleichstände)
- `TickInputBuffer` (neue Eingaben)
- `EFFECT_CAPS` und `buildStatBlock` (alle RPG-Effekte)
- `migrateToV7` (Muster für v8)
- Camp-Events (Muster für Kabinen-Ereignisse)
- `RenderCadence` und `renderer.diagnostics()` (Messung)
- die Spielerwerkstatt (Animationsabnahme)

## Prüfung

- **Pro Phase:**
  - `npm test`, `npm run typecheck`, `npm run balance:check`, `npm run i18n:check`, `npm run format:check`, `npm run styles:check`, `npm run build`
  - E2E mit `PLAYWRIGHT_PRODUCTION=1 npm run test:e2e`, besonders `gameplay-performance`, `three-playground`, `player-studio` und `game-modes`
- **Gameplay-Phasen:** neue Szenario-Specs, Hash- und Checkpoint-Tests, Spielprobe im Browser (Dev-Server über `.claude/launch.json`).
- **Animation und Grafik:** Werkstatt-Screenshots je Clip und Atmosphäre, Fußrutsch- und Kontakttest, Draw-Calls und Bildzeiten aus `canvas.dataset`.
- **RPG:** Spezifikationen nach dem Muster von `rpg-effects.spec.ts`, `save-v7.spec.ts` und `career-longrun.spec.ts`.
- **Offen bleibt ausdrücklich:** Messung auf echten Handys. Die Playwright-Browser müssen lokal mit `npx playwright install` installiert sein.

## Risiken

- **Balance-Drift durch mehr Spieltiefe:** nach jeder Verhaltensänderung den Balance-Lauf machen und bei Bedarf über `ARCADE_MATCH_TUNING` nachregeln.
- **Leistungsbudget von 560 ms pro Match:** Neue Prüfungen nutzen Scratch-Objekte; neue KI-Bewertungen laufen nur im Entscheidungstakt.
- **Qualität des Clip-Retargetings:** Die prozeduralen Posen bleiben Rückfallebene je Zustand. Ein Clip wird erst nach der Werkstatt-Abnahme aktiviert.
- **Umfang:** Jede Phase ist für sich auslieferbar. RPG-Phasen werden nicht vor Phase 2 begonnen, wenn nicht parallel gearbeitet wird.
