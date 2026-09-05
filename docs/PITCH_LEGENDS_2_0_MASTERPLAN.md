# Pitch Legends 2.0 – Phasenplan für flüssigen, lebendigen und spaßigen Fußball

Verbindlicher Masterplan vom 5. September 2026. Die Umsetzung und Prüfbelege werden in `IMPLEMENTATION_2_0_LOG.md` festgehalten. Dieser Plan ersetzt die früheren PLAN-/V2-/Gameplay-/Grafik-Roadmaps als aktuelle Arbeitsgrundlage; diese bleiben historische Dokumente.

Aus Pitch Legends wird ein direkt zugängliches Fußballspiel mit taktischer Tiefe, stilisierten 3D-Spielern und einer langfristig funktionierenden Karriere. Gameplay, Ballgefühl und Animation bestimmen die Reihenfolge. Jede abgeschlossene Phase wird geprüft, mit verständlichen Conventional Commits auf `develop` gepusht und auf GitHub Pages veröffentlicht.

## Ausgangspunkt und verbindliche Entscheidungen

Der untersuchte Stand ist Version 1.4.2. Produktionsbuild, Versionsprüfung, 60 Unit-Tests und zwei gezielte Browser-Smoke-Tests bestanden. Eine belastbare Messung auf einem echten Handy steht aus.

Konkrete Probleme der Ausgangsversion:

- Kurze Eingaben können zwischen Render- und Simulationstakt verloren gehen.
- Bei einer exakten 180°-Wende kann die Figur dauerhaft in die falsche Richtung schauen.
- Aktionszustände wie Passen werden teilweise schon nach einem Simulationstakt überschrieben.
- Sprite-Cache-Misses zeigen stehende Figuren; Kamera und Positionsrundung verstärken sichtbare Sprünge.
- Ballannahmen greifen teilweise aus 4,2 Metern Entfernung; einzelne Tricks versetzen Spieler unmittelbar.
- Die KI nutzt nur einen Teil der vorhandenen taktischen Einstellungen.
- Wiederverwendete Spielkennungen können den Karrierefortschritt ab Saison zwei blockieren.
- Speichern, langfristige Vereinsökonomie und echtes Offline-Neuladen benötigen zusätzliche Absicherung.

Vom Nutzer bestätigte Richtung:

- **Spielgefühl:** Arcade mit Tiefe; schnelle Reaktion, erkennbare Fußballlogik und Raum für Können.
- **Darstellung:** stilisiertes 3D mit individuell prozedural zusammengestellten Spielern.
- **Geräte:** Desktop mit Tastatur/Gamepad und moderne Mittelklasse-Handys mit Touchsteuerung.
- **Veröffentlichung:** jede bestandene Phase direkt live; abschließend offizieller Release 2.0.
- **Umfang:** Einzelspieler, Karriere, Schnellspiel, Training und Herausforderungen. Online-Multiplayer, kostenpflichtige Dienste und echte Vereinslizenzen gehören nicht zu diesem Release.

## Technische Grundlage

Angular bleibt für Karriere, Navigation und Menüs erhalten. Die Matchdarstellung erhält **Three.js mit WebGL 2**, kontinuierlicher Kamerabewegung und Skelettanimation. Die tatsächliche Leistung wird im Projekt gemessen.

- Ein gemeinsamer deterministischer 60-Hz-TypeScript-Kern für PLAY, COACH und SIM.
- Live-Simulation und Rendering laufen außerhalb der Angular-Änderungserkennung. Das HUD wird höchstens zehnmal pro Sekunde sowie bei wichtigen Ereignissen aktualisiert.
- Worker übernehmen Sofortsimulationen und umfangreiche Balanceberechnungen.
- Rendering interpoliert Positionen, Blickrichtungen und Animationsphasen. Es verändert weder Physik noch Ergebnisse.
- Fußballphysik bleibt ein kontrollierbares eigenes System für Bewegung auf dem Feld und Ballhöhe. Eine zusätzliche allgemeine Physikengine ist zunächst nicht vorgesehen.

