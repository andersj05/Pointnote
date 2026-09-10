export interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
export interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
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
  ): Promise<void>;
  stop(): void;
  abort(): void;
}
function browserRecognition(): RecognitionConstructor | undefined {
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
  constructor(
    private local: boolean,
    private language = 'en-US',
    private factory = browserRecognition,
  ) {
    this.id = local ? 'web-speech-on-device' : 'web-speech-browser-service';
  }
  async start(
    onTranscript: (text: string) => void,
    onEnd: () => void,
    onError: (message: string) => void,
  ) {
    this.released = false;
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
      const availability = await Constructor.available({
        langs: [this.language],
        processLocally: true,
      });
      if (this.released) {
        onEnd();
        return;
      }
      if (availability !== 'available')
        throw new Error(
          'On-device language pack is ' +
            availability +
            '. Use Install language pack, or type your feedback.',
        );
    } else if ('processLocally' in recognition)
      recognition.processLocally = false;
    recognition.onresult = (event) =>
      onTranscript(
        Array.from(event.results)
          .map((r) => r[0].transcript)
          .join(' ')
          .trim(),
      );
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed':
          'Microphone access was denied. Allow it for this page in browser site settings, then try again.',
        'audio-capture': 'No microphone is available.',
        network: 'The browser speech service is unavailable or offline.',
        'no-speech': 'No speech detected. Hold the button and try again.',
        'language-not-supported':
          'This language is not supported. Install its on-device pack or choose another language.',
      };
      onError(
        messages[event.error] || 'Speech recognition stopped: ' + event.error,
      );
    };
    recognition.onend = onEnd;
    if (!this.released) recognition.start();
    else onEnd();
  }
  stop() {
    this.released = true;
    try {
      this.recognition?.stop();
    } catch {
      /* May be awaiting the language pack check. */
    }
  }
  abort() {
    this.released = true;
    this.recognition?.abort();
  }
}
export function mountVoice(
  container: HTMLElement,
  options: {
    getDraft: () => string;
    setDraft: (value: string) => void;
    canStart: () => boolean;
    onState: () => void;
    notice: (text: string) => void;
  },
) {
  container.innerHTML = `<div class="voice-settings"><button class="secondary small" type="button" data-voice-talk aria-label="Hold to talk">◉ Hold to talk</button><details><summary>Voice &amp; privacy</summary><select aria-label="Transcription provider"><option value="local">On-device · audio stays on this computer</option><option value="browser">Browser service · audio may leave this computer</option></select><label class="privacy">Language <input aria-label="Speech language" value="en-US" size="8"></label><p class="voice-disclosure">On-device is the default. A browser language pack may need downloading. Pointnote stores no audio and uses no API keys.</p><label class="privacy voice-consent" hidden><input type="checkbox">I allow the browser speech service to process my audio. It may send audio to its provider.</label><button class="quiet" type="button" data-voice-install>Install language pack</button></details></div>`;
  const talk = container.querySelector<HTMLButtonElement>('[data-voice-talk]')!;
  const select = container.querySelector<HTMLSelectElement>('select')!;
  const consent = container.querySelector<HTMLInputElement>(
    '.voice-consent input',
  )!;
  const language = container.querySelector<HTMLInputElement>(
    '[aria-label="Speech language"]',
  )!;
  const install = container.querySelector<HTMLButtonElement>(
    '[data-voice-install]',
  )!;
  let provider: TranscriptionProvider | undefined;
  let recording = false,
    transcript = '',
    providerId = '',
    base = '',
    previousTranscript = '';
  const finish = () => {
    recording = false;
    talk.classList.remove('recording');
    talk.textContent = '◉ Hold to talk';
    select.disabled = false;
    language.disabled = false;
    install.disabled = false;
    options.onState();
  };
  const start = () => {
    if (recording || !options.canStart()) return;
    if (select.value === 'browser' && !consent.checked) {
      options.notice(
        'Open Voice & privacy and allow browser audio processing before using that provider.',
      );
      return;
    }
    provider = new BrowserSpeechProvider(
      select.value === 'local',
      language.value.trim() || 'en-US',
    );
    providerId = provider.id;
    base = options.getDraft();
    previousTranscript = transcript;
    recording = true;
    talk.classList.add('recording');
    talk.textContent = '● Listening… release to finish';
    select.disabled = true;
    language.disabled = true;
    install.disabled = true;
    options.onState();
    options.notice(
      'Listening. Release to finish, then review and edit the transcript before saving.',
    );
    void provider
      .start(
        (text) => {
          transcript = [previousTranscript, text].filter(Boolean).join(' ');
          options.setDraft(base + (base && text ? '\n' : '') + text);
        },
        finish,
        (error) => options.notice(error),
      )
      .catch((error: unknown) => {
        options.notice(error instanceof Error ? error.message : String(error));
        finish();
      });
  };
  const stop = () => {
    if (recording) provider?.stop();
  };
  talk.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    talk.setPointerCapture(event.pointerId);
    start();
  });
  talk.addEventListener('pointerup', stop);
  talk.addEventListener('pointercancel', stop);
  talk.addEventListener('lostpointercapture', stop);
  talk.addEventListener('keydown', (event) => {
    if ([' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) start();
    }
  });
  talk.addEventListener('keyup', (event) => {
    if ([' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      stop();
    }
  });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  select.onchange = () => {
    container.querySelector<HTMLElement>('.voice-consent')!.hidden =
      select.value !== 'browser';
    consent.checked = false;
    install.hidden = select.value !== 'local';
    container.querySelector('.voice-disclosure')!.textContent =
      select.value === 'local'
        ? 'Audio stays on this computer. A language pack may need downloading. Pointnote stores no audio and uses no API keys.'
        : 'Your browser controls transcription. Audio may be sent to its speech provider. Pointnote has no account, server, or API key. Review the transcript before saving.';
  };
  install.onclick = () => {
    const Constructor = browserRecognition();
    if (!Constructor?.install) {
      options.notice(
        'On-device language pack installation is unavailable in this browser.',
      );
      return;
    }
    install.disabled = true;
    options.notice(
      'Downloading the on-device language pack through your browser…',
    );
    void Constructor.install({
      langs: [language.value.trim() || 'en-US'],
      processLocally: true,
    })
      .then((ok) =>
        options.notice(
          ok
            ? 'Language pack installed. Hold to talk when ready.'
            : 'The language pack could not be installed.',
        ),
      )
      .catch((error: unknown) => options.notice(String(error)))
      .finally(() => {
        install.disabled = false;
      });
  };
  return {
    get recording() {
      return recording;
    },
    input: () =>
      transcript
        ? { method: 'voice' as const, provider: providerId, transcript }
        : { method: 'typed' as const },
    reset: () => {
      provider?.abort();
      transcript = '';
      previousTranscript = '';
      finish();
    },
    stop,
  };
}
