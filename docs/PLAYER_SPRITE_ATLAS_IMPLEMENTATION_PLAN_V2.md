# Top-down Player Sprite System V2 – detaillierter Nutzungs- und Implementierungsplan

## 1. Zielbild

Der neue Matchspieler wird nicht als fertige grüne oder lilafarbene Figur gespeichert. Er entsteht aus drei voneinander unabhängigen Identitäten:

```text
Spieleridentität          Vereinsidentität          Animationszustand
Körper, Haut, Haare       Farben, Muster, Nummer     Aktion, Richtung, Frame
          \                     |                     /
           \                    |                    /
             → deterministischer Sprite Composer ←
                              ↓
                    fertiger 40×48-Matchframe
```

Damit können dieselben Körper- und Animationsdaten für jeden Spieler, jeden Verein, Heim-, Auswärts- und Torwarttrikots verwendet werden.

## 2. Vergleich der beiden Konzeptbögen

| Thema | V1 – Dreiviertel | V2 – Top-down |
|---|---|---|
| Gesicht und Persönlichkeit | stärker sichtbar | im Match kleiner |
| Übereinstimmung mit Spielfeldkamera | mittel | sehr hoch |
| Leserichtung bei Diagonalen | gut | sehr gut |
| Körperkontakt und Ballabstand | seitlich plastischer | räumlich klarer |
| Profil-/Kaderansicht | sehr geeignet | weniger präsentativ |
| Matchdarstellung | charmant, aber perspektivisch flacher | empfohlen |

Empfehlung: V2 wird die Perspektive für Match und Replay. V1 bleibt Referenz für Ganzkörperansichten in Spielerprofil, Umkleidekabine und Transferakte. Beide Darstellungen beziehen ihre Haut-, Haar-, Körper-, Schuh- und Trikotwerte aus derselben `PlayerVisualIdentity`, sodass die Person trotzdem eindeutig gleich bleibt.

Die V2-Konzeptdatei besitzt aktuell ein sichtbares, eingebranntes Schachbrett. Sie ist deshalb ebenfalls eine Art-Bible und kein Runtime-PNG. Die Produktionsatlanten erhalten überprüftes Alpha 0/255.

## 3. Die Lösung für beliebige Trikotfarben

### Grundsatz

Grün und Lila aus V1 waren nur Demonstrationsfarben. In den Produktionssprites wird keine Vereinsfarbe fest eingebrannt. Der Zeichner erstellt neutrale Material-, Regions- und Mustermasken. Der Composer setzt erst beim Matchstart die Farben aus dem vorhandenen `KitDesign` ein.

Das bestehende Datenmodell besitzt bereits alle notwendigen semantischen Farben:

```ts
interface KitDesign {
  pattern: KitPattern;
  shirt: string;      // Primärfarbe
  secondary: string;  // Musterfarbe
  trim: string;       // Kragen, Bündchen, kleine Details
  shorts: string;
  socks: string;
  number: string;
  collar: 'crew' | 'v' | 'polo';
  sleeve: 'plain' | 'cuff' | 'raglan';
}
```

### Drei technische Quellbilder

Für jeden Trikotframe werden drei kleine, deckungsgleiche Raster verwendet:

1. `kit-material.png`
   - enthält Kontur und vier neutrale Helligkeitsstufen;
   - definiert Falten, Schatten und Highlights;
   - enthält keine Vereinsfarbe.
2. `kit-regions.png`
   - jeder Pixel ist ein semantischer Index;
   - `0` transparent, `1` Primärfarbe, `2` Sekundärfarbe, `3` Trim, `4` Hose, `5` Stutzen, `6` Nummer;
   - wird nicht direkt angezeigt.
3. `kit-patterns.png`
   - binäre Alpha-Masken für Streifen, Hälften, Hoops, Sash, Brustband, Pinstripes und Chevron;
   - Muster können je Richtung angepasst werden, ohne den Körper neu zu zeichnen.

### Vierstufige Farbrampen

Aus jedem Hexwert wird deterministisch eine Pixelrampe gebaut:

```ts
interface PixelRamp {
  outline: string;
  shadow: string;
  base: string;
  highlight: string;
}

function kitRamp(base: string): PixelRamp {
  return {
    outline: '#080f20',
    shadow: mixHex(base, '#07120b', 0.38),
    base,
    highlight: mixHex(base, '#f4f4df', 0.26),
  };
}
```

