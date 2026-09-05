> Historisches Dokument. Der aktuelle verbindliche Plan ist [Pitch Legends 2.0](PITCH_LEGENDS_2_0_MASTERPLAN.md).

# Player-Sprite-Pipeline und prozedurale Welt V3

## 1. Entscheidungsvorlage

Es liegen nun drei visuelle Richtungen vor:

| Variante | Kamera und Charakter | Stärke | Sinnvoller Einsatz |
|---|---|---|---|
| V1 | deutliche 3/4-Ansicht | Gesicht, Persönlichkeit und Profilwirkung | Spielerprofil, Transfermarkt, Matchbericht |
| V2 | etwa 65° Top-down | natürlicher Kompromiss aus Gesicht und Spielfeldlesbarkeit | Replay, Taktikansicht, große Match-Zoomstufe |
| V3 | etwa 75° Top-down, kompakter | klare Richtungen, stabile Anker, einfachere Komposition | reguläres Match und Performance-Referenz |

Empfehlung: V3 wird die technische Grundlage für das Match. V1 bleibt als Profil-/Showcase-Pose erhalten. Beide verwenden dieselbe persistierte `PlayerVisualIdentity`, damit Portrait, Ganzkörperfigur und Matchsprite dieselbe Person zeigen. V2 dient als Stilreferenz für nähere Replays und kann später als hochauflösende LOD-Stufe genutzt werden.

Das generierte V3-PNG ist ein Art-Guide. Sein Schachbrett ist in die RGB-Pixel eingebrannt. Produktionsatlanten werden daraus nicht automatisch ausgeschnitten, sondern sauber auf 48×48-Zellen mit echtem Alpha und festen Ankerpunkten nachgebaut.

## 2. Grundprinzip: Beschreibung statt fertiger Spielerbilder speichern

Ein Spielstand speichert keine tausenden gerenderten PNGs. Er speichert nur kleine, deterministische Beschreibungen:

```text
World Seed
 ├─ Land, Regionen, Städte und Reiserouten
 ├─ Club Seed
 │   ├─ Name, Farben, Wappen und Stadion
 │   ├─ Heim-, Auswärts- und Torwarttrikot
 │   └─ Sponsor- und Fankultur-Seed
 └─ Player Seed
     ├─ Name, Alter, Position, Attribute und Persönlichkeit
     ├─ Haut, Kopf, Haare, Körper, Schuhe und Accessoires
     └─ Portrait- und Sprite-Rezept
```

Erst beim Anzeigen setzt der Renderer das Rezept aus neutralen Sprite-Layern zusammen. Dadurch sind Millionen Spieler möglich, ohne für jeden Spieler eigene Dateien zu speichern.

Grundregeln:

- Ein Seed plus eine Generatorversion erzeugt immer dasselbe Ergebnis.
- `Math.random()` und `Date.now()` sind nach dem Karrierestart in Generatoren verboten.
- Jeder Bereich erhält einen eigenen abgeleiteten Seed. Wappenwürfeln verändert niemals Spieler, Spielplan oder Attribute.
- Aussehen wird niemals aus Nationalität abgeleitet.
- Ein fertiges Rezept wird im Save gespeichert. Spätere Generatorupdates verändern bestehende Karrieren nicht.
- Alle visuellen Zufallswerte dürfen den Match-RNG nicht beeinflussen.

## 3. Produktionsassets

### 3.1 Ordnerstruktur

```text
src/assets/sprites/players/v3/
  atlas.manifest.json
  outfield/
    outline.png
    skin-index.png
    hair-index.png
    kit-index.png
    boot-index.png
    accessory-index.png
  goalkeeper/
    outline.png
    skin-index.png
    hair-index.png
    kit-index.png
    glove-index.png
    boot-index.png
    accessory-index.png
  patterns/
    solid.png
    halves.png
    stripes.png
    hoops.png
    sash.png
    chest-band.png
    pinstripes.png
    chevron.png
  parts/
    heads.png
    hair.png
    facial-hair.png
    accessories.png
    boots.png
    digits.png
  portraits/
    bust-outline.png
    bust-skin-index.png
    bust-hair-index.png
    bust-kit-index.png
```

