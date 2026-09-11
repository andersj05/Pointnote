# Review workspace UI/UX audit

Reviewed the note composer, selection modes, recording controls, settings, saved notes, search/filtering, exports, panel movement, keyboard interaction, and narrow-window layouts. Inspected screenshots from the real extension in Chromium.

## Improvements delivered

- **Less pointer travel:** hold middle mouse anywhere during active selection to record against the existing target. Release leaves a draft for review. Text-range and multiple-target selections remain intact.
- **Discoverability:** contextual instructions explain the shortcut before selection, when ready, and when paused. Settings list mouse and keyboard shortcuts together.
- **Visible recording feedback:** the composer changes its label and color, and a page-level indicator explains how to finish or stop with Escape. Recording state is exposed on the buttons, with announcements in the existing live status region.
- **Clearer disabled actions:** Save explains whether a target, note, or completed recording is needed.
- **Recovery without losing work:** canceled startup unlocks the draft immediately; stale transcripts cannot overwrite edits after recording finishes. Permission failures preserve typed input. Release, cancellation, loss of focus, and workspace navigation stop recordings.
- **Search recovery:** no-result searches offer Clear filters and return focus to search after restoring the notes.
- **Visual polish:** softer panel, composer, and control corners; stronger contrast for small secondary labels and placeholders; consistent recording colors and restrained spacing.

## Verified boundaries

- Normal middle-click links work when selection is paused. The shortcut is also inactive in settings and when minimized or closed.
- Existing button, keyboard, and hands-free recording still work. A middle mouse release cannot stop a hands-free recording.
- Existing checks cover narrow viewport clamping, keyboard movement/resizing, saved preferences, selection privacy, note persistence, and exported context.
- No new extension permissions, remote executable code, or audio storage were introduced. Browser-service transcription still requires explicit consent.

Automated voice tests use a simulated recognizer in the extension's isolated world. Physical microphone behavior, browser language packs, mouse hardware/driver behavior, and Edge installation still need the manual checks in [verification.md](verification.md).
