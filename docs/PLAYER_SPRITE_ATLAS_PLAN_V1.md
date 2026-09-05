> Historisches Dokument. Der aktuelle verbindliche Plan ist [Pitch Legends 2.0](PITCH_LEGENDS_2_0_MASTERPLAN.md).

# Player Sprite Atlas V1 – Art-Bible und Integrationsplan

## 1. Ziel

Aus einem deterministischen, modularen Pixel-Atlas sollen komplette Mannschaften erzeugt werden können. Spieler müssen sich im Portrait, Profil, Kader, Taktikbild und Match eindeutig wiedererkennen lassen. Vereine liefern Trikotfarben und Muster; Spieler liefern Körper, Gesicht, Haare, Accessoires und Schuhe.

Der erste generierte Entwurf liegt unter:

- `docs/assets/player-sprite-atlas-concept-v1.png`
- 1536 × 1024 Pixel, 32-Bit-ARGB, circa 2,97 MB
- transparente beziehungsweise nahezu transparente Außenflächen

Der Entwurf ist zunächst eine Art-Bible. Er wird nicht ungeprüft in einzelne Frames zerschnitten, weil ein generiertes Konzeptbild keine garantierten Zellgrößen, Ankerpunkte oder identischen Silhouetten besitzt.

## 2. Bewertung des ersten Entwurfs

### Bereits stark

- deutlich natürlichere, sportliche Proportionen als der alte Rechteck-Look;
- gut lesbare Ein-Pixel-Konturen und kräftige 32-Bit-Farbgebung;
- zahlreiche Lauf-, Dribbling-, Schuss-, Grätsch-, Jubel- und Torwartideen;
- breite Auswahl an Hauttönen, Kopfformen, Frisuren und Bartformen;
- umfangreiche Trikot-, Hosen-, Stutzen- und Schuhbibliothek;
- klare Trennung zwischen Feldspieler und Torwart;
- auch bei kleiner Darstellung erkennbare Silhouetten.

### Vor einer Runtime-Nutzung zu normalisieren

- alle Figuren müssen auf ein exaktes 40 × 48-Pixel-Raster übertragen werden;
- Fußbaseline, Hüfte, Kopfzentrum und Ballkontakt müssen in jedem Frame identisch verankert sein;
- einzelne Aktionsfolgen besitzen aktuell unterschiedliche Frameanzahlen;
- Ballgröße und Ballabstand müssen vereinheitlicht werden;
- acht Richtungen müssen je Aktion vollständig und eindeutig sortiert sein;
- Hintergrundpixel werden vollständig auf Alpha 0 bereinigt;
- Farbverläufe werden in harte, kleine Pixelpaletten übersetzt;
- Identitätsdrift zwischen einzelnen generierten Figuren wird durch einen gemeinsamen Basiskörper beseitigt.

## 3. Feste Art-Direction

Empfohlener Produktionsstandard:

| Eigenschaft | Festlegung |
|---|---|
| Logische Framegröße | 40 × 48 Pixel |
| Richtungen | N, NE, E, SE, S, SW, W, NW |
| Perspektive | leicht erhöhte Top-down-/Dreiviertelansicht |
| Kontur | ein Pixel, dunkles Mitternachtsblau statt reines Schwarz |
| Schattierung | Kontur, Schatten, Grundfarbe, Highlight |
| Raster | ausschließlich ganze Pixel, kein Antialiasing |
| Pivot | Mitte zwischen den Füßen auf `x=20`, `y=43` |
| Kopfanker | `x=20`, ungefähr `y=10` |
| Ballkontakt | pro Animationsframe im Manifest gespeichert |
| Physik | bleibt vollständig unabhängig von der Grafik |

Acht Richtungen sind für die aktuelle 640×360-Kamera der beste Kompromiss. 16 Richtungen würden Speicher und Produktionsaufwand nahezu verdoppeln, ohne bei 40×48 Pixeln einen entsprechend großen Lesbarkeitsgewinn zu liefern. Flüssigkeit entsteht primär durch gute Zwischenframes, distanzbasierte Laufphasen und korrekte diagonale Posen.

## 4. Atlas-Aufteilung

Der große Konzeptbogen bleibt als Übersicht erhalten. Für das Spiel werden kleinere, klar versionierte Runtime-Atlanten verwendet.

```text
assets/player-atlas/v1/
├── body-locomotion.png
├── body-actions.png
├── goalkeeper-actions.png
├── heads.png
├── hair-back.png
├── hair-front.png
├── facial-hair.png
├── kit-base.png
├── kit-pattern-masks.png
├── arms-and-sleeves.png
├── shorts-socks.png
├── boots-accessories.png
├── shadows-markers.png
└── atlas.manifest.json
```

