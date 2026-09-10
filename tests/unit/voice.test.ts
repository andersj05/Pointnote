import { describe, it, expect, vi } from 'vitest';
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
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognition.latest = this;
  }
}
describe('replaceable speech provider', () => {
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
    await Promise.resolve();
    await Promise.resolve();
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
});
