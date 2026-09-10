# Pointnote development

- Branch flow: `main` (releases) ← `dev` (integration) ← `feat/<feature>`.
- Start features from `dev`. Never develop directly on `main` or `dev`.
- Commit frequently at small, coherent milestones. Use conventional commit messages.
- Feature pull requests target `dev`; release pull requests target `main`.
- Run `npm run check` and `npm run test:e2e` before marking work ready.
- Preserve original comments. Never export form values or silently attach ambiguous targets.
- Keep extension permissions minimal and all executable code bundled locally.
- GitHub CLI credentials for `andersj05` are in Windows Credential Manager. Verify authentication outside the sandbox before diagnosing an authentication failure; never suggest logout/login based only on sandboxed checks.
