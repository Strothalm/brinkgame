// Persistent storage. In the desktop app the data lives as JSON files in the user data folder,
// in the browser it falls back to localStorage. Values are cached in memory after init().

const KEYS = ['profile', 'settings', 'servers', 'packs', 'presets', 'played', 'sessions', 'lobbyDraft'];
const cache = new Map();
const timers = new Map();
const bridge = typeof window !== 'undefined' ? window.brink?.store : null;

async function readRaw(key) {
  try {
    if (bridge) return await bridge.get(key);
    const raw = localStorage.getItem(`brink.${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeRaw(key, value) {
  try {
    if (bridge) await bridge.set(key, value);
    else localStorage.setItem(`brink.${key}`, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('storage write failed', key, e);
    return false;
  }
}

export async function initStorage() {
  await Promise.all(KEYS.map(async (key) => cache.set(key, await readRaw(key))));
}

export function load(key, fallback) {
  const value = cache.get(key);
  return value == null ? fallback : value;
}

/** Saves with a short debounce so sliders do not hammer the disk. */
export function save(key, value) {
  cache.set(key, value);
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => writeRaw(key, value), 250));
}

export function saveNow(key, value) {
  cache.set(key, value);
  clearTimeout(timers.get(key));
  return writeRaw(key, value);
}
