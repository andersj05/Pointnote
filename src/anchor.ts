import { locator, safeText } from './context';
import type { Target } from './types';
export type Match =
  | { state: 'attached'; element: Element; reason: string }
  | { state: 'missing' | 'ambiguous'; reason: string };
export function matchTarget(target: Target, doc: Document = document): Match {
  const clue = target.locator;
  const all = [...doc.getElementsByTagName(clue.tag)].filter(
    (el) => !el.closest('[data-pointnote-root]'),
  );
  if (all.length > 6000)
    return {
      state: 'ambiguous',
      reason: 'Too many candidate elements to match safely.',
    };
  const scored = all
    .map((element) => {
      const c = locator(element);
      const stable =
        Boolean(clue.id && c.id === clue.id) ||
        Object.entries(clue.attributes).some(([k, v]) => c.attributes[k] === v);
      const text = Boolean(clue.text && clue.text === c.text);
      const name = Boolean(
        clue.accessibleName && clue.accessibleName === c.accessibleName,
      );
      const heading = Boolean(
        clue.nearbyHeading && clue.nearbyHeading === c.nearbyHeading,
      );
      // Structural position is only a tie-breaker. It can never identify a target on its own.
      const score =
        (stable ? 6 : 0) +
        (text ? 5 : 0) +
        (name ? 3 : 0) +
        (heading ? 1 : 0) +
        (clue.cssSelector === c.cssSelector ? 0.25 : 0);
      const supported =
        (stable && (text || name)) ||
        (!stable &&
          ((text && clue.text.length >= 12) ||
            (name && clue.accessibleName!.length >= 4)) &&
          heading);
      return { element, score, supported };
    })
    .filter((c) => c.supported)
    .sort((a, b) => b.score - a.score);
  if (!scored.length)
    return {
      state: 'missing',
      reason:
        'No target has enough independent matching clues. Reattach explicitly.',
    };
  if (scored[1] && scored[0].score - scored[1].score < 2)
    return {
      state: 'ambiguous',
      reason: 'Several elements match. Choose the intended target.',
    };
  const element = scored[0].element;
  if (target.range) {
    const text = safeText(element),
      quote = target.range.exact;
    const first = text.indexOf(quote);
    if (first < 0)
      return {
        state: 'missing',
        reason: 'The selected text is no longer present.',
      };
    if (text.indexOf(quote, first + 1) >= 0)
      return {
        state: 'ambiguous',
        reason: 'The selected text occurs more than once.',
      };
  }
  return {
    state: 'attached',
    element,
    reason: 'Matched content and independent locating clues.',
  };
}
