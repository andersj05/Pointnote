# Verification and troubleshooting

## Required checks

```sh
npm run check
npm run test:e2e
npm run package
```

Install the browser once with `npx playwright install chromium`. The test suite loads the real unpacked extension in a fresh Chromium profile and triggers its toolbar action through Chromium's extension debugging API. The production manifest keeps its normal permissions.

| Check                   | Coverage                                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`         | TypeScript, ESLint, Prettier, unit tests, production build                                                                                                                                                                                                                        |
| Unit tests              | Sanitized context and URLs, conservative anchors, text ranges, IndexedDB migrations and transactions, review metadata, backups, screenshot cropping, export contents, voice lifecycle and shortcut handling, panel bounds                                                         |
| Browser tests           | Real extension persistence/restarts, selection and reattachment, page/area/comparison notes, masked viewport and close-up pixels, screenshot markup and retained originals, handoffs and clipboard recovery, sessions, review decisions, backup restore, and page-scoped deletion |
| Interaction regressions | Keyboard target selection and panel resizing, focus after async selection/review actions, session-name validation, saved Details/priority state, filtered counts, small-window screenshot controls, and Escape/discard recovery                                                   |
| Voice browser tests     | Simulated recognition, delayed startup/final words, cancellation and permission failures, editable drafts, offscreen ownership, saved consent and shortcuts, reduced motion, and extension microphone setup using fake hardware                                                   |
| Package                 | Locally bundled executable code, installable ZIP without source maps                                                                                                                                                                                                              |

Browser failures write screenshots and diagnostics to `test-results/` and `playwright-report/`. Selected successful cases also retain UI screenshots and exported bundles for inspection. CI uploads failed diagnostics and build/package artifacts. These generated directories are ignored by Git.

## Manual acceptance

Use the [installation instructions](../README.md) and the [user guide](user-guide.md).

1. **Review and handoff:** on the sample report, annotate the 38% claim, comparison chart, and recommendation cards. Reload/restart, revisit the targets, and inspect an exported ZIP. Its Markdown and images should identify the intended changes without guessing source files.
2. **Changed targets and privacy:** use the report's replace/remove/duplicate controls while selection is paused. Check explicit reattachment states and preserved original words. On the frontend, confirm private form content is masked in viewport and close-up images and absent from exported context. Try screenshot opt-out.
3. **Keyboard and layout:** Tab to a page control and select it with Enter/Space; it must not activate. Pause selection and verify normal activation. Move/resize the panel with both pointer and arrow keys, including the left edge. Check narrow windows, large browser zoom, Settings, minimization, saved layout, and focus returning after review actions.
4. **Comparisons and screenshots:** choose change/reference targets, swap roles, save/reload, and inspect the handoff. Open a screenshot, switch views, draw an arrow, add a keyboard callout, undo, and save. Check original and marked exports. Try a 320 × 480 window and a 600 × 400 window; scroll to callouts and confirm Save remains reachable. Escape should dismiss a discard prompt before closing the studio. Try conflicting edits in another tab.
5. **Sessions and review:** create a named session, add notes on two pages, and explicitly add older notes. Set one Later. Verify the handoff scope and selection. Accept one change and request another pass on another; only remaining open Now notes should be selected by default. The original comment must remain unchanged.
6. **Recovery:** back up, delete a page's saved notes, preview the backup, and restore. Existing IDs must be kept, repeated restores must not duplicate notes, and other pages must remain intact. Delete confirmation should report the whole page count even while filtered.
7. **Physical voice:** use Chrome and Edge with a real microphone. Enable the microphone from Pointnote's setup page; another page should not request permission again. Install an on-device language pack, wait for Listening, speak, release, edit, save, and inspect the original transcript. Test denial/unavailable language and explicitly opt in before testing Browser service. Raw audio must not be retained.
8. **Mouse and focus:** hold the scroll wheel over the page and panel using an existing selection. Release outside the window, switch tabs, and pause/minimize/close. Check that recording stops, final words survive, and normal middle-click behavior returns while paused. Hands-free recording should tolerate browser-control focus but stop when switching tabs.

Automated checks do not validate physical microphone quality, language-pack downloads, browser vendor transcription, device drivers, screen-reader behavior, or Edge's installation UI. Record those results separately when performing a release acceptance pass.

## Troubleshooting

- **Voice setup says Unknown request or asks for a reload:** the page and extension background are running different builds. Rebuild, open `chrome://extensions` or `edge://extensions`, reload Pointnote, then refresh the reviewed page. Saved notes and settings are preserved.
- **Target is missing or ambiguous:** choose Reattach and explicitly select the intended target. Comparisons require both roles again. Original comments and previous evidence are retained.
- **Panel is awkwardly placed:** use Settings → Workspace → Reset layout. The default is 360 × 520 pixels, clamped to the current window.
- **Clipboard copy is blocked:** use Save Markdown file. The failed copy should leave the preview and selected notes available.
- **Screenshot cannot be captured or edited:** read the displayed reason. Scroll the target into view before capturing; reopening the studio uses the saved image. If another tab changed it, reopen the latest version before editing.
- **GitHub CLI reports an invalid token only inside Codex's sandbox:** follow [AGENTS.md](../AGENTS.md) and verify the relevant `gh` command outside the sandbox before changing authentication.
