import { icon } from './icons';
import type { Preferences } from './preferences';

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
type RecordingMode = 'hold' | 'middle' | 'hands-free';
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
        'no-speech': 'No speech detected. Try recording again.',
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
    settings?: HTMLElement;
    preferences?: Preferences;
    onPreferences?: (value: Pick<Preferences, 'provider' | 'language'>) => void;
  },
) {
  container.innerHTML = `<div class="voice-controls"><button class="talk" type="button" data-voice-talk aria-label="Hold to talk" title="Hold the button or hold Space while focused">${icon('mic')}<span class="talk-label">Hold to talk</span><span class="talk-key">SPACE</span></button><button class="hands-free" type="button" data-voice-toggle aria-label="Start hands-free recording" title="Click to record hands-free" aria-pressed="false">${icon('record')}</button></div>`;
  const settings = options.settings || document.createElement('div');
  if (!options.settings) container.append(settings);
  settings.innerHTML = `<label class="setting-field">Transcription<select aria-label="Transcription provider"><option value="local">On-device</option><option value="browser">Browser service</option></select></label><p class="voice-disclosure setting-description"></p><label class="setting-field">Language<input aria-label="Speech language" value="en-US" maxlength="35" spellcheck="false" placeholder="en-US"></label><label class="privacy voice-consent" hidden><input type="checkbox">I allow the browser speech service to process my audio. It may send audio to its provider.</label><button class="secondary" type="button" data-voice-install>Install language pack</button>`;
  const talk = container.querySelector<HTMLButtonElement>('[data-voice-talk]')!;
  const toggle = container.querySelector<HTMLButtonElement>(
    '[data-voice-toggle]',
  )!;
  const talkLabel = container.querySelector<HTMLElement>('.talk-label')!;
  const select = settings.querySelector<HTMLSelectElement>('select')!;
  const consent = settings.querySelector<HTMLInputElement>(
    '.voice-consent input',
  )!;
  const language = settings.querySelector<HTMLInputElement>(
    '[aria-label="Speech language"]',
  )!;
  const install = settings.querySelector<HTMLButtonElement>(
    '[data-voice-install]',
  )!;
  let provider: TranscriptionProvider | undefined;
  let mode: RecordingMode = 'hold';
  let session = 0,
    installing = false;
  let recording = false,
    transcript = '',
    providerId = '',
    base = '',
    previousTranscript = '';
  const finish = () => {
    recording = false;
    talk.classList.remove('recording');
    talkLabel.textContent = 'Hold to talk';
    talk.setAttribute('aria-label', 'Hold to talk');
    toggle.classList.remove('recording');
    toggle.innerHTML = icon('record');
    toggle.setAttribute('aria-label', 'Start hands-free recording');
    toggle.setAttribute('title', 'Click to record hands-free');
    toggle.setAttribute('aria-pressed', 'false');
    consent.disabled = false;
    select.disabled = false;
    language.disabled = false;
    install.disabled = installing;
    options.onState();
  };
  const start = (requestedMode: RecordingMode = 'hold') => {
    if (recording || !options.canStart()) return;
    if (select.value === 'browser' && !consent.checked) {
      options.notice(
        'Open Settings and allow browser audio processing before using that provider.',
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
    const currentSession = ++session;
    mode = requestedMode;
    recording = true;
    talk.classList.add('recording');
    talkLabel.textContent =
      mode === 'hands-free'
        ? 'Listening…'
        : mode === 'middle'
          ? 'Release middle button'
          : 'Release to finish';
    toggle.classList.add('recording');
    toggle.innerHTML = icon('stop');
    toggle.setAttribute('aria-label', 'Stop recording');
    toggle.setAttribute('title', 'Stop recording');
    toggle.setAttribute('aria-pressed', 'true');
    consent.disabled = true;
    select.disabled = true;
    language.disabled = true;
    install.disabled = true;
    options.onState();
    options.notice(
      mode === 'hands-free'
        ? 'Listening. Click Stop when you’re done.'
        : mode === 'middle'
          ? 'Listening. Release the middle mouse button to finish.'
          : 'Listening. Release to finish.',
    );
    void provider
      .start(
        (text) => {
          if (currentSession !== session) return;
          transcript = [previousTranscript, text].filter(Boolean).join(' ');
          options.setDraft(base + (base && text ? '\n' : '') + text);
        },
        () => {
          if (currentSession !== session) return;
          finish();
          options.notice('Recording finished. Review your note before saving.');
        },
        (error) => {
          if (currentSession !== session) return;
          session++;
          provider?.abort();
          finish();
          options.notice(error);
        },
      )
      .catch((error: unknown) => {
        if (currentSession !== session) return;
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
  const release = (source: RecordingMode = 'hold') => {
    if (mode === source) stop();
  };
  talk.addEventListener('pointerup', () => release());
  talk.addEventListener('pointercancel', () => release());
  talk.addEventListener('lostpointercapture', () => release());
  talk.addEventListener('keydown', (event) => {
    if ([' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) start();
    }
  });
  talk.addEventListener('keyup', (event) => {
    if ([' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      release();
    }
  });
  talk.addEventListener('blur', () => release());
  toggle.onclick = () => {
    if (recording) stop();
    else start('hands-free');
  };
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  const renderSettings = () => {
    settings.querySelector<HTMLElement>('.voice-consent')!.hidden =
      select.value !== 'browser';
    consent.checked = false;
    install.hidden = select.value !== 'local';
    settings.querySelector('.voice-disclosure')!.textContent =
      select.value === 'local'
        ? 'Audio stays on this computer. Requires browser support and a language pack.'
        : 'Audio may be sent to your browser’s speech provider. Your permission is required below.';
  };
  select.value = options.preferences?.provider || 'local';
  language.value = options.preferences?.language || 'en-US';
  renderSettings();
  const persist = () =>
    options.onPreferences?.({
      provider: select.value as Preferences['provider'],
      language: language.value.trim() || 'en-US',
    });
  select.onchange = () => {
    renderSettings();
    persist();
  };
  language.onchange = persist;
  install.onclick = () => {
    const Constructor = browserRecognition();
    if (!Constructor?.install) {
      options.notice(
        'On-device language pack installation is unavailable in this browser.',
      );
      return;
    }
    installing = true;
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
        installing = false;
        install.disabled = recording;
      });
  };
  return {
    get recording() {
      return recording;
    },
    get middleRecording() {
      return recording && mode === 'middle';
    },
    input: () =>
      transcript
        ? { method: 'voice' as const, provider: providerId, transcript }
        : { method: 'typed' as const },
    reset: () => {
      session++;
      provider?.abort();
      transcript = '';
      previousTranscript = '';
      finish();
    },
    start,
    release,
    stop,
  };
}
