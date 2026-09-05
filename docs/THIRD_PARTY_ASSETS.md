# Third-party assets and libraries

## Three.js (2.0 development)

- Package: `three`, pinned to `0.185.1`; typings `@types/three` `0.185.4`.
- Source: https://github.com/mrdoob/three.js
- License: MIT, bundled with the dependency and production license report.
- Usage: locally bundled WebGL 2 stadium, skinned footballers and animation. No CDN or runtime asset API.
- All 3D player geometry, rigs, kit panels, football poses, stadium meshes and pitch textures currently used are original procedural code. No Quaternius files have been imported; the library remains a researched reference, not an undeclared dependency.

Pitch Legends remains offline-capable. Runtime graphics are generated locally and no avatar or asset API is contacted.

## Faker

- Package: `@faker-js/faker`
- Version: `10.5.0`
- Usage: deterministic, locale-aware fictional player and manager names. All calls use the persisted world seed; no live API is contacted.
- Source: <https://fakerjs.dev/>
- License: MIT.
- Bundled license SHA-256: `8C0814C525426E67C04CA562F28364BE477003697903D257160C081D14B271BF`

## d3-delaunay

- Package: `d3-delaunay`
- Version: `6.0.4`
- Usage: deterministic neighbouring-city routes and Voronoi regions for the fictional league atlas.
- Source: <https://github.com/d3/d3-delaunay>
- License: ISC.
- Bundled license SHA-256: `582C3022BD01942336095F92B58A90B1BE624DC547D987555C6C956512DD24C1`

## Kenney Input Prompts Pixel

- Asset: Input Prompts Pixel
- Revision: official archive downloaded 2026-08-09; upstream archive timestamp `1774771309`
- Usage: selected 16 x 16 keyboard and gamepad glyphs in `public/assets/input-prompts/`.
- Source: <https://kenney.nl/assets/input-prompts-pixel>
- License: CC0 1.0. The bundled license is stored as `public/assets/input-prompts/LICENSE-KENNEY.txt`.
- Bundled license SHA-256: `A428696C49BCACC3B20004ECD65216BAB60791E946A51CDE44798FB68703BB83`

| File | SHA-256 |
| --- | --- |
| `gamepad-a.png` | `BBA030052E8774465072D590D0C6D11EA6663CB14F6567F4F400DC8691965BD2` |
| `gamepad-b.png` | `578DF4E805BB2903EB2E06D1884E738D60E33B3386B781CE798802A85E42D83A` |
| `gamepad-x.png` | `DBC8C263D5FB03511643C028C177DDD981DD7DBA3AAB1C539DB0A362851B1869` |
| `gamepad-y.png` | `6D7A5CB7B4A47CBB26F4B0D2DC7A62C55DA2A027D629FCEA9EF167A5FF8AB699` |
| `key-a.png` | `E4ED3FF891A40A7C0B86593E390B7ED7863CE1B6FA24859AA30AABC9290EC1BA` |
| `key-d.png` | `4F6A1BC0482529298C75671F74528B89CBA392940034FB76759F250B931F1227` |
| `key-escape.png` | `2E70E6A218263D5A48A9F86D60DA970A9BADD835CC1F25A0AADC811E1D9E521C` |
| `key-j.png` | `A29404CCE7FA1F9DD4BA56AE171548F6037402B52133374DDA91D652B8CB7363` |
| `key-k.png` | `872C72CDED2CC352884EDC3874A84E423CCBB6B348869BBF48A7D407C7869E5E` |
| `key-l.png` | `D17F3FBBA60F642507EB02EF53E119C07E5D22BC2A20AFC25406E5F15E7C136E` |
| `key-s.png` | `9CD0F8E26626EA7EA645AA9B5B9E963E1016274777FFF967DB112A9E5E856BFD` |
| `key-u.png` | `E9FA033900ED5A8F8F7767491EB30AE055B6449A8457A9258DACE70E2E77C39F` |
| `key-w.png` | `9C264EE0D4404002265A0B5584FA24F6F571D77C59DAE20606822F570922155E` |

All club crests, sponsors, kit patterns, player sprites, stadium graphics, and visual effects not listed above are original procedural graphics implemented in this repository. They intentionally avoid real club marks and commercial brands.
