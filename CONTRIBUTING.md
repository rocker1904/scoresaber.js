# Contributing

Thanks for helping out! This is a small, typed wrapper around the ScoreSaber v2 API.

## Setup

```bash
npm ci
```

Requires Node.js 20+.

## Day-to-day scripts

| Script                  | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `npm test`              | Offline unit + contract suites (mock fetch, no network)               |
| `npm run test:coverage` | Same, with a coverage summary                                         |
| `npm run typecheck`     | Type-checks `src` **and** `test` (incl. the compile-time contracts)   |
| `npm run lint`          | ESLint (type-checked rules)                                           |
| `npm run format`        | Prettier write (`format:check` to verify)                             |
| `npm run build`         | tsup → dual ESM/CJS + `.d.ts` in `build/`                             |
| `npm run smoke`         | Post-build: both module systems load through the `exports` map        |
| `npm run api:check`     | Fails if the committed API report is stale (`api:update` regenerates) |

Live tests hit the real API and are opt-in:

```bash
SCORESABER_INTEGRATION=1 npm test
```

## Public API changes

Any change to the public surface must include an updated API report:

```bash
npm run api:update   # regenerates etc/scoresaber.js.api.md
```

CI (`api:check`) fails if you forget. Reviewing the report diff is the fastest way
to see whether a change is additive (minor) or breaking (major).

## Updating the API spec

`spec/openapi.json` is the source of truth for the generated types. To refresh:

```bash
npm run fetch-spec    # pulls the live spec out of the ScoreSaber docs page
npm run gen:types     # regenerates src/generated/openapi-types.ts
npm run api:update
```

This also runs weekly via the **Spec sync** workflow, which opens a PR when the
spec changes. (If `fetch-spec` can't extract the spec — e.g. the docs page
changes shape — it exits non-zero; update `spec/openapi.json` by hand instead.)

## Releasing

Releases are automated with [Changesets](https://github.com/changesets/changesets).

1. Add a changeset describing your change and its bump level:
    ```bash
    npx changeset
    ```
2. On merge to `main`, the release workflow opens/updates a **Version Packages**
   PR (bumps version, updates `CHANGELOG.md`).
3. Merging that PR publishes to npm with provenance.

Humans decide the bump level — nothing auto-classifies it from the diff.

**One-time setup:** the release workflow needs an `NPM_TOKEN` repository secret
(an npm automation token with publish rights).
