import { browserRecognition, languagePackMessage } from './speech-provider';

const enable = document.querySelector<HTMLButtonElement>('#enable')!;
const done = document.querySelector<HTMLButtonElement>('#done')!;
const language = document.querySelector<HTMLInputElement>('#language')!;
const install = document.querySelector<HTMLButtonElement>('#install')!;
const status = (text: string) => {
  document.querySelector('#status')!.textContent = text;
};
async function save(patch: object) {
  const { preferences = {} } = await chrome.storage.local.get('preferences');
  await chrome.storage.local.set({
    preferences: { ...(preferences as object), ...patch },
  });
}
void chrome.storage.local.get('preferences').then(({ preferences }) => {
  language.value = (preferences as { language?: string })?.language || 'en-US';
});
enable.onclick = async () => {
  enable.disabled = true;
  status('Choose Allow in your browser’s microphone prompt.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission belongs to the extension. Setup never leaves a live mic open.
    stream.getTracks().forEach((track) => track.stop());
    await save({ voiceReady: true, voiceOnboardingSeen: true });
    status(
      'Microphone ready. Pointnote will remember this setup across pages.',
    );
    enable.textContent = 'Microphone enabled';
    done.hidden = false;
  } catch (error) {
    enable.disabled = false;
    status(
      error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone access was not allowed. You can retry here, or change Pointnote’s microphone permission in browser settings.'
        : String(error),
    );
  }
};
install.onclick = async () => {
  const Constructor = browserRecognition();
  if (!Constructor?.install || !Constructor.available) {
    status(
      'This browser does not support on-device speech packs. You can choose Browser service in Pointnote Settings.',
    );
    return;
  }
  install.disabled = true;
  const lang = language.value.trim() || 'en-US';
  status(`Installing the browser’s ${lang} speech pack…`);
  try {
    const ok = await Constructor.install({
      langs: [lang],
      processLocally: true,
    });
    const availability = await Constructor.available({
      langs: [lang],
      processLocally: true,
    });
    if (ok && availability === 'available') {
      await save({ language: lang });
      status(`${lang} speech pack ready. You can return to your page.`);
    } else status(languagePackMessage(lang, availability));
  } catch (error) {
    status(String(error));
  } finally {
    install.disabled = false;
  }
};
done.onclick = async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) await chrome.tabs.remove(tab.id);
};