Die Indexatlanten sind keine normal eingefärbten Bilder. Ihre Pixel codieren Material und Helligkeitsstufe. Transparente Pixel besitzen Alpha 0; sichtbare Pixel ausschließlich Alpha 255. Es gibt keine halbtransparenten Kanten.

### 3.2 Zellen und Anker

- Logische Matchzelle: 48×48 Pixel.
- Darstellungsgröße im 640×360-Canvas: 24×24 bis 40×40, abhängig vom Kamerazoom.
- Ursprungsanker: Mittelpunkt zwischen den Füßen, standardmäßig `(24, 43)`.
- Ballkontaktanker: rechter/linker Fuß, Kopf, Hände des Torwarts.
- Schattengrund: Ellipse relativ zum Fußanker, nicht Bestandteil des Sprites.
- Jede Aktion besitzt dieselben Anker, auch wenn sich die Figur im Frame bewegt.
- Ground-Actions wie Grätsche und Torwarthechten dürfen über eine 96×48-Doppelzelle laufen; das Manifest beschreibt den Versatz.

```ts
interface SpriteFrameDefinition {
  action: PlayerActionState;
  direction: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  frame: number;
  rect: { x: number; y: number; width: 48 | 96; height: 48 };
  origin: { x: number; y: number };
  contacts: {
    leftFoot?: PixelPoint;
    rightFoot?: PixelPoint;
    head?: PixelPoint;
    leftHand?: PixelPoint;
    rightHand?: PixelPoint;
  };
  event?: 'footstep' | 'ball-contact' | 'landing' | 'release';
}
```

### 3.3 Animationsumfang

| Gruppe | Frames pro Richtung | Richtungen |
|---|---:|---:|
| Idle / Keeper Ready | 3 | 8 |
| Joggen / Ballführung | 6 | 8 |
| Sprint | 8 | 8 |
| enge Ballführung / Skills | 6 | 8 |
| Pass / Steilpass / Lob | 5–6 | 8 |
| Schussvarianten | 5–6 | 8 |
| Annahme / schlechter Kontakt / Kopfball | 4–5 | 8 |
| Tackling / Grätsche / Stolpern | 5–6 | 8 |
| Torwart Fangen / Parieren / Hechten | 6–8 | 8 |
| Jubel | 8 | 4 Varianten, 8 Richtungen |

V1 des Renderers darf weiterhin als Fallback zeichnen, solange einzelne V3-Aktionen fehlen. Im Manifest ist für jede Aktion explizit definiert, auf welche Animation sie zurückfällt.

## 4. Beliebige Trikotfarben statt Grün und Lila

Grün und Lila sind nur Demonstrationsfarben. Die Spielfigur erhält keine feste Vereinsfarbe. Die Trikotebene besteht aus Materialregionen:

| Index | Region | Quelle im bestehenden `KitDesign` |
|---:|---|---|
| 0 | transparent | – |
| 1 | Grundtrikot | `shirt` |
| 2 | Zweitfarbe/Muster | `secondary` |
| 3 | Kragen/Bündchen/Saum | `trim` |
| 4 | Hose | `shorts` |
| 5 | Stutzen | `socks` |
| 6 | Nummer | `number` |

Jede Region besitzt vier Helligkeitsstufen: Kontur, Schatten, Grundton und Highlight. Aus einem beliebigen Hexwert wird deterministisch eine Rampe erzeugt:

```ts
interface PixelRamp {
  outline: string;
  shadow: string;
  base: string;
  highlight: string;
}

function kitRamp(base: string): PixelRamp {
  return {
    outline: mixHex(base, '#050711', 0.72),
    shadow: mixHex(base, '#050711', 0.38),
    base,
    highlight: mixHex(base, '#f8fafc', 0.26),
  };
}
```

Die genauen Mischwerte werden einmal per Golden-Test fixiert. Weiß erhält eine graue statt schwarze Schattierung; sehr dunkle Farben erhalten ein stärkeres Highlight. Neonfarben werden vor der Rampenbildung auf eine zulässige Sättigung begrenzt.

