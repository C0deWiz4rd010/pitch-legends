# ⚽ Pitch Legends

A browser-based **football manager RPG** built with Angular. Build your club, grow
individual players with real RPG progression (XP, levels, skill points, traits),
craft a deep tactical setup, and simulate matches with a live 2D pitch view and
commentary ticker. Climb the league, work the transfer market, and upgrade your
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
- **Match engine** — minute-by-minute simulation driven by your tactics, rendered on
  an animated 2D canvas alongside a live commentary ticker.
- **Season, league & transfers** — round-robin fixtures, standings, top scorers,
  buying & selling players, and facility upgrades.
- **Save anywhere** — autosaves to `localStorage` with JSON export/import.

## Tech Stack

Angular 22 (standalone + signals) · TypeScript · Custom SCSS design system ·
Canvas 2D · GitHub Actions → GitHub Pages.

## Development

```bash
npm install
npm start        # dev server at http://localhost:4200
npm run build    # production build
npm test         # unit tests (vitest)
```

## License

MIT

