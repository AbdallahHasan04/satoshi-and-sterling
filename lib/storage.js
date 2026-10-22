// Thin wrapper over the extension's storage.local. Falls back to localStorage so the
// popup can also be previewed as a plain web page during development.
import { ext } from './ext.js';

const area = ext?.storage?.local;

export async function get(key, fallback = null) {
  try {
    if (area) {
      const result = await area.get(key);
      return result[key] ?? fallback;
    }
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function set(key, value) {
  try {
    if (area) return await area.set({ [key]: value });
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: keep working without persistence.
  }
}

export async function remove(...keys) {
  try {
    if (area) return await area.remove(keys);
    keys.forEach(k => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
