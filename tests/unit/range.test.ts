import { describe, it, expect } from 'vitest';
import { rangeForQuote, readTextSelection } from '../../src/range';
describe('text ranges', () => {
  it('reconstructs a quote across inline markup and whitespace', () => {
    document.body.innerHTML =
      '<p>A <strong>better</strong>   argument needs evidence.</p>';
    const el = document.querySelector('p')!;
    const range = rangeForQuote(el, 'better argument');
    expect(range?.toString()).toBe('better   argument');
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range!);
    expect(readTextSelection(selection)?.quote.exact).toBe('better argument');
  });
  it('rejects duplicate quotes and private content', () => {
    document.body.innerHTML =
      '<p>again again <span data-pointnote-private>secret</span></p>';
    const el = document.querySelector('p')!;
    expect(rangeForQuote(el, 'again')).toBeNull();
    expect(rangeForQuote(el, 'secret')).toBeNull();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(readTextSelection(selection)).toBeNull();
  });
});