Die Produktion verwendet ganzzahlige sRGB-Mischung. Dadurch erzeugt derselbe Hexwert in Browser, Worker, Replay und Tests immer dieselben Bytes.

### Komposition eines Pixels

```text
Region 1 + Shade 0 → Primärfarbe.outline
Region 1 + Shade 1 → Primärfarbe.shadow
Region 1 + Shade 2 → Primärfarbe.base
Region 1 + Shade 3 → Primärfarbe.highlight

Region 2 + Shade 2 → Sekundärfarbe.base
Region 4 + Shade 1 → Hosenfarbe.shadow
Region 6           → gespeicherte Nummernfarbe
```

Ein einziges neutrales Trikot kann damit Rot/Weiß, Blau/Gold, Schwarz/Gelb, Türkis/Orange oder jede andere gespeicherte Vereinsidentität annehmen.

### Muster

Der vorhandene `KitPattern`-Typ bleibt maßgeblich:

- `solid`: nur Primärregion;
- `halves`: linke/rechte Torsohälfte mit Primär/Sekundär;
- `stripes`: zwei Pixel breite vertikale Streifen;
- `hoops`: horizontale Zweipixelbänder;
- `sash`: diagonale, körperangepasste Sekundärmaske;
- `chest-band`: breites Band auf Brusthöhe;
- `pinstripes`: Einpixelstreifen mit Abstand;
- `chevron`: V-Maske aus klaren Pixeltreppen.

Die Mustermaske wird vor Kragen, Ärmelbündchen und Nummer angewendet. So bleiben Trim und Nummer stets lesbar.

### Nummern

Ziffern werden nicht aus dem generierten Konzept übernommen. Ein eigener 3×5- beziehungsweise 4×5-Pixel-Ziffernatlas enthält `0–9`.

- Rückenansichten zeigen die vollständige Nummer;
- Diagonalansichten zeigen eine verkürzte, perspektivische Variante;
- Frontalansichten können eine kleine Brustnummer erhalten;
- `kit.number` wird gegen Primär- und Sekundärfläche geprüft;
- falls der Kontrast nicht reicht, erhält die Nummer eine Einpixelkontur.

## 4. Trikotkonflikte und Farbenblindheit

Vor jedem Match wird für Heim-, Auswärts- und Torwarttrikot eine Signatur berechnet:

```ts
interface KitReadability {
  primaryDistance: number;
  secondaryDistance: number;
  luminanceDistance: number;
  patternDistance: number;
  outlineContrast: number;
  score: number;
}
```

Prüfreihenfolge:

1. Heimtrikot des Heimteams wählen.
2. Heimtrikot des Auswärtsteams testen.
3. Bei zu geringer Farb- oder Helligkeitsdistanz das Auswärtstrikot verwenden.
4. Bleibt der Konflikt bestehen, deterministisch Primär/Sekundär tauschen.
5. Als letzter Fallback eine helle oder dunkle neutrale Kontrastvariante erzeugen.
6. Beide Torwarttrikots müssen sich zusätzlich von beiden Feldteams und voneinander unterscheiden.

Farben allein reichen nicht. Zwei ähnlich helle Teams benötigen unterschiedliche Muster und Hosen-/Stutzenblöcke. Tests simulieren Protanopie, Deuteranopie und Graustufen. Ziel: Auch ohne Farbwahrnehmung bleiben Silhouette und Muster unterscheidbar.

## 5. Atlasstruktur

```text
public/assets/player-atlas/v2/
├── atlas.manifest.json
├── base/
│   ├── locomotion-material.png
│   ├── actions-material.png
│   ├── goalkeeper-material.png
│   └── shadows.png
├── body/
│   ├── skin-material.png
│   ├── body-builds.png
│   ├── heads.png
│   └── facial-features.png
├── hair/
│   ├── hair-back.png
│   ├── hair-front.png
│   └── facial-hair.png
├── kit/
│   ├── kit-material.png
│   ├── kit-regions.png
│   ├── patterns.png
│   ├── collars-sleeves.png
│   ├── shorts-socks.png
│   └── digits.png
├── equipment/
│   ├── boots.png
│   ├── gloves.png
│   └── accessories.png
└── qa/
    ├── anchor-overlay.png
    └── palette-reference.png
```

