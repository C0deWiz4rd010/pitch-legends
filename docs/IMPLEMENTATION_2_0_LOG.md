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
| 2 – 3D-Trainingsplatz | Implementiert; CI-Veröffentlichung ausstehend | Fünf 3D-Unit-Tests, Produktionsbuild, zwei Browserprüfungen bestanden |
| 3 – Ballgefühl | Offen | |
| 4 – Spieler/Animation | Offen | |
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

## Phase 3 ? Ballkontakt und Kombinationen

- Einzelne Dribbelimpulse mit kontinuierlicher Integration ersetzen die starre Ballanbindung. Sprints legen weiter vor; Tricks ver?ndern Impulse und versetzen Spieler nicht.
- Ballannahme nur in Fu?-/K?rperreichweite, abh?ngig von H?he, Geschwindigkeit, Attributen und Wetter. Die bisherige 4,2-m-Annahmehilfe entf?llt.
- Manuelle Zielrichtung bleibt frei; ausgewogene und starke Assistenz verwenden begrenzte Winkel. P?sse ber?cksichtigen Laufwege, Passkorridore und taktische Distanzen.
- 180-ms-Vorabeingaben f?r direkte P?sse/Sch?sse, Sprint+Pass f?r anschlie?enden Doppelpasslauf; flache, angeschnittene und gelupfte Abschl?sse sowie Kopfballkontakte.
- Physik-Unterteilung auf h?chstens 8 cm verhindert Pfosten-/Latten-Tunneling. Erst ein vollst?ndiger Torlinien?bertritt z?hlt. Torh?ter m?ssen die Ballposition tats?chlich erreichen; erstes Winkelspiel und r?umliche Paraden vorgezogen.
- Abseitspositionen werden bei der Passabgabe festgehalten. Manueller Spielerwechsel bleibt f?r 600 ms gegen automatische R?ckwechsel gesch?tzt. Neue Laufzeitdaten werden im Checkpoint mitgespeichert und im Determinismusvergleich ber?cksichtigt.
- Acht neue Verhaltenstests: Reichweite, Dribbelkontinuit?t, direkte Aktion mit Wiederaufnahme, verfallene Vorabeingabe, Pfosten, Latte, Torlinie und entfernte Torh?ter. Mit bisherigen Gameplaytests 25 bestanden; vollst?ndiger Zwischenlauf 89 Tests bestanden; Build und 3D-E2E bestanden.
- Explorative 30-Partien-Serie: 3,57 Tore/Partie, 6,1 Sch?sse/Team, 73,12 % Passquote, 439,87 ms/Partie. **Finale Balanceziele nicht bestanden**; Schussh?ufigkeit und Ergebnisverteilung werden nach dem koordinierten KI-Umbau in Phase 5 und der 500-Partien-Abnahme in Phase 11 erneut abgestimmt.
- Phase-2-Nachbesserung: verz?gerte GPU-Frames begrenzen den nachzuholenden Zeit?berschuss und reduzieren Grafikqualit?t, statt dauerhaft zu pausieren. Der Browsertest pr?ft Bewegung unabh?ngig von Empf?ngerwechseln. CI-Diagnoseartefakte bleiben erhalten.
