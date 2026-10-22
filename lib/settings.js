import * as store from './storage.js';

export const DEFAULT_SETTINGS = {
  theme: 'system',          // 'system' | 'light' | 'dark'
  copyFormat: 'formatted',  // 'formatted' (€1,234.56) | 'raw' (1234.56)
  homeCurrency: 'USD',      // target for right-click conversions
};

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await store.get('settings', {})) };
}

export const saveSettings = settings => store.set('settings', settings);

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
