import type { Bounds, PageContext, Target, Locator } from './types';
export const PRIVATE_SELECTOR =
  'input,textarea,select,option,[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),[data-pointnote-private],iframe,object,embed';
const OMIT_SELECTOR = 'script,style,noscript,template,link,meta';
export const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const trim = (value: string, max: number) => value.slice(0, max);
export function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()])
      url.searchParams.set(key, '[redacted]');
    if (url.hash.includes('=') || /token|secret|password/i.test(url.hash))
      url.hash = '[redacted]';
    return url.href;
  } catch {
    return '[unavailable URL]';
  }
}
function privateElement(el: Element) {
  return Boolean(el.closest(PRIVATE_SELECTOR));
}
export function sanitizedClone(el: Element): Element {
  const clone = el.cloneNode(true) as Element;
  const comments = el.ownerDocument.createTreeWalker(
    clone,
    NodeFilter.SHOW_COMMENT,
  );
  const remove: Node[] = [];
  while (comments.nextNode()) remove.push(comments.currentNode);
  remove.forEach((node) => node.parentNode?.removeChild(node));
  const walk = (node: Element) => {
    if (node.matches(OMIT_SELECTOR)) {
      node.replaceChildren();
      return;
    }
    const isPrivate =
      node.matches(PRIVATE_SELECTOR) || (node === clone && privateElement(el));
    for (const attribute of [...node.attributes]) {
      const name = attribute.name;
      if (
        ![
          'id',
          'class',
          'role',
          'aria-label',
          'aria-labelledby',
          'alt',
          'title',
          'data-testid',
          'data-test',
          'data-cy',
          'type',
          'href',
          'src',
        ].includes(name)
      )
        node.removeAttribute(name);
      else if (name === 'href' || name === 'src') {
        if (/^(data|javascript|blob):/i.test(attribute.value))
          node.removeAttribute(name);
        else {
          try {
            node.setAttribute(
              name,
              safeUrl(new URL(attribute.value, el.ownerDocument.baseURI).href),
            );
          } catch {
            node.removeAttribute(name);
          }
        }
      } else node.setAttribute(name, trim(attribute.value, 180));
    }
    if (isPrivate) {
      for (const a of [...node.attributes]) node.removeAttribute(a.name);
      node.textContent = '[private content omitted]';
      return;
    }
    for (const child of [...node.children]) {
      if (child.matches(OMIT_SELECTOR)) child.remove();
      else walk(child);
    }
  };
  walk(clone);
  return clone;
}
export function safeText(el: Element): string {
  return normalize(sanitizedClone(el).textContent || '');
}
function usefulId(value: string | null): value is string {
  return Boolean(
    value &&
    value.length < 150 &&
    !/(:r\w+:|\d{7,}|[a-f0-9]{16,})/i.test(value),
  );
}
export function selector(el: Element): string {
  const pieces: string[] = [];
  let node: Element | null = el;
  while (
    node &&
    node !== el.ownerDocument.documentElement &&
    pieces.length < 8
  ) {
    if (usefulId(node.id)) {
      pieces.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    for (const key of ['data-testid', 'data-test', 'data-cy']) {
      const value = node.getAttribute(key);
      if (usefulId(value)) {
        part += `[${key}="${CSS.escape(value)}"]`;
        break;
      }
    }
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter(
          (s) => s.tagName === node!.tagName,
        )
      : [];
    if (siblings.length > 1)
      part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    pieces.unshift(part);
    node = node.parentElement;
  }
  return pieces.join(' > ');
}
export function nearbyHeading(el: Element): string | null {
  const headings = [
    ...el.ownerDocument.querySelectorAll('h1,h2,h3,h4,h5,h6'),
  ].filter((h) => !h.closest('[data-pointnote-root]'));
  const containing = headings.find((h) => el.contains(h));
  if (containing) return trim(safeText(containing), 180) || null;
  const preceding = headings.filter((h) =>
    Boolean(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  return preceding.length
    ? trim(safeText(preceding[preceding.length - 1]), 180) || null
    : null;
}
export function accessibleName(el: Element): string | null {
  if (privateElement(el)) return null;
  const labelled = el
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id))
    .filter((e): e is HTMLElement => Boolean(e))
    .map(safeText)
    .join(' ');
  const value =
    labelled ||
    el.getAttribute('aria-label') ||
    el.getAttribute('alt') ||
    el.getAttribute('title') ||
    (/^(BUTTON|A|H[1-6])$/.test(el.tagName) ? safeText(el) : '');
  return value ? trim(normalize(value), 240) : null;
}
export function bounds(el: Element): Bounds {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
export function locator(el: Element): Locator {
  const attributes: Record<string, string> = {};
  if (!privateElement(el))
    for (const key of ['data-testid', 'data-test', 'data-cy']) {
      const value = el.getAttribute(key);
      if (usefulId(value)) attributes[key] = value;
    }
  const implicit: Record<string, string> = {
    BUTTON: 'button',
    A: 'link',
    IMG: 'img',
    H1: 'heading',
    H2: 'heading',
    H3: 'heading',
    SECTION: 'region',
  };
  return {
    tag: el.tagName.toLowerCase(),
    id: usefulId(el.id) ? el.id : null,
    attributes,
    role: el.getAttribute('role') || implicit[el.tagName] || null,
    accessibleName: accessibleName(el),
    cssSelector: selector(el),
    nearbyHeading: nearbyHeading(el),
    text: trim(safeText(el), 1600),
  };
}
export function captureTarget(el: Element, range?: Target['range']): Target {
  const html = sanitizedClone(el).outerHTML;
  const text = safeText(el);
  return {
    locator: locator(el),
    htmlExcerpt: trim(html, 6000),
    htmlTruncated: html.length > 6000,
    textTruncated: text.length > 1600,
    bounds: bounds(el),
    ...(range ? { range } : {}),
  };
}
export async function pageContext(): Promise<PageContext> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(location.href),
  );
  return {
    key: [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    url: safeUrl(location.href),
    title: document.title.slice(0, 500),
    viewport: {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
      scrollX,
      scrollY,
    },
  };
}