| Vertrag | Verantwortung |
| --- | --- |
| `MatchCommandFrame` | Tickbezogene Bewegung, Zielrichtung und zuverlässig zugestellte Aktionsereignisse |
| `PlayerActionRuntime` | Vorbereitung, Kontaktzeitpunkt, Kontaktfuß, Nachbewegung und Unterbrechbarkeit |
| `MatchRenderFrame` | Vollständiger Darstellungszustand ohne Zugriff auf veränderliche Simulationsobjekte |
| `PlayerAppearanceRecipe` | Versionierte, reproduzierbare Körper-, Gesichts-, Haar- und Ausstattungsbeschreibung |
| `MatchScenario` | Konfiguration für Karrierepartie, Schnellspiel und Trainingsaufgaben |
| `SaveResult` / `LoadResult` | Explizite Erfolgs-, Fehler- und Migrationszustände |

Die Weltkoordinaten bleiben meterbasiert. Bestehende Spieleridentitäten, Vereine und Karrierefortschritte werden übernommen.

## Phase 0 – Verlässliche Ausgangsbasis und sichere Veröffentlichungen

- Diesen verbindlichen Masterplan anlegen und alte Pläne als historische Dokumente kennzeichnen.
- Reproduzierbare Testszenen für Dribbling, Zweikämpfe, Strafraumgedränge, Regen, Tor und Replay erstellen.
- Messwerte für Simulation, Rendering, Bildabstände, Eingabeverarbeitung, Speicher und Ladezeiten erfassen.
- Den Saisonblocker früh beheben: Spielkennungen nach Saison unterscheiden und historische Ergebnisse eindeutig zuordnen.
- Automatisches Pages-Deployment auf `develop` konzentrieren. Jeder Build erhält sichtbare Commit-Informationen und ein aufbewahrtes Deployment-Artefakt.

**Abnahme:** Ausgangswerte dokumentiert; Saison zwei startet und verbucht Ergebnisse; vorheriger geprüfter Stand lässt sich erneut veröffentlichen.

Commits: `chore(quality): establish gameplay baselines and deployment traceability` und `fix(season): prevent fixture collisions across seasons`.

## Phase 1 – Sofort bessere Steuerung und Bewegung

- Eingaben erst verbrauchen, wenn tatsächlich ein Simulationstakt stattfindet. Kurze Tastendrücke und Release-Ereignisse bleiben erhalten.
- Aktionspuffer von 120 ms und kontextbezogene Vorabeingaben für direkte Pässe beziehungsweise Abschlüsse von 180 ms einführen.
- Blickrichtungen über den kürzesten Winkel drehen; die fehlerhafte Normalisierung bei Gegenbewegung entfernen.
- Als Startabstimmung Beschleunigung auf 28 m/s² und Bremsen beziehungsweise Gegenlenken auf 38 m/s² setzen. Attribute und Fitness modulieren diese Werte.
- Bewegung und Aktionsanimation voneinander trennen. Ein Pass darf nicht durch den nächsten Lauftakt verschwinden.
- Spielerwechsel vorhersehbar machen; manuelle Auswahl kurz gegen automatische Rückwechsel schützen.
- Im bestehenden Renderer den letzten gültigen Animationszustand als Übergangslösung verwenden.

**Abnahme:** Keine verlorenen 10–40-ms-Eingaben bei 30/60/120/144-Hz-Darstellung; korrekte Gegenwenden; bei einem Referenzspieler mit Tempo 70 werden 90 % der Laufgeschwindigkeit innerhalb von 280 ms erreicht.

Commit: `fix(gameplay): make movement turning and input consistently responsive`.

## Phase 2 – Spielbarer 3D-Trainingsplatz

- Three.js verzögert laden und eine separate Trainingsszene mit Rasen, Toren, Ball, einfachem Torwart und ersten geskinnten Spielern bauen.
- Eine übersichtliche schräge Kamera mit kontinuierlicher Bewegung, vorausschauender Ballverfolgung und begrenztem Zoom verwenden.
- Spieler, Ball und Spielfeld erhalten einen gemeinsamen räumlichen Maßstab.
- Schatten, Auflösung und Stadiondetails über Qualitätsprofile steuern; Shader und erforderliche Ressourcen vor dem Anpfiff vorbereiten.
- Einen gemeinsamen Renderer für Match und Trainingsszenen aufbauen.
- Den Trainingsplatz als nutzbare Vorschau veröffentlichen. Die Karriere bleibt während dieses Übergangs spielbar.

