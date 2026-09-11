import {
  listAnnotations,
  putAnnotation,
  deleteAnnotation,
  deletePageAnnotations,
  readLibrary,
  putSession,
  patchReview,
  patchAttachment,
  restoreLibrary,
} from './storage';
import { BACKUP_LIMIT, validateLibrary } from './backup';
import type { Request, Response } from './types';
import { mountVoiceBackground } from './voice-background';
mountVoiceBackground();
async function activate(tab: chrome.tabs.Tab) {
  if (!tab.id) return;
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
    }
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({
      tabId: tab.id,
      title:
        'Pointnote cannot review this browser page. Open an HTML page on localhost or a website.',
    });
  }
}
chrome.action.onClicked.addListener((tab) => {
  void activate(tab);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`tab:${tabId}`);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  void chrome.storage.session.get(`tab:${tabId}`).then(async (value) => {
    if (!value[`tab:${tabId}`]) return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
      } catch {
        /* User must invoke again on a new origin. */
      }
    }
  });
});
let writeQueue: Promise<unknown> = Promise.resolve();
let captureQueue: Promise<unknown> = Promise.resolve();
let lastCapture = 0;
chrome.runtime.onMessage.addListener(
  (message: Request, sender, respond: (value: Response<unknown>) => void) => {
    if ('target' in message) return;
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0)
      return;
    const tab = sender.tab;
    const handle = async () => {
      switch (message.type) {
        case 'LIST':
          return listAnnotations(message.pageKey);
        case 'LIBRARY':
          return readLibrary();
        case 'RESTORE':
          if (JSON.stringify(message.library).length > BACKUP_LIMIT)
            throw new Error('Backup is too large.');
          return restoreLibrary(validateLibrary(message.library));
        case 'PUT_SESSION':
          await putSession(message.session);
          return null;
        case 'PATCH_REVIEW':
          return patchReview(message.id, message.patch);
        case 'PATCH_ATTACHMENT':
          if (
            !message.attachment ||
            !['attached', 'missing', 'ambiguous'].includes(
              message.attachment.state,
            ) ||
            typeof message.attachment.reason !== 'string' ||
            message.attachment.reason.length > 5000
          )
            throw new Error('Attachment update is invalid.');
          return patchAttachment(message.id, message.attachment);
        case 'PUT': {
          const a = message.annotation;
          if (
            !a ||
            !/^[\w-]{36}$/.test(a.id) ||
            !a.originalComment.trim() ||
            a.originalComment.length > 20000 ||
            !a.targets.length ||
            a.targets.length > 12 ||
            JSON.stringify(a).length > 16000000
          )
            throw new Error('Annotation is invalid or too large.');
          await putAnnotation(a);
          return null;
        }
        case 'DELETE':
          await deleteAnnotation(message.id, message.pageKey);
          return null;
        case 'DELETE_PAGE':
          if (typeof message.pageKey !== 'string' || !message.pageKey)
            throw new Error('Page key is required.');
          await deletePageAnnotations(message.pageKey);
          return null;
        case 'ENABLED':
          await chrome.storage.session.set({
            [`tab:${tab.id}`]: message.enabled,
          });
          return null;
        case 'CAPTURE': {
          const delay = Math.max(0, 650 - (Date.now() - lastCapture));
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          const [active] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          if (active?.id !== tab.id)
            throw new Error('The reviewed tab is not active.');
          lastCapture = Date.now();
          const data = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png',
          });
          const [after] = await chrome.tabs.query({
            active: true,
            windowId: tab.windowId,
          });
          if (after?.id !== tab.id || after.url !== active.url)
            throw new Error('The active page changed during capture.');
          return data;
        }
        default:
          throw new Error('Unknown request.');
      }
    };
    const task =
      message.type === 'PUT' ||
      message.type === 'DELETE' ||
      message.type === 'DELETE_PAGE' ||
      message.type === 'PUT_SESSION' ||
      message.type === 'PATCH_REVIEW' ||
      message.type === 'PATCH_ATTACHMENT' ||
      message.type === 'RESTORE'
        ? (writeQueue = writeQueue.then(handle, handle))
        : message.type === 'CAPTURE'
          ? (captureQueue = captureQueue.then(handle, handle))
          : handle();
    void task.then(
      (value) => respond({ ok: true, value }),
      (error: unknown) =>
        respond({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return true;
  },
);
