# Grafik- und Animationsqualität: Entscheidung vom 14. September 2026

Ergänzung zum [Masterplan](PITCH_LEGENDS_2_0_MASTERPLAN.md). Gameplay, ruhige Kamera, bewusste Spielerwahl und glaubwürdige Torwartaktionen haben weiterhin Vorrang. Dieser Plan beschreibt Arbeit und Abnahmekriterien; offene Punkte gelten nicht als umgesetzt.

## Ergebnis der unabhängigen Prüfung

Ein zusätzlicher Agent hat Renderer, Spielerfabrik und vorhandene Assets ausschließlich gelesen. Aseprite ist lokal unter `D:\Tools\Aseprite-1.3.17.2\build\bin\aseprite.exe` vorhanden. Eine Installation ist nicht erforderlich.

Die Matchspieler sind individuelle prozedurale 3D-Figuren mit einem gemeinsamen SkinnedMesh, 16 Knochen, Vertexfarben und Bein-/Arm-IK. Derzeit hängt jeder Geometrievertex vollständig an einem Knochen. Das Skelett bewegt sich kontinuierlich, die einzelnen Körperteile verformen sich jedoch starr. Ein neuer Spriteatlas oder eine andere Grafikbibliothek behebt weder Gelenkübergänge noch das Zusammenspiel zwischen Parade und Ballphysik.

**Entscheidung:** Jetzt keine umfangreiche Rasterassetproduktion und kein Rendererwechsel. Die vorhandene 3D-Grundlage wird gezielt verbessert. Aseprite bleibt ein optionales Werkzeug für kleine, bewusst pixelige UI-Animationen; moderne Handbuchdiagramme entstehen skalierbar in SVG/CSS.

## Reihenfolge und Abnahme

| Schritt | Umsetzung | Abnahme | Stand |
| --- | --- | --- | --- |
| A – Gameplay-Paket abschließen | Ruhige Kameraführung, drei Wechselmodi, Fang-/Hecht-/Erholungsabläufe, Kontaktgeräusche und vollständige Torwiederholung prüfen und veröffentlichen | Kamera-Geschwindigkeitsgrenze, Schutz manueller Auswahl, Handkontakt, Ballbesitz beim Fangen, Browserbedienung, Build und CI grün; veröffentlichte Revision prüfen | Lokal umgesetzt, Abschlussprüfung läuft |
| B – Animationsqualität absichern | Werkstatt-Zeitleiste für Kontakt und Erholung nutzen; kurze/große und schmale/kräftige Figuren, beide Füße und Spielrichtungen prüfen | Kontaktbilder und Bewegungsfolgen zeigen erreichbaren Ballkontakt und nachvollziehbares Wiederaufstehen; keine neue Bildabstandsverschlechterung | Teilweise geprüft; breitere Variantenabnahme offen |
| C – Gelenke verbessern | Zuerst Nahaufnahmen auf Lücken prüfen. Bei sichtbaren Brüchen zusammenhängende Übergangsgeometrie und gezielte Gewichte an Schultern, Ellbogen, Hüfte und Knie entwickeln | Keine offenen Gelenke beim Sprint, Schuss oder Hechten; keine kollabierenden Knie und keine losgelösten Trikotdetails; weiterhin ein Mesh/Material pro Figur | Erste gemeinsame Gewichte, zusammenhängende Armflächen und längerer Trikotrumpf umgesetzt; 16 gezielte Tests und geprüfte Fang-/Hechtbilder. Breite Variantenabnahme und feine Trikotübergänge bleiben offen |
| D – Interaktives Handbuch | Aktuelle Eingaben, ruhige Spielerwahl und Torwartautomatik erklären; bedienbares Aufladen/Loslassen-Diagramm, klare Typografie und mobile Darstellung | Bedienbar mit Maus, Touch und Tastatur; Escape schließt nur die Hilfe; Spiel bleibt während der Hilfe angehalten; keine Demo schreibt Karrierefortschritt | Geplant |
| E – Asset-Pilot nur bei konkretem Nutzen | Optional das weiterhin pixelige Startbild durch eine zum tatsächlichen 3D-Spiel passende Aufnahme/Illustration ersetzen; höchstens ein kleines Aseprite-UI-Experiment | Vergleich bei realer Anzeigegröße, lesbarer Text, Mobilbeschnitt, sauberes Alpha, geringe Dateigröße und reduzierte Bewegung berücksichtigt | Zurückgestellt |

## Einsatz weiterer Agents

- Sinnvoll: unabhängige Animations-/Kontaktprüfung mit reproduzierbaren Szenen, während der Hauptagent einen anderen abgegrenzten Bereich bearbeitet.
- Später sinnvoll: ein einzelner Bildauftrag mit festem Format, Palette, Dateibudget und Referenz der tatsächlich vorhandenen Figuren. Erst nach Sichtvergleich integrieren.
- Derzeit nicht sinnvoll: parallele Produktion kompletter Spieleratlanten, große Texturpakete oder konkurrierende Änderungen an Spielerfabrik und Renderer.

Rasen, Spielfeldlinien, Publikum, Ballspur und Konfetti bleiben vorerst prozedural. Zusätzliche Assets müssen einen sichtbaren Nutzen aus der normalen Matchkamera liefern. Ein grüner Software-WebGL-Test mit etwa 30 FPS ist kein Nachweis des 60-FPS-Ziels auf realen Mobilgeräten.

## Fortschritt am 15. September

Die ursprüngliche Feststellung zur vollständig starren Knochenzuordnung beschreibt den Ausgangspunkt. Die Überarbeitung mischt die Gewichte benachbarter Körperteile innerhalb begrenzter Gelenkbereiche. Die erste Sichtprüfung zeigte, dass Gewichte allein die Ellbogenlücken nicht schließen. Dort ersetzt nun eine zusammenhängende Oberfläche die getrennten oberen/unteren Armstücke und das Ellbogengelenk. Es entstehen keine zusätzlichen Meshes oder Materialien. Füße und Handschuhspitzen behalten ihre bisherigen Kontaktbezüge. Tests prüfen die durchgängige Armoberfläche, identische Verformung an berührenden Flächen, normierte Gewichte und endliche Posen für drei Körperformen; die bestehenden Stützfuß- und Ballkontaktprüfungen bleiben grün. Diese technischen Prüfungen ersetzen keine vollständige Sichtabnahme aller 128 Identitäten und Bewegungen.
