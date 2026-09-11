import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExtensionSpeechProvider,
  openVoiceSetup,
} from '../../src/voice-client';

afterEach(() => vi.unstubAllGlobals());

describe('voice background compatibility', () => {
  it.each([
    { ok: false, error: 'Unknown request.' },
    { ok: false, error: 'Error: Unknown voice request.' },
    undefined,
  ])('explains how to recover from an outdated worker: %j', async (reply) => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockResolvedValue(reply) },
    });
    await expect(openVoiceSetup()).rejects.toThrow('click Reload on Pointnote');
  });

  it.each([
    'Extension context invalidated.',
    'Could not establish connection. Receiving end does not exist.',
  ])('explains recovery after an extension reload: %s', async (message) => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockRejectedValue(new Error(message)) },
    });
    await expect(openVoiceSetup()).rejects.toThrow('refresh this page');
  });

  it('does not attempt recording when the worker needs to reload', async () => {
    const connect = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi
          .fn()
          .mockResolvedValue({ ok: false, error: 'Unknown request.' }),
        connect,
      },
    });
    const provider = new ExtensionSpeechProvider(true);
    await expect(provider.start(vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      'click Reload on Pointnote',
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it('preserves actionable errors from a current worker', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          ok: false,
          error: 'Could not create the setup tab.',
        }),
      },
    });
    await expect(openVoiceSetup()).rejects.toThrow(
      'Could not create the setup tab.',
    );
  });

  it('opens setup through the extension worker', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await expect(openVoiceSetup()).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith({
      target: 'pointnote-voice',
      action: 'setup',
    });
  });
});

describe('speech activity messages', () => {
  it('relays speech detection, ignores late activity, and retains the final transcript', async () => {
    let receive: (message: object) => void = () => {};
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
      onMessage: {
        addListener: (listener: typeof receive) => {
          receive = listener;
        },
      },
    };
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        connect: vi.fn(() => port),
      },
    });
    const provider = new ExtensionSpeechProvider(true);
    const speaking = vi.fn(),
      transcript = vi.fn(),
      end = vi.fn(),
      listening = vi.fn();
    await provider.start(transcript, end, vi.fn(), listening, speaking);
    receive({ type: 'LISTENING' });
    expect(listening).toHaveBeenCalledOnce();
    expect(speaking).not.toHaveBeenCalled();
    receive({ type: 'SPEAKING', speaking: 'true' });
    expect(speaking).not.toHaveBeenCalled();
    receive({ type: 'SPEAKING', speaking: true });
    receive({ type: 'SPEAKING', speaking: false });
    expect(speaking.mock.calls).toEqual([[true], [false]]);
    provider.stop();
    receive({ type: 'SPEAKING', speaking: true });
    expect(speaking).toHaveBeenCalledTimes(2);
    receive({ type: 'TEXT', text: 'Final words' });
    expect(transcript).toHaveBeenCalledWith('Final words');
    receive({ type: 'END' });
    expect(speaking).toHaveBeenLastCalledWith(false);
    expect(end).toHaveBeenCalledOnce();
    expect(port.disconnect).toHaveBeenCalledOnce();
    receive({ type: 'SPEAKING', speaking: true });
    expect(speaking).toHaveBeenCalledTimes(3);
  });
});
