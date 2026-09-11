import type { Annotation } from './types';
let database: Promise<IDBDatabase> | undefined;
export function db(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('pointnote', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('annotations', {
        keyPath: 'id',
      });
      store.createIndex('pageKey', 'page.key');
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
    tx.objectStore('annotations').put(annotation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save aborted'));
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
