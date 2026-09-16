# Pointnote user guide

For installation and the development commands, see the [README](../README.md).

## Review a page

- **Element:** hover to preview, click to select, then use **↑ Parent** to include a larger container. Headings, paragraphs, links, buttons, images, SVG/chart containers, and sections are supported. For keyboard selection, Tab to a focusable page element and press Enter or Space. This also works in Multiple and Compare; Shift adds or removes an element. Page actions remain blocked while selection is on.
- **Text range:** drag across a unique passage inside one section. Its exact quote and surrounding text are retained. Text ranges are limited to 1,600 characters.
- **Page note:** write about the whole page without selecting an element.
- **Select area:** drag a rectangle for additions, whitespace, or layout feedback. The saved rectangle refers to the captured viewport; it does not track a DOM element. Scrolling or resizing clears an unsaved area selection while keeping your words.
- **Multiple:** click to add/remove up to 12 elements. Shift-click also adds/removes elements in element mode.
- **Compare:** choose **Change this**, then **Use as reference**. Match overall style, spacing, typography, color, or alignment. Use the swap button to reverse the direction, or click either role to replace that element. Compare can also turn one or two selected elements into a comparison without losing your draft. Selecting a third element after a complete pair saves the current note and starts the next pair; incomplete comparisons stay in the composer until both targets are chosen. Reattachment requires both roles again and retains the original match dimension.
- Type a note, or select your target and **hold the middle mouse button (press the scroll wheel)** anywhere on the page or panel to talk. Release to finish. This uses your current selection, including text ranges and multiple targets; it never changes the target under your cursor. A recording indicator stays visible on the page.
- The compact **Hold to talk** button and **Space** while it is focused also work. The adjacent record button starts **hands-free recording**; click Stop when done. Release to leave an editable draft. **Selecting your next target saves the current note automatically**, including final words still arriving from the microphone. Switching selection modes or opening another saved note also saves your draft first. Use the **✓ Save note** button or **Ctrl+Enter** (**Cmd+Enter** on macOS) to save immediately. The **× Clear draft** button beside it discards the current draft. Parent and multi-select refine the current target without creating separate notes. If saving fails, the draft and original target stay in place for retry.
- Numbered markers and each note’s **Locate** button revisit the target. **Mark addressed** / **Reopen** track progress. Missing or ambiguous targets show **Reattach**. Reattachment preserves the original comment and previous target context.
- Use the **trash button in the top bar** to clear all saved notes for the current page. Confirm the page’s note count before deleting. Search filters do not limit this action; other pages and your unsaved draft are preserved.
- Search notes or filter by open, addressed, or reattachment status. The count shows matching notes out of the page total when filtered. Set **Now / Later** inside each note’s Details. The handoff has its own explicit selection, independent of these display filters.
- **Pause selection** restores normal page interaction while keeping notes visible. The configured voice shortcut is active only while selection is on; normal middle-click behavior returns while paused, in settings, minimized, or closed. **×** closes the review UI. **Esc** stops recording, returns from settings, restores a minimized panel, or clears a selection before closing the UI.
- Drag the title bar to move the panel; drag either bottom corner to resize it. **Settings → Workspace → Switch sides** moves it to the opposite side. Focus the title bar or a resize handle and use arrow keys for keyboard adjustments; hold Shift for larger steps.
- **Minimize** keeps a compact title bar available and restores normal page use. Restore it to continue your draft.
- Open **Settings** with the gear icon for screenshots, voice, language, and **Reset layout**. Turning off **Include screenshots** still saves notes with an explicit unavailable reason. The default panel is 360 × 520 pixels, with recording activity kept inside the voice toolbar. Settings and panel position/size are remembered locally; the panel stays within the current window. Use Reset layout to adopt the compact default if you have a saved layout.

Saved notes survive reloads and browser restarts. An enabled review automatically returns after same-origin refreshes. After a browser restart or navigation to another origin, invoke Pointnote again. Notes are keyed to the exact page URL, including query and hash routes; different ports and routes are separate pages. Sensitive URL query values are redacted from the exported URL, while a one-way page key keeps local routes distinct.