**Abnahme:** Bewegung, Richtungswechsel, Pass und Schuss funktionieren in 3D; Desktop- und mobile Leistung werden bereits hier gemessen; Größenänderungen und Querformat funktionieren.

Commit: `feat(rendering): introduce the playable three-dimensional training pitch`.

## Phase 3 – Ballgefühl, Kombinationen und Abschlüsse

- Starre Ballanbindung durch kontrollierte einzelne Kontakte ersetzen. Beim Sprint wird der Ball weiter vorgelegt, beim engen Dribbling näher geführt.
- Annahmen benötigen tatsächliche Reichweite, passende Ballhöhe und Geschwindigkeit. Gute Spieler kontrollieren schwierige Bälle zuverlässiger.
- Pässe nach Zielrichtung, Laufweg und freiem Korridor bewerten. Die Assistenzstufen erhalten tatsächlich unterschiedliche Zielhilfen.
- Direkte Pässe, Doppelpässe, Steilpässe, Flanken und gezielte erste Kontakte ermöglichen.
- Schüsse mit verständlicher Aufladung, Richtung und Varianten ausstatten: flach, kraftvoll, angeschnitten und gelupft.
- Abpraller, Pfostenkontakte und Torlinienübertritte räumlich prüfen; schnelle Bälle dürfen Hindernisse nicht zwischen zwei Ticks überspringen.
- Tricks bewegen Körper und Ball kontinuierlich. Abschirmen und Körpertäuschungen erzeugen nachvollziehbare Vorteile.
- Ballkontakt wird durch die Simulation festgelegt und von Animation und Sound exakt dargestellt.

**Abnahme:** Keine Ballannahme aus mehreren Metern Entfernung, keine Trick-Teleports; einfache Kombinationen gelingen zuverlässig. Kontakt erfolgt beim normalen Pass spätestens 50 ms und beim normalen Schuss spätestens 100 ms nach dem Loslassen.

Commit: `feat(gameplay): rebuild dribbling passing shooting and ball contact`.

## Phase 4 – Individuelle Spieler und fließende Fußballanimationen

- Eine modulare Spielerfabrik mit gemeinsamem Humanoidskelett entwickeln. Körperteile werden zu wenigen geskinnten Meshes zusammengeführt.
- Unterschiedliche Körperproportionen, Gesichter, Frisuren, Bärte, Hautfarben, Schuhe und Accessoires aus dem gespeicherten Seed erzeugen.
- Bestehende Erscheinungsmerkmale stabil in die neue Darstellung übertragen. Neue Details entstehen aus einem getrennten visuellen Seed.
- Portrait, Ganzkörperansicht und Matchfigur verwenden dieselbe Erscheinungsrezeptur. Transfers verändern das Trikot und den Vereinskontext.
- Gehen, Joggen, Sprinten, Bremsen, Rückwärtslaufen und Seitwärtsschritte weich überblenden. Schrittlänge folgt der zurückgelegten Strecke.
- Fußplatzierung und einfache Bein-IK reduzieren Rutschen. Körperneigung und Armbewegung reagieren auf Beschleunigung und Richtungswechsel.
- Eigene Fußballclips für Annahme, Pass, Schuss, Kopfball, Tackling, Stolpern, Aufstehen, Torwartaktionen und Jubel erstellen.
- Ein Entwicklungslabor zeigt Seeds, Varianten, Zeitlupe, Skelett und Kontaktpunkte.

Frei verfügbare Teile der Quaternius Universal Animation Library dienen als Ausgangsmaterial für allgemeine Bewegung und Gesten. Fußballkontakte werden gezielt ausgearbeitet. Verwendete Dateien werden lokal gebündelt und mit Lizenz und Prüfsumme dokumentiert. Eigene prozedurale Clips bleiben eine unabhängige Produktionsgrundlage.

**Abnahme:** Reproduzierbare Galerie mit 128 Identitäten; erkennbare Unterschiede auch in Matchansicht; keine abrupten Idle-Wechsel. In Nahansicht stimmen Fuß/Ballkontakt innerhalb von 10 cm und einem Simulationstakt überein.

