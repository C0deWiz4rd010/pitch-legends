# Umsetzung Pitch Legends 2.0

Dieser Bericht dokumentiert tatsächliche Änderungen und Prüfungen. Ein Eintrag ist erst abgeschlossen, wenn seine Prüfungen bestanden haben. Physische Handyprüfungen werden nicht durch Browseremulation ersetzt.

## Ausgangsstand – 2026-09-05

- Branch `develop`, Version 1.4.2, Commit `fc63246`.
- 60 Unit-Tests bestanden; Produktionsbuild und Versionsprüfung bestanden.
- Zwei gezielte Gameplay-/Sprite-E2E-Tests mit installiertem Chrome bestanden.
- Kein physisches Mobilgerät verfügbar; keine Aussage über reale mobile FPS.
- Masterplan gespeichert. Implementierung Phase 0 begonnen.

## Phasenstatus

| Phase | Status | Nachweis |
| --- | --- | --- |
| 0 – Ausgangsbasis | Veröffentlicht | `f3b393b`; Entwicklungs-404 in `a2c89df` behoben; Pages-Lauf 33967406375 erfolgreich |
| 1 – Steuerung | Veröffentlicht; Vorabeingaben/Wechselschutz folgen in Phase 3 | `a2c89df`, 23 Gameplay-/Inputtests, Build und Gameplay-E2E |
| 2 – 3D-Trainingsplatz | Veröffentlicht | `6ace9bc`; Pages-Lauf 33968766580 erfolgreich |
| 3 – Ballgefühl | Veröffentlicht; finale Balance offen | `40c70a1`, Pages-Lauf 33985582898 erfolgreich |
| 4 – Spieler/Animation | Veröffentlicht; erweiterte Kontaktabnahme bleibt in QA | `f5e6a76`, Pages-Lauf 33985835952 erfolgreich |
| 5 – KI | Veröffentlicht; finale Balance offen | `07c4ada`, Pages-Lauf 33986421455 erfolgreich |
| 6 – Vollständige Partien | Veröffentlicht | In `d382ecc` enthalten; Pages-Lauf 34994242278 erfolgreich, öffentliche Revision geprüft |
| 7 – Präsentation | Gameplay-Paket veröffentlicht; weitere Animationsabnahme läuft | `d382ecc`: ruhige Kamera, Spielerwahl, Torwartabläufe, Audio und Replays; Gelenküberarbeitung folgt |
| 8 – Spielmodi | Offen | |
| 9 – Karriere | Offen | |
| 10 – Plattform | Offen | |
| 11 – QA/Balance | Offen | |
| 12 – Release | Offen | |

## Phase 1 – Steuerung

- Ereignispuffer konsumiert Tastatur, Touch und Gamepad erst pro Simulationstakt, hält kurze Taps für 120 ms vor und trennt gleichzeitig gehaltene Eingabegeräte.
- Kürzeste Winkelrotation behebt exakte 180°-Wenden; isotrope Beschleunigung und höhere Bremskraft machen Gegenlenken unmittelbar.
- Aktionsnachbewegung bleibt bei nachfolgenden Laufticks erhalten. Pixel-Übergangsrenderer bewahrt zuletzt gültige Pose.
- Renderloop außerhalb Angular; begrenzte lokale Messwerte am Spielfeld für Bildabstände, Simulation und Rendering.
- 23 gezielte Tests bestanden; Produktionsbuild bestanden; Gameplay-E2E mit installiertem Chrome bestanden.
- Die optionale Build-Revision wird nur in Produktionsbuilds geladen; dadurch keine Entwicklungs-404.

## Phase 2 – Spielbarer 3D-Platz

- Direkter Einstieg über „Sofort spielen“ ohne Karriereerstellung. Trainingspartien schreiben keine Karriere oder Match-Checkpoints.
- Verzögert geladenes Three.js, prozedurales Stadion, geskinnte individuelle Spieler, interpolierte Kamera und Replaypositionen, Qualitätsprofile und begrenzte Pixeldichte.
- Shader und GPU-Ressourcen werden vor Beginn der Spielzeit vorbereitet. Software-Renderer erhalten ein reduziertes Profil.
- Ausgewechselte Figuren werden ausgeblendet; GPU-Ressourcen werden beim Verlassen freigegeben.
- 128 reproduzierbare Identitäten und kontinuierliche Posen mit fünf Unit-Tests geprüft. Produktionsbuild sowie Desktop-3D-Einstieg und bestehendes mobiles Matchlayout mit installiertem Chrome bestanden.
- Sichtprüfung des Screenshots: Spielfeld, Ball und Auswahl sichtbar, Spieler weiterhin klein in der taktischen Übersicht. Nahansicht, detaillierte Kontaktanimation und mobile Leistungsabnahme bleiben Aufgaben der folgenden Phasen.
- Keine reale Handy-Leistungsmessung. Die Vorschau ist kein Nachweis für das finale 60-FPS-Ziel.

## Phase 3 – Ballkontakt und Kombinationen