Der große 1536×1024-Konzeptbogen wird nicht als Runtime-Textur geladen. Kleine Atlanten reduzieren Speicher, vereinfachen Lazy Loading und erlauben einzelne Versionen auszutauschen.

## 6. Manifest und feste Anker

```ts
type SpriteDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface AtlasFrameDefinition {
  x: number;
  y: number;
  width: 40;
  height: 48;
  pivot: { x: 20; y: 43 };
  headAnchor: { x: number; y: number };
  ballAnchor?: { x: number; y: number };
  contact?: 'left-foot' | 'right-foot' | 'head' | 'hands';
  events?: readonly AnimationEventMarker[];
}

interface AtlasAnimationDefinition {
  fps: number;
  loop: boolean;
  distanceDriven: boolean;
  directions: Record<SpriteDirection, AtlasFrameDefinition[]>;
}
```

Alle Ebenen verwenden dieselben Pivots. Der Composer lehnt einen Layer ab, dessen Abmessungen oder Anker nicht zum Manifest passen.

## 7. Acht Richtungen und flüssige Bewegung

Die vorhandene Quantisierung auf acht Richtungen bleibt bestehen, erhält aber Hysterese:

- eine Richtung wird erst gewechselt, wenn der Blickwinkel die Sektorgrenze um weitere fünf Grad überschreitet;
- unter sehr geringer Geschwindigkeit bleibt die letzte Blickrichtung erhalten;
- bei Pass, Schuss, Tackling und Parade wird die Richtung für die Aktionsdauer fixiert;
- danach darf die neue Bewegungsrichtung übernommen werden.

So flackert ein Spieler bei minimalen diagonalen Stickbewegungen nicht zwischen Ost und Nordost.

Animationsgeschwindigkeiten:

| Animation | Darstellung |
|---|---|
| Idle | 4–5 FPS |
| Joggen | distanzgetrieben, effektiv 9–12 FPS |
| Sprint | distanzgetrieben, effektiv 12–15 FPS |
| Ballführung | distanzgetrieben plus Ballkontaktmarker |
| Pass/Schuss | zeitgetrieben, 12–16 FPS |
| Stolpern/Verletzung | zeitgetrieben, 8–12 FPS |
| Jubel | zeitgetrieben, 8–10 FPS |

Die Simulationsphysik bewegt weiterhin den Spieler. Der Sprite visualisiert nur den Zustand und darf niemals Geschwindigkeit oder Ballflug beeinflussen.

## 8. Nutzung der vorhandenen Spielerdaten

`PlayerVisualIdentity` kann ohne Savebruch weiterverwendet werden:

```text
skinTone          → Hautfarbrampe
headShape         → Kopfmaske
hairStyle         → Vorder-/Hinterhaar
hairColor         → Haarfarbrampe
facialHair        → Bartlayer
bodyBuild         → schlank / normal / kräftig
bootStyle         → Schuhsilhouette
bootColor         → Schuhfarbrampe
longSleeves       → Ärmelvariante
wristTape         → Tapelayer
headAccessory     → Stirnband / Schutzkappe
goalkeeperGloves  → Handschuhform und Palette
```

Neue Felder werden zunächst nicht benötigt. Sollte später Links-/Rechtsfuß grafisch sichtbar werden, kann `dominantFoot` aus dem vorhandenen Spielerattribut gelesen werden und muss nicht in `visuals` dupliziert werden.

## 9. Runtime-Komponenten

### `SpriteAtlasLoader`

- lädt Manifest und kleine PNG-Atlanten lazy;
- validiert Version, Abmessungen und Prüfsummen;
- bietet normales Canvas als Fallback.

### `PlayerAppearanceResolver`

- übersetzt `PlayerVisualIdentity` in konkrete Layerindizes;
- verhindert ungültige Kombinationen;
- erzeugt einen stabilen Appearance-Hash.

### `KitPaletteComposer`

- erzeugt Farbrampen aus `KitDesign`;
- setzt Regions- und Mustermasken um;
- prüft Nummern- und Konturkontrast;
- erzeugt Kit-Hash und Konfliktsignatur.

