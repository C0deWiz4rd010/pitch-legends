# Gameplay V3 – Spieltag-Masterplan

## Produktziel

Der Spieltag wird zu einem reaktionsschnellen Pixel-Fußballspiel mit direkter Steuerung, sichtbaren Attribut-, Fitness- und Taktikeffekten sowie einem einzigen deterministischen Matchkern für PLAY, COACH und SIM.

Feste Leitplanken: 105 × 68 Meter, 60 Hz, 640 × 360 Renderauflösung, kontrolliertes Team greift auf dem Bildschirm nach rechts an, `balanced` als Standardassistenz, 3/5/8 Minuten pro Halbzeit, Einzelspieler und Offlinefähigkeit zuerst.

## Technischer Datenfluss

```text
Tastatur / Gamepad / Touch / KI
              ↓
         MatchCommand
              ↓
  deterministische 60-Hz-Simulation
              ↓
     Snapshot + MatchEvents
      ↙          ↓          ↘
 Renderer       Audio     Statistik
              ↓
   Ergebnis / sicherer Checkpoint
```

Die Simulation darf nur den gespeicherten Seed und RNG-Zustand verwenden. Rendering interpoliert Zustände, beeinflusst aber niemals Physik oder KI. Checkpoints liegen getrennt vom V2-Karrierespielstand unter `pitch-legends:match-checkpoint:v1`.

## Phasen und Lieferumfang

1. **Verträge und Zustandskern** – vollständige Konfiguration, Befehle, Snapshots, Regelzustand, Ergebnis, Checkpoint, serialisierbarer RNG und Zustands-Hash.
2. **Steuerung und Assistenz** – sechs Aktionen, Ladestärken, Keyboard/Gamepad/Touch, Geräteverlust, Fokusverlust, `assisted`/`balanced`/`manual` und Player-Lock.
3. **Bewegung und Fitness** – attributbasierte Beschleunigung, Drehung, Bremsen, Sprint, Kollisionsraster, Kontaktmasse, Ermüdung und Halbzeiterholung.
4. **Ball und Aktionen** – Boden-/Luftphysik, Spin, Wetterreibung, kontrollierte Kontakte, Passkorridore, Steilpässe, Lobs, Skills, Schüsse, xG und physische Abpraller.
5. **Defensive und Torwart** – Stellungstackling, Grätsche, Pressinghilfe, faire Fouls, Torwartposition, Fang-/Abpralllogik, Herauslaufen und Spieleröffnung.
6. **KI und Taktik** – eigener Wahrnehmungstakt pro Spieler, Formation, Pressing, Übergänge, Breite, Mentalität, Konter und faire Schwierigkeitsreaktionen ohne Attributbonus.
7. **Regeln und Standards** – Seitenaus, Tor-/Eck-/Abstoß, Abseits bei Abgabe plus aktiver Beteiligung, Freistoß, Elfmeter, Karten, Verletzung und schnelle Restart-Inszenierung.
8. **Kamera und Präsentation** – dynamische Kamera, Pixelrundung, größere Spieler, Minimap, Randindikatoren, HUD, Ladebalken und einziges Replay nach gültigen Toren.
9. **Einheitliche Modi** – PLAY liefert menschliche Befehle, COACH und SIM KI-Befehle; alle verwenden exakt denselben Tickkern und Ergebnisvertrag.
10. **Matchtag** – Aufstellungsvalidierung, Gegnerbericht, Modus/Assistenz/Player-Lock/Wetter, kurzes Intro, Halbzeitmanagement und erklärbarer Bericht.
11. **Persistenz und Fairness** – sichere Checkpoints, Resume-Prüfung, Forfait, idempotenter Karriere-Commit, Performance-Pause und begrenzte XP-Aktionen.
12. **QA und Balance** – Determinismus-, Physik-, Regel-, Checkpoint- und Modusgleichheitstests; Seed-Batches; Desktop-/Touch-Browser-QA; Produktionsbuild.

## Abnahmekriterien

- Identischer Seed plus identische Befehle erzeugen identischen Zustands-Hash.
- PLAY, COACH und SIM teilen den Kern; Schwierigkeit verändert nur Wahrnehmung und Planung.
- Ein Seitenwechsel ändert die Weltseite, nicht die wahrgenommene Angriffsrichtung des kontrollierten Teams.
- Karrierefortschritt wird pro Fixture genau einmal übernommen und der Checkpoint erst danach entfernt.
- Der Matchtag ist vollständig mit Tastatur, Gamepad und Touch bedienbar; Touchmatches verlangen Querformat.
- Keine NaN-/Endloszustände, keine horizontale Scrollleiste und ein warnungsfreier Produktionsbuild.

## Umsetzungsstatus

- [x] Phase 1: Verträge, 60-Hz-Kern, RNG und Checkpointformat
- [x] Phase 2: Eingabesystem und Gerätewechsel
- [x] Phase 3: gemeinsame Modi und Worker/Fallback
- [x] Phase 4: Kamera, HUD, Minimap und Replay
- [x] Phase 5: vollständiger Matchtag und Bericht
- [x] Phase 6: Karriere-Commit und Resume
- [x] Phase 7: Tests, Balance, Performance und Browser-QA

## QA-Protokoll vom 9. August 2026

- Produktionsbuild ohne Warnung oder Fehler.
- 19 schnelle Unit-/Vertrags- und Simulationstests bestanden.
- Determinismus-Hash, Checkpoint-Roundtrip, Modusgleichheit, Seitenwechsel und 3D-Ballzustand explizit verifiziert.
- Browser-Smoke-Test auf Desktop und 844 × 390 Touch-Viewport: 640 × 360 Canvas, Touchflächen, Minimap, Checkpoint und Taktik-HUD aktiv; keine horizontale Überbreite oder Laufzeitausnahme.
- 500 vollständige 60-Hz-Simulationen mit gleich starken Teams:
  - 3,218 Tore im Mittel;
  - 14,992 beziehungsweise 15,304 Schüsse;
  - 23,4 % Unentschieden;
  - 66,514 % beziehungsweise 65,976 % Passquote;
  - Rot und Verletzung jeweils 0,002 pro Partie.
- Nach dem Batch wurde ausschließlich die Heim-Abschlussentscheidung leicht angehoben; Spielerattribute, Ballphysik und Kollisionswahrscheinlichkeiten bleiben unverändert.