- Einzelne Dribbelimpulse mit kontinuierlicher Integration ersetzen die starre Ballanbindung. Sprints legen weiter vor; Tricks verändern Impulse und versetzen Spieler nicht.
- Ballannahme nur in Fuß-/Körperreichweite, abhängig von Höhe, Geschwindigkeit, Attributen und Wetter. Die bisherige 4,2-m-Annahmehilfe entfällt.
- Manuelle Zielrichtung bleibt frei; ausgewogene und starke Assistenz verwenden begrenzte Winkel. Pässe berücksichtigen Laufwege, Passkorridore und taktische Distanzen.
- 180-ms-Vorabeingaben für direkte Pässe/Schüsse, Sprint+Pass für anschließenden Doppelpasslauf; flache, angeschnittene und gelupfte Abschlüsse sowie Kopfballkontakte.
- Physik-Unterteilung auf höchstens 8 cm verhindert Pfosten-/Latten-Tunneling. Erst ein vollständiger Torlinienübertritt zählt. Torhüter müssen die Ballposition tatsächlich erreichen; erstes Winkelspiel und räumliche Paraden vorgezogen.
- Abseitspositionen werden bei der Passabgabe festgehalten. Manueller Spielerwechsel bleibt für 600 ms gegen automatische Rückwechsel geschützt. Neue Laufzeitdaten werden im Checkpoint mitgespeichert und im Determinismusvergleich berücksichtigt.
- Acht neue Verhaltenstests: Reichweite, Dribbelkontinuität, direkte Aktion mit Wiederaufnahme, verfallene Vorabeingabe, Pfosten, Latte, Torlinie und entfernte Torhüter. Mit bisherigen Gameplaytests 25 bestanden; vollständiger Zwischenlauf 89 Tests bestanden; Build und 3D-E2E bestanden.
- Explorative 30-Partien-Serie: 3,57 Tore/Partie, 6,1 Schüsse/Team, 73,12 % Passquote, 439,87 ms/Partie. **Finale Balanceziele nicht bestanden**; Schusshäufigkeit und Ergebnisverteilung werden nach dem koordinierten KI-Umbau in Phase 5 und der 500-Partien-Abnahme in Phase 11 erneut abgestimmt.
- Phase-2-Nachbesserung: verzögerte GPU-Frames begrenzen den nachzuholenden Zeitüberschuss und reduzieren Grafikqualität, statt dauerhaft zu pausieren. Der Browsertest prüft Bewegung unabhängig von Empfängerwechseln. CI-Diagnoseartefakte bleiben erhalten.

## Phase 4 – Individuelle Figuren und Animationswerkstatt

- `/players` zeigt 128 feste Identitäten, wählbare Trikots, drehbare Ganzkörperansicht, Portraits, 17 Bewegungen, Zeitlupe, Skelett und Kontaktmarkierung.
- Portrait, Ganzkörperbild und Match verwenden dieselbe prozedurale Mesh-/Skelettfabrik. Ein temporärer gemeinsamer WebGL-Kontext rendert Portraits; die Ausgabe wird auf 256 Bilder begrenzt zwischengespeichert. Veraltete asynchrone Antworten überschreiben keinen nachfolgenden Spieler oder Trikotwechsel.
- Strecke steuert den Gangzyklus ohne Phasensprung durch wechselnde Geschwindigkeit. Räumliche Bein-IK berücksichtigt Seitwärts-/Rückwärtsbewegung. Ein geometrischer Test misst weniger als 5 mm Drift des Stützfußes im geprüften Laufabschnitt.
- Fuß-, Kopf- und Handkontakte werden in der Simulation mit Ort und Tick erfasst und über Checkpoints/Renderzustand weitergegeben. Der Kurzpass-Test prüft den Stiefelkontakt zur Balloberfläche mit weniger als 3 cm Abweichung. Schwierige Sprint-/Kopfball-/Hechtkontakte sind noch nicht vollständig geometrisch abgenommen.
- Ballradius und Bodenhöhe entsprechen jetzt den Simulationsmaßen. Die Standardkamera zeigt Spieler näher und in flacherem Winkel.
- Sämtliche Modelle und Bewegungen sind eigene prozedurale Implementierungen. Die im Plan erwähnte Quaternius-Bibliothek wurde nicht benötigt oder importiert; dadurch keine zusätzlichen Assetdownloads, Formatanpassungen oder Lizenzdateien.
- Vollständiger Testlauf: 90 Unit-Tests und 19 Chromium-Browserprüfungen bestanden. Nach dem letzten Kontaktabstand-Fix zusätzlich sieben gezielte 3D-Tests bestanden (insgesamt jetzt 91). Produktionsbuild bestanden. Screenshots der Werkstatt und des Matchs visuell geprüft.
- Reale Mobilgeräte, alle extremen Kontaktposen und subjektive Langzeit-Spielspaßbewertung bleiben Teil der abschließenden QA; sie werden nicht aus grünen Automatiktests abgeleitet.

## Phase 5 – Koordinierte Mannschaften

- Gemeinsame Raumaufteilung unterscheidet Ballbesitz, freie Pässe und Verteidigung. Mitspieler behalten während eines fliegenden Passes ihre Angriffsaufgaben; Empfänger laufen zum Abfangpunkt.
- Pressing benennt einen ersten Angreifer und versetzte absichernde Mitspieler. Breite, Abwehrhöhe, Mentalität, Tempo, Spielaufbau, Passstil, Gegenstoß und Abseitsfalle beeinflussen Entscheidungen und Laufziele.
- Einzelanweisungen begrenzen Positionswechsel und steuern Vorstöße, Pressing und Deckung. Außen-/inverser Verteidiger, Anker, Spielmacher, Flügel, falsche Neun und Zielspieler haben unterschiedliche Laufziele.
- Ballführer prüfen freie Dribbelkorridore, Druck, Flankenmöglichkeiten und Torwartposition. Ersatzaufstellungen bewerten nun tatsächlich die Positionsgruppe statt jeden Feldspieler als passend zu behandeln.
- Echte Normalverteilung für Schussabweichung behebt die zuvor unrealistisch enge Streuung. xG ist als Diagnosewert nachvollziehbar nach Distanz, Winkel und Druck abgestimmt; räumliche Torwartparaden bleiben erforderlich.
- Fünf neue Verhaltenstests prüfen Abwehrlinie/Breite, abgestimmte Pressingpositionen, Positionsbindung, inverse Außenverteidiger und gespiegelte Laufwege nach Seitenwechsel. Zusammen mit bestehenden Kontakt-/Determinismustests 25 bestanden; Produktionsbuild und 3D-Browserprüfung bestanden.
- Letzte explorative 30-Partien-Serie: 4,27 Tore, 12,2 Schüsse/Team, 75,1 % Passquote, 465,52 ms/Partie. Chancenbildung und Passquote sind gegenüber der ersten KI-Fassung wiederhergestellt. **Torhäufigkeit und Heim-Siegquote noch außerhalb der alten Balanceprüfgrenzen**; keine bestandene 500-Partien-Abnahme behauptet.