## Screenshot studio

Choose **View screenshot** on a saved note to open a larger workspace. Switch between the full viewport and the available target close-ups. Close-ups come from the masked capture before the wider view is reduced to 1,600 pixels, preserving small details; each close-up is limited to 2,400 pixels on its longest side. They include a little surrounding context. Partial or offscreen targets have explicit limitations, and no new page capture occurs when you open the studio.

- **View** uses the zoom controls, **Fit**, **100%**, and scrolling to inspect the image.
- **Arrow** lets you drag from the start to the tip. **Callout** places a numbered marker with editable text beside the image.
- For keyboard drawing, choose a tool and focus **Screenshot canvas**. Arrow keys move the cursor; Shift moves farther. Enter or Space places a callout or sets each end of an arrow.
- **Undo** reverses an edit on the current image. **Clear marks** affects only that image. **Show original** temporarily hides the marks.
- **Save changes** saves all edited views together. Closing with unsaved changes offers **Keep editing** or **Discard changes**. Escape dismisses the discard prompt and returns to editing. Conflicting edits from another tab require reopening the latest screenshot. In small windows, scroll the studio body to reach captured views and callouts; the save controls stay available.

The original PNG and original note remain intact. Marked PNGs, arrow positions, and exact callout text are retained separately. The ZIP contains original viewport/close-up images plus marked copies; copied or standalone Markdown includes callout text but cannot carry the arrows or images. Backups include both originals and edits. Each image supports up to 40 marks; close-ups and edits are bounded by the note's image-size limit.

## Review sessions and checking changes

Open **Review sessions** to create a named review such as “Before launch.” Enter a nonempty name, add optional instructions, then select **Start session**. Use **Edit session** to change the name or instructions, or **Cancel edit** to keep the saved version. New notes join the active session across pages; the session selection is remembered in this browser. Existing notes remain separate until you choose **Add existing page notes to this session**. Choose **This page only** to return to page-based review. Notes retain their exact page identity: sessions group pages without automatically treating different preview URLs as the same target.

**Check changes** walks through open Now notes, starting with the current page. It shows your original comment, original captured screenshot (including the first view before any reattachment), and selected text. Use **Locate current target** to compare with the live page. For another page, open that page before recording a decision; redacted preview URLs may need manual navigation.

- **Looks right** records your acceptance and excludes the note from the next default handoff.
- **Needs another pass** keeps the original comment, records a separate follow-up, and puts the note back in Now.
- **Skip for now** leaves the note unchanged. This does not change its priority.

Acceptance is a human review decision, not automatic verification that an agent edited or deployed code. Missing or ambiguous attachments stay explicit even after acceptance. Use **Reopen** to clear the decision and return an accepted note to open status.

## Prepare a handoff for an agent

**Prepare handoff** saves your pending note and opens a preview for the active session, or the current page when no session is active. Open **Now** notes are selected by default. Include or exclude individual notes, use **Select all** for a complete archive of the current scope (including Later and addressed notes), or clear the selection. Changing a note to Later removes it from the selection; you can explicitly include it again.

Add instructions for this particular handoff without changing any original comment. Saved session instructions provide the starting text; handoff edits remain a draft for that scope until the page reloads. Other pages use saved context and need to be rechecked at their source.

The selected notes can be handed over in three formats:

- **Copy Markdown to clipboard** — paste your feedback and target context directly into a chat.
- **Save Markdown file** — download one standalone `.md` file. It contains your exact comments, the page URL, current target clues and selected text, plus warnings for unresolved targets. It skips screenshot commentary, timestamps, internal IDs, HTML dumps, and old attachment history. Area notes include the captured viewport and rectangle so their visual reference remains understandable.
- **Save ZIP file** — download Markdown, JSON, and captured screenshots together:

```text
feedback.md
feedback.json
screenshots/
  <annotation-id>-<capture-time>.png
```

