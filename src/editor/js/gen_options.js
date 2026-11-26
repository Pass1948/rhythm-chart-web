import { loadSettings, saveSettings } from '../../storage/settingsStore.ts';
export function optionsFor(diff) {
  return loadSettings().genOverrides[diff] || {};
}
export function saveOptions(diff, value) {
  saveSettings({ genOverrides: { ...loadSettings().genOverrides, [diff]: value } });
}
