# Verification

## Automated checks

`npm run check` runs TypeScript, ESLint, Prettier, focused unit tests, and production builds. `npm run test:e2e` loads the real unpacked extension in Chromium using a fresh profile. It triggers the toolbar action through Chromium's extension debugging API; the production manifest is unchanged and retains its minimal permissions.

The browser suite verifies:

1. Three report notes survive reload and a complete browser restart, and sidebar cards locate their targets again.
2. ZIP export includes readable Markdown, schema-versioned JSON, and substantial PNG images. The three target IDs are asserted against the original requested changes.
3. Replaced and removed targets need explicit reattachment; manual reattachment preserves original words.
4. The localhost frontend's button does not activate during selection, works while paused, and works after Pointnote closes.
5. Private form content is absent from exported context, private screenshot regions are reported, and SPA routes keep separate notes.
6. Multi-element and actual drag-selected text ranges are exported with the right target/quote data.
7. A deterministic recognizer drives the real push-to-talk UI; the transcript can be edited before saving while the original recognition text remains separate.
8. Duplicate targets become ambiguous, addressed resolution is retained, and screenshot opt-out produces an explicit reason.
9. Panel dragging, resizing, keyboard adjustments, minimization, reset, and viewport clamping keep controls reachable. Layout and capture/language preferences survive reloads.
10. Settings and minimization restore normal page interaction while preserving the current draft.
11. Search and status filters affect the displayed notes, while exports retain every note on the page. Repeated keyboard submission saves only one note.
12. Hands-free recording toggles explicitly, prevents premature saving, and stops when opening settings.
13. Middle mouse holds work over the page and panel, preserve the selected target and written draft, append repeated recordings, and export the reviewed comment separately from its transcript.
14. Middle mouse recording preserves text-range selection and prevents link opening during review; middle-click links work normally while selection is paused. Middle-button releases do not stop a hands-free session.
15. Delayed recognition startup cancels immediately on release. Microphone denial preserves the draft. Escape, lost window focus, settings, minimization, pause, and close stop middle mouse recording.
16. Empty search results offer Clear filters, restore all notes, and return keyboard focus to the search field.
17. Button and middle mouse holds stay in Starting until audio capture begins, show animated waves while listening, and retain final words delivered after release. Reduced-motion settings disable the animation.
18. A fresh microphone permission state offers Enable microphone before starting recognition. The setup action uses Chromium's real `getUserMedia` API with a fake hardware device, stops every setup track, and allows the next hold to proceed.

Unit tests cover privacy sanitization, bounded excerpts, URL redaction, conservative anchors, range reconstruction, page-isolated IndexedDB transactions, bundle contents, local-only voice behavior, fresh browser-service consent, stale transcript rejection after clear and finish, immediate cancellation during startup, middle mouse event consumption and cancellation, and panel recovery on smaller displays.

Browser tests write failure images and a report to `test-results/` and `playwright-report/`. Successful report verification also writes an actual feedback ZIP and a screenshot of the sidebar for inspection. CI uploads failed diagnostics and installable build artifacts.

## Manual acceptance pass

1. Build/load Pointnote using the README. Run `npm run sample`.
2. On the report, annotate the **38% claim**, the **comparison chart**, and the **three recommendation cards**.
3. Reload, close/reopen the browser, activate Pointnote again, and revisit all three notes.
4. Export and unzip. Read `feedback.md`, open each referenced PNG, and check that each outline identifies the intended target.
5. Give the extracted folder to another agent. It should identify: add evidence for the retention claim; show sample size beside the chart; simplify the recommendation cards. Ask it to flag uncertainty rather than guess. Automated tests verify those mappings; this independent-agent reading is a manual exercise.
6. Pause selection and use the report's **Replace the claim**, **Remove the chart**, or **Duplicate the cards** controls. Confirm an explicit reattachment state.
7. Reattach one note, mark another addressed, reload, and verify both states.
8. On the frontend page, try the button while reviewing, paused, and closed. The count changes only when normal interaction is allowed.
9. Inspect the private-field screenshot: the value should be covered by a solid mask. Try screenshot opt-out too.
10. Test voice with a physical microphone on your Chrome/Edge installation. Install the browser's on-device language pack if supported. On a fresh site, hold to talk and verify that Enable microphone appears; release, click it, and accept the prompt. Hold again, wait for Listening, speak, release, edit the transcript, save, and inspect the export. Confirm denied-microphone and unavailable-language cases leave typed input usable. If testing the browser provider, explicitly opt in to its audio handling.
11. Drag and resize the panel, minimize and restore it, and try a narrow window. Open Settings, change the screenshot option, return to the draft, then reload to check saved preferences. Test hands-free recording and stop it by opening Settings or switching tabs.
12. With a physical mouse, select a target, hold the scroll wheel down without moving to the panel, speak, move the pointer, and release. Confirm the page shows the recording indicator and the transcript remains editable. Check that neither autoscroll nor a new tab starts. Repeat for a selected passage and multiple targets. Release outside the browser window and switch tabs while holding; confirm recording stops. Pause selection and confirm ordinary middle-click behavior returns.

Physical microphone input, language-pack downloads, browser vendor transcription, and Edge's installation UI are not simulated as successful in the automated suite. This is the remaining hardware/browser compatibility check.
