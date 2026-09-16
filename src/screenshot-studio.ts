import { icon } from './icons';
import { markupSvg, renderMarkedImage } from './screenshot-render';
import { rpc } from './rpc';
import type {
  Annotation,
  ImagePoint,
  ScreenshotImage,
  ScreenshotMark,
  ScreenshotPatch,
} from './types';

type Choice = { image: ScreenshotImage; label: string; detail: string };
export function mountScreenshotStudio(
  root: ShadowRoot,
  options: {
    onView(open: boolean): void;
    onSaved(note: Annotation): Promise<void>;
    onClose(noteId: string): void;
  },
) {
  const overlay = document.createElement('div');
  overlay.className = 'evidence-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="evidence-dialog" role="dialog" aria-modal="true" aria-label="Screenshot studio">
      <header class="evidence-heading"><div><span class="evidence-eyebrow">POINTNOTE · CAPTURED EVIDENCE</span><h1>Screenshot studio</h1></div><button class="icon" data-studio="close" aria-label="Close screenshot editor">${icon('close')}</button></header>
      <div class="evidence-toolbar"><div class="evidence-tools" role="group" aria-label="Drawing tools"><button data-tool="view" aria-pressed="true">${icon('cursor')}View</button><button data-tool="arrow" aria-pressed="false">${icon('arrow')}Arrow</button><button data-tool="callout" aria-pressed="false">${icon('note')}Callout</button><button data-studio="undo" aria-label="Undo screenshot edit" title="Undo">${icon('undo')}</button></div><div class="evidence-zoom" role="group" aria-label="Image zoom"><button data-studio="out" aria-label="Zoom out">${icon('minus')}</button><output class="zoom-value">100%</output><button data-studio="in" aria-label="Zoom in">${icon('plus')}</button><button data-studio="fit">Fit</button><button data-studio="actual">100%</button></div></div>
      <div class="evidence-layout"><div class="evidence-main"><div class="evidence-viewport"><div class="evidence-stage" tabindex="0" role="group" aria-label="Screenshot canvas" aria-describedby="pointnote-drawing-help"><img class="evidence-image" alt="Captured page with private regions masked" draggable="false"><div class="evidence-marks"></div><span class="evidence-cursor" hidden></span></div></div><p class="evidence-help" id="pointnote-drawing-help"></p></div><aside class="evidence-sidebar"><h2>Captured views</h2><div class="evidence-choices" role="group" aria-label="Captured views"></div><p class="evidence-detail"></p><button class="evidence-original" data-studio="original" aria-pressed="false">Show original</button><div class="evidence-callout-heading"><h2>Callouts</h2><button data-studio="clear" class="quiet">Clear marks</button></div><div class="evidence-callouts"></div><p class="evidence-preserved">Your original capture is always kept.</p></aside></div>
      <div class="evidence-error" aria-live="polite" hidden></div>
      <div class="evidence-discard" hidden><span>Discard your unsaved screenshot edits?</span><button data-studio="keep">Keep editing</button><button data-studio="discard">Discard changes</button></div>
      <footer class="evidence-footer"><span class="evidence-save-state">Original capture preserved</span><button class="secondary" data-studio="cancel">Back to notes</button><button class="primary" data-studio="save">Save changes</button></footer>
    </section>`;
  root.append(overlay);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    overlay.querySelector<T>(selector)!;
  const stage = $('.evidence-stage'),
    viewport = $('.evidence-viewport'),
    img = $<HTMLImageElement>('.evidence-image');
  let note: Annotation | undefined,
    choices: Choice[] = [],
    active = 0,
    zoom = 1;
  let tool: 'view' | 'arrow' | 'callout' = 'view',
    original = false,
    saving = false,
    loaded = false;
  let drafts = new Map<string, ScreenshotMark[]>(),
    history = new Map<string, ScreenshotMark[][]>();
  let start: ImagePoint | undefined,
    preview: ImagePoint | undefined,
    pointerId: number | undefined;
  let cursor: ImagePoint = { x: 0.5, y: 0.5 },
    generation = 0;
  const current = () => choices[active];
  const marks = () => drafts.get(current().image.path)!;
  const changed = () =>
    choices.filter(
      (choice) =>
        JSON.stringify(drafts.get(choice.image.path)) !==
        JSON.stringify(choice.image.marks || []),
    );
  const error = (message = '') => {
    $('.evidence-error').textContent = message;
    $('.evidence-error').hidden = !message;
  };
  function update() {
    for (const button of overlay.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = saving;
    $<HTMLButtonElement>('[data-studio=save]').disabled =
      saving || !changed().length;
    $<HTMLButtonElement>('[data-studio=undo]').disabled =
      saving || !history.get(current()?.image.path)?.length;
    $<HTMLButtonElement>('[data-studio=clear]').disabled =
      saving || !marks().length;
    for (const button of overlay.querySelectorAll<HTMLButtonElement>(
      '[data-tool]',
    )) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
      button.disabled = saving || !loaded;
    }
    for (const field of overlay.querySelectorAll<HTMLTextAreaElement>(
      'textarea',
    ))
      field.disabled = saving;
    $('.evidence-save-state').textContent = saving
      ? 'Saving your edits…'
      : changed().length
        ? 'Unsaved edits · original kept'
        : 'Original capture preserved';
    $('[data-studio=save]').textContent = saving ? 'Saving…' : 'Save changes';
    $('.evidence-help').textContent = original
      ? 'Original capture · marks are hidden.'
      : tool === 'arrow'
        ? 'Drag to draw an arrow. Keyboard: focus the image, use arrow keys, and Enter to set each end.'
        : tool === 'callout'
          ? 'Click to place a numbered callout, then add its text. Keyboard: arrow keys move, Enter places.'
          : 'Choose a close-up for more detail. Zoom in and scroll to explore.';
    stage.dataset.tool = original ? 'view' : tool;
    $('[data-studio=original]').setAttribute('aria-pressed', String(original));
    $('[data-studio=original]').textContent = original
      ? 'Show my marks'
      : 'Show original';
  }
  function draw() {
    const image = current().image;
    const visible = original
      ? []
      : [
          ...marks(),
          ...(start && preview
            ? [{ kind: 'arrow' as const, from: start, to: preview }]
            : []),
        ];
    $('.evidence-marks').replaceChildren(
      markupSvg(image.width, image.height, visible),
    );
    const dot = $('.evidence-cursor');
    dot.style.left = `${cursor.x * 100}%`;
    dot.style.top = `${cursor.y * 100}%`;
  }
  function remember() {
    const path = current().image.path;
    const stack = history.get(path) || [];
    stack.push(structuredClone(marks()));
    if (stack.length > 50) stack.shift();
    history.set(path, stack);
  }
  function listCallouts(focusLast = false) {
    const list = $('.evidence-callouts');
    list.replaceChildren();
    let number = 0;
    marks().forEach((mark, index) => {
      if (mark.kind !== 'callout') return;
      const row = document.createElement('label');
      row.className = 'evidence-callout';
      const label = document.createElement('span');
      const calloutNumber = ++number;
      label.textContent = String(calloutNumber);
      const field = document.createElement('textarea');
      field.rows = 2;
      field.maxLength = 240;
      field.value = mark.text;
      field.placeholder = 'What should change here?';
      field.setAttribute('aria-label', `Callout ${number} text`);
      let recorded = false;
      field.onfocus = () => {
        recorded = false;
      };
      field.oninput = () => {
        if (!recorded) {
          remember();
          recorded = true;
        }
        mark.text = field.value;
        update();
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon';
      remove.innerHTML = icon('close');
      remove.setAttribute('aria-label', `Remove callout ${number}`);
      remove.onclick = (event) => {
        event.preventDefault();
        remember();
        marks().splice(index, 1);
        draw();
        listCallouts();
        update();
        const fields = list.querySelectorAll<HTMLTextAreaElement>('textarea');
        (
          fields[Math.min(calloutNumber - 1, fields.length - 1)] || stage
        ).focus();
      };
      row.append(label, field, remove);
      list.append(row);
    });
    if (!number) {
      const empty = document.createElement('p');
      empty.className = 'evidence-empty';
      empty.textContent =
        'Place a callout to connect a detail with your words.';
      list.append(empty);
    }
    if (focusLast) list.querySelectorAll('textarea')[number - 1]?.focus();
  }
  function scale(value: number) {
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom,
      centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
    zoom = Math.max(0.02, Math.min(4, value));
    stage.style.width = `${current().image.width * zoom}px`;
    stage.style.height = `${current().image.height * zoom}px`;
    $('.zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    viewport.scrollLeft = centerX * zoom - viewport.clientWidth / 2;
    viewport.scrollTop = centerY * zoom - viewport.clientHeight / 2;
  }
  function fit() {
    const image = current().image;
    scale(
      Math.min(
        1,
        Math.max(1, viewport.clientWidth - 56) / image.width,
        Math.max(1, viewport.clientHeight - 56) / image.height,
      ),
    );
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
  }
  async function show(index: number) {
    const token = ++generation;
    active = index;
    start = undefined;
    preview = undefined;
    original = false;
    loaded = false;
    cursor = { x: 0.5, y: 0.5 };
    $('.evidence-cursor').hidden = true;
    const choice = current();
    $('.evidence-detail').textContent = choice.detail;
    for (const button of overlay.querySelectorAll<HTMLButtonElement>(
      '[data-view]',
    ))
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.view) === index),
      );
    img.src = choice.image.dataUrl || '';
    img.alt = choice.label + ' · private regions masked';
    draw();
    listCallouts();
    fit();
    error();
    update();
    try {
      await img.decode();
      if (token !== generation) return;
      if (
        img.naturalWidth !== choice.image.width ||
        img.naturalHeight !== choice.image.height
      )
        throw new Error('Image dimensions do not match this capture.');
      loaded = true;
      update();
    } catch {
      if (token === generation)
        error(
          'This saved image could not be opened. Other captured views may still be available.',
        );
    }
  }
  function close(force = false) {
    if (saving) return;
    if (start) {
      start = preview = undefined;
      draw();
      return;
    }
    if (!force && changed().length) {
      $('.evidence-discard').hidden = false;
      $('[data-studio=keep]').focus();
      return;
    }
    const id = note!.id;
    generation++;
    overlay.hidden = true;
    note = undefined;
    options.onView(false);
    options.onClose(id);
  }
  function add(mark: ScreenshotMark) {
    if (marks().length >= 40) {
      error('Use up to 40 marks per image. Remove a mark to add another.');
      return;
    }
    remember();
    marks().push(mark);
    error();
    draw();
    listCallouts(mark.kind === 'callout');
    update();
  }
  function position(event: PointerEvent): ImagePoint {
    const r = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.x) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.y) / r.height)),
    };
  }
  stage.onpointerdown = (event) => {
    if (saving || !loaded || original || tool === 'view' || event.button !== 0)
      return;
    event.preventDefault();
    stage.focus();
    $('.evidence-cursor').hidden = true;
    if (tool === 'callout') {
      add({ kind: 'callout', at: position(event), text: '' });
      return;
    }
    pointerId = event.pointerId;
    start = preview = position(event);
    stage.setPointerCapture(event.pointerId);
    draw();
  };
  stage.onpointermove = (event) => {
    if (pointerId === event.pointerId && start) {
      preview = position(event);
      draw();
    }
  };
  stage.onpointerup = (event) => {
    if (pointerId !== event.pointerId || !start) return;
    const from = start,
      to = position(event);
    start = preview = undefined;
    pointerId = undefined;
    if (stage.hasPointerCapture(event.pointerId))
      stage.releasePointerCapture(event.pointerId);
    if (
      Math.hypot(
        (to.x - from.x) * current().image.width,
        (to.y - from.y) * current().image.height,
      ) >= 8
    )
      add({ kind: 'arrow', from, to });
    draw();
  };
  stage.onpointercancel = () => {
    start = preview = undefined;
    pointerId = undefined;
    draw();
  };
  stage.onblur = () => {
    $('.evidence-cursor').hidden = true;
  };
  stage.onkeydown = (event) => {
    if (saving || !loaded || original || tool === 'view') return;
    const step = event.shiftKey ? 0.1 : 0.01;
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    ) {
      event.preventDefault();
      cursor = {
        x: Math.max(
          0,
          Math.min(
            1,
            cursor.x +
              (event.key === 'ArrowRight'
                ? step
                : event.key === 'ArrowLeft'
                  ? -step
                  : 0),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            1,
            cursor.y +
              (event.key === 'ArrowDown'
                ? step
                : event.key === 'ArrowUp'
                  ? -step
                  : 0),
          ),
        ),
      };
      if (start) preview = { ...cursor };
      $('.evidence-cursor').hidden = false;
      draw();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (tool === 'callout')
        add({ kind: 'callout', at: { ...cursor }, text: '' });
      else if (!start) {
        start = preview = { ...cursor };
        draw();
      } else {
        const from = start;
        start = preview = undefined;
        if (Math.hypot(from.x - cursor.x, from.y - cursor.y) > 0.005)
          add({ kind: 'arrow', from, to: { ...cursor } });
        draw();
      }
    }
  };
  overlay.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!$('.evidence-discard').hidden) keepEditing();
      else close();
    }
    if (event.key === 'Tab') {
      const focusable = [
        ...overlay.querySelectorAll<HTMLElement>(
          'button:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && root.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && root.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  for (const button of overlay.querySelectorAll<HTMLButtonElement>(
    '[data-tool]',
  ))
    button.onclick = () => {
      tool = button.dataset.tool as typeof tool;
      original = false;
      start = preview = undefined;
      draw();
      update();
    };
  $('[data-studio=close]').onclick = $('[data-studio=cancel]').onclick = () =>
    close();
  $('[data-studio=discard]').onclick = () => close(true);
  function keepEditing() {
    $('.evidence-discard').hidden = true;
    const save = $<HTMLButtonElement>('[data-studio=save]');
    (save.disabled ? $('[data-studio=close]') : save).focus();
  }
  $('[data-studio=keep]').onclick = keepEditing;
  $('[data-studio=in]').onclick = () => scale(zoom * 1.25);
  $('[data-studio=out]').onclick = () => scale(zoom / 1.25);
  $('[data-studio=fit]').onclick = fit;
  $('[data-studio=actual]').onclick = () => scale(1);
  $('[data-studio=original]').onclick = () => {
    original = !original;
    start = preview = undefined;
    draw();
    update();
  };
  $('[data-studio=undo]').onclick = () => {
    const previous = history.get(current().image.path)?.pop();
    if (previous) drafts.set(current().image.path, previous);
    start = preview = undefined;
    draw();
    listCallouts();
    update();
  };
  $('[data-studio=clear]').onclick = () => {
    remember();
    drafts.set(current().image.path, []);
    start = preview = undefined;
    draw();
    listCallouts();
    update();
  };
  $('[data-studio=save]').onclick = () => {
    if (saving || !note || note.screenshot.status !== 'available') return;
    const captured = note;
    const patch: ScreenshotPatch = {
      capturePath: note.screenshot.path,
      revision: note.screenshot.revision || 0,
      edits: [],
    };
    saving = true;
    error();
    update();
    void (async () => {
      try {
        for (const choice of changed()) {
          const marks = drafts.get(choice.image.path)!;
          patch.edits.push({
            imagePath: choice.image.path,
            marks,
            ...(marks.length
              ? {
                  renderedDataUrl: await renderMarkedImage(choice.image, marks),
                }
              : {}),
          });
        }
        const updated = await rpc<Annotation>({
          type: 'PATCH_SCREENSHOT',
          id: captured.id,
          patch,
        });
        await options.onSaved(updated);
        saving = false;
        start = undefined;
        close(true);
      } catch (cause) {
        saving = false;
        error(cause instanceof Error ? cause.message : String(cause));
        update();
      }
    })();
  };
  const resize = new ResizeObserver(() => {
    if (!overlay.hidden && !saving) fit();
  });
  resize.observe(viewport);
  return {
    get isOpen() {
      return !overlay.hidden;
    },
    get isBusy() {
      return saving;
    },
    close,
    async open(value: Annotation) {
      if (value.screenshot.status !== 'available') return;
      note = value;
      choices = [
        {
          image: value.screenshot,
          label: 'Full viewport',
          detail: 'The wider view at the moment you saved your note.',
        },
      ];
      for (const crop of value.screenshot.crops || []) {
        if (crop.status !== 'available') continue;
        const role = value.comparison
          ? crop.targetIndex === value.comparison.changeTarget
            ? ' · Change this'
            : ' · Reference'
          : '';
        choices.push({
          image: crop,
          label:
            crop.targetIndex === undefined
              ? 'Selected area'
              : `Target ${crop.targetIndex + 1}${role}`,
          detail: crop.clipped
            ? 'Close-up · only the visible portion was captured.'
            : 'A closer look at the target and its surroundings.',
        });
      }
      drafts = new Map(
        choices.map((choice) => [
          choice.image.path,
          structuredClone(choice.image.marks || []),
        ]),
      );
      history = new Map();
      tool = 'view';
      original = false;
      saving = false;
      overlay.hidden = false;
      $('.evidence-discard').hidden = true;
      options.onView(true);
      const views = $('.evidence-choices');
      views.replaceChildren();
      choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.dataset.view = String(index);
        button.setAttribute('aria-pressed', String(index === 0));
        const thumb = document.createElement('img');
        thumb.src = choice.image.dataUrl || '';
        thumb.alt = '';
        const label = document.createElement('span');
        label.textContent = choice.label;
        const size = document.createElement('small');
        size.textContent = `${choice.image.width} × ${choice.image.height}`;
        const text = document.createElement('span');
        text.append(label, size);
        button.append(thumb, text);
        button.onclick = () => {
          void show(index);
        };
        views.append(button);
      });
      for (const crop of value.screenshot.crops || []) {
        if (crop.status !== 'unavailable') continue;
        const missing = document.createElement('p');
        missing.className = 'evidence-detail';
        missing.textContent = `${crop.targetIndex === undefined ? 'Selected area' : `Target ${crop.targetIndex + 1}`}: ${crop.reason}`;
        views.append(missing);
      }
      await show(0);
      if (!overlay.hidden) $('[data-studio=close]').focus();
    },
  };
}
