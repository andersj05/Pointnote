# Contributing

Use Node.js 22.13 or newer (CI uses 24), then `npm ci`.

## Branches and commits

`main` holds releases. `dev` integrates reviewed work. Start each feature from `dev` with `git switch -c feat/short-description dev`. Fixes, maintenance, and documentation use `fix/`, `chore/`, and `docs/` respectively.

Commit small, coherent changes frequently with conventional messages such as `feat: add element selection` or `fix: reject ambiguous anchors`. Feature PRs target `dev`. Release PRs go from `dev` to `main`. Do not push implementation directly to either protected branch.

## Checks

Run `npm run check` and `npm run test:e2e`. Install the test browser once with `npx playwright install chromium`. CI runs type checking, ESLint, formatting, unit tests, real extension browser tests, and packaging. Failed browser runs upload diagnostics. `npm run dev` rebuilds scripts; reload the extension and page after changes.

## Scope

Keep data local, retain original words, bound context, and test ambiguous or removed targets. Use `textContent` for page/user strings in UI. Adding permissions, network providers, or export schema changes requires an explicit explanation in the PR.

## GitHub repository settings

Both main and dev require pull requests, up-to-date quality/browser checks, branch-policy checks, and resolved review conversations. Force pushes and deletion are disabled, including for administrators. The current solo-maintainer policy requires no additional reviewer approval; add one when there is another maintainer. The reproducible settings are in `.github/branch-protection.json`.

Squash feature PRs into dev. Release PRs from dev to main may use a merge commit to retain the integration history. GitHub automatically deletes merged feature branches; protected branches are retained. Dependabot's schedule becomes active once its configuration is present on the default branch.
