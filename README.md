# ⚽ Pitch Legends

A browser-based **arcade football and manager RPG** built with Angular. Build your club, grow
individual players with real RPG progression (XP, levels, skill points, traits),
craft a deep tactical setup, and play matches with procedural 3D footballers,
keyboard/gamepad/touch controls, or AI control. Climb the league, work the transfer market, and upgrade your
facilities across a full season — all in your browser, no backend required.

**▶ Play:** https://C0deWiz4rd010.github.io/pitch-legends/

## Features

- **Deep tactical team management** — formations, per-player roles & instructions,
  team mentality, pressing, tempo, width, defensive line, build-up & passing style,
  offside trap, set-piece takers, captain, and live in-match adjustments.
- **Individual players & stats** — 8 core attributes, derived overall, potential,
  morale, form, fitness, injuries and market value.
- **RPG progression** — earn XP from matches & training, level up, spend skill
  points, and unlock powerful traits/perks.
- **Match engine** — deterministic 60 Hz football with a Three.js pitch, individual
  animated players, calmer camera tracking, selectable player-switching assistance,
  goalkeeper actions, goal replays and independent audio channels.
- **Quick play and player studio** — enter an exhibition match without a career,
  or inspect procedural identities and animations with a scrubbable timeline.
- **Season, league & transfers** — round-robin fixtures, standings, top scorers,
  buying & selling players, and facility upgrades.
- **Save anywhere** — autosaves to `localStorage` with JSON export/import.

## Tech Stack

Angular 22 (standalone + signals) · TypeScript · Custom SCSS design system ·
Three.js / WebGL 2 · GitHub Actions → GitHub Pages.

## Development

```bash
npm install
npm start        # dev server at http://localhost:4200
npm run build    # production build
npm test         # unit tests (vitest)
```

Browser QA for the optimized production build (also used in Pages CI):

```bash
node tools/write-build-info.mjs
npm run build
npx playwright install chromium
PLAYWRIGHT_PRODUCTION=1 npm run test:e2e
```

In PowerShell, set `$env:PLAYWRIGHT_PRODUCTION='1'` before running the tests.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an installed Chrome executable;
`PLAYWRIGHT_SOFTWARE_GL=1` additionally exercises the reduced software-rendering profile.
The production QA server requires port 4200 to be free. Normal `npm run test:e2e`
continues to use the development server.

The 2.0 upgrade is in progress. See the [masterplan](docs/PITCH_LEGENDS_2_0_MASTERPLAN.md),
[implementation evidence](docs/IMPLEMENTATION_2_0_LOG.md), and
[asset/animation quality decisions](docs/ASSET_ANIMATION_QUALITY_PLAN.md) for completed and open work.

## License

MIT
