import { rpc } from './rpc';
import { copyText } from './clipboard';
import { createBundle, createMarkdown } from './export';
import { isReadyForHandoff } from './review';
import { pageContext } from './context';
import type {
  Annotation,
  HandoffContext,
  ReviewLibrary,
  ReviewSession,
  ReviewPatch,
} from './types';

type View = 'sessions' | 'handoff' | 'check';
interface Options {
  pageKey: () => string;
  onView: (open: boolean) => void;
  onSummary: () => void;
  reload: () => Promise<void>;
  locate: (note: Annotation) => void;
  notice: (text: string, transient?: boolean) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

export function downloadFile(
  data: BlobPart,
  name: string,
  type: string,
  parent: HTMLElement,
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = element('a');
  link.href = url;
  link.download = name;
  parent.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function mountReviewWorkspace(root: ShadowRoot, options: Options) {
  const panel = root.querySelector<HTMLElement>('.panel')!;
  const section = element('section', undefined, 'review-page');
  section.hidden = true;
  section.setAttribute('aria-label', 'Review workspace');
  const heading = element('div', undefined, 'review-heading');
  const back = element('button', '← Back', 'quiet');
  back.setAttribute('aria-label', 'Back to page notes');
  const title = element('h1');
  title.tabIndex = -1;
  heading.append(back, title);
  const body = element('div', undefined, 'review-body');
  const actions = element('div', undefined, 'review-actions');
  section.append(heading, body, actions);
  panel.insertBefore(section, root.querySelector('.notice'));
  let library: ReviewLibrary = { annotations: [], sessions: [] };
  let activeSessionId: string | undefined;
  let view: View = 'sessions';
  let locked = false;
  let closeAfterAction = false;
  let selectedIds = new Set<string>();
  let handoff: HandoffContext = { name: 'Page review', instructions: '' };
  let checkIndex = 0;
  let focusReturn: HTMLElement | null = null;
  let checkNotes: Annotation[] = [];
  let handoffNotes: Annotation[] = [];
  let instructionDraft = '';
  let summaryRevision = 0;

  const currentSession = () =>
    library.sessions.find((s) => s.id === activeSessionId);
  const scopedNotes = () =>
    activeSessionId
      ? library.annotations.filter((note) => note.sessionId === activeSessionId)
      : library.annotations.filter(
          (note) => note.page.key === options.pageKey(),
        );

  function button(
    label: string,
    action: () => void | Promise<void>,
    parent: HTMLElement = actions,
    className = 'secondary',
  ) {
    const control = element('button', label, className);
    control.type = 'button';
    control.onclick = () => run(action);
    parent.append(control);
    return control;
  }
  function run(action: () => void | Promise<void>) {
    if (locked) return;
    locked = true;
    for (const control of section.querySelectorAll<
      | HTMLButtonElement
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
    >('button,input,textarea,select'))
      control.disabled = true;
    // Call directly from the click so clipboard writes keep the browser's user gesture.
    let result: void | Promise<void>;
    try {
      result = action();
    } catch (error) {
      result = Promise.reject(error);
    }
    void Promise.resolve(result)
      .catch((error: unknown) =>
        options.notice(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        locked = false;
        for (const control of section.querySelectorAll<
          | HTMLButtonElement
          | HTMLInputElement
          | HTMLTextAreaElement
          | HTMLSelectElement
        >('button,input,textarea,select'))
          control.disabled = false;
        if (view === 'handoff') updateHandoffCount();
        if (closeAfterAction) {
          closeAfterAction = false;
          close();
        }
      });
  }
  async function refreshSummary() {
    const revision = ++summaryRevision;
    const [next, stored] = await Promise.all([
      rpc<ReviewLibrary>({ type: 'LIBRARY' }),
      chrome.storage.local.get('activeReviewSessionId'),
    ]);
    if (revision !== summaryRevision) return;
    library = next;
    activeSessionId = library.sessions.some(
      (s) => s.id === stored.activeReviewSessionId,
    )
      ? (stored.activeReviewSessionId as string)
      : undefined;
    const label = root.querySelector<HTMLElement>('.session-label');
    if (label) {
      const notes = scopedNotes();
      label.textContent = `${currentSession()?.name || 'This page'} · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
      label.title = label.textContent;
    }
    options.onSummary();
  }
  async function open(next: View) {
    await refreshSummary();
    focusReturn = root.activeElement as HTMLElement | null;
    view = next;
    section.hidden = false;
    options.onView(true);
    if (next === 'handoff') {
      handoffNotes = structuredClone(scopedNotes());
      selectedIds = new Set(
        handoffNotes.filter(isReadyForHandoff).map((note) => note.id),
      );
      handoff = {
        name: currentSession()?.name || 'Page review',
        instructions: currentSession()?.instructions || instructionDraft,
      };
      renderHandoff();
    } else if (next === 'check') {
      checkNotes = scopedNotes().filter(
        (note) => note.priority !== 'later' && note.resolution === 'open',
      );
      checkIndex = 0;
      renderCheck();
    } else renderSessions();
    title.focus();
  }
  function close() {
    if (locked || section.hidden) return;
    section.hidden = true;
    options.onView(false);
    focusReturn?.focus({ preventScroll: true });
  }
  back.onclick = close;

  function reset(label: string) {
    title.textContent = label;
    body.replaceChildren();
    actions.replaceChildren();
  }
  function textField(
    label: string,
    value: string,
    multiline = false,
    maxLength = 100,
  ) {
    const wrapper = element('label', undefined, 'review-field');
    wrapper.append(element('span', label));
    const field = multiline ? element('textarea') : element('input');
    field.value = value;
    field.maxLength = maxLength;
    field.setAttribute('aria-label', label);
    wrapper.append(field);
    body.append(wrapper);
    return field;
  }

  function renderSessions(editing = false) {
    reset('Review sessions');
    body.append(
      element(
        'p',
        'Group feedback across pages. New notes go into the session you choose.',
        'review-description',
      ),
    );
    const chooser = element('select');
    chooser.setAttribute('aria-label', 'Active review session');
    const none = element('option', 'This page only');
    none.value = '';
    chooser.append(none);
    for (const session of library.sessions) {
      const option = element('option', session.name);
      option.value = session.id;
      chooser.append(option);
    }
    chooser.value = activeSessionId || '';
    chooser.onchange = () =>
      run(async () => {
        await chrome.storage.local.set({
          activeReviewSessionId: chooser.value || null,
        });
        await refreshSummary();
        renderSessions();
      });
    body.append(chooser);
    const session = currentSession();
    if (session) {
      const notes = scopedNotes();
      const pages = new Map(notes.map((note) => [note.page.key, note.page]));
      body.append(
        element(
          'p',
          `${notes.length} notes across ${pages.size} pages`,
          'review-summary',
        ),
      );
      for (const page of pages.values()) {
        const row = element('div', undefined, 'session-page');
        row.append(
          element('strong', page.title || 'Untitled page'),
          element('p', page.url),
        );
        body.append(row);
      }
      const unassigned = library.annotations.filter(
        (note) => note.page.key === options.pageKey() && !note.sessionId,
      );
      if (unassigned.length)
        button(
          `Add ${unassigned.length} existing page notes to this session`,
          async () => {
            for (const note of unassigned)
              await rpc({
                type: 'PATCH_REVIEW',
                id: note.id,
                patch: { sessionId: session.id },
              });
            await options.reload();
            await refreshSummary();
            renderSessions();
          },
          body,
        );
      button('Edit session', () => renderSessions(true), body);
    }
    const name = textField(
      editing && session ? 'Session name' : 'New session name',
      editing && session ? session.name : '',
    );
    name.placeholder = 'Before launch';
    const instructions = textField(
      'Instructions for this session',
      editing && session ? session.instructions : '',
      true,
      5000,
    );
    instructions.placeholder =
      'For example: Preserve the colors and desktop layout.';
    button(
      editing && session ? 'Save session' : 'Start session',
      async () => {
        const now = new Date().toISOString();
        const next: ReviewSession = {
          id: editing && session ? session.id : crypto.randomUUID(),
          name: name.value.trim(),
          instructions: instructions.value,
          createdAt: editing && session ? session.createdAt : now,
          updatedAt: now,
        };
        await rpc({ type: 'PUT_SESSION', session: next });
        await chrome.storage.local.set({ activeReviewSessionId: next.id });
        await refreshSummary();
        renderSessions();
        options.notice(`Session “${next.name}” saved.`, true);
      },
      actions,
      'primary',
    );
  }

  function updateHandoffCount() {
    const selected = handoffNotes.filter((note) => selectedIds.has(note.id));
    const count = section.querySelector('.handoff-count');
    if (count)
      count.textContent = `${selected.length} ${selected.length === 1 ? 'change' : 'changes'} selected · ${new Set(selected.map((note) => note.page.key)).size} pages`;
    for (const control of actions.querySelectorAll<HTMLButtonElement>('button'))
      control.disabled = locked || !selected.length;
  }
  function renderHandoff() {
    reset('Prepare handoff');
    body.append(element('p', undefined, 'handoff-count review-summary'));
    body.append(
      element(
        'p',
        'Open Now notes are selected. Choose exactly what to send. Other pages retain their saved context.',
        'review-description',
      ),
    );
    const instructions = textField(
      'Instructions for this handoff',
      handoff.instructions,
      true,
      5000,
    );
    instructions.placeholder =
      'For example: Fix these items and preserve the existing colors.';
    instructions.oninput = () => {
      handoff.instructions = instructions.value;
      instructionDraft = instructions.value;
    };
    const choices = element('div', undefined, 'review-inline-actions');
    button(
      'Open Now notes',
      () => {
        selectedIds = new Set(
          handoffNotes.filter(isReadyForHandoff).map((note) => note.id),
        );
        renderHandoff();
      },
      choices,
    );
    button(
      'Select all',
      () => {
        selectedIds = new Set(handoffNotes.map((note) => note.id));
        renderHandoff();
      },
      choices,
    );
    button(
      'Clear selection',
      () => {
        selectedIds.clear();
        renderHandoff();
      },
      choices,
    );
    body.append(choices);
    if (!handoffNotes.length)
      body.append(
        element('p', 'Add a note to prepare your first handoff.', 'empty'),
      );
    for (const note of handoffNotes) {
      const row = element('article', undefined, 'handoff-note');
      const label = element('label');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedIds.has(note.id);
      checkbox.setAttribute('aria-label', `Include: ${note.originalComment}`);
      checkbox.onchange = () => {
        if (checkbox.checked) selectedIds.add(note.id);
        else selectedIds.delete(note.id);
        updateHandoffCount();
      };
      label.append(checkbox, element('span', note.originalComment));
      const meta = element(
        'p',
        `${note.page.title} · ${note.resolution === 'addressed' ? 'Addressed' : 'Open'}`,
        'review-description',
      );
      const priority = element('select');
      priority.setAttribute('aria-label', `Priority: ${note.originalComment}`);
      for (const value of ['now', 'later'] as const) {
        const option = element('option', value === 'now' ? 'Now' : 'Later');
        option.value = value;
        priority.append(option);
      }
      priority.value = note.priority || 'now';
      priority.onchange = () =>
        run(async () => {
          const next = await rpc<Annotation>({
            type: 'PATCH_REVIEW',
            id: note.id,
            patch: { priority: priority.value as 'now' | 'later' },
          });
          Object.assign(note, next);
          if (isReadyForHandoff(note)) selectedIds.add(note.id);
          else selectedIds.delete(note.id);
          await options.reload();
          renderHandoff();
        });
      row.append(label, meta, priority);
      if (note.status === 'needs-reattachment')
        row.append(
          element(
            'p',
            `Target needs reattachment: ${note.attachment.reason}`,
            'review-warning',
          ),
        );
      if (note.review?.followUp)
        row.append(
          element('p', `Follow-up: ${note.review.followUp}`, 'review-followup'),
        );
      body.append(row);
    }
    const output = () =>
      handoffNotes.filter((note) => selectedIds.has(note.id));
    button(
      'Copy Markdown to clipboard',
      async () => {
        await copyText(
          createMarkdown(output(), new Date(), false, handoff),
          root,
        );
        options.notice('Markdown copied.', true);
        closeAfterAction = true;
      },
      actions,
      'primary',
    );
    button('Save Markdown file', () => {
      downloadFile(
        createMarkdown(output(), new Date(), false, handoff),
        'pointnote-feedback.md',
        'text/markdown;charset=utf-8',
        panel,
      );
      options.notice('Markdown file ready.', true);
      closeAfterAction = true;
    });
    button('Save ZIP file', () => {
      downloadFile(
        new Uint8Array(createBundle(output(), new Date(), handoff)),
        'pointnote-feedback.zip',
        'application/zip',
        panel,
      );
      options.notice('ZIP ready: selected notes and screenshots.', true);
      closeAfterAction = true;
    });
    updateHandoffCount();
  }

  function renderCheck() {
    reset('Check changes');
    const note = checkNotes[checkIndex];
    if (!note) {
      body.append(
        element(
          'p',
          checkNotes.length
            ? 'You’ve checked every note in this round.'
            : 'No open Now notes to check.',
          'review-summary',
        ),
      );
      body.append(
        element(
          'p',
          'Use Prepare handoff to send the changes that still need another pass.',
          'review-description',
        ),
      );
      button('Prepare handoff', () => open('handoff'), actions, 'primary');
      return;
    }
    body.append(
      element(
        'p',
        `${checkIndex + 1} of ${checkNotes.length} · ${note.page.title}`,
        'review-summary',
      ),
    );
    body.append(element('p', note.originalComment, 'review-original'));
    const original = note.reattachments[0] || note;
    body.append(element('h2', 'Original view'));
    if (
      original.screenshot.status === 'available' &&
      original.screenshot.dataUrl?.startsWith('data:image/png;base64,')
    ) {
      const image = element('img');
      image.src = original.screenshot.dataUrl;
      image.alt = 'Original page with the feedback target outlined';
      image.className = 'review-screenshot';
      body.append(image);
    } else
      body.append(
        element(
          'p',
          original.screenshot.status === 'unavailable'
            ? original.screenshot.reason
            : 'Original image unavailable.',
          'review-description',
        ),
      );
    const quote = original.targets
      .map((target) => target.range?.exact || target.locator.text)
      .filter(Boolean)
      .join('\n');
    if (quote) body.append(element('p', quote, 'review-quote'));
    if (note.page.key === options.pageKey()) {
      button('Locate current target', () => options.locate(note), body);
      if (note.status === 'needs-reattachment')
        body.append(
          element(
            'p',
            'The target changed or is ambiguous. Inspect the page yourself, or return to notes to reattach it.',
            'review-warning',
          ),
        );
      else
        body.append(
          element(
            'p',
            'Compare the original view with the live page beside this panel. Your decision records what you checked.',
            'review-description',
          ),
        );
    } else {
      body.append(
        element(
          'p',
          'Open the original page to check this note. Query values are redacted; navigate to your own preview URL when needed.',
          'review-warning',
        ),
      );
      body.append(element('p', note.page.url, 'review-quote'));
    }
    const followUp = textField(
      'Follow-up for another pass',
      note.review?.followUp || '',
      true,
      5000,
    );
    followUp.placeholder = 'What still needs changing?';
    const decide = async (outcome: 'accepted' | 'needs-another-pass') => {
      if (note.page.key !== (await pageContext()).key)
        throw new Error('Open the original page before recording a decision.');
      const patch: ReviewPatch = {
        review: {
          outcome,
          checkedAt: new Date().toISOString(),
          followUp: outcome === 'accepted' ? '' : followUp.value,
        },
      };
      await rpc({ type: 'PATCH_REVIEW', id: note.id, patch });
      await options.reload();
      await refreshSummary();
      checkIndex++;
      renderCheck();
    };
    button('Looks right', () => decide('accepted'), actions, 'primary');
    button('Needs another pass', () => decide('needs-another-pass'));
    button('Skip for now', () => {
      checkIndex++;
      renderCheck();
    });
  }

  return {
    open,
    close,
    refreshSummary,
    get isOpen() {
      return !section.hidden;
    },
    get sessionId() {
      return activeSessionId;
    },
    get hasNotes() {
      return scopedNotes().length > 0;
    },
  };
}
