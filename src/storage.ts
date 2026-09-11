import type {
  Annotation,
  ReviewLibrary,
  ReviewPatch,
  ReviewSession,
} from './types';
import { applyReviewPatch, validateSession } from './review';
let database: Promise<IDBDatabase> | undefined;
export function db(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('pointnote', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('annotations')) {
        const store = request.result.createObjectStore('annotations', {
          keyPath: 'id',
        });
        store.createIndex('pageKey', 'page.key');
      }
      if (!request.result.objectStoreNames.contains('sessions'))
        request.result.createObjectStore('sessions', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
export async function listAnnotations(pageKey: string): Promise<Annotation[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction('annotations')
      .objectStore('annotations')
      .index('pageKey')
      .getAll(pageKey);
    request.onsuccess = () =>
      resolve(
        (request.result as Annotation[]).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function putAnnotation(annotation: Annotation): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('annotations', 'readwrite');
    const store = tx.objectStore('annotations');
    const current = store.get(annotation.id);
    current.onsuccess = () => {
      const previous = current.result as Annotation | undefined;
      // Capture/reattachment writes cannot undo review decisions made in another tab.
      const next = previous
        ? {
            ...annotation,
            originalComment: previous.originalComment,
            priority: previous.priority,
            sessionId: previous.sessionId,
            review: previous.review,
            resolution: previous.resolution,
            status:
              annotation.attachment.state === 'attached'
                ? previous.resolution
                : 'needs-reattachment',
          }
        : annotation;
      store.put(next);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save aborted'));
  });
}

export async function readLibrary(): Promise<ReviewLibrary> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['annotations', 'sessions']);
    const annotations = tx.objectStore('annotations').getAll();
    const sessions = tx.objectStore('sessions').getAll();
    tx.oncomplete = () =>
      resolve({
        annotations: (annotations.result as Annotation[]).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
        sessions: (sessions.result as ReviewSession[]).sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Library read aborted.'));
  });
}

export async function putSession(session: ReviewSession): Promise<void> {
  validateSession(session);
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Session save aborted.'));
  });
}

async function updateAnnotation(
  id: string,
  update: (note: Annotation) => Annotation,
): Promise<Annotation> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['annotations', 'sessions'], 'readwrite');
    const store = tx.objectStore('annotations');
    const request = store.get(id);
    let result: Annotation;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        if (!request.result)
          throw new Error('This note was deleted. Refresh the review.');
        result = update(request.result as Annotation);
        if (result.sessionId) {
          const session = tx.objectStore('sessions').get(result.sessionId);
          session.onsuccess = () => {
            if (!session.result) {
              failure = new Error('That session no longer exists.');
              tx.abort();
            } else store.put(result);
          };
        } else store.put(result);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () =>
      reject(failure || tx.error || new Error('Review update aborted.'));
  });
}

export function patchReview(
  id: string,
  patch: ReviewPatch,
): Promise<Annotation> {
  return updateAnnotation(id, (note) => applyReviewPatch(note, patch));
}

export function patchAttachment(
  id: string,
  attachment: Annotation['attachment'],
): Promise<Annotation> {
  return updateAnnotation(id, (note) => ({
    ...note,
    attachment,
    status:
      attachment.state === 'attached' ? note.resolution : 'needs-reattachment',
    updatedAt: new Date().toISOString(),
  }));
}

export async function restoreLibrary(
  library: ReviewLibrary,
): Promise<{ added: number; skipped: number }> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['annotations', 'sessions'], 'readwrite');
    let added = 0,
      skipped = 0;
    for (const session of library.sessions) {
      const store = tx.objectStore('sessions');
      const current = store.get(session.id);
      current.onsuccess = () => {
        if (!current.result) store.add(session);
      };
    }
    for (const note of library.annotations) {
      const store = tx.objectStore('annotations');
      const current = store.get(note.id);
      current.onsuccess = () => {
        if (current.result) skipped++;
        else {
          store.add(note);
          added++;
        }
      };
    }
    tx.oncomplete = () => resolve({ added, skipped });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error('Import aborted. Nothing was restored.'));
  });
}
export async function deleteAnnotation(
  id: string,
  pageKey: string,
): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('annotations', 'readwrite');
    const store = tx.objectStore('annotations');
    const request = store.get(id);
    request.onsuccess = () => {
      if ((request.result as Annotation | undefined)?.page.key === pageKey)
        store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function deletePageAnnotations(pageKey: string): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('annotations', 'readwrite');
    const request = tx
      .objectStore('annotations')
      .index('pageKey')
      .openCursor(pageKey);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Page deletion aborted'));
  });
}