Commit: `feat(players): add procedural identities and continuous football animation`.

**Erster verbindlicher Spielspaß-Prüfpunkt:** Eine fünfminütige Spielsession mit Dribbling, Kombinationen, Abschlüssen und einer kleinen Partie muss direkt, verständlich und wiederholenswert wirken. Festgestellte Steuerungs- oder Kontaktprobleme werden vor der Erweiterung behoben.

## Phase 5 – Mitspieler, Gegner und Torhüter mit Fußballverständnis

- Teamverhalten in Ballbesitz, Ballverlust, Verteidigung und Umschalten unterscheiden.
- Mitspieler bieten Passdreiecke, Tiefenläufe, Überlappungen und Rückpassoptionen an.
- Verteidiger sichern Räume, decken Passwege und stimmen Pressing ab.
- Ballführende Spieler bewerten Optionen nach Raumgewinn, Risiko, Druck und Abschlussqualität.
- Alle angebotenen Taktikregler erhalten beobachtbare Auswirkungen. Bestehende Rollen und Einzelanweisungen werden angeschlossen.
- Torhüter verbessern Winkelspiel, Herauslaufen, Fangen, Abwehren und Spieleröffnung.
- Schwierigkeitsgrade verändern Wahrnehmung und Entscheidungsqualität. Dieselben Bewegungs- und Aktionsregeln gelten für Menschen und KI.

**Abnahme:** Wiederholbare Szenarien zeigen freie Anspielstationen, Überzahlen, sinnvolle Rückpässe und abgestimmte Defensive. Taktikänderungen verändern messbar die erwarteten Laufwege.

Commit: `feat(ai): add coordinated football decisions and credible goalkeeping`.

## Phase 6 – Vollständige und faire Partien

- Den verbesserten Kern auf vollständiges 11 gegen 11 ausrollen.
- Tacklings nach Richtung, Timing und Kontakt bewerten; nachvollziehbare Fouls, Vorteil und Karten.
- Abseits anhand von Abgabezeitpunkt und aktiver Beteiligung prüfen.
- Einwürfe, Ecken, Abstöße, Freistöße und Elfmeter erhalten verständliche Steuerung und kurze Abläufe.
- Halbzeit, Seitenwechsel, Auswechslungen, Verletzungen und Matchende zuverlässig integrieren.
- PLAY, AUTO, COACH und SIM verwenden denselben Kern und dieselbe Ergebnisverbuchung.
- Die 3D-Darstellung wird nach bestandener Prüfung Standard für Karrierepartien. Den alten Pixelrenderer anschließend entfernen.

**Abnahme:** Vollständige Partien ohne Regelstillstand; korrekte Blick- und Steuerungsrichtung nach der Halbzeit; identische Ergebnisse bei identischem Seed und Befehlsstrom.

Commit: `feat(match): complete the unified eleven-a-side football experience`.

## Phase 7 – Stadiongefühl, Kamera, Replays und Audio

- Prozedurale Stadionvarianten entwickeln, deren Größe und Ausstattung die Vereinsentwicklung zeigen.
- Tageslicht, Flutlicht, Rasenabnutzung, Fahnen und Zuschauerbewegung gestalterisch aufeinander abstimmen.
- Ball und Auswahlmarkierung bleiben bei jedem Wetter gut erkennbar.
- Replays aus einem begrenzten Zustandsring interpolieren; Zeitlupe zeigt denselben Kontakt wie die Liveansicht.
- Kurze Torjubel, Netzreaktion und Zuschauerreaktionen erzeugen Höhepunkte. Wiederholungen bleiben überspringbar.
- Musik, Effekte und Publikum getrennt regeln. Ballkontakte, Pfosten, Netz und Torwartaktionen erhalten passende Geräusche.
- Reduzierte Bewegung deaktiviert Kameraschütteln, Blitze und starke Kamerafahrten.

**Abnahme:** Kamera bleibt bei Kontern und Strafraumszenen nachvollziehbar; Replays springen nicht; stummgeschaltete Effekte beeinflussen den Musikkanal nicht.