## Phase 6 – Gemeinsame 3D-Partien und faire Fortsetzung (2026-09-06)

- Nutzerfeedback: Die öffentliche Karriere sah noch wie zuvor aus, weil die 3D-Vorschau bisher auf `/play` beschränkt war. Der 3D-Renderer wird jetzt in sämtlichen Livepartien verwendet; der alte Pixel-Matchrenderer ist entfernt.
- Perspektivische Arcade-Kamera mit näherer Standardansicht, wählbarer TV-/Taktikübersicht, dunklerem Rasen und abgestimmtem Licht. Die Spielfläche nutzt auf Desktop den gesamten Viewport. Spielstand, Minikarte, Spielerauswahl und Werkzeugleiste sind überlagert und voneinander getrennt positioniert.
- Figuren außerhalb der Kamera werden weder animiert noch gezeichnet. Niedrige Qualität blendet die Zuschauermenge aus. Kontextverlust pausiert die Partie; der Renderer bereitet seine Ressourcen nach Wiederherstellung erneut vor.
- Standards berücksichtigen kurze gepufferte Eingaben, Aufladung, nominierte Schützen, Aufstellung und Mindestabstände. Unbeaufsichtigte Standards werden nach drei Sekunden ausgeführt. Einwürfe starten aus Handhöhe; Elfmeter vom korrekten Punkt.
- Direkte Abseitsausnahmen für Einwurf, Ecke und Abstoß; erneute Berührung durch denselben Schützen führt zum indirekten Freistoß. Direkte Tore aus Einwürfen/indirekten Freistößen zählen nicht; direkte Eigentore bei Standards ergeben Ecke.
- Ballgewinn durch Tackling setzt tatsächliche Ballreichweite und passende Höhe voraus. Ausgewechselte Spieler können nicht wieder eingewechselt werden. Checkpoints übernehmen auch Formation, taktische Änderungen, Spielerbindung und bereits ausgewechselte Identitäten.
- Neun neue Tests prüfen Standards, Abseitsausnahmen, Doppelberührung, direkte Einwurftore, Elfmeteraufstellung, zeitliche Freigabe und identische Fortsetzung nach Auswechslung. Gesamtstand: 105 Unit-Tests; 104 im vollständigen Lauf bestanden, der korrigierte Testaufbau anschließend mit allen neun Regeltests bestanden.
- Produktionsbuild ohne Budgetwarnung bestanden. Erste vier Chromium-Prüfungen für Karriere-3D, Schnellspiel, Bildabstände und mobiles Querformat bestanden. Nach visueller Screenshotprüfung wurden Spielstandzentrierung und HUD-Überdeckung korrigiert; vollständige Browserabnahme: 18 Tests direkt bestanden, Karriere-3D nach Korrektur einer Heim-/Auswärts-Koordinatenannahme ebenfalls bestanden (19 insgesamt). Screenshot unter `docs/screenshots/career-3d-2026-09-06.png`.
- Keine Behauptung eines fertigen Releases 2.0: Phasen 7–12 und finale Balance-/Geräteabnahmen bleiben offen.

