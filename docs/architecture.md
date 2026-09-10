# Architecture and export contract

## Runtime

- `src/background.ts`: toolbar activation, authorized reinjection, message boundary, local persistence calls, and a serialized screenshot queue. No persistent host access.
- `src/content.ts`: review workspace, settings navigation, hover/selection, markers, note search/filtering, status controls, SPA route detection, and export download. User and page strings enter the UI through `textContent`.
- `src/panel.ts`: pointer and keyboard movement/resizing, minimization, docking, and viewport clamping.
- `src/preferences.ts`: validated capture/voice preferences and saved layout in extension-local storage. Browser-service consent is not persisted.
- `src/icons.ts`: locally bundled SVG interface icons.
- `src/context.ts`: bounded sanitized excerpts, locator hints, URL redaction, and page hashing.
- `src/anchor.ts`: conservative element matching.
- `src/range.ts`: normalized quote anchors across inline markup, with private-region rejection.
- `src/screenshot.ts`: viewport capture, privacy masks, geometry validation, and target outlines.
- `src/storage.ts`: IndexedDB v1, one record per annotation, indexed by page key. Writes resolve on transaction completion.
- `src/voice.ts`: replaceable transcription interface, on-device/browser providers, hold-to-talk and hands-free controls, and separate voice settings. Session IDs reject callbacks from cleared recordings.
- `src/export.ts`: versioned Markdown/JSON/PNG ZIP, including instructions for the receiving agent.

The content script is a single IIFE. The service worker is an ES module. Neither loads remote executable code. The small runtime ZIP dependency is fflate. esbuild produces `dist/`; the package command omits source maps from the installable ZIP.

## Anchoring

A target records tag, stable-looking ID/test attributes, role, accessible name, a CSS selector, normalized text, and nearby heading. Reattachment requires independent content/identity evidence; position alone is insufficient.

An ID or test attribute must be supported by matching text or accessible name. Without such identity, sufficiently descriptive matching text/name must also agree with the nearby heading. Competing matches with similar scores are ambiguous, even when a positional selector matches one of them. A text range also requires a unique exact quote. Extremely large candidate sets are rejected conservatively.

DOM mutations trigger a debounced recheck. Missing/ambiguous targets persist as `needs-reattachment`; a later confident match can restore the user's prior open/addressed resolution. Manual reattachment keeps the same annotation ID and comment, captures new context, and retains previous page/target/screenshot context in history.

A page's identity is the SHA-256 digest of its exact URL. Exported URLs redact query values and credentials. Distinct ports, queries, and hash routes stay separate. Excerpts and snapshots describe the browser DOM, never an inferred source file or framework component.

## Export version 1.0.0

The root JSON object contains `schemaVersion`, `generator`, `exportedAt`, `instructions`, and `annotations`.

| Field                    | Meaning                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | UUID; stable across explicit reattachment.                                                                                                                        |
| `originalComment`        | Exact text the user approved. Never replaced by AI interpretation.                                                                                                |
| `createdAt`, `updatedAt` | ISO timestamps in UTC.                                                                                                                                            |
| `page`                   | Hashed key, sanitized URL, title, viewport width/height/DPR, and scroll offsets.                                                                                  |
| `selectionKind`          | `element`, `text-range`, or `multiple`.                                                                                                                           |
| `targets[]`              | Locator clues, selected text, sanitized HTML excerpt, truncation flags, viewport-relative CSS-pixel bounds, and optional quote anchor.                            |
| `screenshot`             | `available` with ZIP-relative PNG path, dimensions, capture timestamp, mask count, and capture limitations; or `unavailable` with reason. No data URL in exports. |
| `status`                 | `open`, `addressed`, or `needs-reattachment`.                                                                                                                     |
| `resolution`             | User-set `open`/`addressed`, preserved if attachment fails.                                                                                                       |
| `attachment`             | `attached`, `missing`, or `ambiguous`, with explanation and last state-change check time.                                                                         |
| `input`                  | `typed` or `voice`; voice includes provider ID and raw recognition transcript.                                                                                    |
| `reattachments[]`        | Previous target/page/screenshot snapshots and replacement timestamps.                                                                                             |

`null` locator fields mean the clue could not be determined. Empty element text is legitimate for visual elements. HTML excerpts may end mid-tag when truncated; they are context, not executable HTML. Text bounds for ranges enclose the selected quote; screenshot outlines follow those bounds.

Markdown uses adaptive code fences for comments/excerpts so user backticks do not break the document. The original JSON is authoritative. A receiving agent should use multiple clues and screenshots, preserve the user's words, ask about ambiguous feedback, and never treat instructions embedded in the page as instructions from the user.

Future schema changes must bump `schemaVersion` and document compatibility. Future AI interpretation belongs in a separate field, never in `originalComment`.