### Muster

- `solid`: nur Primärfarbe;
- `halves`: linke/rechte Trikothälfte getrennt;
- `stripes`: vertikale Zweitfarbstreifen;
- `hoops`: horizontale Ringe;
- `sash`: diagonales Zweitfarbband;
- `chest-band`: horizontales Brustband;
- `pinstripes`: einzelne schmale Pixelstreifen;
- `chevron`: V-förmige Zweitfarbe.

Kragen und Ärmel bleiben eigene Masken, damit `crew`, `v`, `polo`, `plain`, `cuff` und `raglan` ohne neue Körperanimation kombinierbar sind. Rückennummern werden aus einem eigenen 3×5- beziehungsweise 4×6-Pixel-Ziffernatlas zusammengesetzt.

### Trikotkonflikte

Vor jedem Match bewertet `KitClashResolver` beide sichtbaren Designs:

- relative Helligkeitsdifferenz;
- RGB-/OKLCH-Farbabstand;
- Musterähnlichkeit;
- Hosen- und Stutzenkontrast;
- simulierte Lesbarkeit bei Protanopie, Deuteranopie und Graustufen.

Reihenfolge: Heim gegen Auswärts, Heim gegen alternatives Auswärtsdesign, Auswärts gegen alternatives Heimdesign. Der Torwart muss sich von beiden Mannschaften und dem Schiedsrichter unterscheiden. Reicht Farbe nicht aus, erzwingt das System zusätzlich ein deutlich anderes Muster und eine helle beziehungsweise dunkle Außenkontur.

## 5. Layer-Komposition

### 5.1 Reihenfolge

Die Reihenfolge hängt von Blickrichtung und Pose ab:

```text
Schatten
→ hinteres Bein
→ hinterer Arm
→ Torso/Trikot
→ vorderes Bein
→ Kopf/Haut
→ Haare/Bart
→ vorderer Arm
→ Handschuhe/Accessoires
→ Nummer und kleine Kitdetails
→ Auswahlmarker/Karte/Player-Lock
```

Bei Nordrichtungen liegt der Kopf teilweise vor dem Torso, bei Südrichtungen liegt der Torso stärker vor Hinterkopf und Schultern. Das Manifest enthält pro Richtung eine feste Layerreihenfolge, damit keine Gliedmaßen unnatürlich durch den Körper schneiden.

### 5.2 Kompositionszeitpunkt

- Beim Karrierebildschirm: Spieler erst bei Sichtbarkeit rendern.
- Vor dem Match: Idle, Joggen, Sprint und Ballführung aller 22 Spieler vorbereiten.
- Seltene Aktionen wie Torjubel oder Torwarthechten: beim ersten Bedarf lazy erzeugen.
- Ergebnis: `ImageBitmap` oder normales Canvas als Fallback.
- Während eines Renderframes werden keine Pixelmasken ausgewertet; es wird nur das fertige Bitmap gezeichnet.

```ts
interface PlayerSpriteRecipe {
  playerVisualSeed: number;
  kitSignature: string;
  skinTone: number;
  headShape: number;
  hairStyle: number;
  hairColor: number;
  facialHair: number;
  bodyBuild: 'slim' | 'average' | 'strong';
  bootStyle: number;
  bootColor: string;
  sleeve: 'short' | 'long';
  wristTape: 'none' | 'left' | 'right' | 'both';
  headAccessory: 'none' | 'headband' | 'protective-cap';
  goalkeeper: boolean;
  goalkeeperGloves: number;
}
```

Cache-Key:

```text
assetVersion | visualSignature | kitSignature | action | direction | frame | goalkeeper
```

Der bestehende Grenzwert von 896 Frames bleibt zunächst erhalten. Ein LRU-Eintrag schließt sein `ImageBitmap` beim Entfernen. Ziel: unter 7 MB Rohpixeldaten pro Match.

## 6. Richtungen und flüssige Bewegung

