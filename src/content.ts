import css from './ui.css';
import { bounds, captureTarget, pageContext, safeText } from './context';
import { matchTarget } from './anchor';
import { rpc } from './rpc';
import { captureScreenshot } from './screenshot';
import { createBundle } from './export';
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
        <div class="window-actions"><button class="icon" data-action="settings" aria-label="Open settings" title="Settings" aria-expanded="false">${icon('settings')}</button><button class="icon" data-action="minimize" aria-label="Minimize Pointnote" title="Minimize">${icon('minus')}</button><button class="icon" data-action="close" aria-label="Close Pointnote" title="Close">${icon('close')}</button></div>
      </header>
      <div class="workspace">
        <div class="page-context"><span class="page-title"></span><button class="icon" data-action="dock" aria-label="Move sidebar to the other side" title="Move to the other side">${icon('dock')}</button></div>
        <div class="review-row"><span class="mode-label"><span class="dot"></span><span class="mode-text">Selection on</span></span><button class="quiet" data-action="pause">Pause selection</button></div>
        <div class="body">
          <div class="tabs" role="group" aria-label="Selection mode"><button data-mode="element" aria-pressed="true">${icon('cursor')}Element</button><button data-mode="text" aria-pressed="false">${icon('text')}Text range</button><button data-mode="multiple" aria-pressed="false">${icon('layers')}Multiple</button></div>
          <div class="selection-prompt">${icon('cursor')}<span class="hint">Select an element on the page</span></div>
          <div class="target" hidden><div class="target-top"><span class="target-name"></span><button class="quiet" data-action="parent">↑ Parent</button></div><div class="excerpt"></div></div>
          <form class="composer">
            <label class="sr-only" for="feedback">Your feedback</label>
            <textarea id="feedback" maxlength="20000" placeholder="Write a note, or say it out loud…" aria-label="Your feedback"></textarea>
            <div class="voice-slot"></div>
            <div class="composer-actions"><button class="quiet" type="button" data-action="cancel">Clear</button><button class="primary" type="submit" data-action="save" title="Save note · Ctrl+Enter or ⌘+Enter" disabled>Save note <span aria-hidden="true">↵</span></button></div>
          </form>
          <div class="notes-heading"><h2>Notes <span class="count">0</span></h2><select class="note-filter" aria-label="Filter notes"><option value="all">All notes</option><option value="open">Open</option><option value="addressed">Addressed</option><option value="needs-reattachment">Needs reattachment</option></select></div>
          <label class="search-field">${icon('search')}<input type="search" class="note-search" aria-label="Search notes" placeholder="Search notes"></label>
          <div class="notes"></div>
        </div>
      </div>
      <section class="settings-page" aria-label="Settings" hidden>
        <div class="settings-heading"><button class="icon" data-action="back" aria-label="Back to notes" title="Back to notes">${icon('back')}</button><h1 tabindex="-1">Settings</h1></div>
        <div class="settings-body">
          <section class="settings-section"><h2>Capture</h2><label class="setting-toggle"><span>Include screenshots<span class="setting-description">Form fields and private areas are masked.</span></span><input type="checkbox" class="include-screenshot" role="switch"></label></section>
          <section class="settings-section"><h2>Voice</h2><div class="voice-preferences"></div><div class="voice-shortcut-settings"></div></section>
          <section class="settings-section"><h2>Workspace</h2><div class="setting-row"><span>Panel position &amp; size</span><button class="secondary" data-action="reset-layout">Reset layout</button></div><p class="setting-description">Drag the title bar to move. Drag either bottom corner to resize.</p></section>
          <section class="settings-section shortcuts"><h2>Shortcuts</h2><div><span>Hold to talk, selection on</span><kbd data-active-voice-shortcut>Middle mouse</kbd></div><div><span>Save note</span><kbd>Ctrl / ⌘ + Enter</kbd></div><div><span>Hold to talk, when focused</span><kbd>Space</kbd></div><div><span>Cancel selection / go back</span><kbd>Esc</kbd></div><div><span>Move or resize, when focused</span><kbd>Arrow keys</kbd></div></section>
          <p class="local-note"><span class="dot"></span>Notes stay in this browser. No audio is stored.</p>
        </div>
      </section>
      <div class="notice" role="status" aria-live="polite" hidden></div>
      <footer class="footer"><button class="export" data-action="export" disabled>${icon('download')}<span>Export feedback</span><span class="export-format">ZIP</span></button></footer>
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
  let selectionMode: 'element' | 'text' | 'multiple' = 'element';
  let quote: Target['range'];
  const setNotice = (message: string) => {
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
    canMove: () => !busy,
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
      if (!selected.length)
        setNotice('Select a target before recording feedback.');
      return (
        opened &&
        !busy &&
        !reattaching &&
        !settingsOpen &&
        !minimized &&
        selected.length > 0
      );
    },
    onState: updateControls,
    notice: setNotice,
  });
  mountVoiceShortcut({
    binding: () => preferences.voiceShortcut || defaultShortcut,
    enabled: () => selectionActive() && !busy && !reattaching,
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
    if (area !== 'local' || !changes.preferences) return;
    void readPreferences().then(({ preferences: value }) => {
      Object.assign(preferences, value);
      voice.refreshPreferences(preferences);
      refreshShortcutSettings();
      updateControls();
    });
  });
  const act = (action: () => Promise<void>) => {
    void action().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : String(error)),
    );
  };
  function updateControls() {
    const holdKey = shortcutLabel(preferences.voiceShortcut);
    $('[data-active-voice-shortcut]').textContent = holdKey;
    $('[data-voice-talk]').title =
      `Hold ${holdKey} outside text fields, hold this button, or hold Space while focused`;
    const voiceHint = $('.voice-hint');
    voiceHint.textContent = !selected.length
      ? `Select a target, then hold ${holdKey} to talk.`
      : !reviewing
        ? 'Resume selection to use your voice shortcut.'
        : `Hold ${holdKey} to talk about this selection.`;
    voiceHint.classList.toggle('ready', Boolean(selected.length && reviewing));
    $<HTMLButtonElement>('[data-action=save]').disabled =
      busy ||
      voice.recording ||
      !selected.length ||
      (!reattaching && !feedback.value.trim());
    $<HTMLButtonElement>('[data-action=export]').disabled =
      busy || !annotations.length;
    $<HTMLButtonElement>('[data-action=parent]').disabled =
      busy ||
      !selected[0]?.parentElement ||
      selected[0].parentElement === document.body;
    $<HTMLButtonElement>('[data-action=save]').textContent = busy
      ? 'Saving…'
      : reattaching
        ? 'Attach here'
        : 'Save note';
    $('[data-action=save]').title = voice.recording
      ? 'Finish recording before saving'
      : !selected.length
        ? 'Select a target on the page first'
        : !reattaching && !feedback.value.trim()
          ? 'Write or record a note first'
          : 'Save note · Ctrl+Enter or ⌘+Enter';
    feedback.disabled = busy || voice.recording || Boolean(reattaching);
    for (const action of ['cancel', 'pause', 'settings', 'minimize', 'close'])
      $<HTMLButtonElement>(`[data-action=${action}]`).disabled = busy;
    $<HTMLButtonElement>('[data-action=cancel]').disabled =
      busy || (!selected.length && !feedback.value && !reattaching);
    $<HTMLButtonElement>('[data-action=parent]').disabled ||= voice.recording;
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '[data-mode]',
    ))
      button.disabled = busy || voice.recording;
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '.card button',
    ))
      button.disabled = busy || voice.recording;
  }
  function renderSelection() {
    $('.target').hidden = !selected.length;
    $('.selection-prompt').hidden = Boolean(selected.length);
    if (selected.length) {
      $('.target-name').textContent = selected
        .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''))
        .join(', ');
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
        reviewing && selectionMode === 'text' ? 'none' : 'auto';
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
    if (!annotations.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML = `${icon('note')}<span>No notes yet</span><p>Select a target and add your first note.</p>`;
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
        a.targets[0].locator.tag +
        ' · ' +
        (a.targets[0].locator.nearbyHeading ||
          a.targets[0].locator.accessibleName ||
          'Page element');
      title.onclick = () => revisit(a);
      title.setAttribute('aria-label', 'Open note ' + (i + 1));
      const status = document.createElement('span');
      status.className =
        'status' + (a.status === 'needs-reattachment' ? ' missing' : '');
      status.textContent =
        a.status === 'needs-reattachment' ? 'Reattach' : a.status;
      head.append(number, title, status);
      const comment = document.createElement('p');
      comment.className = 'comment';
      comment.textContent = a.originalComment;
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
      const button = (text: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'quiet';
        b.textContent = text;
        b.disabled = busy || voice.recording;
        b.onclick = fn;
        actions.append(b);
      };
      button(a.resolution === 'addressed' ? 'Reopen' : 'Mark addressed', () =>
        act(async () => {
          a.resolution = a.resolution === 'addressed' ? 'open' : 'addressed';
          a.status =
            a.attachment.state === 'attached'
              ? a.resolution
              : 'needs-reattachment';
          a.updatedAt = new Date().toISOString();
          await rpc({ type: 'PUT', annotation: a });
          renderNotes();
        }),
      );
      button('Reattach', () => {
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
      });
      button('Delete', () => {
        const remove = actions.lastElementChild as HTMLButtonElement;
        remove.textContent = 'Confirm delete';
        remove.onclick = () =>
          act(async () => {
            await rpc({ type: 'DELETE', id: a.id, pageKey: page.key });
            annotations = annotations.filter((n) => n.id !== a.id);
            if (selectedId === a.id) clear();
            renderNotes();
            draw();
          });
      });
      card.append(head, comment, imageState, actions);
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
          await rpc({ type: 'PUT', annotation: a });
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
  }
  function clear() {
    voice.reset();
    quote = undefined;
    selected = [];
    selectedId = null;
    reattaching = null;
    feedback.value = '';
    renderSelection();
  }
  function setReviewing(value: boolean) {
    reviewing = value;
    shield.hidden = !selectionActive() || selectionMode === 'text';
    $('.mode-text').textContent = value ? 'Selection on' : 'Selection paused';
    $('.review-row').classList.toggle('paused', !value);
    $('[data-action=pause]').textContent = value
      ? 'Pause selection'
      : 'Resume selection';
    if (!value) hovered = null;
    updateControls();
    draw();
  }
  function selectionActive() {
    return opened && reviewing && !settingsOpen && !minimized;
  }
  function showSettings(value: boolean) {
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
    if (!value) voice.stop();
    opened = value;
    panel.hidden = !value;
    shield.hidden = !selectionActive() || selectionMode === 'text';
    act(async () => {
      await rpc({ type: 'ENABLED', enabled: value });
    });
    draw();
  }
  function revisit(a: Annotation) {
    if (busy || voice.recording) return;
    voice.stop();
    selectedId = a.id;
    reattaching = null;
    quote = a.targets[0].range;
    const targets = resolved.get(a.id);
    if (!targets?.length || a.status === 'needs-reattachment') {
      selected = [];
      setNotice(a.attachment.reason + ' Use Reattach to choose the target.');
    } else {
      selected = targets;
      targets[0].scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'instant',
      });
      setNotice('Note ' + (annotations.indexOf(a) + 1) + ' highlighted.');
    }
    renderSelection();
    renderNotes();
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
  shield.addEventListener('pointermove', (event) => {
    if (!selectionActive() || busy) return;
    hovered = underPointer(event.clientX, event.clientY);
    draw();
  });
  shield.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || voice.recording || !selectionActive()) return;
    const element = underPointer(event.clientX, event.clientY);
    if (!element) return;
    quote = undefined;
    if (selectionMode === 'multiple' || event.shiftKey) {
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
    setNotice('');
    renderSelection();
    if (preferences.voiceShortcut?.kind === 'key') {
      panel.tabIndex = -1;
      panel.focus({ preventScroll: true });
    } else feedback.focus();
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
        if (
          selectionMode === 'text' &&
          ['pointerdown', 'pointerup', 'mousedown', 'mouseup'].includes(type)
        ) {
          event.stopImmediatePropagation();
          if (type === 'mouseup' && !busy && !voice.recording)
            setTimeout(() => {
              const selection = readTextSelection(window.getSelection());
              if (!selection) {
                setNotice(
                  'Select a unique text passage within one section (up to 1,600 characters). Private fields are excluded.',
                );
                return;
              }
              selected = [selection.element];
              quote = selection.quote;
              selectedId = reattaching;
              renderSelection();
              setNotice('Text selected. Add your feedback.');
              if (preferences.voiceShortcut?.kind === 'key') {
                panel.tabIndex = -1;
                panel.focus({ preventScroll: true });
              } else feedback.focus();
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
        if (busy) return;
        if (voice.recording) voice.stop();
        else if (settingsOpen && !minimized) showSettings(false);
        else if (minimized) setMinimized(false);
        else if (selected.length || reattaching) {
          clear();
          setNotice('Selection cleared.');
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
        !minimized
      ) {
        event.preventDefault();
        act(save);
        return;
      }
      if (event.composedPath().includes(panel)) return;
      if (selectionActive() && ['Enter', ' '].includes(event.key)) {
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
    setNotice('Panel layout reset.');
  };
  $('.note-search').addEventListener('input', renderNotes);
  $('.note-filter').addEventListener('change', renderNotes);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    button.onclick = () => {
      if (busy || voice.recording) return;
      selectionMode = button.dataset.mode as typeof selectionMode;
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
            : 'Select an element on the page';
      setReviewing(true);
      renderSelection();
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
  async function save() {
    if (
      busy ||
      voice.recording ||
      !selected.length ||
      (!reattaching && !feedback.value.trim())
    )
      return;
    if (selected.some((el) => !el.isConnected)) {
      setNotice(
        'The selection changed or disappeared. Select it again before saving.',
      );
      return;
    }
    busy = true;
    updateControls();
    renderNotes();
    try {
      const currentPage = await pageContext();
      if (currentPage.key !== page.key) {
        setNotice('The page changed. Select the target again.');
        return;
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
            targets.map((target) => target.bounds),
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
        selectionKind: quote
          ? 'text-range'
          : selected.length > 1
            ? 'multiple'
            : 'element',
        targets,
        screenshot,
        status: old?.resolution ?? 'open',
        resolution: old?.resolution ?? 'open',
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
          : 'Note saved. Screenshot unavailable: ' + screenshot.reason,
      );
    } finally {
      busy = false;
      renderSelection();
      renderNotes();
      draw();
      if (matchAgain) scheduleRefresh();
    }
  }
  $('[data-action=export]').onclick = () =>
    act(async () => {
      if (busy) return;
      while (matching) await new Promise((resolve) => setTimeout(resolve, 20));
      annotations = await rpc<Annotation[]>({
        type: 'LIST',
        pageKey: page.key,
      });
      while (matching) await new Promise((resolve) => setTimeout(resolve, 20));
      await reconcile();
      const bytes = createBundle(annotations),
        blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download =
        'pointnote-feedback-' + new Date().toISOString().slice(0, 10) + '.zip';
      panel.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice(
        'Export ready: feedback.md, feedback.json, and screenshot files.',
      );
    });
  chrome.runtime.onMessage.addListener((message: { type: string }) => {
    if (message.type === 'TOGGLE' && !busy) setOpened(!opened);
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
  setInterval(() => {
    if (location.href !== lastUrl && !busy) {
      voice.stop();
      lastUrl = location.href;
      selected = [];
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
  try {
    await load();
    await rpc({ type: 'ENABLED', enabled: true });
  } catch (error) {
    setNotice('Could not load notes: ' + String(error));
  }
}
