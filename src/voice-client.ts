import type { TranscriptionProvider } from './speech-provider';

const reloadMessage =
  'Pointnote needs to reload after an update. Open your browser’s Extensions page, click Reload on Pointnote, then refresh this page and try again. Your saved notes and settings will stay.';

async function requestVoice(action: 'setup' | 'prepare') {
  try {
    const result = await chrome.runtime.sendMessage({
      target: 'pointnote-voice',
      action,
    });
    // Rebuilding an unpacked extension can leave its old worker running while
    // newly opened pages receive the new content script. That worker does not
    // understand voice requests until the extension itself is reloaded.
    if (!result || /Unknown (?:voice )?request\.?$/i.test(result.error || ''))
      throw new Error(reloadMessage);
    if (!result.ok)
      throw new Error(
        result.error ||
          (action === 'setup'
            ? 'Could not open voice setup.'
            : 'Could not prepare the microphone.'),
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /Extension context invalidated|Receiving end does not exist|Could not establish connection/i.test(
        message,
      )
    )
      throw new Error(reloadMessage, { cause: error });
    throw error;
  }
}

export function openVoiceSetup() {
  return requestVoice('setup');
}
export class ExtensionSpeechProvider implements TranscriptionProvider {
  readonly id: string;
  private port?: chrome.runtime.Port;
  private released = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(local: boolean) {
    this.id = local ? 'web-speech-on-device' : 'web-speech-browser-service';
  }
  async start(
    onTranscript: (text: string) => void,
    onEnd: () => void,
    onError: (text: string) => void,
    onListening = () => {},
    onSpeaking: (speaking: boolean) => void = () => {},
  ) {
    await requestVoice('prepare');
    if (this.released) {
      onEnd();
      return;
    }
    const port = (this.port = chrome.runtime.connect({
      name: 'pointnote-recorder',
    }));
    const finish = () => {
      clearTimeout(this.timer);
      onSpeaking(false);
      this.port = undefined;
      port.disconnect();
    };
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      finish();
      onError('Voice recording disconnected. Your draft is safe; try again.');
    });
    port.onMessage.addListener((message) => {
      if (this.port !== port) return;
      if (message.type === 'LISTENING') {
        clearTimeout(this.timer);
        if (!this.released) onListening();
      } else if (
        message.type === 'SPEAKING' &&
        typeof message.speaking === 'boolean'
      ) {
        if (!this.released) onSpeaking(message.speaking);
      } else if (message.type === 'TEXT' && typeof message.text === 'string')
        onTranscript(message.text);
      else if (message.type === 'END') {
        finish();
        onEnd();
      } else if (message.type === 'ERROR') {
        finish();
        onError(message.error);
      }
    });
    this.timer = setTimeout(() => {
      this.abort();
      onError(
        'Voice setup is taking too long. Open Voice settings and try again.',
      );
    }, 35000);
    port.postMessage({ type: 'START' });
  }
  stop() {
    this.released = true;
    if (!this.port) return false;
    this.port.postMessage({ type: 'STOP' });
    return true;
  }
  abort() {
    this.released = true;
    clearTimeout(this.timer);
    const port = this.port;
    this.port = undefined;
    port?.disconnect();
  }
}
