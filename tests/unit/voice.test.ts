import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  BrowserSpeechProvider,
  mountVoice,
  type Recognizer,
} from '../../src/voice';
class FakeRecognition implements Recognizer {
  static latest: FakeRecognition;
  static available = vi.fn(async () => 'available');
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  onresult: Recognizer['onresult'] = null;
  onerror: Recognizer['onerror'] = null;
  onend: Recognizer['onend'] = null;
  start = vi.fn(() => this.onaudiostart?.());
  onaudiostart: Recognizer['onaudiostart'] = null;
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognition.latest = this;
  }
}
describe('replaceable speech provider', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('shows listening only after audio capture starts and retains final words after release', async () => {
    class DelayedRecognition extends FakeRecognition {
      start = vi.fn();
      stop = vi.fn();
    }
    Object.assign(globalThis, { SpeechRecognition: DelayedRecognition });
    let draft = 'Written context';
    const voice = mountVoice(document.createElement('div'), {
      getDraft: () => draft,
      setDraft: (value) => {
        draft = value;
      },
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    voice.start('middle');
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    expect(voice.phase).toBe('starting');
    FakeRecognition.latest.onaudiostart?.();
    expect(voice.phase).toBe('listening');
    voice.release('middle');
    expect(voice.phase).toBe('finishing');
    FakeRecognition.latest.onresult?.({
      results: [
        { isFinal: true, 0: { transcript: 'Final words after release' } },
      ],
    });
    expect(draft).toBe('Written context\nFinal words after release');
    FakeRecognition.latest.onend?.();
    expect(voice.recording).toBe(false);
    voice.reset();
  });
  it('aborts stalled startup with an actionable error', async () => {
    vi.useFakeTimers();
    class SilentRecognition extends FakeRecognition {
      start = vi.fn();
    }
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => SilentRecognition,
    );
    const error = vi.fn();
    await provider.start(vi.fn(), vi.fn(), error);
    await vi.advanceTimersByTimeAsync(15000);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('microphone did not start'),
    );
    expect(FakeRecognition.latest.abort).toHaveBeenCalled();
  });
  it('never starts recognition when microphone permission needs setup', async () => {
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => FakeRecognition,
      async () => {
        throw new Error('Enable microphone');
      },
    );
    await expect(provider.start(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      'Enable microphone',
    );
    expect(FakeRecognition.latest.start).not.toHaveBeenCalled();
  });
  it('times out a stalled language check without starting recognition', async () => {
    vi.useFakeTimers();
    FakeRecognition.available.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => FakeRecognition,
    );
    const result = expect(
      provider.start(vi.fn(), vi.fn(), vi.fn()),
    ).rejects.toThrow('did not finish checking the speech language pack');
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(FakeRecognition.latest.start).not.toHaveBeenCalled();
  });
  it('unlocks a stalled stop even if audio starts after release', async () => {
    vi.useFakeTimers();
    class DelayedRecognition extends FakeRecognition {
      start = vi.fn();
      stop = vi.fn();
    }
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => DelayedRecognition,
    );
    const end = vi.fn();
    await provider.start(vi.fn(), end, vi.fn());
    provider.stop();
    FakeRecognition.latest.onaudiostart?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(end).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.latest.abort).toHaveBeenCalled();
  });
  it('keeps hands-free recording alive when a permission prompt takes focus', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    const voice = mountVoice(document.createElement('div'), {
      getDraft: () => '',
      setDraft: () => {},
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    voice.start('hands-free');
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    window.dispatchEvent(new Event('blur'));
    expect(FakeRecognition.latest.stop).not.toHaveBeenCalled();
    expect(voice.recording).toBe(true);
    voice.stop();
    expect(voice.recording).toBe(false);
    voice.reset();
  });
  it.each(['downloadable', 'downloading', 'unavailable'])(
    'explains the exact browser pack state: %s',
    async (availability) => {
      FakeRecognition.available.mockResolvedValueOnce(availability);
      const provider = new BrowserSpeechProvider(
        true,
        'en-GB',
        () => FakeRecognition,
      );
      await expect(provider.start(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
        availability === 'downloadable'
          ? 'Windows language pack'
          : availability,
      );
      expect(FakeRecognition.latest.start).not.toHaveBeenCalled();
    },
  );
  it('verifies that an installed pack is usable before reporting it ready', async () => {
    class InstallingRecognition extends FakeRecognition {
      static install = vi.fn(async () => true);
    }
    Object.assign(globalThis, { SpeechRecognition: InstallingRecognition });
    FakeRecognition.available.mockResolvedValueOnce('downloading');
    const container = document.createElement('div');
    const notice = vi.fn();
    const voice = mountVoice(container, {
      getDraft: () => '',
      setDraft: () => {},
      canStart: () => true,
      onState: () => {},
      notice,
    });
    container.querySelector<HTMLButtonElement>('[data-voice-install]')!.click();
    await vi.waitFor(() =>
      expect(notice).toHaveBeenLastCalledWith(
        expect.stringContaining('still downloading'),
      ),
    );
    expect(InstallingRecognition.install).toHaveBeenCalledWith({
      langs: ['en-US'],
      processLocally: true,
    });
    voice.reset();
  });
  it('unlocks a released draft immediately while availability is still pending', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    let resolve!: (value: string) => void;
    FakeRecognition.available.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    let draft = 'Written context';
    const voice = mountVoice(document.createElement('div'), {
      getDraft: () => draft,
      setDraft: (value) => {
        draft = value;
      },
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    voice.start('middle');
    const recognition = FakeRecognition.latest;
    voice.release('middle');
    expect(voice.recording).toBe(false);
    draft = 'My updated draft';
    resolve('available');
    await Promise.resolve();
    await Promise.resolve();
    expect(recognition.start).not.toHaveBeenCalled();
    expect(draft).toBe('My updated draft');
    voice.reset();
  });
  it('ignores late results after recording ends without overwriting subsequent edits', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    let draft = '';
    const voice = mountVoice(document.createElement('div'), {
      getDraft: () => draft,
      setDraft: (value) => {
        draft = value;
      },
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    voice.start('middle');
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    const recognition = FakeRecognition.latest;
    recognition.onresult?.({
      results: [{ isFinal: true, 0: { transcript: 'Original transcript' } }],
    });
    voice.release('middle');
    draft = 'My corrected note';
    recognition.onresult?.({
      results: [{ isFinal: true, 0: { transcript: 'Late transcript' } }],
    });
    expect(draft).toBe('My corrected note');
    expect(voice.input()).toMatchObject({ transcript: 'Original transcript' });
    voice.reset();
  });
  it('only releases the active recording gesture and preserves hands-free sessions', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    const voice = mountVoice(document.createElement('div'), {
      getDraft: () => '',
      setDraft: () => {},
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    voice.start('middle');
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    voice.release('hold');
    expect(voice.middleRecording).toBe(true);
    voice.release('middle');
    expect(voice.recording).toBe(false);
    voice.start('hands-free');
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    voice.start('middle');
    voice.release('middle');
    expect(voice.recording).toBe(true);
    expect(voice.middleRecording).toBe(false);
    voice.reset();
  });
  it('enforces local processing and returns an editable transcript', async () => {
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => FakeRecognition,
    );
    const transcript = vi.fn(),
      end = vi.fn();
    await provider.start(transcript, end, vi.fn());
    expect(FakeRecognition.latest.processLocally).toBe(true);
    FakeRecognition.latest.onresult?.({
      results: [{ isFinal: true, 0: { transcript: 'This feels cluttered.' } }],
    });
    expect(transcript).toHaveBeenCalledWith('This feels cluttered.');
    provider.stop();
    expect(end).toHaveBeenCalled();
  });
  it('never falls back to a network provider when local recognition is unavailable', async () => {
    FakeRecognition.available.mockResolvedValueOnce('unavailable');
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => FakeRecognition,
    );
    await expect(provider.start(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      'language pack',
    );
    expect(FakeRecognition.latest.start).not.toHaveBeenCalled();
    expect(FakeRecognition.latest.processLocally).toBe(true);
  });
  it('release during availability check never starts recording later', async () => {
    let resolve!: (value: string) => void;
    FakeRecognition.available.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const provider = new BrowserSpeechProvider(
      true,
      'en-US',
      () => FakeRecognition,
    );
    const pending = provider.start(vi.fn(), vi.fn(), vi.fn());
    provider.stop();
    resolve('available');
    await pending;
    expect(FakeRecognition.latest.start).not.toHaveBeenCalled();
  });
  it('keeps transcript metadata separate from the user-edited draft', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    const container = document.createElement('div');
    document.body.append(container);
    let draft = '';
    const voice = mountVoice(container, {
      getDraft: () => draft,
      setDraft: (value) => {
        draft = value;
      },
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    const button =
      container.querySelector<HTMLButtonElement>('[data-voice-talk]')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    FakeRecognition.latest.onresult?.({
      results: [{ isFinal: true, 0: { transcript: 'this feel clutter' } }],
    });
    button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    expect(draft).toBe('this feel clutter');
    draft = 'This feels cluttered. Simplify the layout.';
    expect(voice.input()).toEqual({
      method: 'voice',
      provider: 'web-speech-on-device',
      transcript: 'this feel clutter',
    });
    expect(draft).toContain('Simplify');
    expect(voice.recording).toBe(false);
    voice.reset();
    container.remove();
  });
  it('ignores late transcription after a draft has been cleared', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    const container = document.createElement('div');
    let draft = '';
    const voice = mountVoice(container, {
      getDraft: () => draft,
      setDraft: (value) => {
        draft = value;
      },
      canStart: () => true,
      onState: () => {},
      notice: () => {},
    });
    container.querySelector<HTMLButtonElement>('[data-voice-toggle]')!.click();
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    const recognition = FakeRecognition.latest;
    expect(voice.recording).toBe(true);
    voice.reset();
    draft = 'A new draft';
    recognition.onresult?.({
      results: [{ isFinal: true, 0: { transcript: 'late result' } }],
    });
    expect(draft).toBe('A new draft');
    expect(voice.input()).toEqual({ method: 'typed' });
  });
  it('requires fresh consent for a remembered browser speech provider', async () => {
    Object.assign(globalThis, { SpeechRecognition: FakeRecognition });
    const container = document.createElement('div');
    const settings = document.createElement('div');
    const notice = vi.fn();
    const voice = mountVoice(container, {
      getDraft: () => '',
      setDraft: () => {},
      canStart: () => true,
      onState: () => {},
      notice,
      settings,
      preferences: { provider: 'browser', language: 'en-US', screenshot: true },
    });
    container.querySelector<HTMLButtonElement>('[data-voice-toggle]')!.click();
    expect(voice.recording).toBe(false);
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining('allow browser audio processing'),
    );
    const consent = settings.querySelector<HTMLInputElement>(
      '.voice-consent input',
    )!;
    consent.checked = true;
    container.querySelector<HTMLButtonElement>('[data-voice-toggle]')!.click();
    await vi.waitFor(() =>
      expect(FakeRecognition.latest.start).toHaveBeenCalled(),
    );
    expect(voice.recording).toBe(true);
    expect(FakeRecognition.latest.processLocally).toBe(false);
    voice.stop();
    expect(voice.recording).toBe(false);
    voice.reset();
  });
});
