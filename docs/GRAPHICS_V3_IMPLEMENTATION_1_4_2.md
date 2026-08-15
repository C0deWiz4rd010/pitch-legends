# Grafiksystem V3 – Implementierung in Pitch Legends 1.4.2

## Gewählte Art Direction

Pitch Legends verwendet ab Version 1.4.2 einen Hybrid aus den drei Konzeptstudien:

- V3 bestimmt die steile Top-down-Kamera, die klare Matchsilhouette und die technische 48×48-Arbeitsfläche.
- V2 liefert die natürlicheren Körperproportionen und die kräftige 32-Bit-Farbwirkung.
- V1 bleibt die Referenz für nahe Profil- und Präsentationsansichten.

Die generierten Konzeptatlanten werden bewusst nicht direkt zerschnitten: Sie besitzen kein verlässliches Produktionsraster und ihr Schachbrett ist in die RGB-Pixel eingebrannt. Stattdessen wurde die bestehende Canvas-Pipeline nach dieser Art Direction erweitert. So bleiben sämtliche Figuren deterministisch, scharf, offlinefähig und vollständig über die vorhandenen Spieler- und Vereinsdaten steuerbar.

## Umgesetzte Spieleroptik

- 48×48 Pixel große quadratische Arbeitsfläche mit mehr Platz für Grätschen und Torwartaktionen.
- Acht Bewegungsrichtungen; fünf Grundansichten werden sauber gespiegelt.
- Richtungs-Hysterese verhindert Flackern an 45°-Grenzen.
- Getaperte Pixelpolygone ersetzen die bisher rechteckig wirkenden Arme und Beine.
- Top-down-Projektion komprimiert Körperhöhe abhängig von Front-, Diagonal- oder Seitenansicht.
- Köpfe besitzen abgeschnittene Ecken, unterschiedliche Kiefer und besser erkennbare Silhouetten.
- Trikotmuster werden Pixel für Pixel innerhalb der Torsoform gezeichnet und können nicht mehr über den Körper hinausragen.
- Rückennummern verwenden einen eigenen 3×5-Pixel-Ziffernsatz statt geglätteter Canvas-Schrift.
- Haut, Kopf, 18 Frisuren, Haarfarbe, Bart, Körperform, Schuhe, Tape, Accessoires und Torwarthandschuhe bleiben seed-basiert.
- Idle, Lauf, Sprint, Dribbling, Pässe, Schüsse, Tacklings, Verletzungen, Jubel und Torwartaktionen verwenden weiterhin eigene Animationsfolgen.

## Einheitliche Portraits

Portraits sind keine Ausschnitte des Top-down-Matchsprites mehr. `PlayerSpriteFactory.getPortrait()` baut eine eigene 48×48-Büste aus derselben `PlayerVisualIdentity` und demselben aktuellen Vereinstrikot:

```text
PlayerVisualIdentity
 ├─ Matchsprite
 ├─ Ganzkörper-Paper-Doll
 └─ Profilportrait
```

Damit bleiben Haut, Kopfform, Haare, Haarfarbe, Bart, Accessoire und Clubfarben überall dieselben. Ein Transfer invalidiert lediglich den Kit-Cache; die Person verändert sich nicht.

## Dynamische Trikots

`createPixelRamp()` erzeugt aus jeder beliebigen Hexfarbe vier feste Pixelstufen:

```text
Kontur → Schatten → Grundfarbe → Highlight
```

Das vorhandene `KitDesign` steuert weiterhin:

- Haupt- und Zweitfarbe;
- Trim, Hose, Stutzen und Nummer;
- Kragen und Ärmel;
- Solid, Hälften, Streifen, Hoops, Sash, Brustband, Pinstripes und Chevron.

`resolveMatchKits()` bewertet vor dem Match Shirt-, Hosen- und Stutzenkontrast, Farbabstand und Musterunterschied. Bei einem Konflikt wird deterministisch das besser lesbare Auswärtstrikot gewählt. Reicht auch dieses nicht aus, erzeugt das Spiel ein klar kontrastierendes fiktives Notfalltrikot. Torhüter werden separat gegen beide Feldmannschaften geprüft.

## Matchpräsentation

- klarere deterministische Rasenabnutzung und Mähmuster;
- kompaktere, mehrstufige Bodenschatten;
- neuer dreistufiger Auswahlpfeil über dem kontrollierten Spieler;
- plastischere Torpfosten, Netzrippen, Bodenschatten und Netzanker;
- weiterhin deterministische Abnutzung, Mähmuster, Fahnen, Zuschauer und Werbebanden.

## Performancekonzept

Nur ein garantierter Idle-Fallback pro Spieler wird synchron vorbereitet. Noch nicht verwendete Richtungen und Aktionsframes werden während freier Browserzeit zusammengesetzt.

```text
Cache-Treffer → Frame sofort zeichnen
Cache-Fehler → letzten gültigen Spielerframe zeichnen
             → neue Pose für Idle-Zeit vormerken
             → anschließend im LRU-Cache wiederverwenden
```

- maximal 736 Frames beziehungsweise unter 7 MB Rohpixeldaten;
- `ImageBitmap` über `OffscreenCanvas`, normales Canvas als Fallback;
- höchstens 128 offene Kompositionsaufträge;
- maximal ein neuer Frame je ausreichend großer Idle-Phase;
- keine Spritekomposition im kritischen Match-Renderpfad;
- Simulationshash und Match-RNG bleiben vollständig unangetastet.

## Neue Kern-APIs

- `createPixelRamp(colour)` – erstellt eine sichere Vierfarbrampe.
- `kitSeparationScore(a, b)` – bewertet die visuelle Trennung zweier Kits.
- `resolveMatchKits(home, away)` – liefert Feld- und Torwarttrikots für eine Begegnung.
- `kitVisualSignature(kit)` – vollständiger Cache-Schlüssel eines Designs.
- `quantizeDirection(x, y, previous)` – acht Richtungen mit Hysterese.
- `PlayerSpriteFactory.getPortrait()` – gemeinsame Identitätsquelle für Profile.
- `PlayerSpriteFactory.beginFrame()` – schützt das Live-Rendering vor synchronen Cache-Misses.

## Qualitätssicherung

- deterministische Unit-Tests für Farbrampen, Kitwahl, Signaturen und acht Richtungen;
- vollständige Action-/Fallback-Abdeckung;
- E2E-Test für reale Bewegung ohne Canvasfehler;
- Match-Performance-Test mit Sprint, Pässen, Schuss, Pause und AUTO-Wechsel;
- Produktionsbuild und Versionssynchronisierung;
- bestehende Spielstände bleiben kompatibel, da keine neuen Savefelder notwendig sind.
