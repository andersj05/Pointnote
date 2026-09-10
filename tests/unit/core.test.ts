import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { captureTarget, safeUrl } from '../../src/context';
import { matchTarget } from '../../src/anchor';
import { createBundle } from '../../src/export';
import {
  deleteAnnotation,
  listAnnotations,
  putAnnotation,
} from '../../src/storage';
import { unzipSync, strFromU8 } from 'fflate';
import type { Annotation } from '../../src/types';

beforeEach(() => {
  Object.assign(globalThis, {
    CSS: {
      escape: (value: string) =>
        value.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c),
    },
  });
  document.body.innerHTML =
    '<main><h1>Research findings</h1><p id="claim">Long-term retention increased in our study.</p></main>';
});
function annotation(): Annotation {
  const time = '2026-09-10T12:00:00.000Z';
  return {
    id: crypto.randomUUID(),
    originalComment: '  This needs more evidence.\nKeep my words.  ',
    createdAt: time,
    updatedAt: time,
    page: {
      key: crypto.randomUUID(),
      url: 'http://localhost/report',
      title: 'Report',
      viewport: {
        width: 1200,
        height: 900,
        devicePixelRatio: 1,
        scrollX: 0,
        scrollY: 0,
      },
    },
    selectionKind: 'element',
    targets: [captureTarget(document.querySelector('#claim')!)],
    screenshot: { status: 'unavailable', reason: 'Capture permission denied.' },
    status: 'open',
    resolution: 'open',
    attachment: {
      state: 'attached',
      reason: 'Selected by user.',
      checkedAt: time,
    },
    input: { method: 'typed' },
    reattachments: [],
  };
}
describe('bounded private context', () => {
  it('removes HTML comments and tolerates malformed resource URLs', () => {
    document.body.innerHTML =
      '<section><!-- private-comment-token --><img src="http://[invalid" alt="Chart"></section>';
    const target = captureTarget(document.querySelector('section')!);
    expect(target.htmlExcerpt).not.toContain('private-comment-token');
    expect(target.htmlExcerpt).not.toContain('http://[invalid');
    expect(target.htmlExcerpt).toContain('Chart');
  });
  it('excludes form values, private content, scripts and arbitrary attributes', () => {
    document.body.innerHTML =
      '<section id="form"><h2>Contact</h2><input value="password123" data-secret="token"><textarea>private textarea</textarea><select><option selected>secret choice</option></select><div contenteditable>private draft</div><div data-pointnote-private>private account</div><script>secretScript()</script><p onclick="secretEvent()" data-token="secretToken">Visible</p></section>';
    const target = captureTarget(document.querySelector('section')!);
    for (const secret of [
      'password123',
      'private textarea',
      'secret choice',
      'private draft',
      'private account',
      'secretScript',
      'secretEvent',
      'secretToken',
    ])
      expect(JSON.stringify(target)).not.toContain(secret);
    expect(target.htmlExcerpt).toContain('Visible');
  });
  it('bounds selected text and HTML and signals truncation', () => {
    document.querySelector('p')!.textContent = 'evidence '.repeat(2000);
    const target = captureTarget(document.querySelector('p')!);
    expect(target.locator.text.length).toBe(1600);
    expect(target.htmlExcerpt.length).toBe(6000);
    expect(target.htmlTruncated && target.textTruncated).toBe(true);
  });
  it('redacts URL credentials and query values', () => {
    const url = safeUrl(
      'https://alice:secret@example.com/report?token=abc&q=private#access_token=123',
    );
    expect(url).not.toMatch(/alice|secret|abc|private|123/);
  });
});
describe('conservative reattachment', () => {
  it('survives wrappers and ID changes using content and heading', () => {
    const target = captureTarget(document.querySelector('p')!);
    document.querySelector('main')!.innerHTML =
      '<h1>Research findings</h1><div><p id="new-claim">Long-term retention increased in our study.</p></div>';
    expect(matchTarget(target).state).toBe('attached');
  });
  it('rejects removed targets and recycled IDs with new content', () => {
    const target = captureTarget(document.querySelector('p')!);
    document.querySelector('p')!.textContent = 'A completely unrelated claim.';
    expect(matchTarget(target).state).toBe('missing');
    document.querySelector('p')!.remove();
    expect(matchTarget(target).state).toBe('missing');
  });
  it('rejects duplicates instead of trusting DOM position', () => {
    const target = captureTarget(document.querySelector('p')!);
    document.querySelector('p')!.removeAttribute('id');
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<p>Long-term retention increased in our study.</p>',
      );
    expect(matchTarget(target).state).toBe('ambiguous');
  });
  it('requires a unique text quote when matching ranges', () => {
    const target = captureTarget(document.querySelector('p')!, {
      exact: 'retention',
      prefix: 'Long-term ',
      suffix: ' increased',
      start: 10,
      end: 19,
    });
    expect(matchTarget(target).state).toBe('attached');
    target.range!.exact = 'missing quote';
    expect(matchTarget(target).state).toBe('missing');
  });
});
describe('local storage and export', () => {
  it('stores three independent annotations and keeps page isolation', async () => {
    const a = annotation(),
      b = { ...annotation(), page: a.page },
      c = { ...annotation(), page: a.page };
    await Promise.all([a, b, c].map(putAnnotation));
    expect(await listAnnotations(a.page.key)).toHaveLength(3);
    expect(await listAnnotations('other-page')).toHaveLength(0);
    await deleteAnnotation(a.id, 'other-page');
    expect(await listAnnotations(a.page.key)).toHaveLength(3);
    await deleteAnnotation(a.id, a.page.key);
    expect(await listAnnotations(a.page.key)).toHaveLength(2);
  });
  it('preserves exact words, instructions, screenshot files and missing reasons', () => {
    const a = annotation(),
      b = annotation();
    a.screenshot = {
      status: 'available',
      path: 'screenshots/' + a.id + '.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      capturedAt: a.createdAt,
      width: 100,
      height: 80,
      redactedRegions: 1,
      note: 'Forms masked.',
    };
    const files = unzipSync(createBundle([a, b]));
    const json = JSON.parse(strFromU8(files['feedback.json']));
    expect(json.schemaVersion).toBe('1.0.0');
    expect(json.annotations[0].originalComment).toBe(a.originalComment);
    expect(json.annotations[0].screenshot.dataUrl).toBeUndefined();
    expect(files[a.screenshot.path]).toBeDefined();
    const md = strFromU8(files['feedback.md']);
    expect(md).toContain(a.originalComment);
    expect(md).toContain('Capture permission denied.');
    expect(md).toContain('untrusted reference material');
    expect(md).toContain('Research findings');
  });
});
