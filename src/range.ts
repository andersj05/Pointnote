import { normalize, PRIVATE_SELECTOR, safeText } from './context';
import type { Target } from './types';
export function readTextSelection(
  selection: Selection | null,
): { element: Element; quote: NonNullable<Target['range']> } | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const element =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (
    !element ||
    element === document.body ||
    element === document.documentElement ||
    element.closest('[data-pointnote-root],' + PRIVATE_SELECTOR)
  )
    return null;
  for (const privateNode of element.querySelectorAll(PRIVATE_SELECTOR))
    if (range.intersectsNode(privateNode)) return null;
  const exact = normalize(range.toString());
  if (!exact || exact.length > 1600) return null;
  const text = safeText(element),
    start = text.indexOf(exact);
  if (start < 0 || text.indexOf(exact, start + 1) >= 0) return null;
  return {
    element,
    quote: {
      exact,
      prefix: text.slice(Math.max(0, start - 48), start),
      suffix: text.slice(start + exact.length, start + exact.length + 48),
      start,
      end: start + exact.length,
    },
  };
}
export function rangeForQuote(element: Element, exact: string): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const positions: { node: Text; offset: number }[] = [];
  let text = '',
    node: Node | null;
  while ((node = walker.nextNode())) {
    if (
      node.parentElement?.closest(PRIVATE_SELECTOR + ',script,style,noscript')
    )
      continue;
    const value = node.textContent || '';
    for (let offset = 0; offset < value.length; offset++) {
      const char = /\s/.test(value[offset]) ? ' ' : value[offset];
      if (char === ' ' && (!text || text.endsWith(' '))) continue;
      text += char;
      positions.push({ node: node as Text, offset });
    }
  }
  const index = text.indexOf(exact);
  if (index < 0 || text.indexOf(exact, index + 1) >= 0) return null;
  const first = positions[index],
    last = positions[index + exact.length - 1];
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