Richtung wird aus `facingX/facingY` in acht 45°-Sektoren quantisiert. Um Flackern an einer Sektorgrenze zu vermeiden, wechselt die Ansicht erst, wenn der neue Winkel die Grenze um zusätzliche 7,5° überschritten hat.

- Laufanimation basiert auf `animationDistance`, nicht ausschließlich auf Zeit.
- Linker und rechter Fußkontakt folgt der zurückgelegten Strecke.
- Aktionen sperren ihre Richtung bis zum Ballkontaktframe.
- Nach Pass oder Schuss darf die Blickrichtung über zwei Frames in die neue Laufrichtung zurückkehren.
- Bei Teleport, Anstoß, Resume und Auswechslung wird die Animationsdistanz zurückgesetzt.
- Replay liest dieselbe Aktion, Richtung, Distanz und den Aktionsstarttick; Livebild und Replay zeigen dadurch dieselbe Pose.

## 7. Prozedurale Welt-, Vereins- und Spielergenerierung

Das Projekt besitzt bereits die passende Basis:

- `@faker-js/faker` 10.5.0 für deterministische Personennamen;
- `d3-delaunay` für Regionen und Weltkarte;
- `Rng` und `hash32` für reproduzierbare Zufallsströme;
- `createClubVisualIdentity()`, `createPlayerVisualIdentity()` und `generateWorld()`;
- `PlayerSpriteFactory` mit 40×48-Zeichenfallback und 896er Cache.

Die neue Pipeline erweitert diese vorhandenen Bausteine, statt einen zweiten Generator daneben zu bauen.

### 7.1 Seed-Baum

```text
worldSeed
 ├─ hash(worldSeed, "geography", generationVersion)
 ├─ hash(worldSeed, "schedule", season)
 ├─ hash(worldSeed, "club", stableClubIndex)
 │   ├─ "name"
 │   ├─ "visuals"
 │   ├─ "culture"
 │   ├─ "manager"
 │   └─ "squad"
 │       └─ hash(clubSeed, "player", stableSquadSlot)
 │           ├─ "person"
 │           ├─ "football"
 │           ├─ "appearance"
 │           └─ "personality"
 └─ hash(worldSeed, "free-agents", season)
```

Ein Teilgenerator darf nur seinen Zweig verbrauchen. Werden später neue Frisuren ergänzt, dürfen dadurch nicht plötzlich andere Spielerstärken oder Städtenamen entstehen.

### 7.2 Welt und Land

1. Nutzer wählt einen zufälligen oder eingegebenen, teilbaren Welt-Seed.
2. `generateWorld()` erzeugt Landesname, Flagge, Umriss und vier bis sechs Regionen.
3. Städte werden räumlich verteilt und mit Delaunay-Nachbarschaften verbunden.
4. Stadttyp, Klima, Landmarke, Wohlstand und Fußballkultur werden ergänzt.
5. Entfernungen bestimmen Reisezeit und mögliche Reiseereignisse.
6. Ein `generationVersion`-Feld hält alte Welten reproduzierbar.

### 7.3 Vereine

Für jeden stabilen Club-Slot:

1. Stadt und Region bestimmen Namenspool und Suffix.
2. Clubalter, Reputation, Rivalität, Fankultur und Philosophie würfeln.
3. Drei Grundfarben aus einer kuratierten, farbenblindentauglichen Palette wählen.
4. `createClubVisualIdentity()` erzeugt Wappen, Heim-, Auswärts- und Torwarttrikot.
5. Semantische Namensbegriffe beeinflussen nur das Emblem, etwa Solar → Sonne/Stern.
6. Ligaweite Signaturen prüfen: Name, Kürzel, Wappen und Haupttrikot dürfen nicht kollidieren.
7. Stadionform, Sitzfarbe, Banner, Flutlicht und fiktive Sponsoren aus dem Club-Seed erzeugen.
8. Ein kleiner `ClubCultureProfile` steuert bevorzugte Transfers, Nachwuchsregionen und Spielstil, aber verleiht keine versteckten Attributboni.

