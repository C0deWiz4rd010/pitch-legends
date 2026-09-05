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
| 3 – Ballgefühl | Implementiert; Veröffentlichung läuft | `40c70a1`, 25 gezielte Tests und Build bestanden; finale Balance offen |
| 4 – Spieler/Animation | Implementiert; erweiterte Kontaktabnahme bleibt in QA | 90 Tests im Gesamtlauf + neuer Kontakttest; 19 Browserprüfungen und Build bestanden |
| 5 – KI | Offen | |
| 6 – Vollständige Partien | Offen | |
| 7 – Präsentation | Offen | |
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
- Manuelle Zielrichtung bleibt frei; ausgewogene und starke Assistenz verwenden begrenzte Winkel. Pässe ber?cksichtigen Laufwege, Passkorridore und taktische Distanzen.
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
