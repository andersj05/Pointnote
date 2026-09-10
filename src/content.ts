import css from './ui.css';
import { bounds, captureTarget, pageContext, safeText } from './context';
import { matchTarget } from './anchor';
import { rpc } from './rpc';
import { captureScreenshot } from './screenshot';
import { createBundle } from './export';
import { mountVoice } from './voice';
import type { Annotation, PageContext } from './types';

const guard = globalThis as typeof globalThis & { __pointnote?: boolean };
if (!guard.__pointnote) {
  guard.__pointnote = true;
  void mount();
}

async function mount() {
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
        <div class="brand-row"><span class="logo" aria-hidden="true">p</span><span class="brand">pointnote</span><span class="local">● Local only</span><button class="icon" data-action="close" aria-label="Close Pointnote">×</button></div>
        <div class="page-title"></div>
        <div class="review-row"><span class="mode-label"><span class="dot"></span><span class="mode-text">Review mode</span></span><button class="quiet" data-action="pause">Pause selection</button></div>
      </header>
      <div class="body">
        <div class="eyebrow">A little context goes a long way</div>
        <h1 class="instruction">Point to it.<br>Put it into words.</h1>
        <p class="hint">Click something on the page to leave a note. Your words stay yours.</p>
        <div class="selection-tools" hidden></div>
        <div class="target" hidden><div class="target-top"><span class="target-name"></span><button class="quiet" data-action="parent">↑ Parent</button></div><div class="excerpt"></div></div>
        <form class="composer">
          <label class="feedback-label" for="feedback">Your feedback</label>
          <textarea id="feedback" maxlength="20000" placeholder="What feels off? What could be better?" aria-label="Your feedback"></textarea>
          <div class="composer-actions"><button class="secondary" type="button" data-action="cancel">Clear selection</button><button class="primary" type="submit" data-action="save" disabled>Save note ↗</button></div>
          <label class="privacy"><input type="checkbox" class="include-screenshot" checked>Include a screenshot. Form controls and private areas are masked.</label>
        </form>
        <div class="voice-slot"></div>
        <div class="notice" role="status" aria-live="polite"></div>
        <div class="notes-heading"><span class="eyebrow">Notes on this page</span><span class="count">0</span></div>
        <div class="notes"></div>
      </div>
      <footer class="footer"><button class="primary export" data-action="export" disabled><span>Export feedback</span><span>↓ ZIP</span></button><div class="footer-note">Markdown · JSON · screenshots</div></footer>
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
  const setNotice = (message: string) => {
    $('.notice').textContent = message;
  };
  const voice = mountVoice($('.voice-slot'), {
    getDraft: () => feedback.value,
    setDraft: (value) => {
      feedback.value = value;
      updateControls();
    },
    canStart: () => {
      if (!selected.length)
        setNotice('Select a target before recording feedback.');
      return !busy && !reattaching && selected.length > 0;
    },
    onState: updateControls,
    notice: setNotice,
  });
  const act = (action: () => Promise<void>) => {
    void action().catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : String(error)),
    );
  };
  function updateControls() {
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
        ? 'Attach here ↗'
        : 'Save note ↗';
    feedback.disabled = busy || Boolean(reattaching);
  }
  function renderSelection() {
    $('.target').hidden = !selected.length;
    if (selected.length) {
      $('.target-name').textContent = selected
        .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''))
        .join(', ');
      $('.excerpt').textContent =
        safeText(selected[0]).slice(0, 260) || '(No text — visual element)';
    }
    updateControls();
    draw();
  }
  function draw() {
    highlights.replaceChildren();
    markers.replaceChildren();
    if (!opened) return;
    const addOutline = (el: Element, hover: boolean) => {
      if (!el.isConnected) return;
      const r = bounds(el),
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
    selected.forEach((el) => addOutline(el, false));
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
      empty.textContent =
        'Nothing here yet. Start with the thing that caught your eye.';
      list.append(empty);
    }
    annotations.forEach((a, i) => {
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
          ? '▧ Screenshot saved'
          : 'Screenshot unavailable: ' + a.screenshot.reason;
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const button = (text: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'quiet';
        b.textContent = text;
        b.disabled = busy;
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
    annotations = await rpc<Annotation[]>({ type: 'LIST', pageKey: page.key });
    await reconcile();
  }
  function clear() {
    voice.reset();
    selected = [];
    selectedId = null;
    reattaching = null;
    feedback.value = '';
    renderSelection();
  }
  function setReviewing(value: boolean) {
    reviewing = value;
    shield.hidden = !value || !opened;
    $('.mode-text').textContent = value ? 'Review mode' : 'Page interaction on';
    $('[data-action=pause]').textContent = value
      ? 'Pause selection'
      : 'Resume selection';
    if (!value) hovered = null;
    draw();
  }
  function setOpened(value: boolean) {
    if (!value) voice.stop();
    opened = value;
    panel.hidden = !value;
    shield.hidden = !value || !reviewing;
    act(async () => {
      await rpc({ type: 'ENABLED', enabled: value });
    });
    draw();
  }
  function revisit(a: Annotation) {
    if (busy) return;
    selectedId = a.id;
    reattaching = null;
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
    if (!reviewing || busy) return;
    hovered = underPointer(event.clientX, event.clientY);
    draw();
  });
  shield.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || voice.recording || !reviewing) return;
    const element = underPointer(event.clientX, event.clientY);
    if (!element) return;
    selected = [element];
    selectedId = reattaching;
    hovered = null;
    setNotice('');
    renderSelection();
    feedback.focus();
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
        if (!opened || !reviewing) return;
        const path = event.composedPath();
        if (path.includes(panel) || path.includes(markers)) return;
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
        if (selected.length || reattaching) {
          clear();
          setNotice('Selection cleared.');
        } else setOpened(false);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.composedPath().includes(panel)) return;
      if (reviewing && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  $('[data-action=close]').onclick = () => {
    if (!busy) setOpened(false);
  };
  $('[data-action=pause]').onclick = () => {
    if (!busy) setReviewing(!reviewing);
  };
  $('[data-action=cancel]').onclick = () => {
    if (!busy) {
      clear();
      setNotice('');
    }
  };
  $('[data-action=parent]').onclick = () => {
    const parent = selected[0]?.parentElement;
    if (!busy && parent && parent !== document.body) {
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
    const currentPage = await pageContext();
    if (currentPage.key !== page.key) {
      setNotice('The page changed. Select the target again.');
      return;
    }
    busy = true;
    updateControls();
    renderNotes();
    try {
      const now = new Date().toISOString();
      const id = reattaching || crypto.randomUUID(),
        old = annotations.find((a) => a.id === reattaching);
      const targets = selected.map((el) => captureTarget(el));
      const screenshot = $<HTMLInputElement>('.include-screenshot').checked
        ? await captureScreenshot(
            selected,
            host,
            root,
            'screenshots/' + id + '-' + Date.now() + '.png',
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
        selectionKind: selected.length > 1 ? 'multiple' : 'element',
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
              { at: now, targets: old.targets, screenshot: old.screenshot },
            ]
          : [],
      };
      await rpc({ type: 'PUT', annotation });
      resolved.set(id, [...selected]);
      if (old)
        annotations = annotations.map((a) => (a.id === id ? annotation : a));
      else annotations.push(annotation);
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
      await reconcile();
      annotations = await rpc<Annotation[]>({
        type: 'LIST',
        pageKey: page.key,
      });
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
    if (message.type === 'TOGGLE') setOpened(!opened);
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
