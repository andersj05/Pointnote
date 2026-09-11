export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Preferences {
  screenshot: boolean;
  provider: 'local' | 'browser';
  language: string;
  voiceReady?: boolean;
  voiceOnboardingSeen?: boolean;
  browserConsent?: boolean;
}
const defaults: Preferences = {
  screenshot: true,
  provider: 'local',
  language: 'en-US',
};
export async function readPreferences(): Promise<{
  preferences: Preferences;
  layout?: PanelBounds;
}> {
  const stored = await chrome.storage.local.get(['preferences', 'panelLayout']);
  const value = stored.preferences as Partial<Preferences> | undefined;
  const candidate = stored.panelLayout as PanelBounds | undefined;
  return {
    preferences: {
      voiceReady: value?.voiceReady === true,
      voiceOnboardingSeen: value?.voiceOnboardingSeen === true,
      browserConsent: value?.browserConsent === true,
      screenshot:
        typeof value?.screenshot === 'boolean'
          ? value.screenshot
          : defaults.screenshot,
      provider: value?.provider === 'browser' ? 'browser' : 'local',
      language:
        typeof value?.language === 'string' &&
        value.language.length <= 35 &&
        value.language.trim()
          ? value.language
          : defaults.language,
    },
    layout:
      candidate &&
      ['x', 'y', 'width', 'height'].every((key) =>
        Number.isFinite(candidate[key as keyof PanelBounds]),
      )
        ? candidate
        : undefined,
  };
}