Commit: `feat(presentation): add stadium atmosphere replays and football audio`.

## Phase 8 – Schnell zum Spielen und gerne wiederkommen

- Schnellspiel ohne vorherige Karriereerstellung anbieten.
- Einen wiederholbaren interaktiven Einstieg für Bewegung, Pass, Schuss und Verteidigung integrieren.
- Trainingsherausforderungen für Slalom, Passkombinationen, Abschlüsse und Standards hinzufügen.
- Eine kurze 3-gegen-3-Partie als weiteren Spielmodus anbieten.
- Lokale Bestleistungen und feste Szenario-Seeds erlauben faire Wiederholungen.
- Nach Spielende stehen Revanche, nächste Aufgabe oder Karrierefortsetzung direkt bereit.
- Standarddauer für reguläre Partien bleibt zweimal drei Minuten; fünf und acht Minuten pro Halbzeit bleiben auswählbar.

**Abnahme:** Nach dem Laden mit höchstens zwei Hauptaktionen Fußball spielen. Training und Schnellspiel verändern keine Karriere versehentlich.

Commit: `feat(play): add quick matches practice challenges and small-sided football`.

## Phase 9 – Karriere, Fortschritt und Vereinswelt verbessern

- Mehrjährige Saisons mit erneuerten Zielen, aktueller Form, Vertragsabläufen, Ruhestand und Nachwuchs für alle Vereine ermöglichen.
- Einnahmen und Ausgaben auch für KI-Vereine vollständig anwenden.
- Transfers und Scouting auf sportlichen Bedarf, verfügbare Mittel und erkennbare Spielerprofile abstimmen.
- Den bisher wirkungslosen Reise-Scoutingbericht tatsächlich erzeugen.
- Training und Talente erklären anhand sichtbarer Spielsituationen, welche Fähigkeiten sie verbessern.
- Medizin, Rehabilitation und Fitness verständlich mit Einsatzplanung verbinden.
- Anlagen zeigen ihren Nutzen und visuelle Veränderungen. Rivalitäten und Nachrichten beziehen sich auf tatsächliche Ereignisse.
- Spielberichte verbinden entscheidende Aktionen mit Leistungen und Entwicklung.

**Abnahme:** Drei vollständige Saisons einschließlich Neuladen, Transfers, Leihen und Verletzungen; jede Woche lässt sich abschließen; alle Vereine können spielfähige Mannschaften erhalten.

Commit: `feat(career): strengthen progression club economies and season continuity`.

## Phase 10 – Speichern, Mobile, Bedienung und Offlinebetrieb

- Save-Version 6 mit nachvollziehbarer Migration aus Version 4 und 5 einführen. Ursprungsdaten bleiben als Sicherung erhalten.
- Neue Erscheinungsrezepte vor dieser Migration zunächst aus bestehenden Seeds ableiten; frühere Grafikphasen erzwingen keinen voreiligen Speicherumbau.
- IndexedDB für asynchrones Speichern, Checkpoints und begrenzte Replays verwenden. Bestehende lokale Saves werden importiert.
- Karriereübernahme und erledigte Spielkennung in einer Transaktion speichern; Checkpoints erst nach erfolgreicher Übernahme entfernen.
- Speicherfehler sichtbar melden und JSON-Export weiterhin ermöglichen.
- Engine-Versionen unabhängig vom Karriereformat führen. Inkompatible laufende Matches werden gesichert und dieselbe unverrechnete Partie ohne Strafwertung neu angeboten.
- Touchflächen, Safe Areas, Querformat, Gerätewechsel, Tastenumbelegung und Controller-Trennung vervollständigen.
- Menüs lesbarer gestalten, DE/EN vollständig umsetzen und Tastaturfokus sowie Textskalierung prüfen.
- Einen Service Worker für echtes Offline-Neuladen ergänzen. Updates erst außerhalb einer laufenden Partie aktivieren.

**Abnahme:** Migration erhält Identitäten und Karriere; Speicherfehler erzeugen keine falsche Erfolgsmeldung; Offline-Neustart, Appwechsel und Wiederaufnahme funktionieren.

Commit: `feat(platform): add resilient saves mobile controls and offline play`.