```ts
interface ClubCultureProfile {
  foundingEra: 'historic' | 'modern' | 'new';
  supporterStyle: 'traditional' | 'ultras' | 'family' | 'cosmopolitan';
  recruitment: 'local' | 'national' | 'international' | 'youth-first';
  philosophy: TacticalPhilosophy;
  rivalClubId: string | null;
  mottoKey: string;
}
```

### 7.4 Spieler

Für jeden Kaderplatz:

1. Positionsschablone festlegen, damit jeder Kader mindestens zwei Torhüter und vollständige Positionsgruppen besitzt.
2. Faker-Locale und Name deterministisch wählen.
3. Alter, starker Fuß, Größeklasse, Persönlichkeit, Archetyp und Potenzial erzeugen.
4. Attribute positionsabhängig um die Clubstärke verteilen.
5. Marktwert, Gehalt, Vertrag und persönliche Ziele berechnen.
6. Aussehen separat über `createPlayerVisualIdentity()` erzeugen.
7. Kaderweite Erscheinungssignatur prüfen; bei Duplikat nur den Appearance-Salt erhöhen.
8. Trikotnummer nach Position und Verfügbarkeit vergeben.
9. Portrait- und Matchrezept aus derselben Identität ableiten.

Nationalität beeinflusst Namen und optionale Biografie, niemals Haut, Haare oder Körperform. Körperbau kann leicht mit Physis und Position korrelieren, darf die vorhandenen Attribute aber nicht verändern. Das Aussehen visualisiert Daten, es erzeugt keine spielerischen Boni.

### 7.5 Jugendspieler, Transfers und neue Saisons

- Jugend: `hash(worldSeed, clubId, season, youthIndex)`.
- Free Agents: `hash(worldSeed, season, freeAgentIndex)`.
- Transferzugänge behalten ID, Identität und Aussehen vollständig.
- Leihspieler tragen nur das Trikot des Leihclubs; Körper und Gesicht bleiben unverändert.
- Regens in späteren Saisons erhalten neue stabile IDs und ein `originClubId`.
- Gelöschte oder verkaufte Spieler werden niemals durch einen neuen Spieler mit derselben ID ersetzt.

## 8. Karrierestart und kontrolliertes Würfeln

Der Startbildschirm erhält einen sichtbaren Welt-Seed mit `KOPIEREN`, `EINFÜGEN` und `NEU WÜRFELN`.

Vorschau-Schritte:

1. `WELT`: Land, Karte, Regionen, Ligagröße und Rivalitäten.
2. `VEREIN`: Stadt, Name, Kürzel, Wappen, Trikots und Stadion.
3. `MANAGER`: Aussehen, Philosophie und Perks.
4. `KADER`: Mannschaftsübersicht mit drei repräsentativen Spielern.
5. `KARRIERE STARTEN`: Rezepte werden endgültig gespeichert.

Würfelaktionen sind domänenspezifisch:

- `ALLES NEU`: neuer Welt-Seed;
- `LAND NEU`: Geografie und Vereine neu, Managername bleibt;
- `VEREIN NEU`: nur eigener Club-Visual-Salt;
- `WAPPEN NEU`: nur Crest-Salt;
- `TRIKOTS NEU`: nur Kit-Salt;
- `MANAGER NEU`: nur Manager-Visual-Salt;
- `KADER-VORSCHAU NEU`: vor Karrierestart ein neuer Squad-Salt.

Nach Start können Wappen und Trikots kosmetisch im Club Studio geändert werden. Spieler, Welt, Attribute und Resultate können nicht kostenlos neu gewürfelt werden. Damit bleibt der Seed teilbar und es entsteht kein Save-Scumming-System.

## 9. Nutzung an allen Stellen

### Match und Replay

- Match nutzt V3 Top-down in 1×.
- Replay darf dieselben V3-Frames größer zeigen; später optional V2-LOD.
- Clubtrikot wird über die aktuelle Fixture-Kitwahl injiziert.
- Nummer, Kapitänsbinde, Handschuhe und Verletzungsaccessoire sind separate Layer.

### Spielerprofil und Transfermarkt

