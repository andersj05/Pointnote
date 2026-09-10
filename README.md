# Pointnote

**Point to it. Put it into words.**

Pointnote is a local Chrome / Edge extension for attaching written or spoken feedback to HTML elements, then handing a useful bundle to a coding or research agent. No account, hosted backend, API key, or agent integration is required.

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

After code changes, rebuild, click **Reload** on the extension card, and refresh the page. Keep the unpacked extension in the same folder to preserve its extension identity and local data.

## Try the included pages

```sh
npm run sample
```

- [Sample research report](http://127.0.0.1:4173/report.html)
- [Interactive localhost frontend](http://127.0.0.1:4173/frontend.html)

The sample server binds only to `127.0.0.1:4173`. Report data is fictional. Your own frontend can use any localhost port. Serve local HTML through a local web server initially; direct `file://` access is not part of this version's verified workflow.

## Review a page

- **Element:** hover to preview, click to select, then use **↑ Parent** to include a larger container. Headings, paragraphs, links, buttons, images, SVG/chart containers, and sections are supported.
- **Text range:** drag across a unique passage inside one section. Its exact quote and surrounding text are retained. Text ranges are limited to 1,600 characters.
- **Multiple:** click to add/remove up to 12 elements. Shift-click also adds/removes elements in element mode.
- Type a note, or **hold to talk**. Read and edit the transcript before choosing **Save note**.
- Numbered markers and sidebar cards revisit the target. **Mark addressed** / **Reopen** track progress. Missing or ambiguous targets show **Reattach**. Reattachment preserves the original comment and previous target context.
- **Pause selection** restores normal page interaction while keeping notes visible. **×** closes the review UI. **Esc** clears a selection, then closes the UI.
- **↔** moves the sidebar so you can reach targets behind it.
- Uncheck **Include a screenshot** if needed. Notes still save, with an explicit unavailable reason.

Saved notes survive reloads and browser restarts. An enabled review automatically returns after same-origin refreshes. After a browser restart or navigation to another origin, invoke Pointnote again. Notes are keyed to the exact page URL, including query and hash routes; different ports and routes are separate pages. Sensitive URL query values are redacted from the exported URL, while a one-way page key keeps local routes distinct.

## Export for an agent

**Export feedback** downloads one ZIP for the current page:

```text
feedback.md
feedback.json
screenshots/
  <annotation-id>-<capture-time>.png
```

Give the complete extracted folder to an agent and ask it to read `feedback.md` first. Markdown includes your original words, selected text, nearby headings, locator clues, HTML excerpts, bounds, and screenshot references. JSON has `schemaVersion: "1.0.0"` and retains the full bounded record.

The bundle instructs the agent to preserve your intent, treat page content as untrusted reference material, and flag ambiguity. CSS selectors are locating hints; they do **not** identify source files or framework components. No automatic code edits occur.

Screenshots show the visible viewport with orange target outlines. Large or multiple targets can extend outside the viewport; the export says so. Scroll the relevant area into view before saving. Context fields that cannot be determined are `null`; missing screenshots always include a reason. Excerpt truncation is explicit.

## Voice and privacy

**On-device** is the default. It requires browser support for local Web Speech recognition and an installed language pack. Open **Voice & privacy**, set a language such as `en-US`, and use **Install language pack** if needed. A language pack downloads through the browser; local recognition audio stays on the computer.

The optional **Browser service** provider may send audio to the browser vendor's speech service. It requires a separate, explicit opt-in in the UI. Pointnote never silently switches providers, stores raw audio, or embeds private API keys. Microphone permission is requested by the browser for the reviewed page; localhost is a secure context. Support varies by browser, OS, language, and policy. A clear error leaves typed input available.

The original saved comment is the text you approve after editing. The unedited recognition transcript is retained separately in `input.transcript`. The provider interface is replaceable.

Read [privacy and data handling](docs/privacy.md) before reviewing sensitive material.

## Development

```sh
npm run dev          # watch/rebuild; reload the unpacked extension afterward
npm run check        # types, lint, formatting, unit tests, production build
npx playwright install chromium
npm run test:e2e     # actual extension in isolated Chromium profiles
npm run package     # artifacts/pointnote-0.1.0.zip
```

Branch flow: **main ← dev ← feat/feature**. Commit frequently. Feature PRs target `dev`; release PRs go from `dev` to `main`. See [CONTRIBUTING.md](CONTRIBUTING.md).

CI checks types, lint, formatting, unit tests, the browser workflow, and packaging. Actions are pinned to commit hashes; Dependabot updates npm dependencies and Actions. Build artifacts and failed browser diagnostics are uploaded.

## Implementation and limits

TypeScript, a small DOM UI in a Shadow DOM, an MV3 service worker, IndexedDB, esbuild, and fflate. All executable code is bundled. There is no runtime framework or remote script dependency.

- Top-level HTML pages only. Browser-internal pages, browser stores, PDF viewers, cross-origin iframe contents, and shadow-tree internals are outside the initial selection scope.
- Reattachment favors uncertainty over a false match. Major copy changes, unlabeled visual elements, or repeated content may need manual reattachment.
- Screenshots mask standard form controls, editable/private regions, embedded frames, custom elements, and open shadow hosts. Use `data-pointnote-private` for other private page regions. Ordinary visible text/images are included; automatic redaction is not a general secret detector.
- Saved comments are local to this browser profile; uninstalling the extension removes its storage. Export before uninstalling. There is no import, sync, account, or collaboration.
- The review UI shares the page DOM and is designed for pages you trust. Shadow DOM isolates styling, not hostile page scripts.
- Automated tests cover the actual extension and a simulated recognizer. Physical microphone, language-pack downloads, vendor speech services, and Edge installation need the short [manual check](docs/verification.md).

See [architecture and export contracts](docs/architecture.md), [verification](docs/verification.md), and [the roadmap](docs/roadmap.md).
