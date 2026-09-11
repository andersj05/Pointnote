import type { Annotation, ReviewPatch, ReviewSession } from './types';

export function isReadyForHandoff(note: Annotation): boolean {
  return note.resolution === 'open' && note.priority !== 'later';
}

export function validateSession(session: ReviewSession): void {
  if (
    !session ||
    !/^[\w-]{36}$/.test(session.id) ||
    typeof session.name !== 'string' ||
    !session.name.trim() ||
    session.name.length > 100 ||
    typeof session.instructions !== 'string' ||
    session.instructions.length > 5000 ||
    !Number.isFinite(Date.parse(session.createdAt)) ||
    !Number.isFinite(Date.parse(session.updatedAt))
  )
    throw new Error(
      'Enter a session name (up to 100 characters) and instructions up to 5,000 characters.',
    );
}

export function applyReviewPatch(
  note: Annotation,
  patch: ReviewPatch,
): Annotation {
  if (
    !patch ||
    (patch.priority !== undefined &&
      !['now', 'later'].includes(patch.priority)) ||
    (patch.resolution !== undefined &&
      !['open', 'addressed'].includes(patch.resolution)) ||
    (patch.sessionId !== undefined &&
      patch.sessionId !== null &&
      !/^[\w-]{36}$/.test(patch.sessionId)) ||
    (patch.review !== undefined &&
      (!patch.review ||
        !['accepted', 'needs-another-pass'].includes(patch.review.outcome) ||
        !Number.isFinite(Date.parse(patch.review.checkedAt)) ||
        typeof patch.review.followUp !== 'string' ||
        patch.review.followUp.length > 5000))
  )
    throw new Error('Review update is invalid.');
  const next = { ...note, updatedAt: new Date().toISOString() };
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.sessionId === null) delete next.sessionId;
  else if (patch.sessionId !== undefined) next.sessionId = patch.sessionId;
  if (patch.review) {
    next.review = { ...patch.review };
    next.resolution =
      patch.review.outcome === 'accepted' ? 'addressed' : 'open';
    if (patch.review.outcome === 'needs-another-pass') next.priority = 'now';
  } else if (patch.resolution !== undefined) {
    next.resolution = patch.resolution;
    delete next.review;
  }
  next.status =
    next.attachment.state === 'attached'
      ? next.resolution
      : 'needs-reattachment';
  return next;
}
