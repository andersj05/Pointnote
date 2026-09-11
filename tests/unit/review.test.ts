import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Annotation, ReviewSession } from '../../src/types';
import { applyReviewPatch, isReadyForHandoff } from '../../src/review';
import {
  putAnnotation,
  putSession,
  patchReview,
  patchAttachment,
  readLibrary,
  deleteAnnotation,
} from '../../src/storage';
import { createMarkdown, createBundle } from '../../src/export';
import { strFromU8, unzipSync } from 'fflate';

function note(): Annotation {
  return {
    id: crypto.randomUUID(),
    originalComment: '  Keep my words.\n```example  ',
    createdAt: '2026-09-11T12:00:00.000Z',
    updatedAt: '2026-09-11T12:00:00.000Z',
    page: {
      key: crypto.randomUUID(),
      url: 'https://example.test/review',
      title: 'Review',
      viewport: {
        width: 1000,
        height: 800,
        devicePixelRatio: 1,
        scrollX: 0,
        scrollY: 0,
      },
    },
    selectionKind: 'element',
    targets: [],
    screenshot: { status: 'unavailable', reason: 'Disabled.' },
    status: 'open',
    resolution: 'open',
    attachment: {
      state: 'attached',
      reason: 'Selected.',
      checkedAt: '2026-09-11T12:00:00.000Z',
    },
    input: { method: 'typed' },
    reattachments: [],
  };
}

describe('review decisions and handoffs', () => {
  it('defaults legacy notes to Now and keeps acceptance separate from attachment', () => {
    const original = note();
    expect(isReadyForHandoff(original)).toBe(true);
    expect(
      isReadyForHandoff(applyReviewPatch(original, { priority: 'later' })),
    ).toBe(false);
    original.attachment.state = 'missing';
    const accepted = applyReviewPatch(original, {
      review: {
        outcome: 'accepted',
        checkedAt: original.createdAt,
        followUp: '',
      },
    });
    expect(accepted.status).toBe('needs-reattachment');
    expect(accepted.resolution).toBe('addressed');
    expect(isReadyForHandoff(accepted)).toBe(false);
    const again = applyReviewPatch(accepted, {
      review: {
        outcome: 'needs-another-pass',
        checkedAt: original.createdAt,
        followUp: 'Keep the original font.',
      },
    });
    expect(again.originalComment).toBe(original.originalComment);
    expect(isReadyForHandoff(again)).toBe(true);
    expect(again.attachment.state).toBe('missing');
    expect(original.resolution).toBe('open');
  });

  it('exports only supplied notes and preserves session instructions and follow-ups in both formats', () => {
    const original = note();
    const selected = applyReviewPatch(original, {
      review: {
        outcome: 'needs-another-pass',
        checkedAt: original.createdAt,
        followUp: 'Only adjust spacing.',
      },
    });
    const handoff = {
      name: 'Before launch',
      instructions: '  Keep colors.\n```literal  ',
    };
    const markdown = createMarkdown([selected], new Date(), false, handoff);
    const files = unzipSync(createBundle([selected], new Date(), handoff));
    const json = JSON.parse(strFromU8(files['feedback.json']));
    for (const text of [markdown, strFromU8(files['feedback.md'])]) {
      expect(text).toContain(original.originalComment);
      expect(text).toContain(handoff.instructions);
      expect(text).toContain('Only adjust spacing.');
    }
    expect(json.handoff).toEqual(handoff);
    expect(json.annotations).toHaveLength(1);
  });

  it('merges independent tab updates and refuses to resurrect deleted notes', async () => {
    const original = note();
    const session: ReviewSession = {
      id: crypto.randomUUID(),
      name: 'Release',
      instructions: '',
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    };
    await putSession(session);
    await putAnnotation(original);
    await Promise.all([
      patchReview(original.id, { sessionId: session.id, priority: 'later' }),
      patchAttachment(original.id, {
        ...original.attachment,
        state: 'missing',
      }),
    ]);
    await putAnnotation({ ...original, originalComment: 'Stale replacement' });
    const stored = (await readLibrary()).annotations.find(
      (item) => item.id === original.id,
    )!;
    expect(stored.sessionId).toBe(session.id);
    expect(stored.priority).toBe('later');
    expect(stored.originalComment).toBe(original.originalComment);
    await deleteAnnotation(original.id, original.page.key);
    await expect(patchReview(original.id, { priority: 'now' })).rejects.toThrow(
      'deleted',
    );
  });
});
