import { icon } from './icons';
import type { Preferences } from './preferences';
import { voiceWave } from './voice-wave';

import {
  MicrophoneSetupError,
  type TranscriptionProvider,
} from './speech-provider';
export {
  BrowserSpeechProvider,
  MicrophoneSetupError,
  type Recognizer,
} from './speech-provider';
import { ExtensionSpeechProvider, openVoiceSetup } from './voice-client';
type RecordingMode = 'hold' | 'middle' | 'hands-free';
export type VoicePhase = 'idle' | 'starting' | 'listening' | 'finishing';
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
    onPreferences?: (value: Partial<Preferences>) => void;
    createProvider?: (
      local: boolean,
      language: string,
    ) => TranscriptionProvider;
    shortcutLabel?: () => string;
  },
) {
  container.innerHTML = `<div class="voice-controls"><button class="talk" type="button" data-voice-talk aria-label="Hold to talk" title="Hold middle mouse anywhere, hold this button, or hold Space while focused" aria-describedby="voice-hint" aria-pressed="false">${icon('mic')}<span class="talk-label">Hold to talk</span><span class="talk-key">SPACE</span></button><button class="hands-free" type="button" data-voice-toggle aria-label="Start hands-free recording" title="Click to record hands-free" aria-pressed="false">${icon('record')}</button></div><p class="voice-hint" id="voice-hint">Select a target, then hold middle mouse to talk.</p>`;
  const settings = options.settings || document.createElement('div');
  const activity = document.createElement('div');
  activity.className = 'voice-activity';
  activity.hidden = true;
  activity.innerHTML = `<div class="voice-activity-copy"><span class="voice-activity-label">Voice note</span><strong class="voice-activity-state" aria-live="polite"></strong></div>${voiceWave()}`;
  container.prepend(activity);
  const enableMicrophone = document.createElement('button');
  enableMicrophone.type = 'button';
  enableMicrophone.className = 'secondary microphone-setup';
  enableMicrophone.textContent = 'Enable microphone';
  enableMicrophone.hidden = true;
  container.append(enableMicrophone);
  if (!options.settings) container.append(settings);
  settings.innerHTML = `<label class="setting-field">Transcription<select aria-label="Transcription provider"><option value="local">On-device</option><option value="browser">Browser service</option></select></label><p class="voice-disclosure setting-description"></p><label class="setting-field">Language<input aria-label="Speech language" value="en-US" maxlength="35" spellcheck="false" placeholder="en-US"></label><label class="privacy voice-consent" hidden><input type="checkbox">I allow the browser speech service to process my audio. It may send audio to its provider.</label><div class="setting-row"><span data-mic-status>Microphone setup</span><button class="secondary" type="button" data-mic-manage>Manage microphone</button></div><button class="secondary" type="button" data-voice-install>Install language pack</button>`;
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
  let session = 0;
  const installing = false;
  let recording = false,
    transcript = '',
    providerId = '',
    base = '',
    previousTranscript = '';
  let phase: VoicePhase = 'idle';
  let heardText = false;
  let settingUpMicrophone = false;
  const setSpeaking = (speaking: boolean) => {
    activity.dataset.speaking = String(speaking && phase === 'listening');
    if (phase === 'listening')
      activity.querySelector('.voice-activity-state')!.textContent = speaking
        ? 'Hearing you'
        : 'Listening';
  };
  const setPhase = (value: VoicePhase) => {
    phase = value;
    container.dataset.voicePhase = value;
    activity.hidden = value === 'idle';
    setSpeaking(false);
    activity.querySelector('.voice-activity-state')!.textContent =
      value === 'starting'
        ? 'Opening microphone…'
        : value === 'finishing'
          ? 'Finishing transcript…'
          : 'Listening';
    options.onState();
  };
  const finish = () => {
    recording = false;
    talk.classList.remove('recording');
    talkLabel.textContent = 'Hold to talk';
    talk.setAttribute('aria-label', 'Hold to talk');
    talk.setAttribute('aria-pressed', 'false');
    toggle.classList.remove('recording');
    toggle.innerHTML = icon('record');
    toggle.setAttribute('aria-label', 'Start hands-free recording');
    toggle.setAttribute('title', 'Click to record hands-free');
    toggle.setAttribute('aria-pressed', 'false');
    consent.disabled = false;
    select.disabled = false;
    language.disabled = false;
    install.disabled = installing;
    setPhase('idle');
  };
  const start = (requestedMode: RecordingMode = 'hold') => {
    if (recording || settingUpMicrophone || installing || !options.canStart())
      return;
    if (select.value === 'browser' && !consent.checked) {
      options.notice(
        'Open Settings and allow browser audio processing before using that provider.',
      );
      return;
    }
    if (!options.createProvider && !options.preferences?.voiceReady) {
      enableMicrophone.hidden = false;
      options.notice('Set up voice once, then use it on every page.');
      return;
    }
    provider = options.createProvider
      ? options.createProvider(
          select.value === 'local',
          language.value.trim() || 'en-US',
        )
      : new ExtensionSpeechProvider(select.value === 'local');
    providerId = provider.id;
    base = options.getDraft();
    previousTranscript = transcript;
    const currentSession = ++session;
    mode = requestedMode;
    recording = true;
    heardText = false;
    talk.classList.add('recording');
    talkLabel.textContent = 'Starting microphone…';
    talk.setAttribute('aria-label', talkLabel.textContent);
    talk.setAttribute('aria-pressed', 'true');
    toggle.classList.add('recording');
    toggle.innerHTML = icon('stop');
    toggle.setAttribute('aria-label', 'Stop recording');
    toggle.setAttribute('title', 'Stop recording');
    toggle.setAttribute('aria-pressed', 'true');
    consent.disabled = true;
    select.disabled = true;
    language.disabled = true;
    install.disabled = true;
    setPhase('starting');
    options.notice('');
    void provider
      .start(
        (text) => {
          if (currentSession !== session) return;
          heardText ||= Boolean(text.trim());
          transcript = [previousTranscript, text].filter(Boolean).join(' ');
          options.setDraft(base + (base && text ? '\n' : '') + text);
        },
        () => {
          if (currentSession !== session) return;
          session++;
          finish();
          options.notice(
            heardText
              ? 'Recording finished. Review your note before saving.'
              : 'No words were captured. Enable microphone, check your input device, then wait for Listening before speaking.',
          );
          enableMicrophone.hidden = heardText;
        },
        (error) => {
          if (currentSession !== session) return;
          session++;
          provider?.abort();
          finish();
          options.notice(error);
          enableMicrophone.hidden = false;
        },
        () => {
          if (currentSession !== session || phase !== 'starting') return;
          enableMicrophone.hidden = true;
          talkLabel.textContent =
            mode === 'hands-free'
              ? 'Listening…'
              : mode === 'middle'
                ? `Release ${options.shortcutLabel?.() || 'middle button'}`
                : 'Release to finish';
          talk.setAttribute('aria-label', talkLabel.textContent);
          setPhase('listening');
        },
        (speaking) => {
          if (currentSession !== session || phase !== 'listening') return;
          setSpeaking(speaking);
        },
      )
      .catch((error: unknown) => {
        if (currentSession !== session) return;
        session++;
        options.notice(error instanceof Error ? error.message : String(error));
        enableMicrophone.hidden = !(error instanceof MicrophoneSetupError);
        finish();
      });
  };
  const stop = () => {
    if (!recording) return;
    if (phase === 'finishing') return;
    const pending = provider?.stop();
    if (!recording) return;
    if (!pending) {
      session++;
      finish();
      options.notice('Recording canceled. Your draft is still here.');
    } else {
      talkLabel.textContent = 'Finishing…';
      talk.setAttribute('aria-label', 'Finishing recording');
      setPhase('finishing');
    }
  };
  enableMicrophone.onclick = async () => {
    if (recording || settingUpMicrophone) return;
    settingUpMicrophone = true;
    try {
      await openVoiceSetup();
    } catch (error) {
      options.notice(String(error));
    } finally {
      settingUpMicrophone = false;
    }
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
  window.addEventListener('blur', () => {
    // A browser permission prompt can take focus from a hands-free session.
    // Hold gestures must still stop when their release might be missed.
    if (mode !== 'hands-free') stop();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  const renderSettings = () => {
    settings.querySelector<HTMLElement>('.voice-consent')!.hidden =
      select.value !== 'browser';

    install.hidden = select.value !== 'local';
    settings.querySelector('.voice-disclosure')!.textContent =
      select.value === 'local'
        ? 'Audio stays on this computer. Install the speech pack here for the exact language below; Windows language packs do not replace the browser pack.'
        : 'Audio may be sent to your browser’s speech provider. Your choice below is remembered. Uncheck it to revoke consent.';
  };
  select.value = options.preferences?.provider || 'local';
  language.value = options.preferences?.language || 'en-US';
  consent.checked = options.preferences?.browserConsent === true;
  renderSettings();
  const persist = () =>
    options.onPreferences?.({
      provider: select.value as Preferences['provider'],
      language: language.value.trim() || 'en-US',
      browserConsent: consent.checked,
    });
  select.onchange = () => {
    renderSettings();
    persist();
  };
  language.onchange = persist;
  consent.onchange = persist;
  install.onclick = () => {
    void openVoiceSetup().catch((error) => options.notice(String(error)));
  };
  settings.querySelector<HTMLButtonElement>('[data-mic-manage]')!.onclick =
    () => {
      void openVoiceSetup().catch((error) => options.notice(String(error)));
    };
  const onboarding = document.createElement('section');
  onboarding.className = 'voice-onboarding';
  onboarding.innerHTML =
    '<strong>Speak your notes</strong><p>Set up your microphone once. Then hold a shortcut to capture your thoughts on any page.</p><button class="primary" type="button" data-setup-voice>Set up voice</button><button class="quiet" type="button" data-skip-voice>Not now</button>';
  container.prepend(onboarding);
  const refreshPreferences = (value: Preferences) => {
    options.preferences = value;
    settings.querySelector('[data-mic-status]')!.textContent = value.voiceReady
      ? 'Ready across pages'
      : 'Set up once';
    onboarding.hidden = Boolean(
      value.voiceReady || value.voiceOnboardingSeen || options.createProvider,
    );
    enableMicrophone.hidden = Boolean(
      value.voiceReady || !onboarding.hidden || options.createProvider,
    );
    if (!recording) {
      select.value = value.provider;
      language.value = value.language;
      consent.checked = value.browserConsent === true;
      renderSettings();
    }
  };
  onboarding.querySelector<HTMLButtonElement>('[data-setup-voice]')!.onclick =
    () => {
      enableMicrophone.click();
    };
  onboarding.querySelector<HTMLButtonElement>('[data-skip-voice]')!.onclick =
    () => {
      onboarding.hidden = true;
      options.onPreferences?.({ voiceOnboardingSeen: true });
    };
  refreshPreferences(
    options.preferences || {
      provider: 'local',
      language: 'en-US',
      screenshot: true,
    },
  );
  return {
    refreshPreferences,
    get phase() {
      return phase;
    },
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
