> Historisches Dokument. Der aktuelle verbindliche Plan ist [Pitch Legends 2.0](PITCH_LEGENDS_2_0_MASTERPLAN.md).

# Pitch Legends V2 – 32-Bit Arcade Football RPG

## Zusammenfassung

Pitch Legends besitzt bereits eine brauchbare Angular-Architektur und einen funktionierenden Manager-Prototyp. Für V2 wird das Spiel vollständig auf einen farbigen 32-Bit-Pixelstil umgestellt und um optionale, direkt steuerbare 11-gegen-11-Partien erweitert.

Vor dem Ausbau müssen zentrale Schwächen behoben werden:

- Bei Auswärtsspielen steuern Live-Taktik und Wechsel aktuell den Gegner.
- Zahlreiche Optionen – unter anderem Schwierigkeit, Sound, Jugendakademie, Passstil, Breite, Spieleranweisungen und Standards – haben keine oder kaum spielerische Wirkung.
- Training und kostenlose Erholung können innerhalb einer Woche unbegrenzt wiederholt werden.
- Transfermarkt, Verträge, Gehälter und Reputation bilden noch keinen nachhaltigen Karrierezyklus.
- Der Startscreen läuft auf kleinen Smartphone-Displays horizontal aus dem Viewport.
- Der bisherige Canvas-Match ist eine Ergebnisvisualisierung, kein tatsächlich gespieltes Fußballspiel.

## Umsetzung in Etappen

### 1. Stabilisierung und belastbarer Regelkern

- Die kontrollierte Mannschaft immer über `clubId` statt über Heim/Auswärts bestimmen.
- Line-ups vor jedem Match validieren und verletzte, gesperrte oder doppelt eingesetzte Spieler behandeln; KI-Clubs stellen wöchentlich neu auf.
- Alle bestehenden Taktiken an messbare Auswirkungen koppeln: Mentalität steuert Linienhöhe und Vorwärtsläufe, Pressing Zugriff und Ausdauer, Tempo die Entscheidungsfrequenz, Breite die Laufkorridore, Aufbau/Passstil die KI-Passwahl und Rollen/Anweisungen die Positionierung.
- Training auf drei belegbare Einheiten pro Spielwoche begrenzen; auch Regeneration verbraucht eine Einheit.
- Transfermarkt wochenweise deterministisch erzeugen und im Spielstand persistieren.
- Save-Import vollständig gegen das Schema validieren.
- Mobile Überläufe, fehlende Fokuszustände und unbeschriftete Icon-Buttons korrigieren.

### 2. Vollständiger 32-Bit-Pixelumbau

- Das Designsystem auf eine feste Arcade-Palette, 2-px-Pixelrahmen, harte Schatten, gekachelte Flächen und `steps()`-Animationen umstellen.
- Lokal gebündelte Pixel-/Monospace-Schriften für Überschriften, Daten und Fließtext verwenden.
- Emojis durch einen einheitlichen Pixel-Icon-Stil ersetzen.
- Spieler, Ball, Spielfeld, Tribünen, Wetter und Effekte als Pixel-Sprites bzw. Canvas-Primitives anlegen; Vereinsfarben werden zur Laufzeit angewendet.
- Canvas intern mit 640 x 360 Pixeln rendern und ganzzahlig mit `image-rendering: pixelated` skalieren.
- Sämtliche Feature-Seiten in dieselbe Designsprache überführen.
- Manageroberflächen für 390 px Portrait optimieren; direkte Matches verlangen auf Smartphones Querformat.
- Touchziele, Tastaturfokus, Kontrast und `prefers-reduced-motion` berücksichtigen.

### 3. Spielbarer 11-gegen-11-Matchday

- Renderer, deterministische Spiellogik und Eingabesystem voneinander trennen.
- Einen festen 60-Hz-Simulationsschritt mit Renderinterpolation verwenden.
- Vor jedem Ligaspiel drei Modi anbieten: selbst spielen, Coach-Modus oder sofort simulieren.
- Alle Modi verwenden dieselben Spielerwerte, Taktikmodifikatoren, Ereignis-, Statistik- und Belohnungsmodelle.
- Einstellbare Halbzeitlängen von 3, 5 oder 8 Minuten anbieten; Standard sind 3 Minuten.
- Bewegung, Sprint, Pass/Tackling, Steilpass, Schuss/Grätsche und Spielerwechsel über Tastatur, Gamepad und Touch unterstützen.
- Team-KI über Zustände wie Formation halten, unterstützen, freilaufen, pressen, decken, passen und abschließen aufbauen.
- Anstoß, Tore, Einwurf, Abstoß, Ecke, Fouls, Karten, Freistöße, Elfmeter, Abseits, Verletzungen, Wechsel, Halbzeit und Abpfiff abbilden.

