import type { TranscriptionProvider } from './speech-provider';

export async function openVoiceSetup() {
  const result = await chrome.runtime.sendMessage({
    target: 'pointnote-voice',
    action: 'setup',
  });
  if (!result?.ok)
    throw new Error(result?.error || 'Could not open voice setup.');
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
  ) {
    const result = await chrome.runtime.sendMessage({
      target: 'pointnote-voice',
      action: 'prepare',
    });
    if (!result?.ok)
      throw new Error(result?.error || 'Could not prepare the microphone.');
    if (this.released) {
      onEnd();
      return;
    }
    const port = (this.port = chrome.runtime.connect({
      name: 'pointnote-recorder',
    }));
    const finish = () => {
      clearTimeout(this.timer);
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
