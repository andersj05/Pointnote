export type VoiceShortcut =
  | { kind: 'mouse'; button: 1 | 3 | 4 }
  | {
      kind: 'key';
      code: string;
      key: string;
      ctrl: boolean;
      alt: boolean;
      shift: boolean;
      meta: boolean;
    };
export const defaultShortcut: VoiceShortcut = { kind: 'mouse', button: 1 };
export const backtickShortcut: VoiceShortcut = {
  kind: 'key',
  code: 'Backquote',
  key: '`',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};
export function validShortcut(value: unknown): value is VoiceShortcut {
  if (!value || typeof value !== 'object') return false;
  const item = value as VoiceShortcut;
  if (item.kind === 'mouse') return [1, 3, 4].includes(item.button);
  return (
    item.kind === 'key' &&
    typeof item.code === 'string' &&
    /^[A-Za-z][A-Za-z0-9]{0,29}$/.test(item.code) &&
    !/^(Escape|Tab|Enter|Space|Control|Shift|Alt|Meta|CapsLock)/.test(
      item.code,
    ) &&
    typeof item.key === 'string' &&
    item.key.length > 0 &&
    item.key.length <= 24 &&
    ['ctrl', 'alt', 'shift', 'meta'].every(
      (key) => typeof item[key as 'ctrl'] === 'boolean',
    )
  );
}
export function shortcutLabel(binding: VoiceShortcut = defaultShortcut) {
  if (binding.kind === 'mouse')
    return binding.button === 1
      ? 'Middle mouse'
      : binding.button === 3
        ? 'Mouse back'
        : 'Mouse forward';
  return [
    binding.ctrl && 'Ctrl',
    binding.alt && 'Alt',
    binding.shift && 'Shift',
    binding.meta && 'Meta',
    binding.key === '`'
      ? '`'
      : binding.key.length === 1
        ? binding.key.toUpperCase()
        : binding.key,
  ]
    .filter(Boolean)
    .join(' + ');
}
export function keyShortcut(event: KeyboardEvent): VoiceShortcut | undefined {
  if (event.repeat || event.isComposing) return;
  const binding: VoiceShortcut = {
    kind: 'key',
    code: event.code,
    key: event.key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
  if (validShortcut(binding)) return binding;
}
export function mountShortcutSettings(
  container: HTMLElement,
  get: () => VoiceShortcut,
  save: (binding: VoiceShortcut) => void,
) {
  container.innerHTML =
    '<label class="setting-field">Hold to talk<select aria-label="Voice shortcut"><option value="middle">Middle mouse</option><option value="backtick">Backtick (`)</option><option value="custom">Custom shortcut</option></select></label><button class="secondary" type="button" data-capture-shortcut>Record shortcut</button><p class="setting-description" data-shortcut-help>Keyboard shortcuts work outside text fields. Extra mouse buttons must be exposed by your browser.</p>';
  const select = container.querySelector<HTMLSelectElement>('select')!;
  const capture = container.querySelector<HTMLButtonElement>(
    '[data-capture-shortcut]',
  )!;
  const help = container.querySelector<HTMLElement>('[data-shortcut-help]')!;
  let listening = false;
  const render = () => {
    const binding = get();
    select.value =
      binding.kind === 'mouse' && binding.button === 1
        ? 'middle'
        : binding.kind === 'key' &&
            binding.code === 'Backquote' &&
            !binding.ctrl &&
            !binding.alt &&
            !binding.meta &&
            !binding.shift
          ? 'backtick'
          : 'custom';
    capture.textContent = `Record shortcut · ${shortcutLabel(binding)}`;
  };
  const accept = (binding: VoiceShortcut) => {
    listening = false;
    save(binding);
    render();
    help.textContent = `Saved: ${shortcutLabel(binding)}. Hold to talk while page selection is on. Keyboard shortcuts leave text fields untouched.`;
  };
  select.onchange = () => {
    if (select.value === 'middle') accept(defaultShortcut);
    else if (select.value === 'backtick') accept(backtickShortcut);
    else capture.click();
  };
  capture.onclick = () => {
    listening = true;
    capture.focus();
    capture.textContent = 'Press a key or mouse button…';
    help.textContent =
      'Press your shortcut now. Esc cancels. For a device button the browser cannot detect, map it to a key in your mouse software.';
  };
  capture.onkeydown = (event) => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      listening = false;
      render();
      return;
    }
    const binding = keyShortcut(event);
    if (binding) accept(binding);
    else
      help.textContent =
        'Choose a letter, punctuation key, function key, or a combination. Navigation keys stay available for the interface.';
  };
  capture.onpointerdown = (event) => {
    if (!listening || ![1, 3, 4].includes(event.button)) return;
    event.preventDefault();
    event.stopPropagation();
    accept({ kind: 'mouse', button: event.button as 1 | 3 | 4 });
  };
  for (const name of ['mousedown', 'mouseup', 'auxclick'])
    capture.addEventListener(name, (event) => {
      if ((event as MouseEvent).button !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  capture.onblur = () => {
    listening = false;
    render();
  };
  render();
  return render;
}