### `PlayerFrameComposer`

- zeichnet die Layer in richtungsabhängiger Reihenfolge;
- übernimmt exakt die Anker des Manifests;
- produziert `ImageBitmap` oder Canvas;
- kennt keine Matchlogik und keinen Match-RNG.

### `PlayerSpriteFactory`

Die bestehende Factory bleibt öffentlicher Einstiegspunkt. Intern delegiert sie schrittweise an den neuen Composer. Bis alle Aktionen fertig sind, fällt eine fehlende Atlasanimation auf den aktuellen Gelenkrenderer zurück.

## 10. Cache und Prewarming

Cache-Key:

```text
atlasVersion | appearanceHash | kitHash | action | direction | frame | goalkeeper
```

- Idle, Joggen, Sprint und Ballführung der 22 Starter werden vorbereitet;
- Bankspieler erhalten Idle beim Matchstart und weitere Frames bei der Einwechslung;
- seltene Aktionen entstehen lazy;
- Zugriff erneuert die LRU-Position;
- ausgewechselte Spieler werden nach einer Schonfrist freigegeben;
- `ImageBitmap.close()` wird beim Entfernen aufgerufen;
- Ziel bleibt maximal 896 Frames und ungefähr 6,9 MB Rohpixeldaten.

Weil alle Spieler eines Teams dasselbe Kit verwenden, werden Farbrampen und Mustermasken einmal pro Kit erzeugt und wiederverwendet.

## 11. Prozedurale Mannschaften und Vereine

### Spieler

1. stabilen Seed aus Spieler-ID laden;
2. Körperbau, Haut, Kopf, Haare, Bart, Schuhe und Zubehör auflösen;
3. vollständige Erscheinungssignatur bilden;
4. bei Kaderduplikat deterministisch mit Salt neu auflösen;
5. Rezept speichern beziehungsweise aus vorhandenen V4-Visuals rekonstruieren.

### Verein

1. gespeicherte Clubfarben laden;
2. Heimtrikot aus Primär-/Sekundärfarbe bauen;
3. Auswärtstrikot mit Kontrastalgorithmus erzeugen;
4. Torwartpalette gegen beide Feldtrikots prüfen;
5. Muster, Kragen, Ärmel, Hose, Stutzen und Nummer persistieren;
6. für UI und Match denselben `KitDesign` verwenden.

### Vollständiges Team

Beim Matchstart werden nicht 22 individuelle Trikotbilder gespeichert. Der Composer kombiniert 22 Appearance-Rezepte mit nur zwei Feldtrikot- und zwei Torwartrezepten. Dadurch bleiben Speicher- und Ladeaufwand niedrig.

## 12. Einheitlichkeit in allen Ansichten

| Ansicht | Darstellung | Datenquelle |
|---|---|---|
| Match | V2 Top-down, animiert | Appearance + Kit + RuntimeState |
| Replay | identischer V2-Frame | gespeicherter Tick/Action/Direction |
| Taktikfeld | V2 Idle, klein | Appearance + aktuelles Kit |
| Kaderliste | Kopf-/Brustausschnitt | dieselben Kopf-/Haarlayer |
| Spielerprofil | V1-artige Ganzkörperpose | dasselbe Appearance-Rezept |
| Transfermarkt | Portrait plus Mini-V2 | dasselbe Appearance-Rezept |
| Matchbericht | Portrait und Trikot | dasselbe Appearance-Rezept |

Es gibt damit keine unabhängig gewürfelten Portraits mehr. Jede Oberfläche fragt dasselbe Rezept ab und wählt nur eine andere Kameradarstellung.

## 13. Internes „Sprite Lab“

Eine nur im Entwicklungsmodus verfügbare Route zeigt:

- V1 und V2 nebeneinander;
- alle acht Richtungen;
- Animation abspielen, pausieren und frameweise prüfen;
- Seed, Spieler, Verein und Heim/Auswärts/Torwart auswählen;
- Primär-, Sekundär-, Trim-, Hosen-, Stutzen- und Nummernfarbe live ändern;
- Muster, Kragen und Ärmel live wechseln;
- hellen, dunklen, transparenten und Rasenhintergrund;
- Pivot, Kopf-, Fuß- und Ballanker;
- Cache-Key, Framezahl und Speicherverbrauch;
- 25-Spieler-Kaderwand zur Duplikatkontrolle;
- Farbenblindheits- und Graustufenvorschau.

