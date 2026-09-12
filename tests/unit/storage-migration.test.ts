import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { db, listAnnotations, readLibrary } from '../../src/storage';

it('upgrades an existing v1 database without changing its saved annotations', async () => {
  const original = {
    id: 'legacy-note',
    originalComment: '  Keep these original words.  ',
    page: { key: 'legacy-page' },
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pointnote', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('annotations', {
        keyPath: 'id',
      });
      store.createIndex('pageKey', 'page.key');
      store.put(original);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  legacy.close();
  expect(await listAnnotations('legacy-page')).toEqual([original]);
  expect(await readLibrary()).toEqual({
    annotations: [original],
    sessions: [],
  });
  expect((await db()).version).toBe(2);
  (await db()).close();
});
