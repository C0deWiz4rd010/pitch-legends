# Finaler Generierungsprompt – Player Sprite Atlas Concept V1

```text
Use case: stylized-concept
Asset type: very large production concept sprite atlas for a top-down football game
Primary request: create one enormous, highly organized modular pixel-art tileset from which a procedural generator can assemble thousands of unique football players, full teams, goalkeepers, and club kits.
Scene/backdrop: genuinely transparent background; sprites separated by generous empty gutters; no decorative scene.
Style/medium: polished late-1990s 32-bit console pixel art, crisp hard pixel clusters, one-pixel dark outlines, four-tone shading per material, no antialiasing, no painterly rendering, readable at small size, charming but anatomically natural football proportions.
Composition/framing: one wide landscape master sheet divided into clean rectangular atlas panels on a strict invisible grid. Every full-body character uses exactly the same bounding box, foot baseline, body proportions, camera angle, and anchor point.

TOP PANEL — eight-direction locomotion:
One identical neutral football player wearing a simple unbranded green shirt, dark shorts, pale socks and boots. Show the same player in N, NE, E, SE, S, SW, W, NW directions. For each direction include a coherent six-frame run cycle and a coherent four-frame idle cycle. Preserve identity, kit pattern, body height, head size, lighting direction and foot baseline across every frame. Diagonal poses must be real three-quarter poses, not merely mirrored side views.

SECOND PANEL — ball movement:
The exact same player and proportions in all eight directions for a six-frame close-dribble cycle, a six-frame sprint-dribble cycle, and four-frame first-touch sequence. Football stays consistently scaled and follows plausible foot contact arcs.

THIRD PANEL — football actions:
Consistent short sequences for short pass, through pass, lob/cross, power shot, finesse shot, header, standing tackle, slide tackle, stumble, injury kneel and four distinct celebration poses. Include front, back, side and diagonal examples, always on the same baseline.

FOURTH PANEL — goalkeeper:
One goalkeeper in a contrasting purple kit with gloves: ready stance in eight directions, run, catch high, catch low, parry, left/right dive, rush out, throw and goal kick. Same dimensions and anchors as outfield players.

BOTTOM HALF — modular construction library:
Neatly separated interchangeable layers shown straight-on and as directional variants where needed:
8 skin-tone palettes; 6 natural head shapes; eyes/noses/mouth shadow clusters; 24 distinct football hairstyles including shaved, fades, curls, afro, braids, locs, ponytail and headband; 8 facial-hair options; 4 body builds; bare arm and leg segment layers; short/long/raglan sleeve shapes; 16 shirt pattern masks including solid, halves, quarters, vertical stripes, hoops, sash, chest band, pinstripes, chevron, gradient-like dither and goalkeeper blocks; collars and cuffs; shorts with number areas; socks with bands; 16 boot silhouettes and colorways; wrist tape, gloves, captain armband, protective cap and subtle accessories. All pieces align to the exact same character skeleton and attachment points.

Palette: midnight-navy outline, vivid pitch green, cyan highlights, warm gold accents, cream whites, plus clearly separated sample club colors. Skin and hair palettes should be broad and natural, never tied to nationality.
Lighting/mood: neutral readable sprite lighting from upper left; energetic, premium football-game charm.
Constraints: no labels, no words, no letters, no numbers, no logos, no real club designs, no trademarks, no watermark, no perspective mockup, no isometric tiles, no blurry pixels. Do not merge sprites. Do not crop any frame. Keep empty transparent gutters between every cell. Maintain exact visual identity and scale throughout the animation rows. This is a sprite atlas, not a poster or character lineup.
```

Generiert mit dem eingebauten `image_gen`-Werkzeug im Standardmodus.
