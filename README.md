# ⚽ Pitch Legends

A browser-based **arcade football and manager RPG** built with Angular. Build your club, grow
individual players with real RPG progression (XP, levels, skill points, traits),
craft a deep tactical setup, and play matches with procedural 3D footballers,
keyboard/gamepad/touch controls, or AI control. Climb two divisions, win the cup, work the transfer
market and upgrade your facilities season after season — all in your browser, no backend required.

**▶ Play:** https://C0deWiz4rd010.github.io/pitch-legends/

## Features

- **Match engine** — deterministic 60 Hz football with a Three.js stadium, individual animated
  players, broadcast cameras, goalkeeper dives, set pieces with walls, stoppage time, extra time and
  penalty shoot-outs, goal replays and synthetic crowd audio.
- **Controls** — keyboard, gamepad and touch with jockeying, skill moves, through balls, crosses,
  finesse, chip and power shots. Every key and gamepad button can be rebound; touch controls can be
  resized, moved up, faded and mirrored for left-handed play (`/controls`).
- **Career** — two divisions with promotion and relegation, a knockout cup, club finances for every
  club, board confidence, objectives renewed each season, ageing, retirements, an academy, scouting
  assignments, a season review and an archive with a hall of fame.
- **Tactics and squad** — formations, per-player roles and instructions, mentality, pressing, tempo,
  width, defensive line, build-up, offside trap, set-piece takers and live quick tactics.
- **Game modes outside the career** — *Legends Team* (collect cards from packs earned by playing, build
  chemistry, Division Rivals, Draft, tasks and squad-building challenges — no real money), quick match
  (11 v 11 or 5 v 5 in a cage), and training challenges with medals and personal bests.
- **Saves and offline play** — everything is stored in IndexedDB on the device, with backups before
  every migration, visible errors when storage is full and recovery of damaged saves. A service worker
  lets the game reload offline; JSON export and import are available in the settings.
- **German and English** throughout.

## Tech Stack

Angular 22 (standalone + signals) · TypeScript · Custom SCSS design system · Three.js / WebGL 2 ·
IndexedDB · Angular service worker · Vitest · Playwright · GitHub Actions → GitHub Pages.

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
`PLAYWRIGHT_SOFTWARE_GL=1` additionally exercises the reduced software-rendering profile and
`PLAYWRIGHT_CROSS_BROWSER=1` adds a functional run of the tests tagged `@cross` in Firefox and WebKit
(`npx playwright install firefox webkit` first). The production QA server requires port 4200 to be free.
Normal `npm run test:e2e` continues to use the development server.

Balance checks:

```bash
npm run balance:check   # 500 AI matches: goals, shots, passing, draws, home wins, simulation speed
```

The ten-season career simulation (`src/app/career-longrun.spec.ts`) runs with the unit tests and guards
squad sizes, ratings, ages and club finances over a decade.

See the [implementation log](docs/IMPLEMENTATION_2_0_LOG.md) for what each phase changed, how it was
verified and what is still open, and the [masterplan](docs/PITCH_LEGENDS_2_0_MASTERPLAN.md) for the
original 2.0 plan.

## License

MIT
