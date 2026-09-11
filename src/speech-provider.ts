export interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
export interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onaudiostart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export interface RecognitionConstructor {
  new (): Recognizer;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<string>;
  install?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<boolean>;
}
export interface TranscriptionProvider {
  id: string;
  start(
    onTranscript: (text: string) => void,
    onEnd: () => void,
    onError: (message: string) => void,
    onListening?: () => void,
    onSpeaking?: (speaking: boolean) => void,
  ): Promise<void>;
  stop(): boolean;
  abort(): void;
}
export class MicrophoneSetupError extends Error {}
async function checkMicrophonePermission() {
  if (globalThis.isSecureContext === false)
    throw new MicrophoneSetupError(
      'Microphone access needs HTTPS or localhost. Open this page through a secure address, then try again.',
    );
  // Some browsers do not expose microphone permission through Permissions API.
  const permission = await navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .catch(() => undefined);
  if (permission && permission.state !== 'granted')
    throw new MicrophoneSetupError(
      permission.state === 'denied'
        ? 'Pointnote microphone access is blocked. Open voice setup to restore the browser permission.'
        : 'Complete Pointnote voice setup once and allow microphone access. Then use your voice shortcut on any page.',
    );
}
export function languagePackMessage(language: string, availability: string) {
  if (availability === 'downloadable')
    return `The browser's ${language} speech language pack is missing. Open Settings → Voice → Install language pack. A Windows language pack does not install this browser pack.`;
  if (availability === 'downloading')
    return `The browser's ${language} speech language pack is still downloading. Wait for it to finish, then try the mic again.`;
  return `An on-device speech language pack for ${language} is unavailable in this browser. In Settings → Voice, choose a supported language or explicitly allow Browser service.`;
}
export function browserRecognition(): RecognitionConstructor | undefined {
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition;
}
export class BrowserSpeechProvider implements TranscriptionProvider {
  readonly id: string;
  private recognition?: Recognizer;
  private released = false;
  private requested = false;
  private timer?: ReturnType<typeof setTimeout>;
  private end?: () => void;
  private speaking?: (speaking: boolean) => void;
  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private async waitForSetup<T>(task: Promise<T>, message: string): Promise<T> {
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          this.timer = setTimeout(() => reject(new Error(message)), 15000);
        }),
      ]);
    } finally {
      this.clearTimer();
    }
  }
  constructor(
    private local: boolean,
    private language = 'en-US',
    private factory = browserRecognition,
    private checkPermission = checkMicrophonePermission,
  ) {
    this.id = local ? 'web-speech-on-device' : 'web-speech-browser-service';
  }
  async start(
    onTranscript: (text: string) => void,
    onEnd: () => void,
    onError: (message: string) => void,
    onListening: () => void = () => {},
    onSpeaking: (speaking: boolean) => void = () => {},
  ) {
    this.released = false;
    this.requested = false;
    this.end = onEnd;
    this.speaking = onSpeaking;
    const Constructor = this.factory();
    if (!Constructor)
      throw new Error(
        'Speech recognition is unavailable in this browser. Typed feedback still works.',
      );
    const recognition = new Constructor();
    this.recognition = recognition;
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    if (this.local) {
      if (!('processLocally' in recognition) || !Constructor.available)
        throw new Error(
          'This browser does not support on-device recognition. You can type, or explicitly choose the browser speech service.',
        );
      recognition.processLocally = true;
      const availability = await this.waitForSetup(
        Constructor.available({
          langs: [this.language],
          processLocally: true,
        }),
        'The browser did not finish checking the speech language pack. Open Voice settings and try installing the pack again.',
      );
      if (this.released) {
        onEnd();
        return;
      }
      if (availability !== 'available')
        throw new Error(languagePackMessage(this.language, availability));
    } else if ('processLocally' in recognition)
      recognition.processLocally = false;
    await this.waitForSetup(
      this.checkPermission(),
      'The browser did not finish checking microphone access. Try Enable microphone again.',
    );
    if (this.released) {
      onEnd();
      return;
    }
    recognition.onaudiostart = () => {
      if (this.released) return;
      this.clearTimer();
      onListening();
    };
    recognition.onspeechstart = () => {
      if (this.released) return;
      this.clearTimer();
      onListening();
      onSpeaking(true);
    };
    recognition.onspeechend = recognition.onaudioend = () => onSpeaking(false);
    recognition.onresult = (event) => {
      if (!this.released) {
        this.clearTimer();
        onListening();
      }
      onTranscript(
        Array.from(event.results)
          .map((r) => r[0].transcript)
          .join(' ')
          .trim(),
      );
    };
    recognition.onerror = (event) => {
      this.clearTimer();
      onSpeaking(false);
      const messages: Record<string, string> = {
        'not-allowed':
          'Microphone access was denied for Pointnote. Open voice setup to check the browser permission, then try again.',
        'audio-capture': 'No microphone is available.',
        'service-not-allowed':
          'This browser or page blocks the selected speech provider. Check Voice settings and browser permissions.',
        network: 'The browser speech service is unavailable or offline.',
        'no-speech': 'No speech detected. Try recording again.',
        'language-not-supported':
          'This language is not supported. Install its on-device pack or choose another language.',
      };
      onError(
        messages[event.error] || 'Speech recognition stopped: ' + event.error,
      );
    };
    recognition.onend = () => {
      this.clearTimer();
      onSpeaking(false);
      this.requested = false;
      onEnd();
    };
    if (!this.released) {
      this.requested = true;
      this.timer = setTimeout(() => {
        onError(
          'The microphone did not start. Choose Enable microphone, check your input device in browser settings, then try again.',
        );
        this.abort();
      }, 15000);
      try {
        recognition.start();
      } catch (error) {
        recognition.onend = null;
        this.abort();
        throw error;
      }
    } else onEnd();
  }
  stop() {
    this.released = true;
    this.speaking?.(false);
    this.clearTimer();
    if (!this.requested) return false;
    // Keep accepting final results after release; stop() is asynchronous.
    this.timer = setTimeout(() => {
      if (this.recognition) this.recognition.onend = null;
      this.abort();
      this.end?.();
    }, 5000);
    try {
      this.recognition?.stop();
    } catch {
      /* May be awaiting the language pack check. */
      this.abort();
      return false;
    }
    return true;
  }
  abort() {
    this.released = true;
    this.speaking?.(false);
    this.requested = false;
    this.clearTimer();
    try {
      this.recognition?.abort();
    } catch {
      /* The browser may already have ended. */
    }
  }
}