## Phase 11 – Leistung, Balance und Spielqualität absichern

Verbindliche Zielwerte, keine Behauptungen über den Ausgangsstand:

| Bereich | Ziel |
| --- | --- |
| Reguläres Gameplay | 60 FPS auf Desktop und definierten Mittelklasse-Handys |
| Bildabstände bei 60 Hz | Median ungefähr 16,7 ms; p95 ≤ 20 ms; p99 ≤ 34 ms |
| Eingabeverarbeitung | Ereignis bis sichtbarer Renderübergabe p95 ≤ 50 ms; Touch ≤ 80 ms |
| Animation | Kein wiederkehrendes Fußrutschen, keine verschluckten Aktionen |
| Dauerbetrieb | 15 Minuten mobile Partie und fünf aufeinanderfolgende Matches ohne wachsenden Ressourcenverlust |
| Einstieg | Matchressourcen für die Standardqualität höchstens 8 MB übertragen |

- Desktop bei 1080p sowie Android-Chrome und iOS-Safari prüfen. Referenzklassen sind Pixel 6a und iPhone 12; tatsächlich getestete Geräte und Browser protokollieren.
- Auf mobilen Geräten zuerst Auflösung, Schatten und Zuschauerdetails reduzieren. Die Simulation bleibt unverändert.
- Chromium, Firefox und WebKit funktional testen; Browseremulation ersetzt keine echte mobile Leistungsmessung.
- 500 deterministische Partien und mehrjährige Karriereabläufe auf Stillstände, Extremwerte und wirtschaftliche Probleme untersuchen.
- Animationstests prüfen Zustandsübergänge und Kontakte; der bisherige Farbzähltest reicht dafür nicht aus.
- Echte Spielsessions beurteilen Orientierung, Kontrolle, Schwierigkeit und Wiederholungsreiz. Vorliegendes Nutzerfeedback fließt in die Abstimmung ein.

**Abnahme:** Kritische Probleme behoben, Messprotokolle vorhanden. Fehlende Geräteprüfungen ausdrücklich als offen ausweisen.

Commit: `perf(game): meet frame pacing budgets and validate football balance`.

## Phase 12 – Offizieller Release 2.0 auf GitHub Pages

- Dokumentation, Steuerungsübersicht, Screenshots, Versionsinformationen, Changelog und Assetnachweise aktualisieren.
- Die bestehende Release-Please-PR auf 2.0.0 ausrichten und nach bestandenen Prüfungen zusammenführen.
- Das vorhandene Tag-Schema beibehalten: `pitch-legends-v2.0.0`.
- Den exakten getaggten Commit per `workflow_dispatch` veröffentlichen und Tag, SHA und angezeigte Version überprüfen. Damit hängt das Deployment nicht von einem automatisch erzeugten Tag-Ereignis ab.
- Release-Artefakt mit Prüfsumme bereitstellen und den letzten funktionierenden Stand für Rückkehr bereithalten.
- Öffentliche Seite prüfen: Einstieg, Schnellspiel, Karriereimport, 3D-Assets, Worker, Unterseiten, Audio und Offline-Update.

**Abnahme:** Offizieller Release veröffentlicht und unter https://c0dewiz4rd010.github.io/pitch-legends/ überprüft spielbar.

## Arbeitsweise für jede Phase

Jede Phase durchläuft Umsetzung, passende Tests, Spielprüfung, Dokumentation, Commit, Push und Prüfung des öffentlichen Deployments. Die nächste Phase beginnt nach erfolgreichem Abschluss. Unabhängige Bausteine dürfen parallel vorbereitet werden; die Integration und Veröffentlichung bleiben geordnet. Neue Bausteine werden während des Übergangs zunächst über vollständig nutzbare Trainings- oder Vorschauansichten veröffentlicht.

Spielspaß wird regelmäßig überprüft. Ein bestandener Build oder eine hohe durchschnittliche Bildrate allein schließt keine Gameplay-Phase ab.

## Primärquellen

- https://threejs.org/docs/pages/WebGLRenderer.html
- https://threejs.org/docs/pages/AnimationMixer.html
- https://quaternius.com/packs/universalanimationlibrary.html
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
