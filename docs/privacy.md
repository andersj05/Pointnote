# Privacy and data handling

## Where data lives

Annotations, page context, approved comments, original voice transcripts, and PNG screenshots live in the extension's IndexedDB database in the current browser profile. Nothing is sent to a Pointnote server. There is no telemetry or analytics. A small session-storage entry remembers which tabs had review open; it does not hold page content.

Export is a local browser download. Pointnote does not contact an agent, upload an export, read source files, or edit code. Uninstalling the extension removes local storage; export anything you want to retain.

Panel position and size, screenshot preference, transcription provider, language, voice shortcut, and microphone setup completion are stored in extension-local storage. These preferences contain no page content. Explicit browser-service audio consent is remembered until unchecked in Voice settings. Existing installations without saved consent require opt-in. Browser microphone permission is separately controlled by the browser for the Pointnote extension origin.

## Permissions

| Permission         | Purpose                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `offscreen`        | Run user-initiated speech recognition under the extension origin so microphone permission is shared across reviewed pages. |
| `activeTab`        | Temporary access after the user invokes Pointnote; allows a visible-tab screenshot.                                        |
| `scripting`        | Inject the review UI into that tab and reinject after an authorized same-origin refresh.                                   |
| `storage`          | Remember enabled tabs for the browser session and save panel/voice/capture preferences locally.                            |
| `unlimitedStorage` | Retain annotations and screenshots in extension IndexedDB without the small extension storage quota.                       |

No persistent host permissions, remote code, clipboard access, browsing-history permission, cookies permission, or private API keys are needed. Screenshot requests verify that the reviewed tab is active before and after capture. A queue respects Chrome's capture rate limit.

## Context minimization

The selected element contributes at most 1,600 characters of normalized text and 6,000 characters of sanitized HTML, with truncation flags. The selected quote, if present, is stored separately with prefix/suffix context. A note can contain up to 12 targets. A container may contain several paragraphs, but Pointnote never intentionally exports the entire document.

Form values and editable/private contents are replaced with an omission marker. Script/style/template content, HTML comments, event handlers, arbitrary data attributes, inline styles, and value attributes are omitted. Locator clues retain a narrow set of IDs, test attributes, roles, and accessible-name hints. URL usernames/passwords and all query parameter values are redacted. Query-style hashes are redacted too; ordinary route hashes remain useful.

The approved user comment is retained verbatim, including whitespace. Pointnote cannot redact a secret you intentionally type into your own comment without changing your words.

## Screenshot handling

Screenshots capture the visible tab, then resize to at most 1,600 pixels wide. The sidebar and markers are hidden during capture; target outlines are drawn onto the saved image afterward. Private-region masks are shown during capture and burned into the output image.

Standard inputs, textareas, selects, editable regions, textbox/combobox roles, `data-pointnote-private` regions, iframe/object/embed content, custom elements, and open shadow hosts are masked. If the viewport, target geometry, or detected private-region geometry changes during capture, the screenshot is discarded and the note records an unavailable reason.

To protect a known private region in a page you control:

```html
<section data-pointnote-private>
  <!-- This region's content is omitted from excerpts and masked in screenshots. -->
</section>
```

A screenshot is still an image of the page: ordinary visible personal information, images, chart labels, CSS-generated text, and private content outside these recognized regions can be included. Closed shadow trees on ordinary HTML hosts cannot be reliably inspected. Use the private marker or disable screenshots on such pages. This extension is intended for trusted localhost projects and reports, not adversarial websites that actively defeat redaction.

## Voice

On-device Web Speech recognition is the default. Pointnote requires local support and an available language pack, sets `processLocally = true`, and never falls back automatically. Language-pack installation can download model data through the browser; that is separate from audio transcription.

Browser-service recognition is optional and requires a user checkbox acknowledging that audio may be processed by the browser vendor off-device. Vendor processing and retention are controlled by that browser/service. Pointnote retains no raw audio. Both providers produce editable text, with the unedited transcript saved separately from the approved comment. Errors leave the draft available.

## Page trust

Content scripts run in an isolated JavaScript world, but their sidebar exists in the shared page DOM. Shadow DOM provides style isolation; it does not make notes secret from a hostile page. Export excerpts are untrusted data. The receiving agent's instructions explicitly distinguish those excerpts from the user's feedback.

Microphone setup uses `getUserMedia` in a bundled extension page and immediately stops all tracks. Recording uses a single extension-owned offscreen document and an extension runtime port to the initiating top-level content script. Only that port receives its transcript; disconnecting aborts recording. Concurrent recording from another tab is refused. No page microphone permission or persistent host access is requested.
