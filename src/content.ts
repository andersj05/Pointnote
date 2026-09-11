import css from './ui.css';
import { bounds, captureTarget, pageContext, safeText } from './context';
import { matchTarget } from './anchor';
import { rpc } from './rpc';
import { captureScreenshot } from './screenshot';
import { mountReviewWorkspace } from './review-workspace';
import { mountVoice } from './voice';
import { mountVoiceShortcut } from './voice-shortcut';
import { readTextSelection, rangeForQuote } from './range';
import { icon } from './icons';
import { mountPanel } from './panel';
import { readPreferences, type Preferences } from './preferences';
import {
  defaultShortcut,
  shortcutLabel,
  mountShortcutSettings,
} from './shortcut-config';
import type { Annotation, PageContext, Target, Bounds } from './types';

const guard = globalThis as typeof globalThis & { __pointnote?: boolean };
if (!guard.__pointnote) {
  guard.__pointnote = true;
  void mount();
}

async function mount() {
  const configuration = await readPreferences().catch(() => ({
    preferences: {
      screenshot: true,
      provider: 'local' as const,
      language: 'en-US',
    },
    layout: undefined,
  }));
  const preferences: Preferences = configuration.preferences;
  const host = document.createElement('div');
  host.dataset.pointnoteRoot = '';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  root.append(style);
  const shell = document.createElement('div');
  shell.innerHTML = `
    <div class="shield" aria-hidden="true"></div><div class="highlights"></div><div class="markers"></div>
    <aside class="panel" aria-label="Pointnote review">
      <header class="top">
        <button class="drag-handle" data-panel-handle="move" aria-label="Move panel" title="Drag to move · arrow keys to nudge"><span class="logo" aria-hidden="true">${icon('note')}</span><span class="brand">pointnote</span><span class="drag-dots">${icon('grip')}</span></button>
        <div class="window-actions"><button class="icon clear-page" data-action="clear-page" aria-label="Clear all notes for this page" title="Clear all notes for this page" aria-expanded="false" disabled>${icon('trash')}</button><button class="icon" data-action="settings" aria-label="Open settings" title="Settings" aria-expanded="false">${icon('settings')}</button><button class="icon" data-action="minimize" aria-label="Minimize Pointnote" title="Minimize">${icon('minus')}</button><button class="icon" data-action="close" aria-label="Close Pointnote" title="Close">${icon('close')}</button></div>
      </header>
      <div class="clear-page-confirmation" role="group" aria-label="Clear page notes" hidden><p class="clear-page-prompt"></p><div><button class="secondary" data-action="keep-notes">Cancel</button><button class="secondary danger" data-action="confirm-clear-page">Delete notes</button></div></div>
      <div class="workspace">
        <div class="session-bar"><span class="session-label">This page</span><button class="quiet" data-action="sessions">Review sessions</button></div>
        <div class="page-context"><span class="dot" aria-hidden="true"></span><span class="page-title"></span><button class="quiet" data-action="pause" title="Pause selection to interact with the page">Pause selection</button></div>
        <div class="body">
          <div class="tabs" role="group" aria-label="Selection mode"><button data-mode="element" aria-pressed="true">${icon('cursor')}Element</button><button data-mode="text" aria-pressed="false">${icon('text')}Text range</button><button data-mode="multiple" aria-pressed="false">${icon('layers')}Multiple</button></div>
          <div class="scope-tools"><button class="quiet" data-mode="page" aria-pressed="false">Page note</button><button class="quiet" data-mode="region" aria-pressed="false">Select area</button></div>
          <form class="composer">
          <div class="selection-prompt">${icon('cursor')}<span class="hint">Click something you want to change</span></div>
          <div class="target" hidden><div class="target-top"><span class="target-name sr-only"></span><button class="quiet" type="button" data-action="parent">↑ Parent</button></div><div class="excerpt"></div></div>
            <label class="sr-only" for="feedback">Your feedback</label>
            <textarea id="feedback" maxlength="20000" placeholder="Write a note, or say it out loud…" aria-label="Your feedback" aria-describedby="save-hint"></textarea>
            <div class="composer-toolbar"><div class="voice-slot"></div>
            <div class="composer-actions"><span class="save-hint sr-only" id="save-hint">Saves when you select the next target</span><button class="icon draft-clear" type="button" data-action="cancel" aria-label="Clear" title="Discard this draft and selection">${icon('close')}</button><button class="icon save-button" type="submit" data-action="save" aria-label="Save note" title="Save note · Ctrl+Enter or ⌘+Enter" disabled>${icon('check')}</button></div></div>
          </form>
          <div class="notes-heading"><h2>Notes <span class="count">0</span></h2><div class="note-tools"><label class="search-field">${icon('search')}<input type="search" class="note-search" aria-label="Search notes" placeholder="Search"></label><select class="note-filter" aria-label="Filter notes"><option value="all">All notes</option><option value="open">Open</option><option value="addressed">Addressed</option><option value="needs-reattachment">Needs reattachment</option></select></div></div>
          <div class="notes"></div>
        </div>
      </div>
      <section class="settings-page" aria-label="Settings" hidden>
        <div class="settings-heading"><button class="icon" data-action="back" aria-label="Back to notes" title="Back to notes">${icon('back')}</button><h1 tabindex="-1">Settings</h1></div>
        <div class="settings-body">
          <section class="settings-section"><h2>Capture</h2><label class="setting-toggle"><span>Include screenshots<span class="setting-description">Form fields and private areas are masked.</span></span><input type="checkbox" class="include-screenshot" role="switch"></label></section>
          <section class="settings-section"><h2>Voice</h2><div class="voice-preferences"></div><div class="voice-shortcut-settings"></div></section>
          <section class="settings-section"><h2>Workspace</h2><div class="setting-row"><span>Panel side</span><button class="secondary" data-action="dock" aria-label="Move sidebar to the other side">Switch sides</button></div><div class="setting-row"><span>Panel position &amp; size</span><button class="secondary" data-action="reset-layout">Reset layout</button></div><p class="setting-description">Drag the title bar to move. Drag either bottom corner to resize.</p></section>
          <section class="settings-section shortcuts"><h2>Shortcuts</h2><div><span>Hold to talk, selection on</span><kbd data-active-voice-shortcut>Middle mouse</kbd></div><div><span>Save note</span><kbd>Ctrl / ⌘ + Enter</kbd></div><div><span>Hold to talk, when focused</span><kbd>Space</kbd></div><div><span>Cancel selection / go back</span><kbd>Esc</kbd></div><div><span>Move or resize, when focused</span><kbd>Arrow keys</kbd></div></section>
          <p class="local-note"><span class="dot"></span>Notes stay in this browser. No audio is stored.</p>
        </div>
      </section>
      <div class="notice" role="status" aria-live="polite" hidden></div>
      <footer class="footer"><button class="export" data-action="export" disabled>${icon('download')}<span>Prepare handoff</span></button><button class="quiet check-changes" data-action="check-changes" disabled>Check changes</button></footer>
      <button class="resize-handle resize-left" data-panel-handle="resize-left" aria-label="Resize panel from left" title="Drag to resize · arrow keys to adjust">${icon('resize')}</button><button class="resize-handle" data-panel-handle="resize" aria-label="Resize panel" title="Drag to resize · arrow keys to adjust">${icon('resize')}</button>
    </aside>`;
  root.append(shell);
  document.documentElement.append(host);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
    root.querySelector<T>(s)!;
  const panel = $('.panel'),
    shield = $('.shield'),
    highlights = $('.highlights'),
    markers = $('.markers');
  const feedback = $<HTMLTextAreaElement>('#feedback');
  let opened = true,
    reviewing = true,
    busy = false;
  let transitioning = false;
  let reviews: ReturnType<typeof mountReviewWorkspace> | undefined = undefined;
  let reviewOpen = false;
  let clearPageKey: string | undefined;
  let settingsOpen = false,
    minimized = false;
  let page: PageContext = await pageContext();
  let annotations: Annotation[] = [],
    selected: Element[] = [],
    hovered: Element | null = null;
  let selectedId: string | null = null,
    reattaching: string | null = null;
  let resolved = new Map<string, Element[]>();
  let lastUrl = location.href,
    refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let matching = false,
    matchAgain = false;
  let selectionMode: 'element' | 'text' | 'multiple' | 'page' | 'region' =
    'element';
  let regionDraft: Bounds | undefined;
  let regionPreview: Bounds | undefined;
  let quote: Target['range'];
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const setNotice = (message: string, transient = false) => {
    clearTimeout(noticeTimer);
    $('.notice').dataset.transient = String(transient);
    if (message && transient)
      noticeTimer = setTimeout(() => setNotice(''), 3000);
    $('.notice').textContent = message;
    $('.notice').hidden = !message;
  };
  const persistPreferences = () => {
    void chrome.storage.local
      .set({ preferences })
      .catch(() =>
        setNotice('Your settings could not be saved. Please try again.'),
      );
  };
  const layout = mountPanel(panel, {
    initial: configuration.layout,
    canMove: () => !busy && !transitioning,
    save: (bounds) => {
      void chrome.storage.local
        .set({ panelLayout: bounds })
        .catch(() => setNotice('Your panel layout could not be saved.'));
    },
  });
  const screenshotOption = $<HTMLInputElement>('.include-screenshot');
  screenshotOption.checked = preferences.screenshot;
  screenshotOption.onchange = () => {
    preferences.screenshot = screenshotOption.checked;
    persistPreferences();
  };
  const voice = mountVoice($('.voice-slot'), {
    shortcutLabel: () => shortcutLabel(preferences.voiceShortcut),
    settings: $('.voice-preferences'),
    preferences,
    onPreferences: (value) => {
      Object.assign(preferences, value);
      persistPreferences();
    },
    getDraft: () => feedback.value,
    setDraft: (value) => {
      feedback.value = value;
      updateControls();
    },
    canStart: () => {
      if (!hasSelection())
        setNotice('Select a target before recording feedback.');
      return (
        opened &&
        !busy &&
        !transitioning &&
        !reattaching &&
        !settingsOpen &&
        !reviewOpen &&
        !minimized &&
        hasSelection()
      );
    },
    onState: updateControls,
    notice: setNotice,
  });
  mountVoiceShortcut({
    binding: () => preferences.voiceShortcut || defaultShortcut,
    enabled: () => selectionActive() && !busy && !transitioning && !reattaching,
    start: () => voice.start('middle'),
    release: () => voice.release('middle'),
  });
  const refreshShortcutSettings = mountShortcutSettings(
    $('.voice-shortcut-settings'),
    () => preferences.voiceShortcut || defaultShortcut,
    (value) => {
      preferences.voiceShortcut = value;
      persistPreferences();
      updateControls();
    },
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.activeReviewSessionId) {
      void reviews
        ?.refreshSummary()
        .catch(() =>
          setNotice(
            'Could not refresh the active session. Reopen Review sessions to retry.',
          ),
        );
    }
    if (area !== 'local' || !changes.preferences) return;
    void readPreferences().then(({ preferences: value }) => {
      Object.assign(preferences, value);
      voice.refreshPreferences(preferences);
      refreshShortcutSettings();
      updateControls();
    });
  });
  const act = <T>(action: () => Promise<T>) => {
    void action().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : String(error)),
    );
  };
  function hasSelection() {
    return (
      selected.length > 0 || selectionMode === 'page' || Boolean(regionDraft)
    );
  }
  function updateControls() {
    const locked = busy || transitioning || Boolean(reviews?.isBusy);
    $<HTMLButtonElement>('[data-action=clear-page]').disabled =
      locked || voice.recording || !annotations.length;
    $<HTMLButtonElement>('[data-action=confirm-clear-page]').disabled = locked;
    $<HTMLButtonElement>('[data-action=keep-notes]').disabled = locked;
    const holdKey = shortcutLabel(preferences.voiceShortcut);
    $('[data-active-voice-shortcut]').textContent = holdKey;
    $('[data-voice-talk]').title =
      `Hold ${holdKey} outside text fields, hold this button, or hold Space while focused`;
    $('.talk-key').textContent = holdKey;
    const voiceHint = $('.voice-hint');
    voiceHint.textContent = !hasSelection()
      ? `Select a target, then hold ${holdKey} to talk.`
      : !reviewing
        ? 'Resume selection to use your voice shortcut.'
        : `Hold ${holdKey} to talk about this selection.`;
    voiceHint.classList.toggle('ready', Boolean(hasSelection() && reviewing));
    $<HTMLButtonElement>('[data-action=save]').disabled =
      locked ||
      voice.recording ||
      !hasSelection() ||
      (!reattaching && !feedback.value.trim());
    $<HTMLButtonElement>('[data-action=export]').disabled =
      locked ||
      (!annotations.length &&
        !reviews?.hasNotes &&
        !(hasSelection() && (feedback.value.trim() || voice.recording)));
    $<HTMLButtonElement>('[data-action=sessions]').disabled = locked;
    $<HTMLButtonElement>('[data-action=check-changes]').disabled =
      locked || (!annotations.length && !reviews?.hasNotes);
    $<HTMLButtonElement>('[data-action=parent]').disabled =
      locked ||
      !selected[0]?.parentElement ||
      selected[0].parentElement === document.body;
    $('[data-action=save]').innerHTML = reattaching
      ? 'Attach here'
      : icon('check');
    $('[data-action=save]').setAttribute(
      'aria-label',
      reattaching ? 'Attach here' : 'Save note',
    );
    $('[data-action=save]').classList.toggle(
      'attach-button',
      Boolean(reattaching),
    );
    $('[data-action=save]').title = voice.recording
      ? 'Finish recording before saving'
      : !hasSelection()
        ? 'Select a target on the page first'
        : !reattaching && !feedback.value.trim()
          ? 'Write or record a note first'
          : 'Save note · Ctrl+Enter or ⌘+Enter';
    $('.save-hint').textContent = reattaching
      ? 'Confirm the new target below'
      : transitioning && voice.recording
        ? 'Finishing your voice note…'
        : 'Saves on next selection';
    feedback.disabled = locked || voice.recording || Boolean(reattaching);
    for (const action of ['cancel', 'pause', 'settings', 'minimize', 'close'])
      $<HTMLButtonElement>(`[data-action=${action}]`).disabled = locked;
    $<HTMLButtonElement>('[data-action=cancel]').disabled =
      locked || (!hasSelection() && !feedback.value && !reattaching);
    $<HTMLButtonElement>('[data-action=parent]').disabled ||= voice.recording;
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '[data-mode]',
    ))
      button.disabled = locked;
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '.card button',
    ))
      button.disabled =
        locked || (voice.recording && !button.matches('.card-title'));
  }
  function renderSelection() {
    $('.target').hidden = !hasSelection();
    $('.selection-prompt').hidden = hasSelection();
    $('[data-action=parent]').hidden = !selected.length;
    if (selectionMode === 'page') {
      $('.target-name').textContent = 'Whole page';
      $('.excerpt').textContent = 'Feedback about this page as a whole';
    } else if (regionDraft) {
      $('.target-name').textContent = 'Selected area';
      $('.excerpt').textContent = 'Area in this view · visual reference';
    }
    if (selected.length) {
      $('.target-name').textContent = selected
        .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''))
        .join(', ');
      $('.target').title = $('.target-name').textContent || '';
      $('.excerpt').textContent =
        quote?.exact ||
        safeText(selected[0]).slice(0, 260) ||
        '(No text — visual element)';
    }
    updateControls();
    draw();
  }
  function draw() {
    highlights.replaceChildren();
    markers.replaceChildren();
    if (!opened || minimized || settingsOpen) return;
    const addOutline = (el: Element, hover: boolean, rect?: Bounds) => {
      if (!el.isConnected) return;
      const r = rect || bounds(el),
        box = document.createElement('div');
      box.className = 'outline' + (hover ? ' hover' : '');
      Object.assign(box.style, {
        left: r.x + 'px',
        top: r.y + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      });
      highlights.append(box);
    };
    const area = regionPreview || regionDraft;
    if (area) {
      const box = document.createElement('div');
      box.className = 'outline';
      Object.assign(box.style, {
        left: area.x + 'px',
        top: area.y + 'px',
        width: area.width + 'px',
        height: area.height + 'px',
      });
      highlights.append(box);
    }
    selected.forEach((el) => {
      const range = quote && rangeForQuote(el, quote.exact);
      if (range)
        for (const rect of range.getClientRects()) addOutline(el, false, rect);
      else addOutline(el, false);
    });
    if (reviewing && hovered && !selected.includes(hovered))
      addOutline(hovered, true);
    annotations.forEach((a, i) => {
      const el = resolved.get(a.id)?.[0];
      if (!el?.isConnected || a.status === 'needs-reattachment') return;
      const r = bounds(el);
      if (
        r.y + r.height < 0 ||
        r.y > innerHeight ||
        r.x > innerWidth ||
        r.x + r.width < 0
      )
        return;
      const marker = document.createElement('button');
      marker.className = 'marker';
      marker.style.pointerEvents =
        reviewing && selectionMode !== 'element' ? 'none' : 'auto';
      marker.textContent = String(i + 1);
      marker.title = a.originalComment;
      marker.setAttribute('aria-label', 'Revisit note ' + (i + 1));
      Object.assign(marker.style, {
        left: Math.max(2, Math.min(innerWidth - 32, r.x - 12)) + 'px',
        top: Math.max(2, Math.min(innerHeight - 32, r.y - 12)) + 'px',
      });
      marker.onclick = () => revisit(a);
      markers.append(marker);
    });
  }
  function renderNotes() {
    const list = $('.notes');
    list.replaceChildren();
    $('.count').textContent = String(annotations.length);
    $('.note-filter').hidden = !annotations.length;
    $('.search-field').hidden = !annotations.length;
    if (!annotations.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = '<span>Your notes will appear here</span>';
      list.append(empty);
    }
    annotations.forEach((a, i) => {
      const filter = $<HTMLSelectElement>('.note-filter').value;
      const search = $<HTMLInputElement>('.note-search')
        .value.trim()
        .toLocaleLowerCase();
      if (
        filter !== 'all' &&
        (filter === 'needs-reattachment'
          ? a.status !== filter
          : a.resolution !== filter)
      )
        return;
      if (
        search &&
        ![
          a.originalComment,
          ...a.targets.map((target) =>
            [
              target.locator.nearbyHeading,
              target.locator.accessibleName,
              target.locator.tag,
            ].join(' '),
          ),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search)
      )
        return;
      const card = document.createElement('article');
      card.className = 'card' + (selectedId === a.id ? ' active' : '');
      card.dataset.noteId = a.id;
      const head = document.createElement('div');
      head.className = 'card-head';
      const number = document.createElement('span');
      number.className = 'number';
      number.textContent = String(i + 1);
      const title = document.createElement('button');
      title.className = 'card-title';
      title.textContent =
        a.targets[0]?.locator.nearbyHeading ||
        a.targets[0]?.locator.accessibleName ||
        (a.selectionKind === 'page'
          ? 'Whole page'
          : a.selectionKind === 'region'
            ? 'Selected area'
            : 'Page element');
      title.title =
        (a.targets[0]?.locator.tag || a.selectionKind) +
        ' · ' +
        title.textContent;
      title.onclick = () => revisit(a);
      title.setAttribute('aria-label', 'Open note ' + (i + 1));
      const status = document.createElement('span');
      status.className =
        'status' + (a.status === 'needs-reattachment' ? ' missing' : '');
      status.textContent =
        a.status === 'needs-reattachment'
          ? 'Reattach'
          : a.review?.outcome === 'accepted'
            ? 'Accepted'
            : a.status;
      status.hidden = a.status === 'open';
      const comment = document.createElement('p');
      comment.className = 'comment';
      comment.textContent = a.originalComment;
      head.append(number, comment, status);
      const targetDescription = document.createElement('div');
      targetDescription.className = 'note-context';
      targetDescription.textContent = title.textContent;
      title.innerHTML = icon('cursor') + 'Locate';
      const imageState = document.createElement('div');
      imageState.className = 'image-state';
      imageState.textContent =
        a.screenshot.status === 'available'
          ? 'Screenshot attached'
          : 'No screenshot';
      imageState.title =
        a.screenshot.status === 'available'
          ? 'Screenshot saved with private areas masked'
          : a.screenshot.reason;
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const details = document.createElement('details');
      details.className = 'note-details';
      details.open = a.status === 'needs-reattachment';
      const summary = document.createElement('summary');
      summary.innerHTML = 'Details <span aria-hidden="true">⌄</span>';
      summary.setAttribute('aria-label', 'Details for note ' + (i + 1));
      const detailActions = document.createElement('div');
      detailActions.className = 'detail-actions';
      const priority = document.createElement('select');
      priority.setAttribute('aria-label', 'Priority for note ' + (i + 1));
      priority.innerHTML =
        '<option value="now">Now</option><option value="later">Later</option>';
      priority.value = a.priority || 'now';
      priority.onchange = () =>
        act(async () => {
          const updated = await rpc<Annotation>({
            type: 'PATCH_REVIEW',
            id: a.id,
            patch: { priority: priority.value as 'now' | 'later' },
          });
          Object.assign(a, updated);
          renderNotes();
          await reviews?.refreshSummary();
        });
      details.append(
        summary,
        targetDescription,
        imageState,
        priority,
        detailActions,
      );
      actions.append(title);
      const button = (text: string, fn: () => void, parent = actions) => {
        const b = document.createElement('button');
        b.className = 'note-action';
        b.textContent = text;
        if (text === 'Mark addressed' || text === 'Reopen')
          b.innerHTML = icon('check') + text;
        b.disabled = busy || voice.recording;
        b.onclick = fn;
        parent.append(b);
      };
      button(a.resolution === 'addressed' ? 'Reopen' : 'Mark addressed', () =>
        act(async () => {
          const updated = await rpc<Annotation>({
            type: 'PATCH_REVIEW',
            id: a.id,
            patch: {
              resolution: a.resolution === 'addressed' ? 'open' : 'addressed',
            },
          });
          Object.assign(a, updated);
          await reviews?.refreshSummary();
          renderNotes();
        }),
      );
      if (a.targets.length)
        button(
          'Reattach',
          () =>
            act(() =>
              changeSelection(() => {
                reattaching = a.id;
                selectedId = a.id;
                selected = [];
                feedback.value = a.originalComment;
                setReviewing(true);
                setNotice(
                  'Select the intended target, then choose Attach here. Your original words and previous context are preserved.',
                );
                renderSelection();
                renderNotes();
              }),
            ),
          detailActions,
        );
      button(
        'Delete',
        () => {
          const remove = detailActions.lastElementChild as HTMLButtonElement;
          remove.textContent = 'Confirm delete';
          remove.onclick = () =>
            act(async () => {
              await rpc({ type: 'DELETE', id: a.id, pageKey: page.key });
              annotations = annotations.filter((n) => n.id !== a.id);
              if (selectedId === a.id) clear();
              renderNotes();
              draw();
              await reviews?.refreshSummary();
            });
        },
        detailActions,
      );
      actions.append(details);
      card.append(head, actions);
      list.append(card);
    });
    if (annotations.length && !list.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `${icon('search')}<span>No matching notes</span><p>Try another search or show all notes.</p>`;
      const reset = document.createElement('button');
      reset.className = 'secondary';
      reset.textContent = 'Clear filters';
      reset.onclick = () => {
        $<HTMLInputElement>('.note-search').value = '';
        $<HTMLSelectElement>('.note-filter').value = 'all';
        renderNotes();
        $('.note-search').focus();
      };
      empty.append(reset);
      list.append(empty);
    }
    updateControls();
  }
  async function reconcile() {
    if (matching || busy) {
      matchAgain = true;
      return;
    }
    matching = true;
    matchAgain = false;
    try {
      const current = annotations;
      const next = new Map<string, Element[]>();
      for (const a of current) {
        if (a.selectionKind === 'page' || a.selectionKind === 'region')
          continue;
        const matches = a.targets.map((target) => matchTarget(target));
        const failure = matches.find((m) => m.state !== 'attached');
        const state = failure?.state || 'attached';
        const reason =
          failure?.reason || 'Matched content and independent locating clues.';
        if (!failure)
          next.set(
            a.id,
            matches.flatMap((m) => (m.state === 'attached' ? [m.element] : [])),
          );
        if (a.attachment.state !== state) {
          a.attachment = { state, reason, checkedAt: new Date().toISOString() };
          a.status = state === 'attached' ? a.resolution : 'needs-reattachment';
          a.updatedAt = new Date().toISOString();
          const updated = await rpc<Annotation>({
            type: 'PATCH_ATTACHMENT',
            id: a.id,
            attachment: a.attachment,
          });
          Object.assign(a, updated);
        }
      }
      if (current === annotations) {
        resolved = next;
        renderNotes();
        draw();
      }
    } finally {
      matching = false;
      if (matchAgain) scheduleRefresh();
    }
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => act(reconcile), 650);
  }
  async function load() {
    page = await pageContext();
    $('.page-title').textContent = page.title;
    $('.page-title').title = page.title;
    annotations = await rpc<Annotation[]>({ type: 'LIST', pageKey: page.key });
    await reconcile();
    await reviews?.refreshSummary();
  }
  function clear() {
    voice.reset();
    if (selectionMode === 'page') {
      selectionMode = 'element';
      for (const button of root.querySelectorAll<HTMLElement>('[data-mode]'))
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.mode === selectionMode),
        );
      $('.hint').textContent = 'Click something you want to change';
    }
    quote = undefined;
    regionDraft = undefined;
    regionPreview = undefined;
    selected = [];
    selectedId = null;
    reattaching = null;
    feedback.value = '';
    renderSelection();
  }
  function setReviewing(value: boolean) {
    reviewing = value;
    shield.hidden =
      !selectionActive() ||
      selectionMode === 'text' ||
      selectionMode === 'page';
    $('.page-context').classList.toggle('paused', !value);
    $('[data-action=pause]').title = value
      ? 'Pause selection to interact with the page'
      : 'Resume selecting elements for your notes';
    $('[data-action=pause]').textContent = value
      ? 'Pause selection'
      : 'Resume selection';
    if (!value) hovered = null;
    updateControls();
    draw();
  }
  function selectionActive() {
    return opened && reviewing && !settingsOpen && !reviewOpen && !minimized;
  }
  function showSettings(value: boolean) {
    closeClearPage();
    closeExport();
    voice.stop();
    settingsOpen = value;
    $('.settings-page').hidden = !value;
    $('.workspace').hidden = value;
    $('.footer').hidden = value;
    $('[data-action=settings]').setAttribute('aria-expanded', String(value));
    setReviewing(reviewing);
    if (value) $('.settings-heading h1').focus();
    else $('[data-action=settings]').focus();
  }
  function setMinimized(value: boolean) {
    closeClearPage();
    closeExport();
    voice.stop();
    minimized = value;
    panel.classList.toggle('minimized', value);
    layout.minimize(value);
    const button = $('[data-action=minimize]');
    button.innerHTML = icon(value ? 'expand' : 'minus');
    button.setAttribute(
      'aria-label',
      value ? 'Restore Pointnote' : 'Minimize Pointnote',
    );
    button.title = value ? 'Restore' : 'Minimize';
    setReviewing(reviewing);
    button.focus();
  }
  function setOpened(value: boolean) {
    closeClearPage();
    closeExport();
    if (!value) voice.stop();
    opened = value;
    panel.hidden = !value;
    shield.hidden =
      !selectionActive() ||
      selectionMode === 'text' ||
      selectionMode === 'page';
    act(async () => {
      await rpc({ type: 'ENABLED', enabled: value });
    });
    draw();
  }
  function revisit(a: Annotation) {
    act(() =>
      changeSelection(() => {
        if (reattaching) {
          feedback.value = '';
          voice.reset();
        }
        selectedId = a.id;
        reattaching = null;
        quote = a.targets[0]?.range;
        regionDraft = undefined;
        if (!a.targets.length) {
          selected = [];
          setNotice(
            a.selectionKind === 'page'
              ? 'Whole-page feedback. Use Check changes to see the original view.'
              : 'Area feedback refers to the captured view. Use Check changes to compare it with this page.',
          );
          renderSelection();
          renderNotes();
          return;
        }
        const targets = resolved.get(a.id);
        if (!targets?.length || a.status === 'needs-reattachment') {
          selected = [];
          setNotice(
            a.attachment.reason + ' Use Reattach to choose the target.',
          );
        } else {
          selected = targets;
          targets[0].scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: 'instant',
          });
          setNotice(
            'Note ' + (annotations.indexOf(a) + 1) + ' highlighted.',
            true,
          );
        }
        renderSelection();
        renderNotes();
      }),
    );
  }
  async function changeSelection(change: () => void | Promise<void>) {
    if (busy || transitioning) return;
    transitioning = true;
    updateControls();
    try {
      if (!(await voice.finishDraft())) return;
      if (!reattaching && hasSelection() && feedback.value.trim()) {
        if (!(await save())) return;
      } else if (!reattaching && selected.length) {
        feedback.value = '';
        voice.reset();
      }
      await change();
    } finally {
      transitioning = false;
      updateControls();
    }
  }
  function underPointer(x: number, y: number): Element | null {
    return (
      document
        .elementsFromPoint(x, y)
        .find(
          (el) =>
            el !== host &&
            !host.contains(el) &&
            el !== document.documentElement &&
            el !== document.body,
        ) || null
    );
  }
  let areaStart:
    { x: number; y: number; scrollX: number; scrollY: number } | undefined;
  shield.addEventListener('pointerdown', (event) => {
    if (
      selectionMode !== 'region' ||
      !selectionActive() ||
      busy ||
      transitioning ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    areaStart = { x: event.clientX, y: event.clientY, scrollX, scrollY };
    shield.setPointerCapture(event.pointerId);
  });
  shield.addEventListener('pointermove', (event) => {
    if (!areaStart) return;
    event.stopImmediatePropagation();
    regionPreview = {
      x: Math.min(areaStart.x, event.clientX),
      y: Math.min(areaStart.y, event.clientY),
      width: Math.abs(event.clientX - areaStart.x),
      height: Math.abs(event.clientY - areaStart.y),
    };
    draw();
  });
  shield.addEventListener('pointerup', (event) => {
    if (!areaStart) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const start = areaStart;
    areaStart = undefined;
    if (shield.hasPointerCapture(event.pointerId))
      shield.releasePointerCapture(event.pointerId);
    const area = regionPreview;
    regionPreview = undefined;
    if (
      !area ||
      area.width < 8 ||
      area.height < 8 ||
      scrollX !== start.scrollX ||
      scrollY !== start.scrollY
    ) {
      draw();
      return;
    }
    act(() =>
      changeSelection(() => {
        regionDraft = area;
        selected = [];
        quote = undefined;
        selectedId = reattaching;
        renderSelection();
        feedback.focus();
      }),
    );
  });
  shield.addEventListener('pointercancel', () => {
    areaStart = undefined;
    regionPreview = undefined;
    draw();
  });
  shield.addEventListener('pointermove', (event) => {
    if (!selectionActive() || busy || selectionMode === 'region') return;
    hovered = underPointer(event.clientX, event.clientY);
    draw();
  });
  shield.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (
      busy ||
      transitioning ||
      !selectionActive() ||
      selectionMode === 'region'
    )
      return;
    const element = underPointer(event.clientX, event.clientY);
    if (!element) return;
    const multiple = selectionMode === 'multiple' || event.shiftKey;
    if (multiple && voice.recording) return;
    const choose = () => {
      if (!element.isConnected) {
        setNotice('That target disappeared. Select another element.');
        return;
      }
      quote = undefined;
      regionDraft = undefined;
      if (multiple) {
        if (selected.includes(element))
          selected = selected.filter((el) => el !== element);
        else if (selected.length < 12) selected = [...selected, element];
        else {
          setNotice('A note can include up to 12 elements.');
          return;
        }
      } else selected = [element];
      selectedId = reattaching;
      hovered = null;
      renderSelection();
      if (preferences.voiceShortcut?.kind === 'key') {
        panel.tabIndex = -1;
        panel.focus({ preventScroll: true });
      } else feedback.focus();
    };
    if (
      multiple ||
      (!quote && selected.length === 1 && selected[0] === element)
    )
      choose();
    else act(() => changeSelection(choose));
  });
  // The shield prevents hit-testing the real controls. Capture listeners also stop
  // bubbling handlers on the host page while selection mode is active.
  const blocked = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'auxclick',
    'contextmenu',
    'touchstart',
    'touchend',
    'submit',
  ];
  blocked.forEach((type) =>
    window.addEventListener(
      type,
      (event) => {
        if (!selectionActive()) return;
        const path = event.composedPath();
        if (path.includes(panel) || path.includes(markers)) return;
        if (selectionMode === 'page') return;
        if (
          selectionMode === 'region' &&
          path.includes(shield) &&
          type.startsWith('pointer')
        )
          return;
        if (
          selectionMode === 'text' &&
          ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].includes(type)
        ) {
          event.stopImmediatePropagation();
          if (type === 'mouseup' && !busy && !transitioning)
            setTimeout(() => {
              const selection = readTextSelection(window.getSelection());
              if (!selection) {
                setNotice(
                  'Select a unique text passage within one section (up to 1,600 characters). Private fields are excluded.',
                );
                return;
              }
              act(() =>
                changeSelection(() => {
                  selected = [selection.element];
                  quote = selection.quote;
                  selectedId = reattaching;
                  renderSelection();
                  setNotice('Text selected. Add your feedback.', true);
                  if (preferences.voiceShortcut?.kind === 'key') {
                    panel.tabIndex = -1;
                    panel.focus({ preventScroll: true });
                  } else feedback.focus();
                }),
              );
            }, 0);
          return;
        }
        if (type === 'click' && path.includes(shield)) return; // selection handler owns it
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, passive: false },
    ),
  );
  // The click must be handled before bubbling to document/window page handlers.
  shield.addEventListener('click', (event) => event.stopImmediatePropagation());
  window.addEventListener(
    'keydown',
    (event) => {
      if (!opened) return;
      if (event.key === 'Escape') {
        if (busy || transitioning) return;
        if (!$('.clear-page-confirmation').hidden) closeClearPage(true);
        else if (reviews?.isOpen) closeExport(true);
        else if (voice.recording) voice.stop();
        else if (settingsOpen && !minimized) showSettings(false);
        else if (minimized) setMinimized(false);
        else if (hasSelection() || reattaching) {
          clear();
          setNotice('Selection cleared.', true);
        } else setOpened(false);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        event.composedPath().includes(panel) &&
        event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey) &&
        !settingsOpen &&
        !reviewOpen &&
        !minimized
      ) {
        event.preventDefault();
        act(save);
        return;
      }
      if (event.composedPath().includes(panel)) return;
      if (
        selectionActive() &&
        selectionMode !== 'page' &&
        ['Enter', ' '].includes(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  $('[data-action=close]').onclick = () => {
    if (!busy) setOpened(false);
  };
  $('[data-action=dock]').onclick = () => {
    if (busy) return;
    layout.dock();
  };
  $('[data-action=settings]').onclick = () => {
    if (busy) return;
    if (minimized) setMinimized(false);
    showSettings(!settingsOpen);
  };
  $('[data-action=back]').onclick = () => showSettings(false);
  $('[data-action=minimize]').onclick = () => {
    if (!busy) setMinimized(!minimized);
  };
  $('[data-action=reset-layout]').onclick = () => {
    layout.reset();
    setNotice('Panel layout reset.', true);
  };
  $('.note-search').addEventListener('input', renderNotes);
  $('.note-filter').addEventListener('change', renderNotes);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    button.onclick = () => {
      if (button.dataset.mode === selectionMode) return;
      act(() =>
        changeSelection(() => {
          selectionMode = button.dataset.mode as typeof selectionMode;
          regionDraft = undefined;
          regionPreview = undefined;
          selected = [];
          quote = undefined;
          hovered = null;
          for (const b of root.querySelectorAll('[data-mode]'))
            b.setAttribute('aria-pressed', String(b === button));
          $('.hint').textContent =
            selectionMode === 'text'
              ? 'Drag across a passage on the page'
              : selectionMode === 'multiple'
                ? 'Select up to 12 elements on the page'
                : selectionMode === 'region'
                  ? 'Drag over an area you want to change'
                  : selectionMode === 'page'
                    ? 'Add feedback about the whole page'
                    : 'Click something you want to change';
          setReviewing(true);
          renderSelection();
          if (selectionMode === 'page') feedback.focus();
        }),
      );
    };
  $('[data-action=pause]').onclick = () => {
    if (!busy) {
      voice.stop();
      setReviewing(!reviewing);
    }
  };
  $('[data-action=cancel]').onclick = () => {
    if (!busy) {
      clear();
      setNotice('');
    }
  };
  $('[data-action=parent]').onclick = () => {
    const parent = selected[0]?.parentElement;
    if (!busy && !voice.recording && parent && parent !== document.body) {
      quote = undefined;
      selected = [parent];
      renderSelection();
    }
  };
  feedback.addEventListener('input', updateControls);
  $('.composer').addEventListener('submit', (event) => {
    event.preventDefault();
    act(save);
  });
  async function save(): Promise<boolean> {
    if (
      busy ||
      voice.recording ||
      !hasSelection() ||
      (!reattaching && !feedback.value.trim())
    )
      return false;
    if (selected.some((el) => !el.isConnected)) {
      setNotice(
        'The selection changed or disappeared. Select it again before saving.',
      );
      return false;
    }
    busy = true;
    updateControls();
    renderNotes();
    try {
      const currentPage = await pageContext();
      if (currentPage.key !== page.key) {
        setNotice('The page changed. Select the target again.');
        return false;
      }
      const now = new Date().toISOString();
      const id = reattaching || crypto.randomUUID(),
        old = annotations.find((a) => a.id === reattaching);
      const targets = selected.map((el) => {
        const target = captureTarget(el, quote);
        const range = quote && rangeForQuote(el, quote.exact);
        if (quote && !range)
          throw new Error(
            'The selected text changed. Select the passage again.',
          );
        if (range) {
          const r = range.getBoundingClientRect();
          target.bounds = { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return target;
      });
      const screenshot = $<HTMLInputElement>('.include-screenshot').checked
        ? await captureScreenshot(
            selected,
            host,
            root,
            'screenshots/' + id + '-' + Date.now() + '.png',
            regionDraft
              ? [regionDraft]
              : targets.map((target) => target.bounds),
          )
        : {
            status: 'unavailable' as const,
            reason: 'Screenshot capture disabled by the user.',
          };
      if (location.href !== lastUrl)
        throw new Error(
          'The page changed while saving. Your draft has been kept.',
        );
      const annotation: Annotation = {
        id,
        originalComment: old?.originalComment ?? feedback.value,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        page: currentPage,
        selectionKind:
          selectionMode === 'page'
            ? 'page'
            : regionDraft
              ? 'region'
              : quote
                ? 'text-range'
                : selected.length > 1
                  ? 'multiple'
                  : 'element',
        targets,
        ...(regionDraft ? { region: { ...regionDraft } } : {}),
        screenshot,
        status: old?.resolution ?? 'open',
        resolution: old?.resolution ?? 'open',
        priority: old?.priority ?? 'now',
        sessionId: old?.sessionId ?? reviews?.sessionId,
        ...(old?.review ? { review: old.review } : {}),
        attachment: {
          state: 'attached',
          reason: old ? 'Explicitly reattached by user.' : 'Selected by user.',
          checkedAt: now,
        },
        input: old?.input ?? voice.input(),
        reattachments: old
          ? [
              ...old.reattachments,
              {
                at: now,
                targets: old.targets,
                screenshot: old.screenshot,
                page: old.page,
              },
            ]
          : [],
      };
      await rpc({ type: 'PUT', annotation });
      await reviews?.refreshSummary();
      resolved.set(id, [...selected]);
      if (old)
        annotations = annotations.map((a) => (a.id === id ? annotation : a));
      else annotations.push(annotation);
      $<HTMLSelectElement>('.note-filter').value = 'all';
      $<HTMLInputElement>('.note-search').value = '';
      clear();
      setNotice(
        screenshot.status === 'available'
          ? 'Saved locally, with a screenshot.'
          : !preferences.screenshot
            ? 'Saved locally.'
            : 'Note saved. Screenshot unavailable: ' + screenshot.reason,
        screenshot.status === 'available' || !preferences.screenshot,
      );
      return true;
    } catch (error) {
      setNotice(
        'Could not save. Your draft and target have been kept. ' +
          (error instanceof Error ? error.message : String(error)),
      );
      return false;
    } finally {
      busy = false;
      renderSelection();
      renderNotes();
      draw();
      if (matchAgain) scheduleRefresh();
    }
  }
  function closeExport(restoreFocus = false) {
    reviews?.close();
    if (restoreFocus) $('[data-action=export]').focus();
  }
  function closeClearPage(restoreFocus = false) {
    clearPageKey = undefined;
    $('.clear-page-confirmation').hidden = true;
    $('[data-action=clear-page]').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('[data-action=clear-page]').focus();
  }
  $('[data-action=clear-page]').onclick = () => {
    if (busy || transitioning || voice.recording || !annotations.length) return;
    if (clearPageKey) {
      closeClearPage();
      return;
    }
    closeExport();
    clearPageKey = page.key;
    $('.clear-page-prompt').textContent =
      `Delete all ${annotations.length} saved notes on this page?${feedback.value && !reattaching ? ' Your draft will stay.' : ''}`;
    $('.clear-page-confirmation').hidden = false;
    $('[data-action=clear-page]').setAttribute('aria-expanded', 'true');
    $('[data-action=keep-notes]').focus();
  };
  $('[data-action=keep-notes]').onclick = () => closeClearPage(true);
  $('[data-action=confirm-clear-page]').onclick = () =>
    act(async () => {
      if (busy || transitioning || !clearPageKey) return;
      const key = clearPageKey;
      busy = true;
      updateControls();
      try {
        while (matching)
          await new Promise((resolve) => setTimeout(resolve, 20));
        if ((await pageContext()).key !== key)
          throw new Error(
            'The page changed. Reopen Clear all notes on the intended page.',
          );
        await rpc({ type: 'DELETE_PAGE', pageKey: key });
        annotations = [];
        resolved.clear();
        await reviews?.refreshSummary();
        if (reattaching) {
          feedback.value = '';
          voice.reset();
        }
        selectedId = null;
        reattaching = null;
        $<HTMLSelectElement>('.note-filter').value = 'all';
        $<HTMLInputElement>('.note-search').value = '';
        closeClearPage();
        setNotice('All saved notes on this page deleted.', true);
      } finally {
        busy = false;
        renderNotes();
        renderSelection();
        if (matchAgain) scheduleRefresh();
        if (!$('.clear-page-confirmation').hidden)
          $('[data-action=keep-notes]').focus();
        else feedback.focus({ preventScroll: true });
      }
    });
  const openReview = (view: 'sessions' | 'handoff' | 'check') =>
    act(() =>
      changeSelection(async () => {
        while (matching)
          await new Promise((resolve) => setTimeout(resolve, 20));
        if ((await pageContext()).key !== page.key) {
          setNotice('The page changed. Open the review after the notes load.');
          return;
        }
        await load();
        await reviews?.open(view);
      }),
    );
  $('[data-action=export]').onclick = () => openReview('handoff');
  $('[data-action=sessions]').onclick = () => openReview('sessions');
  $('[data-action=check-changes]').onclick = () => openReview('check');
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !busy &&
        !event.composedPath().includes($('.clear-page-confirmation')) &&
        !event.composedPath().includes($('[data-action=clear-page]'))
      )
        closeClearPage();
    },
    true,
  );
  chrome.runtime.onMessage.addListener((message: { type: string }) => {
    if (message.type === 'TOGGLE' && !busy && !transitioning)
      setOpened(!opened);
  });
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (m) =>
          m.target !== host &&
          !host.contains(m.target) &&
          !(
            [...m.addedNodes, ...m.removedNodes].length &&
            [...m.addedNodes, ...m.removedNodes].every((n) => n === host)
          ),
      )
    )
      scheduleRefresh();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'id',
      'class',
      'role',
      'aria-label',
      'data-testid',
      'data-test',
      'data-cy',
    ],
  });
  window.addEventListener('scroll', draw, true);
  window.addEventListener('resize', draw);
  const invalidateArea = (event: Event) => {
    if (
      event.composedPath().includes(panel) ||
      busy ||
      transitioning ||
      !regionDraft
    )
      return;
    regionDraft = undefined;
    renderSelection();
    setNotice('The view moved. Select the area again; your draft is kept.');
  };
  window.addEventListener('scroll', invalidateArea, true);
  window.addEventListener('resize', invalidateArea);
  setInterval(() => {
    if (location.href !== lastUrl && !busy && !transitioning) {
      closeClearPage();
      closeExport();
      voice.stop();
      lastUrl = location.href;
      selected = [];
      regionDraft = undefined;
      regionPreview = undefined;
      selectedId = null;
      reattaching = null;
      resolved.clear();
      renderSelection();
      setNotice(
        'Page changed. Your draft is still here; select a target on this page.',
      );
      act(load);
    }
  }, 700);
  reviews = mountReviewWorkspace(root, {
    pageKey: () => page.key,
    onView: (value) => {
      reviewOpen = value;
      voice.stop();
      hovered = null;
      $('.workspace').hidden = value;
      $('.footer').hidden = value;
      setReviewing(reviewing);
    },
    onSummary: updateControls,
    reload: load,
    locate: revisit,
    notice: setNotice,
  });
  try {
    await load();
    await rpc({ type: 'ENABLED', enabled: true });
  } catch (error) {
    setNotice('Could not load notes: ' + String(error));
  }
}
