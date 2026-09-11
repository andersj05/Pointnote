import { readPreferences } from './preferences';

let creating: Promise<void> | undefined;
async function ensureRecorder() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL('recorder.html')],
    });
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url: 'recorder.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification:
          'Transcribe user-initiated voice notes using Pointnote microphone permission across reviewed pages.',
      });
  })();
  try {
    await creating;
  } finally {
    creating = undefined;
  }
}
let opening: Promise<void> | undefined;
async function openSetup() {
  if (opening) return opening;
  opening = (async () => {
    const url = chrome.runtime.getURL('voice-setup.html');
    const tabs = await chrome.tabs.query({ url });
    if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true });
    else await chrome.tabs.create({ url });
  })();
  try {
    await opening;
  } finally {
    opening = undefined;
  }
}
export function mountVoiceBackground() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      message?.target !== 'pointnote-voice' ||
      sender.id !== chrome.runtime.id
    )
      return;
    const fromPage = Boolean(sender.tab && sender.frameId === 0);
    const fromRecorder = sender.url === chrome.runtime.getURL('recorder.html');
    if (!fromPage && !fromRecorder) return;
    const run = async () => {
      if (message.action === 'setup' && fromPage) return openSetup();
      if (message.action === 'prepare' && fromPage) return ensureRecorder();
      if (message.action === 'config' && fromRecorder)
        return (await readPreferences()).preferences;
      throw new Error('Unknown voice request.');
    };
    void run().then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: String(error) }),
    );
    return true;
  });
}
