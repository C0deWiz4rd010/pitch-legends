# Contributing

## Local checks

```bash
npm ci
npm run version:check
npm test -- --watch=false
npm run build
npm run test:e2e
```

## Commits and releases

Use Conventional Commits with a focused scope, for example:

- `fix(match): keep the scoreboard in sync`
- `feat(transfers): add loan negotiations`
- `perf(renderer): interpolate simulation frames`
- `feat!: replace the career save schema`

`fix` creates a patch release, `feat` creates a minor release and a breaking
change creates a major release. Release Please maintains a release pull request
against `develop`; merging that pull request updates the version and changelog,
creates the `vX.Y.Z` tag and publishes the GitHub release.
