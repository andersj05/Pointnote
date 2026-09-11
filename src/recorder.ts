import { BrowserSpeechProvider } from './speech-provider';
import type { Preferences } from './preferences';

let owner: chrome.runtime.Port | undefined;
let revokeBrowser: (() => void) | undefined;
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    message?.target === 'pointnote-recorder' &&
    message.type === 'REVOKE_BROWSER'
  )
    revokeBrowser?.();
});
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'pointnote-recorder' ||
    port.sender?.id !== chrome.runtime.id ||
    !port.sender.tab ||
    port.sender.frameId !== 0
  )
    return;
  let closed = false;
  let provider: BrowserSpeechProvider | undefined;
  let started = false;
  const send = (message: object) => {
    if (!closed)
      try {
        port.postMessage(message);
      } catch {
        close();
      }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    provider?.abort();
    if (owner === port) {
      owner = undefined;
      revokeBrowser = undefined;
    }
  };
  port.onDisconnect.addListener(close);
  port.onMessage.addListener((message) => {
    if (message.type === 'STOP') {
      if (!provider?.stop()) {
        send({ type: 'END' });
        close();
      }
      return;
    }
    if (message.type !== 'START' || started || closed) return;
    started = true;
    if (owner && owner !== port) {
      send({
        type: 'ERROR',
        error: 'Finish recording in the other Pointnote tab first.',
      });
      close();
      return;
    }
    owner = port;
    void (async () => {
      const response = await chrome.runtime.sendMessage({
        target: 'pointnote-voice',
        action: 'config',
      });
      if (closed) return;
      if (!response?.ok) throw new Error('Could not read voice settings.');
      const preferences = response.value as Preferences;
      if (!preferences.voiceReady)
        throw new Error(
          'Set up your microphone once in Pointnote Voice settings.',
        );
      if (preferences.provider === 'browser' && !preferences.browserConsent)
        throw new Error(
          'Allow browser audio processing in Voice settings before recording.',
        );
      provider = new BrowserSpeechProvider(
        preferences.provider === 'local',
        preferences.language,
      );
      revokeBrowser =
        preferences.provider === 'browser'
          ? () => {
              send({
                type: 'ERROR',
                error:
                  'Browser audio processing consent was revoked. Recording stopped.',
              });
              close();
            }
          : undefined;
      await provider.start(
        (text) => send({ type: 'TEXT', text }),
        () => {
          send({ type: 'END' });
          close();
        },
        (error) => {
          send({ type: 'ERROR', error });
          close();
        },
        () => send({ type: 'LISTENING' }),
        (speaking) => send({ type: 'SPEAKING', speaking }),
      );
    })().catch((error) => {
      send({
        type: 'ERROR',
        error: error instanceof Error ? error.message : String(error),
      });
      close();
    });
  });
});
