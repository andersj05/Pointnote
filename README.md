# Pointnote

**Point to it. Put it into words.**

Pointnote is a local Chrome / Edge extension for attaching written or spoken feedback to a page, then handing useful context to a coding or research agent. No account, hosted backend, API key, or agent integration is required.

## Install locally

Use Node.js 22.13 or newer (Node 24 is used in CI).

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's **dist** folder.
4. Pin Pointnote in the extensions menu.
5. Open an HTML page and click the Pointnote toolbar icon. The shortcut is **Ctrl+Shift+Y** (**Cmd+Shift+Y** on macOS); change it on the browser's extension shortcuts page if occupied.

After code changes, rebuild, click **Reload** on the extension card, and refresh the page. Keep the unpacked extension in the same folder to preserve its identity and local data. Rebuilding or refreshing the page alone does not reload the extension background.

## Your first review

1. Choose an **Element**, **Text range**, **Page note**, or **Select area**. Use **Multiple** for several targets or **Compare** to pair a change target with a reference. Keyboard users can Tab to a page control and press Enter or Space to select it.
2. Write your feedback. Voice is optional: choose **Set up voice**, then hold **Hold to talk** or the middle mouse button while selection is on.
3. Choose **Save**, press **Ctrl+Enter** / **Cmd+Enter**, or select the next target to save automatically. Notes stay in this browser.
4. Choose **Prepare handoff**, review the selected notes, and copy Markdown or download Markdown / ZIP. Choose ZIP to include screenshots and visible markup. Give the extracted folder to your agent and ask it to read `feedback.md` first.

Use **Pause selection** to interact with the page normally. **Review sessions** groups notes across pages and includes backup/restore. **Check changes** compares the original evidence with the page so you can accept changes or request another pass.

The [user guide](docs/user-guide.md) covers selection, keyboard controls, voice, screenshot editing, review sessions, handoffs, backups, and recovery.

## Try the included pages

```sh
npm run sample
```

- [Sample research report](http://127.0.0.1:4173/report.html)
- [Interactive localhost frontend](http://127.0.0.1:4173/frontend.html)

The sample server binds only to `127.0.0.1:4173`. Report data is fictional. Your own frontend can use any localhost port. Serve local HTML through a web server; direct `file://` access is outside the verified workflow.

## Data and limits

- Notes are local to the browser profile and exact page URL, including query and hash routes. Uninstalling removes extension storage; download a backup first.
- Screenshots mask recognized form controls and private regions. Ordinary visible text and images remain included. Read [privacy and data handling](docs/privacy.md) before reviewing sensitive material.
- On-device voice is the default and needs browser support plus a language pack. The optional browser speech service requires explicit consent. Raw audio is never stored.
- Top-level HTML pages are supported. Browser-internal pages, browser stores, PDF viewers, cross-origin iframe contents, and shadow-tree internals are outside the selection scope.
- Ambiguous or missing targets require explicit reattachment. Selectors describe the browser DOM; they do not identify source files. There are no automatic code edits, cloud sync, or collaboration.
- Pointnote is intended for pages you trust. Shadow DOM isolates styles, not hostile page scripts.

## Development

```sh
npm run dev          # watch/rebuild; reload the unpacked extension afterward
npm run check        # types, lint, formatting, unit tests, production build
npx playwright install chromium
npm run test:e2e     # real extension in isolated Chromium profiles
npm run package     # installable ZIP in artifacts/
```

Branch flow: **main ← dev ← feat/feature**. Start work from `dev`, commit small milestones, and open feature PRs against `dev`. Release PRs go from `dev` to `main`. See [CONTRIBUTING.md](CONTRIBUTING.md) for required checks and branch protection.

TypeScript, Shadow DOM, an MV3 service worker, IndexedDB, esbuild, and fflate. All executable code is bundled locally.

- [User guide](docs/user-guide.md)
- [Architecture and export contracts](docs/architecture.md)
- [Verification and troubleshooting](docs/verification.md)
- [Privacy](docs/privacy.md) and [security reporting](SECURITY.md)
- [Changelog](CHANGELOG.md)