Trikotmuster werden als einfarbige Masken gespeichert. Vereinsfarben werden erst beim Komponieren eingesetzt. Dadurch benötigt ein Streifentrikot nicht für jeden Club eine neue Bilddatei.

## 5. Animationsvertrag

Jede im Match verwendete Aktion erhält eine explizite Sequenz und Kontaktmarker.

| Gruppe | Animation | Frames je Richtung | Loop |
|---|---|---:|---|
| Basis | Idle | 4 | ja |
| Bewegung | Joggen | 8 | ja |
| Bewegung | Sprint | 8 | ja |
| Ball | normale Ballführung | 8 | ja |
| Ball | enge Führung | 6 | ja |
| Ball | Sprintdribbling | 8 | ja |
| Ball | Annahme | 5 | nein |
| Ball | schlechter Kontakt | 5 | nein |
| Skills | Ballrolle / Drag Back | je 6 | nein |
| Pass | Kurzpass / Steilpass | je 6 | nein |
| Pass | Lob / Flanke | je 6 | nein |
| Schuss | normal / flach / Finesse / Chip | je 6 | nein |
| Luft | Kopfball | 5 | nein |
| Defensive | Stellungstackling | 6 | nein |
| Defensive | Grätsche | 7 | nein |
| Reaktion | Stolpern / Foul / Verletzung | 5–6 | nein |
| Jubel | vier Persönlichkeitsvarianten | je 8 | nein |
| Torwart | Grundstellung | 4 | ja |
| Torwart | Laufen / Herauslaufen | 8 | ja |
| Torwart | Fangen / Abklatschen | je 6 | nein |
| Torwart | Hechten | 8 | nein |
| Torwart | Abwurf / Abschlag | je 6 | nein |

Das Manifest speichert zusätzlich Ereignisse wie `plantFoot`, `ballContact`, `release`, `impact` und `recover`. Audio, Partikel und Ballkontakt können damit exakt auf dem richtigen Frame ausgelöst werden.

## 6. Layer-System

Empfohlene Reihenfolge pro Frame:

1. Bodenschatten;
2. hinteres Haar oder Accessoire;
3. hinteres Bein und hinterer Arm;
4. Körper und Haut;
5. Hose und Stutzen;
6. Trikotgrundfarbe;
7. Trikotmustermaske, Kragen, Bündchen und Nummer;
8. vorderes Bein und vorderer Arm;
9. Schuhe und Handschuhe;
10. Kopf, Gesicht, Bart und vorderes Haar;
11. Tape, Kapitänsbinde und Schutzkappe;
12. Auswahlmarker, Karte und Player-Lock-Symbol.

Die Reihenfolge wird je Blickrichtung leicht angepasst. So verschwindet beispielsweise der hintere Arm korrekt hinter dem Torso.

## 7. Prozedurale Spielerrezepte

```ts
interface PlayerSpriteRecipe {
  version: 1;
  seed: number;
  bodyBuild: 'slim' | 'average' | 'strong';
  skinPalette: number;
  headShape: number;
  hairBack: number;
  hairFront: number;
  hairPalette: number;
  facialHair: number;
  bootStyle: number;
  bootPalette: number;
  longSleeves: boolean;
  wristTape: 'none' | 'left' | 'right' | 'both';
  headAccessory: 'none' | 'headband' | 'protective-cap';
  goalkeeperGloves: number;
}
```

```ts
interface SpriteAtlasManifest {
  version: 1;
  cell: { width: 40; height: 48 };
  directions: readonly ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  animations: Record<PlayerActionState, AnimationDefinition>;
  anchors: Record<string, { x: number; y: number }>;
  palettes: PaletteDefinition[];
}
```

`PlayerVisualIdentity.seed` bleibt die einzige Quelle der Spielerauswahl. `ClubVisualIdentity` liefert Trikotmuster und Vereinsfarben. Nationalität beeinflusst das Aussehen weiterhin nicht.

## 8. Generierungsablauf

```text
gespeicherter Player-Seed
        ↓
PlayerSpriteRecipe
        ↓
Kader-Duplikatprüfung
        ↓
Körper + Kopf + Haare + Zubehör
        ↓
Club-Kit + Muster + Nummer
        ↓
Animationsframe + Richtung
        ↓
OffscreenCanvas / ImageBitmap
        ↓
PixelAssetCache → Matchrenderer / Profil / Taktik
```

