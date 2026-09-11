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

If **Set up voice** reports **Unknown request** or asks you to reload Pointnote, the page and extension background are running different builds. Open `chrome://extensions` (or `edge://extensions`), click **Reload** on Pointnote, then refresh the reviewed page and reopen Pointnote. Rebuilding or refreshing the page alone does not reload the extension background. Saved notes and settings are preserved.

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
- Type a note, or select your target and **hold the middle mouse button (press the scroll wheel)** anywhere on the page or panel to talk. Release to finish. This uses your current selection, including text ranges and multiple targets; it never changes the target under your cursor. A recording indicator stays visible on the page.
- The compact **Hold to talk** button and **Space** while it is focused also work. The adjacent record button starts **hands-free recording**; click Stop when done. Release to leave an editable draft. **Selecting your next target saves the current note automatically**, including final words still arriving from the microphone. Switching selection modes or opening another saved note also saves your draft first. Use the **✓ Save note** button or **Ctrl+Enter** (**Cmd+Enter** on macOS) to save immediately; The **× Clear** button beside it discards the current draft. Parent and multi-select refine the current target without creating separate notes. If saving fails, the draft and original target stay in place for retry.
- Numbered markers and each note’s **Locate** button revisit the target. **Mark addressed** / **Reopen** track progress. Missing or ambiguous targets show **Reattach**. Reattachment preserves the original comment and previous target context.
- Use the **trash button in the top bar** to clear all saved notes for the current page. Confirm the page’s note count before deleting. Search filters do not limit this action; other pages and your unsaved draft are preserved.
- Search notes or filter by open, addressed, or reattachment status. Exports always include all notes on the current page.
- **Pause selection** restores normal page interaction while keeping notes visible. The configured voice shortcut is active only while selection is on; normal middle-click behavior returns while paused, in settings, minimized, or closed. **×** closes the review UI. **Esc** stops recording, returns from settings, restores a minimized panel, or clears a selection before closing the UI.
- Drag the title bar to move the panel; drag either bottom corner to resize it. **Settings → Workspace → Switch sides** moves it to the opposite side. Focus the title bar or a resize handle and use arrow keys for keyboard adjustments; hold Shift for larger steps.
- **Minimize** keeps a compact title bar available and restores normal page use. Restore it to continue your draft.
- Open **Settings** with the gear icon for screenshots, voice, language, and **Reset layout**. Turning off **Include screenshots** still saves notes with an explicit unavailable reason. The default panel is 360 × 520 pixels, with recording activity kept inside the voice toolbar. Settings and panel position/size are remembered locally; the panel stays within the current window. Use Reset layout to adopt the compact default if you have a saved layout.

Saved notes survive reloads and browser restarts. An enabled review automatically returns after same-origin refreshes. After a browser restart or navigation to another origin, invoke Pointnote again. Notes are keyed to the exact page URL, including query and hash routes; different ports and routes are separate pages. Sensitive URL query values are redacted from the exported URL, while a one-way page key keeps local routes distinct.

## Export for an agent

**Export feedback** saves your pending note, then offers three choices for all notes on the current page:

- **Copy Markdown to clipboard** — paste your feedback and target context directly into a chat.
- **Save Markdown file** — download one standalone `.md` file. It contains your exact comments, the page URL, current target clues and selected text, plus warnings for unresolved targets. It skips screenshot commentary, timestamps, internal IDs, viewport data, HTML dumps, and old attachment history.
- **Save ZIP file** — download Markdown, JSON, and captured screenshots together:

```text
feedback.md
feedback.json
screenshots/
  <annotation-id>-<capture-time>.png
```

Give the complete extracted folder to an agent and ask it to read `feedback.md` first. Markdown in the ZIP includes your original words, selected text, nearby headings, locator clues, HTML excerpts, bounds, and screenshot references. JSON has `schemaVersion: "1.0.0"` and retains the full bounded record.

The bundle instructs the agent to preserve your intent, treat page content as untrusted reference material, and flag ambiguity. CSS selectors are locating hints; they do **not** identify source files or framework components. No automatic code edits occur.

Screenshots show the visible viewport with orange target outlines. Large or multiple targets can extend outside the viewport; the export says so. Scroll the relevant area into view before saving. Context fields that cannot be determined are `null`; missing screenshots always include a reason. Excerpt truncation is explicit.

## Voice and privacy

**On-device** is the default. It requires browser support for local Web Speech recognition and an installed language pack. Open **Settings → Voice**, set a language such as `en-US`, and use **Install language pack** if needed. A language pack downloads through the browser; local recognition audio stays on the computer.

On first opening, choose **Set up voice**. Pointnote opens its own setup screen: click **Enable microphone** and allow the browser prompt once, then return to your page. The permission belongs to the extension, not each reviewed website or file. Setup closes its audio stream immediately and remembers completion across pages and restarts. Browser permission can still require setup again if you revoke it, reset browser data, reinstall the extension, or use a different profile. Then hold **Hold to talk** or your voice shortcut and wait for **Listening** before speaking. On release, Pointnote finishes the transcript before unlocking your draft. Layered teal, blue, and violet waves flow inside the voice button while speech is detected. They are a decorative animation, not a microphone volume measurement. They rest between phrases, stop on release, and respect reduced-motion settings.

The optional **Browser service** provider may send audio to the browser vendor's speech service. It requires a separate, explicit opt-in in the UI. Pointnote never silently switches providers, stores raw audio, or embeds private API keys. Microphone permission is requested for Pointnote’s own extension page; recording runs in its offscreen document. Support varies by browser, OS, language, and policy. A clear error leaves typed input available.

**Settings → Voice → Hold to talk** offers **Middle mouse**, **Backtick (`)**, or **Custom shortcut**. Choose **Record shortcut** and press your key combination or supported extra mouse button; Escape cancels. Keyboard shortcuts leave text fields untouched. Browser/OS reserved shortcuts and device buttons that do not emit browser events cannot be intercepted; map those device buttons to a key combination in their configuration software. Hints update immediately and the binding survives reloads.

The original saved comment is the exact draft text at the time you save or move to the next target. The unedited recognition transcript is retained separately in `input.transcript`. The provider interface is replaceable.

Provider, language, shortcut, setup completion, and explicit browser-service consent are remembered. Uncheck the consent box in **Settings → Voice** to revoke it; old installations without saved consent still require an explicit opt-in. Recording stops when you pause selection, open settings, minimize or close the panel, switch away from the tab, or press Escape. Hold gestures also stop on lost window focus; hands-free sessions tolerate focus moving to browser controls. Releasing before a recognition request is submitted cancels immediately. After submission, release waits briefly for the final transcript. Delayed callbacks after a session ends cannot overwrite your next edits.

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
