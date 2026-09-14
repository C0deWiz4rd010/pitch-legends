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
| 6 – Vollständige Partien | Gepusht; Pages-Nachprüfung offen | `dd1adab`; CI 34024994728 scheiterte an Software-WebGL und schmaler AUTO-Schaltfläche |
| 7 – Präsentation | In Arbeit; Gameplay-Feedback vorgezogen | Ruhige Kamera, Spielerwahl, Torwartabläufe, Audio und Replays |
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
