import { safeUrl, sanitizedClone } from './context';
import { applyReviewPatch, validateSession } from './review';
import type {
  Annotation,
  Bounds,
  PageContext,
  ReviewLibrary,
  ReviewSession,
  Screenshot,
  Target,
} from './types';

export const BACKUP_LIMIT = 64 * 1024 * 1024;
function invalid(): never {
  throw new Error(
    'This is not a supported Pointnote backup. No notes were imported.',
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return invalid();
  return value;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) return invalid();
  return result;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!/^[\w-]{36}$/.test(result)) return invalid();
  return result;
}
function number(value: unknown, min = -1e9, max = 1e9): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    return invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid();
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function nullable(value: unknown, max: number): string | null {
  return value === null ? null : text(value, max);
}
function bounds(value: unknown): Bounds {
  const b = object(value);
  return {
    x: number(b.x),
    y: number(b.y),
    width: number(b.width, 0),
    height: number(b.height, 0),
  };
}
function page(value: unknown): PageContext {
  const p = object(value),
    viewport = object(p.viewport);
  const key = text(p.key, 64);
  if (!/^[a-f0-9]{64}$/.test(key)) return invalid();
  return {
    key,
    title: text(p.title, 500),
    url: safeUrl(text(p.url, 20000)),
    viewport: {
      width: number(viewport.width, 0),
      height: number(viewport.height, 0),
      devicePixelRatio: number(viewport.devicePixelRatio, 0, 100),
      scrollX: number(viewport.scrollX),
      scrollY: number(viewport.scrollY),
    },
  };
}
function screenshot(value: unknown): Screenshot {
  const s = object(value);
  if (s.status === 'unavailable')
    return { status: 'unavailable', reason: text(s.reason, 5000) };
  if (s.status !== 'available') return invalid();
  const path = text(s.path, 250);
  if (!/^screenshots\/[\w-]+\.png$/.test(path)) return invalid();
  const dataUrl = text(s.dataUrl, 16000000);
  if (!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(dataUrl))
    return invalid();
  return {
    status: 'available',
    path,
    dataUrl,
    capturedAt: date(s.capturedAt),
    width: number(s.width, 1, 1600),
    height: number(s.height, 1, 50000),
    redactedRegions: number(s.redactedRegions, 0),
    note: text(s.note, 5000),
  };
}
function target(value: unknown): Target {
  const t = object(value),
    locator = object(t.locator),
    rawAttributes = object(locator.attributes);
  const attributes: Record<string, string> = {};
  for (const key of ['data-testid', 'data-test', 'data-cy'])
    if (rawAttributes[key] !== undefined)
      attributes[key] = text(rawAttributes[key], 180);
  const result: Target = {
    locator: {
      tag: text(locator.tag, 100),
      id: nullable(locator.id, 180),
      attributes,
      role: nullable(locator.role, 500),
      accessibleName: nullable(locator.accessibleName, 240),
      cssSelector: text(locator.cssSelector, 5000),
      nearbyHeading: nullable(locator.nearbyHeading, 180),
      text: text(locator.text, 1600),
    },
    htmlExcerpt: text(t.htmlExcerpt, 6000),
    htmlTruncated: bool(t.htmlTruncated),
    textTruncated: bool(t.textTruncated),
    bounds: bounds(t.bounds),
  };
  if (t.range !== undefined) {
    const range = object(t.range);
    result.range = {
      exact: text(range.exact, 1600),
      prefix: text(range.prefix, 1600),
      suffix: text(range.suffix, 1600),
      start: number(range.start, 0),
      end: number(range.end, 0),
    };
  }
  return result;
}
function annotation(value: unknown): Annotation {
  const a = object(value),
    attachment = object(a.attachment),
    input = object(a.input);
  if (
    !['element', 'multiple', 'text-range', 'page', 'region'].includes(
      String(a.selectionKind),
    ) ||
    !['open', 'addressed'].includes(String(a.resolution)) ||
    !['attached', 'missing', 'ambiguous'].includes(String(attachment.state)) ||
    !['typed', 'voice'].includes(String(input.method))
  )
    return invalid();
  const targets = list(a.targets, 12).map(target);
  if (!targets.length && !['page', 'region'].includes(String(a.selectionKind)))
    return invalid();
  const originalComment = text(a.originalComment, 20000);
  if (!originalComment.trim()) return invalid();
  let result: Annotation = {
    id: id(a.id),
    originalComment,
    createdAt: date(a.createdAt),
    updatedAt: date(a.updatedAt),
    page: page(a.page),
    selectionKind: a.selectionKind as Annotation['selectionKind'],
    ...(a.selectionKind === 'region' ? { region: bounds(a.region) } : {}),
    targets,
    screenshot: screenshot(a.screenshot),
    status:
      attachment.state === 'attached'
        ? (a.resolution as Annotation['resolution'])
        : 'needs-reattachment',
    resolution: a.resolution as Annotation['resolution'],
    attachment: {
      state: attachment.state as Annotation['attachment']['state'],
      reason: text(attachment.reason, 5000),
      checkedAt: date(attachment.checkedAt),
    },
    input: {
      method: input.method as 'typed' | 'voice',
      ...(input.provider !== undefined
        ? { provider: text(input.provider, 100) }
        : {}),
      ...(input.transcript !== undefined
        ? { transcript: text(input.transcript, 40000) }
        : {}),
    },
    reattachments: list(a.reattachments, 100).map((value) => {
      const r = object(value);
      return {
        at: date(r.at),
        page: page(r.page),
        targets: list(r.targets, 12).map(target),
        screenshot: screenshot(r.screenshot),
      };
    }),
  };
  if (a.priority !== undefined)
    result = applyReviewPatch(result, {
      priority: a.priority as 'now' | 'later',
    });
  if (a.sessionId !== undefined) result.sessionId = id(a.sessionId);
  if (a.review !== undefined) {
    const review = object(a.review);
    result = applyReviewPatch(result, {
      review: {
        outcome: review.outcome as 'accepted' | 'needs-another-pass',
        checkedAt: date(review.checkedAt),
        followUp: text(review.followUp, 5000),
      },
    });
  }
  result.updatedAt = date(a.updatedAt);
  return result;
}

