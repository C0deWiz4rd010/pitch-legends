# Prompt: Player Sprite Atlas – Top-down Concept V3

Modus: eingebautes `image_gen`, Generierung mit V2 ausschließlich als Umfangs- und Stilreferenz.

```text
Use case: stylized-concept
Asset type: production-oriented pixel-art football player sprite atlas concept for a 640x360 top-down game
Primary request: Create a SECOND and clearly different top-down football sprite atlas for comparison with Image 1. Make it more orthographic, more compact, more athletic and more production-friendly than the reference. It must demonstrate how complete fictional teams can be assembled procedurally.
Input images: Image 1 is a scope and feature reference only; do not copy its poses or layout exactly.
Scene/backdrop: genuinely transparent background, no baked checkerboard, no scenery, no field.
Subject: modular 32-bit pixel footballers viewed from a steep 75-degree elevated top-down camera. Use a strict, repeated 48x48 logical cell grid with generous gutters. Show one neutral grayscale outfield player in eight directions (N, NE, E, SE, S, SW, W, NW) for idle, 8-frame run, 6-frame dribble, pass, shot, tackle, slide, header, stumble and four celebrations. Show a neutral dark goalkeeper in eight directions with idle, run, catch, parry, dive, throw and goal kick. Include modular rows for eight skin-tone ramps, head shapes, eighteen hairstyles, hair colors, facial hair, slim/average/strong torsos, arms, legs, long sleeves, wrist tape, headband, protective cap, gloves, shorts, socks and twelve boot palettes.
Kit system panel: do not bake green or purple into the core character. Show a neutral four-tone grayscale shirt/shorts/socks master, separate high-contrast region-mask examples for primary fabric, secondary fabric, trim, shorts, socks and number, separate black-and-white pattern masks for solid, halves, quarters, vertical stripes, hoops, sash, chest band, pinstripes and chevron. Along the bottom show at least twenty small fictional team examples recolored from the same base using varied red, blue, amber, cyan, white, black, burgundy, teal, coral and violet palettes, plus six clearly contrasting goalkeeper kits. No real club likenesses.
Style/medium: crisp hand-authored-looking 32-bit pixel art, hard one-pixel dark outlines, no anti-aliasing, limited four-tone ramps, readable silhouettes, natural limb proportions, subtle kit folds, consistent overhead lighting, integer-pixel edges.
Composition/framing: large landscape sprite sheet, perfectly aligned rows and columns, sprites never overlap cells; movement cycles in the upper half, goalkeeper cycles in the middle, modular body and uniform assets below, color/pattern demonstrations along the bottom. No labels or typography.
Color palette: core animation masters are neutral grayscale; only the demonstration swatches use varied fictional club colors.
Constraints: strict consistent scale and camera angle; eight visibly distinct directions; all frame feet share stable ground anchors; ball contact points are consistent; truly transparent background; no text, no logos, no trademarks, no watermark.
Avoid: fake transparency checkerboard, painterly rendering, vector smoothing, isometric camera, side-view platformer poses, giant heads, chibi proportions, duplicated frames, inconsistent body identity, green-and-purple-only palette, real football clubs.
```

## Technischer Hinweis

Der Generator hat trotz der Transparenzanforderung ein Schachbrett in das RGB-Bild gerendert. Ein einzelner gezielter `background-extraction`-Versuch erzeugte ebenfalls keinen Alpha-Kanal und wurde verworfen. V3 ist daher ein Konzept- und Freigabebild, kein direkt schneidbarer Produktionsatlas. Die Produktionsdateien werden separat auf ein festes Zellenraster mit echtem Alpha normalisiert.