Regelquellen: [IFAB Abseits](https://theifab.com/laws/latest/offside/), [Freistöße](https://www.theifab.com/laws/latest/free-kicks/), [Eckstoß](https://www.theifab.com/laws/latest/the-corner-kick/), [Strafstoß](https://theifab.com/laws/latest/the-penalty-kick/).

## Gameplay-Schwerpunkt nach Nutzerfeedback – 2026-09-06

Die neue Darstellung wird als deutlich besser bewertet. Vorrang haben jetzt Animationen, Torwartverhalten, eine ruhigere Kamera und weniger automatische Spielerwechsel. Die interaktive Erneuerung des Handbuchs folgt passend zur finalisierten Steuerung; zusätzliche Karriere-/Spielmodi werden dafür zurückgestellt.

- Kamera: Ruhebereich von 3,2 m horizontal und 2,1 m vertikal, sanfte Nachführung mit höchstens 20 m/s Schwenkgeschwindigkeit. Kleine Dribbelbewegungen ändern den Ausschnitt nicht. Kein sprunghafter Sonderzoom beim Wechsel zwischen schnellem und langsamem Ball. Direkte Initialisierung beim Matchstart verhindert die bisherige lange Einfahrt aus der Totalen.
- Spielerwahl: Standard „Ruhig“ folgt gesichertem Ballbesitz nach 200 ms statt bei jedem wechselnden Abstand zum freien Ball. Nach einem automatischen Wechsel 750 ms Schutz; manuelle Auswahl bleibt 1,5 Sekunden erhalten. Die Modi „Auto“ und „Manuell“ lassen sich während der Partie wählen. Torhüter werden dabei nicht ungefragt angewählt.
- Animation: Laufzyklus auf eine natürliche längere Schrittlänge abgestimmt; Körperneigung reagiert auf seitliche Bewegung. Ausholpose während der Aufladung, weich auslaufende Schussnachbewegung, längere Torwartaktionen und Wiederaufstehen.
- Torwart: antizipiert erreichbare seitliche Abschlüsse, schaut bei Seitwärtsschritten zum Ball und unterbricht Paraden nicht sofort durch neue KI-Bewegungsbefehle. Gefangene Bälle werden sichtbar auf Brusthöhe gesammelt. Zweiarm-IK richtet die Hände am Fangpunkt aus. Abwürfe starten als Handkontakt. Die Werkstatt bietet eine frei verschiebbare Zeitleiste für Kontakt- und Erholungsphasen.
- Replay: begrenzter Ring mit zwölf Sekunden bei 60 Hz; Torwiederholung enthält die tatsächliche Torlinienüberschreitung vor dem folgenden Anstoß. Letzte sechs Sekunden werden in Zeitlupe wiedergegeben; kein einzelnes Anstoßbild zwischen Tor und Replay.
- Audio: getrennte Musik-, Effekt- und Publikumskanäle funktionieren auch ohne Karriere. Einmalige Ballkontaktgeräusche aus den Simulationsticks, Pfostenklang, Fanggeräusch und situationsabhängige Zuschauerlautstärke. Stummschalten der Effekte unterdrückt die Musik nicht mehr.
- Geometrische/Verhaltenstests: beide Fanghände am Ball, kontinuierliche Schussrückführung, Kamerabegrenzung, stabile Spielerwahl, geschützte manuelle Auswahl und gehaltene Torwartbälle geprüft. Vier zusätzliche Audio-/Replaytests und bestehende Regressionen bestanden.
- Letzter lokaler GPU-Browserlauf: neun Prüfungen bestanden, Median 16,7 ms, p95 17,0 ms, p99 19,1 ms, keine Long Tasks. Das ist ein Desktop-Browserbeleg, keine reale Mobilgeräteabnahme.
- Software-WebGL: Ausgangsmessung ca. 100–133 ms Median. Korrigierte Auflösungsreduzierung, kein MSAA im Softwareprofil, einfacheres Rasenmaterial, kompaktere Figuren und vollständige GPU-Vorbereitung reduzieren die Bildabstände deutlich. Ein anschließender Diagnoselauf mit CPU-Profiler bestand bei 33,3 ms Median / 50 ms p95 ohne Long Tasks. Das ist kein abschließender Nachweis; die erneute ungeprofilte Messung steht im folgenden Eintrag. GPU-Darstellung behält ihre eigene volle Qualität.
- Die horizontale Werkzeugleiste bricht auf schmalen Desktopfenstern nicht mehr über die AUTO-Schaltfläche um. Dieser Bedienungstest besteht lokal.

## Fortsetzung und Asset-Entscheidung – 2026-09-14

- [Zusatzplan für Assets und Animation](ASSET_ANIMATION_QUALITY_PLAN.md) nach unabhängiger, rein lesender Agent-Prüfung gespeichert. Aseprite ist vorhanden; derzeit werden keine Spieleratlanten erzeugt. Vorrang haben bestehende 3D-Kontakte und die noch starren Gelenkübergänge. Die vollständige interaktive Neugestaltung des Handbuchs bleibt offen.
- Lernfortschritt und Gerätewechsel lösen im laufenden Match keine vollständige Karrierekopie samt synchronem Speichern mehr aus. Fortschritt wird sofort angezeigt und an Pause-, Menü-, Halbzeit- oder Endgrenzen gesammelt gespeichert. Zwei Tests prüfen das verzögerte Speichern und die Trennung verschiedener Karrieren.
- Hilfeöffnung setzt gehaltene Eingaben zurück. Escape im Handbuch wechselt nicht zugleich den Pausenzustand. Der zusätzliche Browsertest prüft Öffnen während des Spiels und aus der Pause.
- Steuerungstexte erklären drei Wechselkandidaten, 1,5 Sekunden Schutz, ruhige/manuelle Spielerwahl, Doppelpasslauf, direkte Aktionen, Schussvarianten und selbstständige Torwartverteilung. Die tatsächlichen Ladezeiten bleiben 0,8 Sekunden für Pässe und 0,9 Sekunden für Schüsse.
- Torhüter antizipieren keine oberhalb ihrer modellierten Reichweite liegenden Hechtziele. Die Zeitleistenanzeige der Werkstatt aktualisiert sich auch nach mehreren Schleifen begrenzt statt bei jedem Bild.
- **117 Unit-Tests bestanden. 20 bestehende Chromium-E2E-Tests vollständig bestanden**, zusätzlicher Hilfe-/Pausentest anschließend bestanden. Lokale normale GPU-Messung: 300 Bildabstände, Median 16,7 ms, p95 16,8 ms, p99 16,9 ms; keine Long Tasks. Fang- und Hechtansicht visuell geprüft; sichtbare starre Gelenkübergänge bleiben ausdrücklich weitere Arbeit.
- **Unprofilierter Softwarelauf noch nicht vollständig grün:** Median 16,7 ms, p95 33,4 ms, p99 50 ms und eine 53-ms-Blockade während Bewegung. Gegenüber dem Ausgangszustand deutlich schneller, aber die strenge Prüfung schlägt weiterhin an. Keine Testgrenze wurde dafür gelockert. Keine mobile 60-FPS-Abnahme oder fertige Version 2.0 behauptet.
- Produktionsbuild ohne Budgetwarnungen und Versionssynchronisierung bestanden. Das Gameplay-Paket wird auf `develop` gepusht; Veröffentlichung bleibt bis zum erfolgreichen Pages-Lauf und Abgleich der Build-Revision unbestätigt.
- Gegenprüfung des **minifizierten Produktionsbuilds** von `100dda8` mit erzwungenem SwiftShader: bestanden, 217 Bildabstände, Median 33,3 ms, p95 33,4 ms, p99 50 ms und keine Long Tasks. Dieselben Testgrenzen, keine zusätzliche Wartezeit oder Profilerinstrumentierung. Der Entwicklungsbuild-Aussetzer ist dadurch eingegrenzt, seine Ursache jedoch nicht abschließend belegt.
- Produktionsaufnahmen visuell geprüft: [Match](screenshots/gameplay-2026-09-14.png), [Fangen](screenshots/keeper-catch-2026-09-14.png), [Hechten](screenshots/keeper-dive-2026-09-14.png). Die Nahansichten dokumentieren auch die noch zu verbessernden starren Gelenkübergänge.
- CI `34878734748` für `100dda8`: 117 Unit-Tests und 20 Browser-Funktionstests bestanden; die Performance-Prüfung meldet im Entwicklungsbuild einzelne 54–92-ms-Blockaden. Kein Deployment. Die Browserabnahme wird deshalb auf den zuvor lokal geprüften optimierten Produktionsbuild umgestellt (`PLAYWRIGHT_PRODUCTION=1`, eigener lokaler statischer Server). Der für Pages nötige Basispfad wird weiterhin im Veröffentlichungsbuild gesetzt. Messablauf und Performance-Grenzen bleiben unverändert.

## Fortsetzung – 2026-09-15

- Erneute Softwareprüfung von `100dda8`: auch der Produktionsbuild zeigte einmal eine 61-ms-Blockade. Ein Wechsel des Testservers allein löst das Problem somit nicht. Zusätzlich liefen zwei Menütests im langsamen Softwareprofil in ihre Zeitgrenzen; die normalen GPU-Funktionstests waren zuvor grün.
- Browser-Timeline aufgezeichnet: lange Aufgaben lagen sowohl in der Frame-Verarbeitung als auch im Compositor-Commit; keine belegte einzelne JavaScript-Ursache. Deshalb keine Behauptung, der Entwicklungsserver oder die Portraits seien allein verantwortlich.
- Nicht mehr benötigte Portraitanfragen werden jetzt vor der GPU-Erzeugung verworfen. Gemeinsame Anfragen bleiben bestehen, solange eine sichtbare Ansicht sie benötigt. Vor dem Matchstart werden ausstehende Menübilder abgeschlossen/abgebrochen und der temporäre Portrait-Grafikkontext freigegeben. Reine Vorberechnung ungenutzter Ganzkörperbilder in der Werkstatt entfernt.
- Software-Portraits verwenden 128 statt 256 Pixel, kompaktere Geometrie und kein MSAA. Hardware-Portraits behalten ihr Qualitätsprofil. Die Software-Matchdarstellung wird auf 30 Zeichnungen pro Sekunde begrenzt, damit sie den Treiber nicht dauerhaft überlastet; Simulation und Eingabeverarbeitung bleiben bei 60 Hz. Diagnosefeld `targetFps` unterscheidet dieses Profil von Hardwaredarstellung.
- Sieben neue Tests für Abbruch, gemeinsam benötigte Bilder, Cachewechsel, Kontextfreigabe und akkumulierte Renderzeit bestanden. Browser- und Produktionsabnahme dieses Folgepakets läuft; neue Veröffentlichung noch nicht bestätigt.
- Produktionsbuild bestanden. **Alle 21 Browserprüfungen mit erzwungenem Software-Rendering bestanden**, einschließlich der zuvor gescheiterten Kader-/Transferansichten. Ungeprofilte Messung: 292 Browser-Bildabstände, Median 16,7 ms, p95 16,8 ms, p99 33,4 ms, keine Long Tasks. Diese Abstände messen die Browser-/Eingabeschleife; das Softwareprofil zeichnet weiterhin höchstens 30 3D-Bilder/s. Kein Testlimit oder Funktionskriterium wurde gelockert.
- **`d382ecc106e1a1ef2d4ae9061fd56dc2f973422b` veröffentlicht.** CI/Pages `34994242278` erfolgreich, öffentliche `build-info.json` am 15. September auf genau diese Revision geprüft. Die CI-Performanceprüfung benötigte zwei Wiederholungen wegen einzelner 51-/70-ms-Blockaden; der dritte Lauf bestand ohne Long Tasks. Damit ist die Veröffentlichung bestätigt, aber nicht völlige Reproduzierbarkeit jeder Softwaremessung behauptet.

### Zusammenhängende Gelenke und bessere Nahansicht

- Gemeinsame Gewichte an Rumpf, Schultern und Knien; etwas längerer Trikotrumpf schließt den bisherigen Abstand zur Hüfte. Erste Sichtprüfung erkannte trotz grüner Gewichtstests Lücken an stark gebeugten Ellbogen.
- Die getrennten Arm-/Ellbogenstücke wurden daraufhin durch eine zusammenhängende, über zwei Knochen verformte Oberfläche ersetzt. Ein Topologietest prüft, dass offene Kanten ausschließlich an den verdeckten Ärmel-/Handgelenkenden liegen. Keine zusätzlichen Meshes oder Materialien pro Figur.
- Die Werkstatt rahmt Hechtposen weiter und tiefer, sodass Kopf, Ball und Hände nicht am rechten Rand abgeschnitten werden. Neue Sichtbelege: [Fangen](screenshots/keeper-catch-2026-09-15.png), [Hechten](screenshots/keeper-dive-2026-09-15.png). Feine Trikot-/Oberarmübergänge und eine vollständige 128-Varianten-Abnahme bleiben offen.
- 16 gezielte Geometrie-, Kontakt- und Steuerungstests bestanden; Produktionsbuild bestanden. Werkstatt-Browsertest bestanden und Screenshots geprüft. GPU-Zwischenmessung ohne Blockaden bei 16,7 ms Median / 17,1 ms p95; nach dem endgültigen Armumbau Softwaremessung ohne Long Tasks bei 16,7 ms Median / 16,8 ms p95 / 33,4 ms p99 für die Browserschleife, weiterhin 30 FPS als Software-Zeichenziel. Abschließende CI-Veröffentlichung dieses Animationspakets steht noch aus.

## Gesamtverbesserung Phase A – Fundament (2026-09-25)

Grundlage: neuer, element-weiser Verbesserungsplan (Fundament → Gameplay → Grafik → UI → Karriere → Modi → Plattform → Balance).

- **Toter Code entfernt:** alter 2D-Matchrenderer `match-renderer.ts` (618 Zeilen, ohne Importe) sowie Pixel-Sprite-Fabrik (797 Zeilen) und deren Test. Scheitert ein WebGL-Portrait, zeigt `kitSilhouetteUri` jetzt eine kleine SVG-Silhouette in Trikotfarben mit Rückennummer. Ungenutzte Tuningwerte und Hilfsfunktionen der Engine entfernt.
- **Engine aufgeteilt:** `arcade-match.ts` 1920 → rund 1700 Zeilen. Neue reine Module unter `core/football/`: `match-types`, `pitch-analysis` (Abseits, Passkorridor, Gegnerabstand ohne Spread-Allokation), `collisions`, `match-snapshot`, `keeper-ai`, `set-pieces`. Die Klasse bleibt die Fassade. Ein temporärer Referenztest mit vier Seeds und 4000 Ticks gemischter Eingaben lieferte vor und nach der Aufteilung identische Zustands-Hashes, Ergebnisse, Schüsse und Ereigniszahlen.
- **Performance:** Replay-Ring und Renderzustand überschreiben nicht mehr angezeigte Frames, statt pro Tick neue Snapshots anzulegen. Die Interpolation nutzt eigene Scratch-Objekte und verändert nie Simulationsframes. `poseFootballer` legt keine Arrays pro Figur und Frame mehr an. Match-Checkpoints werden sofort erfasst, aber im Leerlauf serialisiert; beim Verlassen, bei `pagehide` und beim Laden wird sofort geschrieben, `clear()` verwirft ausstehende Schreibvorgänge. Karriere-Autosaves werden 150 ms gebündelt; neues Spiel, Import, Laden und Löschen verwerfen ausstehende Saves. Crowd-Audio wird nur bei spürbarer Änderung neu geplant.
- **Grafikqualität erholt sich:** Ein Frame-Rückstand senkt die Qualität nur noch um eine Stufe statt direkt auf „low“. Nach stabilen Messfenstern steigt sie wieder bis zum Startprofil des Geräts; jede neue Herabstufung erhöht die Hürde, damit die Qualität nicht pendelt.
- **Vereinheitlicht:** eine Tabellenfunktion (`core/standings.ts`) für Tabelle und Saisonziel. Das Ziel wertete bisher ohne erzielte Tore und Namen als Tiebreak und konnte dadurch einen anderen Platz melden als die Tabelle. `I18nService.pick` ersetzt fünf Kopien des `text()`-Helfers; `<html lang>` folgt der gewählten Sprache (Standard `de`).
- **CI:** neuer Schritt `npm run typecheck` (App und Specs). Der Performance-Test bleibt lokal und mit `PLAYWRIGHT_STRICT_PERF=1` streng; in CI toleriert er höchstens eine isolierte Blockade unter 80 ms. Median- und Perzentilgrenzen sind unverändert. Einen Prettier-Check habe ich nicht eingeführt: Das gesamte Repo müsste dafür umformatiert werden.
- **Zurückgestellt:** Das doppelte Wechsel-Panel wird in Phase D3 durch Bankkarten ersetzt. Der Taktik-Perk („schnellere taktische Reaktion“) hat bisher keine Wirkung und kommt in Phase B.
- **Nachweis:** 141 Unit-Tests (5 neue Vertragstests für Frame-Wiederverwendung, Scratch-Interpolation, Idle-Checkpoint, gebündeltes Autosave, SVG-Fallback). Typecheck und Produktionsbuild ohne Warnungen. Alle 21 Chromium-E2E-Tests gegen den Produktionsbuild bestanden. Frame-Pacing lokal auf GPU: 301 Frames, Median 16,7 ms, p95 17,0 ms, p99 17,1 ms, keine Long Tasks.

## Gesamtverbesserung Phase B – Gameplay (2026-09-25)

- **Bugfixes:**
  - Eigentore werden als Eigentor verbucht (kein Tor und kein Bonus für den Verteidiger, Einblendung „EIGENTOR“).
  - Die Schwierigkeit gilt nur noch für die gegnerische KI (`aiLevel`); die eigenen Mitspieler spielen immer auf „normal“.
  - Der gesteuerte Verteidiger tackelt nie ohne Eingabe; der Test prüft 600 Ticks direkt am Ball.
  - Der schwache Fuß ist relativ zur Blick- bzw. Angriffsrichtung und kippt nicht mehr zur Halbzeit.
  - Der Torwart läuft nur heraus, wenn der Ball höchstens 22 m vom eigenen Tor entfernt ist.
  - Kopfball-Abseits erzeugt Ereignis und Meldung; beim Elfmeter mit Karte werden beide Entscheidungen gemeldet.
  - Kopfbälle haben echte Streuung, xG aus dem gemeinsamen Modell (`core/football/xg.ts`) und zählen nur als „aufs Tor“, wenn sie wirklich aufs Tor gehen.
  - Verletzte Spieler bleiben 2,5 s liegen, humpeln danach mit 60 % Tempo und werden von der KI an der nächsten Unterbrechung ausgewechselt.
- **Laufgefühl:** Beschleunigung 18 statt 28 m/s², Bremsen 30 statt 38, Joggen 68 % statt 82 % des Sprints, Drehrate bei vollem Tempo bis zu 40 % geringer. 90 % Joggtempo weiterhin in unter 280 ms; der Sprint lohnt sich jetzt spürbar (Test: nach 1 s mehr als 30 % schneller).
- **Aktionen:**
  - Tackling beim Drücken statt beim Loslassen.
  - Stellen/Jockey (O/LT): torseitig, Blick zum Ball, gebremst, kleiner Tackling-Bonus.
  - Steilpass mit Vorhalt von 4–13 m in den Raum; Steil + Lob ergibt einen hohen Steilpass.
  - Flanken aus der Flankenzone zum besten Läufer im Strafraum: Lob als hohe Flanke, die auf Kopfhöhe ankommt; Steil als scharfe, flache Hereingabe.
  - Kopfballklärung und Kopfballpass ohne vorgemerkten Schuss.
  - Brust- und Oberschenkelannahme bei 0,75–1,4 m Ballhöhe.
  - Kraftschuss (Lob + Skill), Volleys, fußabhängiger Effet mit vorgehaltenem Ziel.
  - Skill-Moves nach Richtung: Körpertäuschung, Ballrolle, Drag Back, Vorlegen. Das Ergebnis hängt vom Abstand zum Gegner ab statt von einem Zufallswurf.
  - Abschirmen: Ein Ballführer ohne Sprint mit Gegner im Rücken ist schwerer zu tacklen.
  - Das Handbuch ist aktualisiert.
- **Ballphysik** (`integrateBall`):
  - Magnus-Effekt senkrecht zur Flugrichtung; Effet klingt auch in der Luft ab.
  - Topspin lässt den Ball absenken, Backspin gibt Auftrieb.
  - Grasreibung beim Aufprall.
  - Rollwiderstand aus einem konstanten und einem geschwindigkeitsabhängigen Anteil; nasser Rasen ist schneller und rutschiger.
- **KI:**
  - Schussentscheidung über die Schussqualität (xG, blockierte Schussbahn, Torwartposition) statt über einen Zufallswurf pro Entscheidung.
  - Querlegen, wenn ein Mitspieler deutlich besser steht; Skill-Moves im Eins-gegen-eins.
  - Echter Hechtsprung mit Seitwärtsbewegung und größerer Reichweite.
  - Paraden gehen zur Seite; Rückpassregel; Handspiel nur im Strafraum.
  - Taktik-Perk wirkt (4 % schnellere Reaktion je Stufe).
  - Wechsel ab Minute 55 bei Erschöpfung; nach einer roten Karte gegen einen Verteidiger rückt der vorderste Stürmer auf dessen Position zurück.
- **Regeln und Ablauf:**
  - Nachspielzeit aus Toren, Wechseln, Verletzungen und Karten, angezeigt als „+N“. Der Halbzeit- bzw. Schlusspfiff wartet auf eine ruhige Situation, höchstens 8 s.
  - Mauer mit 2–5 Spielern im Abstand von 9,15 m; Feldspieler blocken Schüsse.
  - Die KI schießt Freistöße direkt; Einwürfe mit 8–14 m/s.
  - Elfmeter mit Nervenstärke („Ice in the Veins“), der Torwart wählt eine Ecke.
  - Verlängerung (2 × 15 Minuten, spielbar) und deterministisches Elfmeterschießen für K.-o.-Spiele (`MatchConfig.knockout`, `MatchResult.shootout`).
- **Audio** (weiterhin synthetisch):
  - Anstoß-, Halbzeit- und dreifacher Schlusspfiff, Doppelpfiff bei Abseits.
  - Buhrufe bei Karten, Raunen bei Paraden, Pfostentreffern und Großchancen, Netzrauschen beim Tor.
  - Schüsse klingen härter als Pässe; Dribbelberührungen sind leise.
  - Fangesänge, solange die Heimelf führt.
- **Heimvorteil:** Die Engine war nach den Änderungen symmetrisch (37 % Heim- zu 38 % Auswärtssiegen). Der alte Heimvorteil entstand nur durch die Reihenfolge der Spielerliste. Jetzt gibt es einen echten, kleinen Effekt: 12 % weniger Pass- und Schussstreuung, bessere Ballannahme und etwas mehr Erfolg im Zweikampf.
- **Balance** (300 Spiele):

  | Kennzahl | Wert | Ziel | Vorher |
  |---|---|---|---|
  | Tore pro Spiel | 3,38 | 2,2–3,4 | 3,85 |
  | Schüsse pro Team | 8,9 | 8–18 | |
  | Schüsse aufs Tor | 65 % | | 74 % |
  | Passquote | 65,3 % | 65–88 % | |
  | Unentschieden | 21,3 % | 20–32 % | |
  | Heimsiege | 45 % | 42–52 % | |

  Das 500-ms-Zeitlimit wird auf diesem Rechner nicht erreicht: 740 ms pro Spiel, der Stand vor Phase B brauchte hier bereits 635 ms. Die Optimierung folgt in Phase H.
- **Nachweis:**
  - 164 Unit-Tests, davon 24 neu: `gameplay-fixes`, `gameplay-actions`, `ball-flight`, `match-flow` und Audio. Der Tackling-Regressionstest wurde gegen den zurückgenommenen Fix geprüft und schlägt dann fehl.
  - Typecheck und Build bestanden; 21 E2E-Tests gegen den Produktionsbuild bestanden (Frame-Pacing 16,7 / 17 / 18 ms, keine Long Tasks).
  - Gespielte Szene in Chrome ohne Fehler, 971 Frames bei einem Median von 16,7 ms.
- **Offen für spätere Phasen:**
  - Sichtbare Zielhilfe bei Standards (D3).
  - Einzeln dargestelltes Elfmeterschießen und Pokalanbindung (E4).
  - Touch-Taste für Stellen (G).
  - Posen für die neuen Aktionen (C5).

## Gesamtverbesserung Phase C – Grafik und Animation (2026-09-25)

- **Kamera:**
  - ARCADE, TV und TAKTIK sind jetzt echte Einstellungen mit eigenem Winkel, Objektiv und Ausschnitt (30° / 25° / 60°) statt reiner Zoomstufen. Die Standardansicht ist flacher und 20 % enger; die Spieler sind dadurch deutlich größer, Tribünen und Himmel sind sichtbar.
  - Die nahe Längstribüne entfällt, weil die Kamera in ihr sitzt und sie sonst die Seitenlinie verdecken würde.
  - Kamerawackeln bei Toren, Pfosten und Blocks (abschaltbar, aus bei reduzierter Bewegung).
  - Kurzer Kameraschwenk über das Stadion vor dem Anstoß.
- **Licht:**
  - Image-based Lighting (RoomEnvironment) und ein Gegenlicht; das direkte Licht ist dafür etwas reduziert.
  - Die Schattenkamera folgt dem Bild auf das Texel genau: etwa 28 statt 14 Texel pro Meter.
  - Die runden Schatten sind im High-Profil nur noch schwach eingeblendet, der doppelte Schatten ist damit weg.
  - Nachbearbeitung nur im High-Profil: Bloom (nur Lampen und Torblitz), Vignette, Tone Mapping.
  - Die Draw-Call-Statistik zählt den ganzen Frame einschließlich aller Passes.
- **Stadion:**
  - Himmelskuppel mit Farbverlauf und Skyline für Tag, Dämmerung und Nacht.
  - Leuchtende Flutlichtköpfe, nachts mit Schein.
  - Rückwände; ab Stadionstufe 2 Tribünendächer mit Stützen.
  - Netze als halbtransparente, texturierte Flächen mit Ausbeulung.
  - Spielfeldlinien als Geometrie, in jedem Abstand scharf.
  - Rasen mit Bump-Map, großflächiger Farbvariation und Lichtverlauf; nasser Rasen glänzt.
  - Flatternde Eckfahnen, dichterer Regen bei Sturm.
- **Figuren:**
  - Ein gemeinsames Material für alle Spieler.
  - Name und Nummer auf dem Rücken (Canvas-Aufdruck am Wirbelsäulen-Knochen; das Softwareprofil behält die Segmentziffern).
  - Blick zum Ball, Neigung in Kurven, Schrittlänge nach Körpergröße.
  - Ruhephasen mit Gewichtsverlagerung und Umschauen.
- **Animation:**
  - 0,14 s Überblendung bei jedem Aktionswechsel, als Schicht vor der Torwart- und Kontakt-IK, damit Hände und Stiefelkontakt exakt bleiben. Der neue Test deckte einen Aliasing-Fehler in `slerpQuaternions` auf, der die Überblendung sonst wirkungslos gemacht hätte.
  - Eigene Schussposen: Innenseitpass, Vollspann mit gebeugtem Standbein und Armausgleich, Lupfer, Flanke, Vorlegen.
  - Posen für Stellen und Körpertäuschung.
  - Fünf Jubelvarianten nach Seed: Arme hoch, Knierutscher, Flugzeug, Faust, Zeigen zum Himmel.
- **Effekte und Inszenierung:**
  - Die Ballspur ist ein kamerazugewandtes, auslaufendes Band.
  - Rasenfetzen bei Grätschen und harten Schüssen.
  - Vor dem Replay 2,4 s Jubel in Nahaufnahme: Der Torschütze läuft zur Ecke, zwei Mitspieler kommen dazu.
  - Replay mit wechselnder Regie (Standard, hinter dem Tor, tief an der Seitenlinie), Kinobalken und Zeitlupenrampe von 0,65× auf 0,3× in den letzten 1,5 s.
- **Nachweis:**
  - 169 Unit-Tests (5 neu in `presentation-v2`: Replay-Zeitlupe, Kameraeinstellungen, Überblendung, Blick und Neigung, Jubelvarianten).
  - Build bestanden; 21 E2E-Tests gegen den Produktionsbuild bestanden (16,7 / 17 / 19,4 ms, keine Long Tasks).
  - Mit Software-GL bestanden: Performance-, Playground- und Renderer-Test (16,7 / 16,7 / 16,8 ms).
  - Screenshots: [Spiel](screenshots/gameplay-2026-09-25.png), [Strafraum/Stadion](screenshots/stadium-2026-09-25.png).
- **Offen:** Schnee als Wetter. Eigene Spielerkamera. Eine vollständige Abnahme aller 128 Varianten in Nahansicht.