export function validateLibrary(value: unknown): ReviewLibrary {
  const source = object(value);
  const sessions: ReviewSession[] = list(source.sessions, 500).map((value) => {
    const s = object(value);
    const session = {
      id: id(s.id),
      name: text(s.name, 100),
      instructions: text(s.instructions, 5000),
      createdAt: date(s.createdAt),
      updatedAt: date(s.updatedAt),
    };
    validateSession(session);
    return session;
  });
  const annotations = list(source.annotations, 2000).map(annotation);
  const ids = new Set(annotations.map((note) => note.id));
  const sessionIds = new Set(sessions.map((session) => session.id));
  if (
    ids.size !== annotations.length ||
    sessionIds.size !== sessions.length ||
    annotations.some(
      (note) => note.sessionId && !sessionIds.has(note.sessionId),
    )
  )
    return invalid();
  return { annotations, sessions };
}

export function createBackup(library: ReviewLibrary): string {
  const result = JSON.stringify({
    format: 'pointnote-backup',
    schemaVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    ...library,
  });
  if (
    new TextEncoder().encode(result).length > BACKUP_LIMIT ||
    library.annotations.length > 2000 ||
    library.sessions.length > 500
  )
    throw new Error(
      'This library exceeds the backup limit (64 MB, 2,000 notes, 500 sessions). Export individual handoffs before reducing it.',
    );
  return result;
}
export function parseBackup(raw: string): ReviewLibrary {
  if (new TextEncoder().encode(raw).length > BACKUP_LIMIT)
    throw new Error('Backups must be smaller than 64 MB.');
  let value: Record<string, unknown>;
  try {
    value = object(JSON.parse(raw));
  } catch {
    return invalid();
  }
  if (value.format !== 'pointnote-backup' || value.schemaVersion !== '1.0.0')
    return invalid();
  const library = validateLibrary(value);
  // Parse imported excerpts in an inert template, then apply the capture redaction rules.
  // Original comments and transcripts remain authoritative and are never rewritten.
  for (const note of library.annotations) {
    for (const context of [note, ...note.reattachments]) {
      for (const target of context.targets) {
        const template = document.createElement('template');
        template.innerHTML = target.htmlExcerpt;
        const wrapper = document.createElement('div');
        wrapper.append(template.content);
        const sanitized = sanitizedClone(wrapper).innerHTML;
        target.htmlExcerpt = sanitized.slice(0, 6000);
        target.htmlTruncated ||= sanitized.length > 6000;
      }
    }
  }
  return library;
}
