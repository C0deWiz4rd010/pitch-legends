> Historisches Dokument. Der aktuelle verbindliche Plan ist [Pitch Legends 2.0](PITCH_LEGENDS_2_0_MASTERPLAN.md).

# Pitch Legends — Project Plan (A → Z)

A browser-based **football manager RPG** built with Angular 22. This document is the
end-to-end plan that guided the build, from empty folder to a deployed game on GitHub
Pages.

- **Repo:** https://github.com/C0deWiz4rd010/pitch-legends
- **Live:** https://c0dewiz4rd010.github.io/pitch-legends/
- **Branch flow:** work on `develop`, deploy on every push via GitHub Actions.

## 1. Concept

You manage a football club. Build a squad of individually-modelled players, grow them
with real RPG progression (XP, levels, skill points, unlockable traits), design a deep
tactical setup (formation, per-player roles & instructions, team shape, set-pieces), and
simulate matches with a live 2D canvas view + commentary ticker. Climb the league, trade
on the transfer market, and upgrade club facilities across full seasons. Everything runs
client-side and saves to `localStorage` (plus JSON export/import).

## 2. Tech Stack

- Angular 22 (standalone components, signals, new control flow `@if/@for/@switch`)
- TypeScript (strict)
- Custom SCSS design system (CSS variables, dark neon-pitch theme, responsive)
- Canvas 2D match renderer (`requestAnimationFrame`, interpolated movement)
- Signal-based state services + `localStorage` persistence
- GitHub Actions → GitHub Pages

## 3. Architecture

```
src/app/
  models/       Domain interfaces & enums (player, tactics, team, match, league, game)
  core/
    util.ts         RNG (seedable), clamp, uid
    ratings.ts      overall, role-fit, effective match rating
    progression.ts  XP curve, skill-point & upgrade costs
    services/       game-state, save, rpg, training, match-engine, season,
                    transfer, facilities
  data/         roles, formations, traits, names, generators (players/teams/league)
  shared/       rating-color helpers, stat-bar, radar-chart, player-detail modal
  features/     start, dashboard, squad, tactics, training, match, transfer,
                league, facilities, settings
```

## 4. Deep Tactical System (priority)

- **Formations:** 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2, 4-1-2-1-2 diamond.
- **Roles (24):** e.g. Sweeper Keeper, Ball-Playing Defender, Wing-Back, Anchor,
  Deep-Lying Playmaker, Box-to-Box, Mezzala, Advanced Playmaker, Shadow Striker,
  Inside Forward, Poacher, Target Man, False Nine … each reweights attributes.
- **Per-player instructions:** duty (defend/support/attack), forward runs, marking,
  pressing bias, hold-position.
- **Team shape:** mentality, pressing, tempo, width, defensive line, build-up style,
  passing style, offside trap, counter-attack.
- **Set-pieces & leadership:** captain, penalty / free-kick / corner takers.
- **Role-fit rating** per slot warns about square pegs; drag players from the bench into
  slots on an interactive pitch.

## 5. RPG Systems

- XP from matches (apps, goals, assists, ratings, results) and training drills.
- Level up → skill points → spend to push individual attributes (soft-capped by potential).
- Unlockable traits/perks (Clinical Finisher, Engine, Playmaker, The Wall, Wonderkid …).
- Morale, form, fitness and injuries dynamically affect match performance.

## 6. Match Engine

Minute-by-minute simulation using per-zone team strength derived from the lineup's
effective ratings + all tactical modifiers + home advantage + seedable randomness.
Produces an event log, team stats, per-player ratings/contributions, a Man of the Match,
and positional keyframes that drive the canvas replay.

## 7. Build Phases (each pushed to `develop`)

0. **Repo & CI** — scaffold, README, git init, remote repo, Pages deploy workflow.
1. **Foundation** — SCSS design system, domain models.
2. **State & data** — game-state & save services, procedural generators.
3. **Systems** — ratings, RPG, training, match engine, season/league services.
4. **UI** — app shell + 9 feature pages (incl. the tactics editor & match centre).
5. **Polish & docs** — balancing, responsive pass, this documentation.
6. **Deploy** — base-href, SPA 404 fallback, verify live site.

## 8. Persistence

- Autosaves to `localStorage` after every action (toggleable).
- Full JSON export/import from the Settings and Start screens.

## 9. Deployment

GitHub Actions builds with `--base-href /pitch-legends/`, copies `index.html` to
`404.html` for SPA routing, adds `.nojekyll`, and publishes `dist/pitch-legends/browser`
to GitHub Pages on every push to `develop`.

## 10. Verification

- `npm run build` passes within budgets; `npx ng test --watch=false` green.
- Manual loop: new game → train & level up → play a match (canvas + ticker) → standings
  update → buy/sell → upgrade facilities → reload persists → JSON round-trips.
