export async function copyText(text: string, root: ShadowRoot) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some reviewed pages deny the Clipboard API through their permissions policy.
  }
  const focused = root.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('aria-label', 'Feedback to copy');
  Object.assign(field.style, { position: 'fixed', left: '-10000px', top: '0' });
  root.append(field);
  try {
    field.focus();
    field.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } catch {
    throw new Error(
      'Clipboard access was blocked. Choose Save Markdown file instead.',
    );
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
  }
}