## 14. Produktionsphasen

### Phase A – Art Lock

- V2-Top-down-Perspektive und 40×48-Raster bestätigen;
- einen neutralen Idle-Frame in acht Richtungen pixelgenau erstellen;
- Pivot, Kontur und vierstufige Paletten festschreiben.

### Phase B – Locomotion Vertical Slice

- Idle, Joggen, Sprint und Ballführung;
- acht Richtungen, distanzbasierte Phase und Hysterese;
- Integration in ein echtes 844×390-Touchmatch;
- vorhandener Renderer bleibt Fallback.

### Phase C – Appearance Layers

- Körperformen, acht Hautrampen, Köpfe, Haare, Bart, Schuhe und Zubehör;
- 25-Spieler-Testwand;
- Portrait-/Match-Identitätsprüfung.

### Phase D – Kit Composer

- Material-, Regions- und Mustermasken;
- alle vorhandenen `KitPattern`-Varianten;
- Nummernatlas, Keeperkits und Konfliktprüfung;
- UI-Minikit und Matchsprite verwenden dieselben Farben.

### Phase E – Aktionen

- Annahme, Skills, Pässe, Flanken und Schüsse;
- Tacklings, Stolpern, Verletzung und Jubel;
- Torwartaktionen;
- Ballkontakt- und Audioevents aus Manifestmarkern.

### Phase F – Vollständige Migration

- Taktik, Kader, Profil, Transfermarkt und Matchbericht angleichen;
- Sprite Lab und Golden-Tests;
- alten Gelenkrenderer erst nach vollständiger QA entfernen.

## 15. Tests und Abnahmekriterien

### Grafikdaten

- alle Runtime-PNGs besitzen echtes Alpha mit ausschließlich 0 oder 255;
- jede Zelle ist exakt 40×48;
- kein Layer überschreitet die Zellgrenzen;
- alle Richtungen teilen denselben Pivot;
- keine geglätteten oder halbtransparenten Randpixel;
- Manifest und PNG-Prüfsummen stimmen überein.

### Identität

- gleicher Seed erzeugt byte-identische Rezepte und Frames;
- keine vollständige Erscheinungssignatur doppelt im Kader;
- Portrait, Profil, Taktik und Match stimmen erkennbar überein;
- Nationalität verändert keine Erscheinungsparameter.

### Trikots

- alle acht Muster funktionieren mit beliebigen Hexfarben;
- Heim, Auswärts und Torwart bleiben kontrastreich;
- Graustufen-/Farbenblindheitstest unterscheidet beide Teams;
- Nummer bleibt auf Primär- und Sekundärflächen lesbar;
- dieselben Kitwerte erzeugen in UI und Match dieselben Farben.

### Animation

- alle Aktionen besitzen acht Richtungen oder expliziten Fallback;
- kein Richtungsflackern an Sektorgrenzen;
- Füße gleiten bei Joggen und Sprint nicht sichtbar;
- Ballkontakt findet exakt am Manifestmarker statt;
- Live und Replay zeigen denselben Frame am selben Tick.

### Performance

- Prewarming der 22 Starter unter 300 ms auf Referenzdesktop;
- kein Frame-Compose im kritischen Simulationsschritt;
- Cache bleibt unter 896 Einträgen;
- Render-p99 unter 8 ms;
- mindestens 30 FPS bei 844×390 mit Wetter und Touch-HUD.

## 16. Empfohlene endgültige Entscheidung

- Matchperspektive: V2 Top-down;
- Profil-/Showcase-Perspektive: V1 Dreiviertel;
- Runtimegröße: 40×48;
- Richtungen: acht echte Richtungen;
- Trikotfarben: ausschließlich über semantische Masken und `KitDesign`;
- Quelltrikot: neutrales Grau, niemals Grün oder Lila;
- Muster: separate binäre Masken;
- Komposition: einmalig/lazy zu `ImageBitmap`, nicht in jedem Renderframe;
- Migration: schrittweise mit bestehendem Gelenkrenderer als Fallback.