- Gleicher Seed und gleiches Trikot ergeben immer dasselbe Pixelbild.
- Im Kader wird eine vollständige Erscheinungssignatur nicht doppelt vergeben.
- Seltene Aktionen werden erst bei Bedarf komponiert.
- Idle, Joggen, Sprint und Ballführung werden beim Matchstart vorbereitet.
- Ein Cache-Key enthält Rezept-Hash, Kit-Hash, Aktion, Richtung und Frame.
- Grafikauswahl verwendet niemals den Match-RNG.

## 9. Performancekonzept

Ein 40×48-RGBA-Frame benötigt roh 7.680 Byte. Rund 600 gleichzeitig zwischengespeicherte Frames liegen bei ungefähr 4,4 MB. Der bestehende LRU-Cache kann daher weiterhin unter dem gesetzten Matchbudget bleiben.

- Komposition bevorzugt `OffscreenCanvas` und `ImageBitmap`;
- normales Canvas bleibt Fallback;
- wiederkehrende Kit-Farben werden über kleine Palette-Lookups eingesetzt;
- Portrait und Ganzkörpervorschau teilen dasselbe Rezept;
- Replays verwenden exakt die gleichen Aktions-, Richtungs- und Frameindizes;
- keine Bildkomposition während eines kritischen Physikticks.

## 10. Produktionswerkzeug „Sprite Lab“

Eine interne Entwicklungsansicht soll enthalten:

- Seed-Eingabe und Zufallsbutton;
- Club-, Heim-, Auswärts- und Torwarttrikot;
- Richtungsschalter mit allen acht Richtungen;
- Animation, FPS und Einzelbildsteuerung;
- Zoom 1×, 2×, 4× und 8× ohne Glättung;
- transparente, helle, dunkle und Rasen-Hintergründe;
- Anzeige aller Ankerpunkte und der Fußbaseline;
- Kaderwand mit 25 generierten Spielern zur Duplikatkontrolle;
- Export eines Rezepts und einer Golden-Test-PNG.

## 11. QA und automatische Prüfungen

- jede Bildgröße ist ein exaktes Vielfaches von 40×48;
- Alpha ist ausschließlich 0 oder 255;
- keine Farbe außerhalb der erlaubten Paletten;
- Füße weichen höchstens einen Pixel von der Baseline ab;
- Ballkontaktmarker befinden sich innerhalb der Framegrenzen;
- jede Aktion besitzt alle acht Richtungen oder einen ausdrücklich definierten Fallback;
- dieselbe Identität bleibt über Portrait, Profil und Match gleich;
- Golden-Hashes für Basiskörper, Frisuren, Trikotmuster und Torwart;
- keine Cacheüberschreitung und keine sichtbaren Nachladeruckler;
- Testwand bei 640×360, 844×390 und verschiedenen Rasenpaletten.

## 12. Empfohlene Umsetzungsschritte

1. Stilentscheidung anhand des Konzeptbogens treffen.
2. Einen neutralen 40×48-Basisspieler mit exaktem Pivot pixelgenau neu zeichnen.
3. Idle und Joggen in acht Richtungen fertigstellen und im Match testen.
4. Körper-, Haut-, Kopf- und Haarlayer auf denselben Ankern aufbauen.
5. Trikotgrundformen und monochrome Mustermasken erstellen.
6. Sprint, Dribbling, Pässe und Schüsse ergänzen.
7. Defensive, Reaktionen, Jubel und Torwart ergänzen.
8. Manifest, Composer, Cache und Sprite Lab implementieren.
9. Alle Profil- und Kaderansichten auf dasselbe Rezept umstellen.
10. Golden-, Performance- und Mobile-QA abschließen.

## 13. Entscheidungen für die nächste Runde

Empfehlung als Ausgangspunkt:

- Proportionen: sportlich-kompakt wie im Konzept, nicht stärker verniedlichen;
- Framegröße: 40×48 beibehalten;
- Richtungen: echte acht Richtungen;
- Shading: vier Farbstufen plus Kontur;
- Kontur: dunkles Navy;
- Trikotdetails: Muster, Kragen, Ärmel, Nummer, Stutzenband und Schuhe sichtbar;
- Spieleridentität: breites Spektrum, aber keine zufälligen Fantasieaccessoires;
- Runtime: Layer einmalig zu Frames vorbacken, nicht jeden Renderframe neu zeichnen.

Vor der eigentlichen Atlas-Produktion sollten wir gemeinsam genau drei Dinge festlegen: Silhouette/Proportion, gewünschte Pixeldichte und ob der aktuelle detailreiche Farblook oder eine etwas härtere klassische 16-Bit-Palette bevorzugt wird.