### 4. Spieler- und Manager-RPG

- Spieler um Archetyp, Entwicklungsplan und datengetriebenen Talentbaum erweitern.
- Torhüter, Verteidiger, Mittelfeldspieler und Angreifer erhalten jeweils drei Entwicklungsrichtungen.
- Bestehende Traits in Talentknoten überführen, die Simulation und direktes Matchverhalten beeinflussen.
- Match-XP aus nachvollziehbaren Aktionen berechnen und gegen XP-Farming begrenzen.
- Training als Wochenplan mit Mannschaftseinheiten, individuellem Fokus und Regeneration gestalten.
- Form, Moral, Fitness, Verletzungen, Spielzeit und persönliche Ziele verknüpfen.
- Ein Managerprofil mit Level, XP und den Perkpfaden Coaching, Taktik, Scouting und Führung ergänzen.
- Schwierigkeit über Eingabehilfe, KI-Reaktion, Wirtschaft und Zielvorgaben statt versteckter Attributboni abbilden.

### 5. Karriere, Sprache und Abschluss

- Den Wochenzyklus Nachrichten/Ziele → Training → Kader/Taktik → Match → Bericht → Entwicklung/Finanzen etablieren.
- Gehälter abbuchen, Verträge verlängerbar machen und auslaufende Spieler behandeln.
- Reputation für Transfers, Nachwuchs und Vorstandserwartungen verwenden.
- Jugendakademie pro Saison echte Talente erzeugen lassen.
- Transfers um Filter, Scoutinginformationen, Vertragsdauer und Gehalt erweitern.
- Deutsch und Englisch zur Laufzeit umschaltbar machen; Ereignisse speichern Übersetzungsschlüssel plus Parameter.
- Retro-Musik und Soundeffekte über einen zentralen Audiomixer anbinden.
- Abschließend sämtliche Seiten, Balancewerte und den vollständigen Saisonzyklus prüfen.

## Wichtige Typ- und Schnittstellenänderungen

- `GameStateV2` erhält Managerprofil, Sprache, Matchdauer, Trainingsplan, Karriereziele, Transfermarkt und Entwicklungsdaten.
- `Player` erhält Archetyp, Talentknoten, Entwicklungsplan und persönliche Ziele.
- `MatchConfig` definiert Modus, Halbzeitdauer, kontrollierte Mannschaft, Schwierigkeit, Eingabegerät und Seed.
- `MatchSession` enthält Phase, Uhr, Ergebnis, Ball, 22 Akteure, Auswechslungen, Regeln, Ereignisse und Statistiken.
- `InputFrame` vereinheitlicht Tastatur-, Gamepad-, Touch- und KI-Befehle.
- `MatchEvent` und `NewsItem` verwenden `messageKey` und typisierte Parameter für Deutsch/Englisch.
- Der neue Spielstand nutzt `pitch-legends:save:v2`. V1-Spielstände werden nicht migriert oder überschrieben.

## Test- und Abnahmekriterien

- Unit-Tests für Ratings, Talentbäume, Traininglimits, Verträge, Finanzen, Taktikmodifikatoren und Save-Validierung.
- Identischer Match-Seed plus identische Eingabefolge erzeugt identische Ergebnisse.
- Heim- und Auswärtsspiele kontrollieren ausschließlich den eigenen Club.
- Tastatur, Gamepad und Touch behandeln Pause, Gerätewechsel und Querformat korrekt.
- E2E: Karriere → Training → Talent → Taktik → Match/Simulation → Bericht → Speichern/Laden.
- Deutsch/Englisch besitzen vollständige Schlüsselabdeckung.
- Visuelle Regression bei Desktop, Tablet, Mobile Portrait und Mobile Landscape.
- Zielwerte: 60 FPS Desktop, mindestens 30 FPS Mobilgerät, kein horizontales UI-Scrolling und erfolgreicher Produktionsbuild.

## Annahmen

- Angular 22, Signals, Canvas 2D und GitHub Pages bleiben bestehen; keine zusätzliche Game-Engine.
- V2 bleibt clientseitig, offlinefähig und auf Einzelspieler ausgelegt.
- Direkte Matches sind optional; Coach-Modus und Sofortsimulation bleiben verfügbar.
- Direkte Touchmatches laufen ausschließlich im Querformat.
- Pokale, Sponsoren, umfangreiche Mitarbeiterverwaltung, Online-Multiplayer und lizenzierte Inhalte bleiben außerhalb von V2.