- Portrait und Ganzkörperfigur werden aus derselben Identität erzeugt.
- Haare, Haut, Bart, Accessoire, Körperbau und Clubtrikot müssen übereinstimmen.
- Ein Portrait darf Details vergrößern, aber keine unabhängige DiceBear-Zufallsfigur mehr zeigen.
- Leih- oder Transferwechsel invalidiert nur den Kit-Cache, nicht das Gesicht.

### Kader und Taktik

- Kleine 16- oder 24-Pixel-Köpfe aus demselben Portraitrezept.
- Feldfiguren verwenden Idle-Frame und echtes Trikotmuster.
- Auswahlstatus wird durch Form und Kontur gezeigt, nicht durch Umfärben der Person.

### Zentrale, Liga und Matchbericht

- Starspieler, Torschützen, Verletzte und Team-of-the-Week verwenden dieselben Portraits.
- Clubwappen und Trikots stammen aus `ClubVisualIdentity`.
- Bilder werden über stabile IDs geladen, damit sie beim Navigieren nicht wechseln.

## 10. Services und API

```ts
interface SpriteAssetLoader {
  loadManifest(): Promise<SpriteAtlasManifest>;
  loadLayer(layer: SpriteLayerId): Promise<ImageBitmap | HTMLCanvasElement>;
}

interface PlayerAppearanceResolver {
  resolve(player: Player, team: Team | null, kit: KitDesign): PlayerSpriteRecipe;
}

interface PlayerFrameComposer {
  compose(recipe: PlayerSpriteRecipe, frame: SpriteFrameDefinition): CanvasImageSource;
  prewarm(players: readonly Player[], kits: ReadonlyMap<string, KitDesign>): Promise<void>;
  invalidatePlayer(playerId: string): void;
  invalidateKit(kitSignature: string): void;
}

interface ProceduralWorldFactory {
  preview(seed: number, salts: GenerationSalts): WorldPreview;
  create(seed: number, salts: GenerationSalts): GameState;
}
```

`PlayerSpriteFactory` bleibt zunächst die öffentliche Fassade. Intern entscheidet ein Engine-Schalter zwischen dem bisherigen Canvas-Zeichner und dem neuen Atlas-Composer. Dadurch kann jede Seite einzeln migriert und bei fehlenden Assets sicher auf den alten Renderer zurückfallen.

## 11. Sprite Lab

Eine nur in Development sichtbare Route `/dev/sprites` beschleunigt die Produktion:

- Spieler- und Club-Seed eingeben;
- alle acht Richtungen gleichzeitig abspielen;
- Aktion, Frame, Tempo und Zoom auswählen;
- Heim/Auswärts/Torwart umschalten;
- beliebige Hexfarben und Muster testen;
- Haut, Haare, Körper, Schuhe und Accessoires wechseln;
- Ankerpunkte, Zellenränder und Ballkontaktpunkte einblenden;
- Protanopie, Deuteranopie und Graustufen simulieren;
- Cachegröße, Renderzeit und fehlende Fallbacks anzeigen;
- Golden-Test-Referenzbilder exportieren.

## 12. Umsetzung in Phasen

### Phase A – Assetvertrag und Freigabe

- V2 und V3 bei realer Matchgröße vergleichen.
- 48×48-Zelle, 75°-Kamera, Anker und Pixelpalette festschreiben.
- Produktionsmanifest und Dateibenennung definieren.
- Vier Kernaktionen als vertikalen Slice zeichnen: Idle, Joggen, Sprint, Pass.

### Phase B – Indexed Kit Composer

- Material- und Helligkeitsindizes einlesen.
- beliebige `KitDesign`-Farben auf vierstufige Rampen abbilden;
- alle acht Muster, Kragen, Ärmel, Nummern und Keeperfarben unterstützen;
- Konfliktprüfung und Golden-Tests ergänzen.

### Phase C – Spieleridentität

- Haut, Kopf, Haare, Bart, Körperbau, Schuhe und Accessoires als Atlaslayer;
- bestehende `PlayerVisualIdentity` vollständig abbilden;
- Portraitservice auf dieselbe Appearance-Quelle umstellen;
- Kaderweite Duplikatprüfung beibehalten.

