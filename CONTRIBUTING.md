# Contributing

## Ownership

| Person | Folders |
|---|---|
| A | `forge-app/` (except `src/contracts/`), `mocks/runner-mock/` |
| B | `runner/`, `demo-app/`, `infra/`, `mocks/fixtures/` |
| Both | `packages/contracts/`, `scripts/`, root config, `docs/` |

Edit only your own folders. If you need something from the other side, ask or open an issue.

## Contracts

`packages/contracts` is the only place the two halves meet.

- Change it only in its own small PR, approved by the other person.
- Add fields; don't rename or remove them. Make new fields optional when you can.
- Keep `pnpm test` green: it checks `demo-app/manifest.json` and `mocks/fixtures/*` against the schemas.
- Run `pnpm sync:contracts` in the same PR so `forge-app/src/contracts` matches. CI fails if it doesn't. Never edit that folder by hand.

## Branches and merges

- Branch names: `a/<thing>` or `b/<thing>` (for example `a/workspace-ui`, `b/sandbox`). Contract changes: `contracts/<thing>`.
- Open a PR into `main`. CI must pass.
- Merge at least every 6 hours to keep merges small.
- **Every merge to `main` updates `README.md`**: the status table and a changelog line.

## Dependencies

Add packages only inside your own package: `pnpm --filter @pr-agent/<pkg> add <dep>` for workspace packages, `npm install <dep>` inside `forge-app/` (it uses npm so `forge deploy` sees a normal `node_modules`). Root `package.json` changes go in a contracts PR.