Give the complete extracted folder to an agent and ask it to read `feedback.md` first. Markdown in the ZIP includes your original words, selected text, nearby headings, locator clues, HTML excerpts, bounds, and screenshot references. JSON has `schemaVersion: "1.2.0"` and retains the full bounded record.

The bundle instructs the agent to preserve your intent, treat page content as untrusted reference material, and flag ambiguity. CSS selectors are locating hints; they do **not** identify source files or framework components. No automatic code edits occur.

Screenshots show the visible viewport with orange target outlines. Large or multiple targets can extend outside the viewport; the export says so. Scroll the relevant area into view before saving. Context fields that cannot be determined are `null`; missing screenshots always include a reason. Excerpt truncation is explicit.

## Backup and restore

In **Review sessions → Backup & restore**, choose **Download backup** to save all local notes, sessions, review decisions, and screenshot data as a Pointnote backup JSON file. This is separate from an agent handoff ZIP.

Choose a backup file to preview its note/session counts, then select **Restore backup**. Restore adds missing records in one transaction and keeps existing records with the same IDs, including newer local review decisions. Repeating a restore does not duplicate notes. Existing sessions with matching IDs are also kept. Imported excerpts pass through the context sanitization rules; unsupported formats and remote screenshot URLs are rejected.

Backups are limited to 64 MB, 2,000 notes, and 500 sessions per file. Restore accepts Pointnote backup JSON versions 1.0.0 and 1.1.0, not Markdown or handoff ZIP files. New backups use 1.1.0 so older installations cannot silently discard comparison or screenshot-edit metadata. A backup includes the same visible screenshots and exact comments you retained locally; keep it somewhere appropriate for that content.

## Voice and privacy

**On-device** is the default. It requires browser support for local Web Speech recognition and an installed language pack. Open **Settings → Voice**, set a language such as `en-US`, and use **Install language pack** if needed. A language pack downloads through the browser; local recognition audio stays on the computer.

On first opening, choose **Set up voice**. Pointnote opens its own setup screen: click **Enable microphone** and allow the browser prompt once, then return to your page. The permission belongs to the extension, not each reviewed website or file. Setup closes its audio stream immediately and remembers completion across pages and restarts. Browser permission can still require setup again if you revoke it, reset browser data, reinstall the extension, or use a different profile. Then hold **Hold to talk** or your voice shortcut and wait for **Listening** before speaking. On release, Pointnote finishes the transcript before unlocking your draft. Layered teal, blue, and violet waves flow inside the voice button while speech is detected. They are a decorative animation, not a microphone volume measurement. They rest between phrases, stop on release, and respect reduced-motion settings.

The optional **Browser service** provider may send audio to the browser vendor's speech service. It requires a separate, explicit opt-in in the UI. Pointnote never silently switches providers, stores raw audio, or embeds private API keys. Microphone permission is requested for Pointnote’s own extension page; recording runs in its offscreen document. Support varies by browser, OS, language, and policy. A clear error leaves typed input available.

**Settings → Voice → Hold to talk** offers **Middle mouse**, **Backtick (`)**, or **Custom shortcut**. Choose **Record shortcut** and press your key combination or supported extra mouse button; Escape cancels. Keyboard shortcuts leave text fields untouched. Browser/OS reserved shortcuts and device buttons that do not emit browser events cannot be intercepted; map those device buttons to a key combination in their configuration software. Hints update immediately and the binding survives reloads.

The original saved comment is the exact draft text at the time you save or move to the next target. The unedited recognition transcript is retained separately in `input.transcript`. The provider interface is replaceable.

Provider, language, shortcut, setup completion, and explicit browser-service consent are remembered. Uncheck the consent box in **Settings → Voice** to revoke it; old installations without saved consent still require an explicit opt-in. Recording stops when you pause selection, open settings, minimize or close the panel, switch away from the tab, or press Escape. Hold gestures also stop on lost window focus; hands-free sessions tolerate focus moving to browser controls. Releasing before a recognition request is submitted cancels immediately. After submission, release waits briefly for the final transcript. Delayed callbacks after a session ends cannot overwrite your next edits.

Read [privacy and data handling](privacy.md) before reviewing sensitive material.