### Phase D – Matchmigration

- Atlas-Composer hinter Engine-Schalter integrieren;
- Richtungs-Hysterese und Distanzanimation ergänzen;
- Prewarming, Lazy-Aktionen und LRU-Cleanup;
- Match, Replay und Torwartaktionen migrieren.

### Phase E – Gesamte UI

- Profile, Transfermarkt, Taktik, Training, Zentrale, Liga und Bericht migrieren;
- Kitwechsel invalidiert nur betroffene Frames;
- dieselbe Person an allen Stellen visuell testen.

### Phase F – Prozedurale Karriere

- Seed-Baum versionieren;
- Clubkultur, Stadien, Sponsoren und Jugendquellen ergänzen;
- Karrierestart mit Seed-Vorschau und domänenspezifischen Würfeln;
- Save-/Import-Migration und geteilte Seed-Codes.

## 13. Tests und Abnahmekriterien

### Assets

- Jede Produktionsdatei besitzt echten Alpha-Kanal und keine halbtransparenten Randpixel.
- Alle Frames liegen exakt auf dem Manifest-Raster.
- Fußanker springen innerhalb eines Laufzyklus höchstens einen Pixel.
- Jede `PlayerActionState` besitzt einen expliziten Frame oder Fallback.
- Acht Richtungen sind bei 1× klar unterscheidbar.

### Farben und Trikots

- 500 zufällige `KitDesigns` erzeugen gültige Pixelrampen ohne ungültige Farben.
- Heim, Auswärts, Torwart und Schiedsrichter bleiben unterscheidbar.
- Muster sind in Graustufe und bei simulierten Farbsehschwächen lesbar.
- Nummern kontrastieren mit der jeweiligen Rückenregion.

### Determinismus

- Gleicher Welt-Seed plus Generatorversion erzeugt byte-identische Welt-, Club- und Spielerbeschreibungen.
- Ein anderer Appearance-Salt verändert keine Attribute oder Namen.
- Ein anderer Kit-Salt verändert weder Wappen noch Kader.
- Save/Load und Export/Import erhalten alle Rezepte.
- Kein Kader enthält eine doppelte vollständige Appearance-Signatur.

### Konsistenz

- Portrait, Profilfigur und Matchsprite stimmen bei Haut, Kopf, Haaren, Bart, Körperbau und Accessoires überein.
- Transfers ändern ausschließlich sichtbares Trikot und Clubkontext.
- Replay und Livebild zeigen für denselben Tick dieselbe Pose.

### Performance

- Prewarming der 22 Spieler bleibt typischerweise unter 300 ms.
- Render-p99 bleibt unter 8 ms.
- Spritecache bleibt bei höchstens 896 Einträgen beziehungsweise ungefähr 7 MB Rohpixeln.
- Ohne `OffscreenCanvas` funktioniert der HTML-Canvas-Fallback.
- Mobilgerät hält mindestens 30 FPS, Desktop 60 FPS.

## 14. Konkrete Empfehlung für die gemeinsame Entscheidung

1. V3 als Matchbasis auswählen: beste Lesbarkeit, technisch sauberstes Zielraster.
2. Körperproportionen und Gesichtscharme aus V2 übernehmen, ohne die steilere V3-Kamera aufzugeben.
3. V1 ausschließlich als Profil-/Showcase-Pose verwenden.
4. Nicht das generierte Gesamtbild direkt zerschneiden. Zuerst einen kleinen, manuell bereinigten Produktionssatz mit echtem Alpha erstellen.
5. Den vertikalen Slice mit zwei Feldspielern, einem Torwart, vier Aktionen, acht Richtungen und vier vollständig unterschiedlichen Vereinen testen.
6. Erst nach Prüfung in echter 640×360-Matchkamera alle übrigen Aktionen produzieren.

Damit bleibt die Darstellung charmant und individuell, während Farben, Vereine und Spieler vollständig deterministisch und nahezu unbegrenzt kombinierbar werden.
