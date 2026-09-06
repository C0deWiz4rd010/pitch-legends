# Changelog

All notable changes to Pitch Legends are recorded here. Releases follow
[Semantic Versioning](https://semver.org/) and are generated from Conventional
Commits by Release Please.

## [1.5.0](https://github.com/C0deWiz4rd010/pitch-legends/compare/pitch-legends-v1.4.2...pitch-legends-v1.5.0) (2026-09-06)


### Features

* **ai:** add coordinated football decisions and credible goalkeeping ([07c4ada](https://github.com/C0deWiz4rd010/pitch-legends/commit/07c4ada61b79758f00d45f5930ea2fe853f72b52))
* **gameplay:** rebuild dribbling passing shooting and ball contact ([40c70a1](https://github.com/C0deWiz4rd010/pitch-legends/commit/40c70a198beb0bec73693145926a153713936ced))
* **match:** bring arcade 3D to career and complete match restarts ([dd1adab](https://github.com/C0deWiz4rd010/pitch-legends/commit/dd1adab698a8f83cbb66ef1dca05ff5164c79bec))
* **players:** add procedural identities and continuous football animation ([f5e6a76](https://github.com/C0deWiz4rd010/pitch-legends/commit/f5e6a76dc7683cc5925677c20cd42fb7ce101d7e))
* **rendering:** introduce the playable three-dimensional training pitch ([2f566b3](https://github.com/C0deWiz4rd010/pitch-legends/commit/2f566b3abb01ea414f8a1fd1489ef25f89a3ce37))


### Bug Fixes

* **gameplay:** make movement turning and input consistently responsive ([a2c89df](https://github.com/C0deWiz4rd010/pitch-legends/commit/a2c89df3b80b96911a87347d1081dae1df94cb59))
* **rendering:** keep football playable after delayed GPU frames ([8cc8edd](https://github.com/C0deWiz4rd010/pitch-legends/commit/8cc8edd20504270f27942e6aa30c4b2971ba2bf3))
* **season:** secure multi-season progression and document the 2.0 roadmap ([f3b393b](https://github.com/C0deWiz4rd010/pitch-legends/commit/f3b393bf1a36ca246e6d3ba0d4d08ec969ce763d))

## 1.4.2 (2026-08-15)

### Features

* **match-art:** introduce the V3 top-down player style with natural tapered limbs, directional pose projection and pixel-perfect shirt patterns
* **player-art:** render portraits and full-body figures from one shared procedural identity recipe
* **kits:** resolve fixture and goalkeeper colour clashes with deterministic emergency designs
* **match-vfx:** refine player grounding, selection markers and goal construction

### Performance Improvements

* **match-art:** compose uncommon sprite frames during browser idle time and protect the live render path with a stable per-player fallback

## [1.4.1](https://github.com/C0deWiz4rd010/pitch-legends/compare/pitch-legends-v1.4.0...pitch-legends-v1.4.1) (2026-08-09)


### Bug Fixes

* **dashboard:** contain mobile objective progress ([218b6e9](https://github.com/C0deWiz4rd010/pitch-legends/commit/218b6e9e2c818df376bbe93dcfb1c3c4151934fd))
* **pwa:** add branded install icons and manifest ([288ec13](https://github.com/C0deWiz4rd010/pitch-legends/commit/288ec135bf4b6d7d224633d859fb94549c291e6d))

## [1.4.0](https://github.com/C0deWiz4rd010/pitch-legends/compare/pitch-legends-v1.3.0...pitch-legends-v1.4.0) (2026-08-09)


### Features

* **injuries:** integrate medical rehab with matches and training ([11824b1](https://github.com/C0deWiz4rd010/pitch-legends/commit/11824b1924051b6c95a9ab5fecea777707ceac72))
* **league:** add interactive atlas and travel events ([fb9350e](https://github.com/C0deWiz4rd010/pitch-legends/commit/fb9350ef31f5841d7ac6547d8ac841cb47c03081))
* **match-art:** refine pitch goals nets and coach presentation ([0c7125f](https://github.com/C0deWiz4rd010/pitch-legends/commit/0c7125f52e64c22b8094d660dbe9cf3e771383e4))
* **world:** generate seeded clubs people and managers ([bf23492](https://github.com/C0deWiz4rd010/pitch-legends/commit/bf23492b3c40492c0416efb53b3ecfab819019c2))

## [1.3.0](https://github.com/C0deWiz4rd010/pitch-legends/compare/pitch-legends-v1.2.0...pitch-legends-v1.3.0) (2026-08-09)


### Features

* **match-art:** animate refined procedural player sprites ([c966495](https://github.com/C0deWiz4rd010/pitch-legends/commit/c966495b9bb3b011d18630648b78f4624289aaae))
* **tactics:** rebuild the tactical command workspace ([227644a](https://github.com/C0deWiz4rd010/pitch-legends/commit/227644a0cb96976c828015076e0387ebac54e70a))
* **training:** add deterministic weekly training plans ([16ef511](https://github.com/C0deWiz4rd010/pitch-legends/commit/16ef511b9a996de50caf1cb4e09a6cade9aa401b))


### Bug Fixes

* **layout:** constrain route workspaces to the main viewport ([09d2d79](https://github.com/C0deWiz4rd010/pitch-legends/commit/09d2d7986c4e29fe6e4db403c9024420e9a2e57c))

## [1.2.0](https://github.com/C0deWiz4rd010/pitch-legends/compare/pitch-legends-v1.1.0...pitch-legends-v1.2.0) (2026-08-09)


### Features

* **career:** complete player manager and club progression loops ([4b9a362](https://github.com/C0deWiz4rd010/pitch-legends/commit/4b9a36288e1d611cf708ce74037a9d13b3da3758))
* **core:** data generators, ratings and game services (state, save, rpg, training, match engine, season, transfer, facilities) ([61680f4](https://github.com/C0deWiz4rd010/pitch-legends/commit/61680f4d0c3b2603009ea43810d9f00fcb2fda62))
* **core:** establish v2 progression and career rules ([ac9d465](https://github.com/C0deWiz4rd010/pitch-legends/commit/ac9d465777890107fcfa972b227848e5cf9b2c6f))
* **foundation:** add SCSS design system and domain models ([71fbebd](https://github.com/C0deWiz4rd010/pitch-legends/commit/71fbebd3975da427d4dbd8b14506de4356ae64ee))
* **gameplay:** add reversible live auto control ([81cae8e](https://github.com/C0deWiz4rd010/pitch-legends/commit/81cae8e3d47f40b62401ea1fbb05b371b17c3b42))
* **gameplay:** establish deterministic v3 match core ([4df5f9e](https://github.com/C0deWiz4rd010/pitch-legends/commit/4df5f9ef53ccf20c46366f8256509250864ea589))
* **gameplay:** harden resume rules and competitive balance ([8070783](https://github.com/C0deWiz4rd010/pitch-legends/commit/8070783eaad9250f0c18755482bafd607322acf8))
* **gameplay:** retune arcade movement ball speed and match responsiveness ([cbcc0ce](https://github.com/C0deWiz4rd010/pitch-legends/commit/cbcc0cebe41657811d34cbe12c57fb369aa698e8))
* **hub:** rebuild the central manager command centre ([233eb99](https://github.com/C0deWiz4rd010/pitch-legends/commit/233eb99f441d36536c3f801e24734b4a24a0b17b))
* **match-art:** render animated procedural footballers ([c38b229](https://github.com/C0deWiz4rd010/pitch-legends/commit/c38b229e0ed03e76699e55fb3f14b581421c2b0f))
* **match-vfx:** enrich pitch stadium and event presentation ([0ac227f](https://github.com/C0deWiz4rd010/pitch-legends/commit/0ac227fddc7fe1a97f4a65dab2882e06194477cf))
* **match:** add playable deterministic 11v11 arcade mode ([c62b20e](https://github.com/C0deWiz4rd010/pitch-legends/commit/c62b20e53796f101777cbc669710929acf493ca9))
* **matchday:** deliver unified playable v3 experience ([5e10cf0](https://github.com/C0deWiz4rd010/pitch-legends/commit/5e10cf0ff346659237fd6e321c97a1de9d344a54))
* **match:** pre-match scouting report with squad ratings, recent form and win prediction ([a8c9336](https://github.com/C0deWiz4rd010/pitch-legends/commit/a8c93360def9aee4d5177097662ce6ba2b2dea70))
* **match:** real-time interactive simulation (live mentality/pressing + substitutions) and cinematic canvas renderer (stadium, crowd, floodlights, camera, particles, weather, momentum meter) ([c575f44](https://github.com/C0deWiz4rd010/pitch-legends/commit/c575f449d4c0747af43ad3d7db141b17e9c02d11))
* **onboarding:** add adaptive visual controls handbook ([49ebcb8](https://github.com/C0deWiz4rd010/pitch-legends/commit/49ebcb84ccd11c344970d583ab26bbb97576fb63))
* **player-art:** showcase portraits and animated kit dolls ([4d275c6](https://github.com/C0deWiz4rd010/pitch-legends/commit/4d275c6458b91cd15a56da4e6aa81f68b090dd30))
* **polish:** deepen match rules and finish responsive pixel UI ([9ad1278](https://github.com/C0deWiz4rd010/pitch-legends/commit/9ad1278b2f2e0c79db4a2096e7a05c9cd9b0bb62))
* **transfers-ui:** rebuild the transfer hub and contract workflows ([9dd01bd](https://github.com/C0deWiz4rd010/pitch-legends/commit/9dd01bdc9928510ae9eec9b538772dd07c6f3b29))
* **transfers:** add living transfer economy and negotiation engine ([2762822](https://github.com/C0deWiz4rd010/pitch-legends/commit/276282200681a317705414f7f2ac81edbc4e2403))
* **ui:** app shell, routing, shared components, start screen and unit tests ([a23383a](https://github.com/C0deWiz4rd010/pitch-legends/commit/a23383ae6af84216356708570a4262d93efbf34c))
* **ui:** dashboard, squad, deep tactics editor, training, match centre, transfers, league, facilities and settings pages ([5960ecb](https://github.com/C0deWiz4rd010/pitch-legends/commit/5960ecb9c4c037aa6582060643f26876756c5b18))
* **ui:** rebuild the game in a 32-bit pixel arcade style ([8b152ec](https://github.com/C0deWiz4rd010/pitch-legends/commit/8b152ecb57be1e32d26c8f10ff7cba2d839d0b53))
* **ui:** redesign dashboard (club hero, form, season progress, star player) and squad (search, filter counts, richer player cards) ([8a1be9f](https://github.com/C0deWiz4rd010/pitch-legends/commit/8a1be9fba4cda806146d510350a5f3fd51929f7b))
* **visuals:** add deterministic club and player identities ([3b0ca7c](https://github.com/C0deWiz4rd010/pitch-legends/commit/3b0ca7cf9827173cebf06b4e9e2dce3a5aa7e03e))


### Bug Fixes

* **build:** add missing shared _page.scss partial (broke CI build) ([af801ae](https://github.com/C0deWiz4rd010/pitch-legends/commit/af801aecc565e025dac398f5ca3918f3b3bc265d))
* **ci:** stabilize browser performance checks ([8b1bc3f](https://github.com/C0deWiz4rd010/pitch-legends/commit/8b1bc3fbc320e369daa8e0c880615781eaf72b04))
* **portraits:** align DiceBear v10 generation options ([e3216c0](https://github.com/C0deWiz4rd010/pitch-legends/commit/e3216c0615775d07af42a539f9389f011fd44a5e))


### Performance Improvements

* **gameplay:** interpolate match rendering and stabilize frame pacing ([43dfd6f](https://github.com/C0deWiz4rd010/pitch-legends/commit/43dfd6f1d817f0e4ff3c7b62eef80a2fe2c4a31e))

## [1.1.0] - 2026-07-31

### Added

- Interactive deterministic live matches, coach mode and match scouting.
- Pixel-art club identities, players, stadium presentation and control handbook.

[1.1.0]: https://github.com/C0deWiz4rd010/pitch-legends/releases/tag/v1.1.0
