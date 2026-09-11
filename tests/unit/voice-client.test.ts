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
        sendMessage: vi
          .fn()
          .mockResolvedValue({
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
