export type Status = 'open' | 'addressed' | 'needs-reattachment';
export interface ReviewSession {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}
export interface ReviewDecision {
  outcome: 'accepted' | 'needs-another-pass';
  checkedAt: string;
  followUp: string;
}
export interface ReviewPatch {
  priority?: 'now' | 'later';
  sessionId?: string | null;
  resolution?: 'open' | 'addressed';
  review?: ReviewDecision;
}
export interface ReviewLibrary {
  annotations: Annotation[];
  sessions: ReviewSession[];
}
export interface HandoffContext {
  name: string;
  instructions: string;
}
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Locator {
  tag: string;
  id: string | null;
  attributes: Record<string, string>;
  role: string | null;
  accessibleName: string | null;
  cssSelector: string;
  nearbyHeading: string | null;
  text: string;
}
export interface Target {
  locator: Locator;
  htmlExcerpt: string;
  htmlTruncated: boolean;
  textTruncated: boolean;
  bounds: Bounds;
  range?: {
    exact: string;
    prefix: string;
    suffix: string;
    start: number;
    end: number;
  };
}
export interface PageContext {
  key: string;
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
    scrollX: number;
    scrollY: number;
  };
}
export type Screenshot =
  | {
      status: 'available';
      path: string;
      dataUrl?: string;
      capturedAt: string;
      width: number;
      height: number;
      redactedRegions: number;
      note: string;
    }
  | { status: 'unavailable'; reason: string };
export interface Annotation {
  id: string;
  originalComment: string;
  createdAt: string;
  updatedAt: string;
  page: PageContext;
  selectionKind: 'element' | 'multiple' | 'text-range' | 'page' | 'region';
  region?: Bounds;
  targets: Target[];
  screenshot: Screenshot;
  status: Status;
  resolution: 'open' | 'addressed';
  priority?: 'now' | 'later';
  sessionId?: string;
  review?: ReviewDecision;
  attachment: {
    state: 'attached' | 'missing' | 'ambiguous';
    reason: string;
    checkedAt: string;
  };
  input: { method: 'typed' | 'voice'; provider?: string; transcript?: string };
  reattachments: {
    at: string;
    targets: Target[];
    screenshot: Screenshot;
    page: PageContext;
  }[];
}
export type Request =
  | { type: 'LIST'; pageKey: string }
  | { type: 'LIBRARY' }
  | { type: 'PUT_SESSION'; session: ReviewSession }
  | { type: 'PATCH_REVIEW'; id: string; patch: ReviewPatch }
  | {
      type: 'PATCH_ATTACHMENT';
      id: string;
      attachment: Annotation['attachment'];
    }
  | { type: 'RESTORE'; library: ReviewLibrary }
  | { type: 'PUT'; annotation: Annotation }
  | { type: 'DELETE'; id: string; pageKey: string }
  | { type: 'DELETE_PAGE'; pageKey: string }
  | { type: 'CAPTURE' }
  | { type: 'ENABLED'; enabled: boolean };
export type Response<T> = { ok: true; value: T } | { ok: false; error: string };
