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
| 0 – Ausgangsbasis | Implementiert; CI-Prüfung läuft | `f3b393b`, 18 gezielte Tests, Build |
| 1 – Steuerung | Implementiert; Veröffentlichung wird geprüft | 23 Gameplay-/Inputtests, Build und Gameplay-E2E |
| 2 – 3D-Trainingsplatz | Offen | |
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
