import type { Request, Response } from './types';
export async function rpc<T>(message: Request): Promise<T> {
  const result: Response<T> = await chrome.runtime.sendMessage(message);
  if (!result?.ok)
    throw new Error(
      result?.error ||
        'Extension disconnected. Reload this page and open Pointnote again.',
    );
  return result.value;
}
