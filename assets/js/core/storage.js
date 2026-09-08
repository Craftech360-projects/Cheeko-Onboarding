/**
 * core/storage.js
 * localStorage wrapper.
 *
 * Safari with cookies blocked (and some private modes) throws on any
 * localStorage access. Unguarded, that would take down the whole page
 * controller, so we probe once and fall back to an in-memory map. The
 * page then works normally for the session, it just forgets on reload.
 */

function createMemoryStorage() {
  const values = new Map();
  return {
    get: (key) => (values.has(key) ? values.get(key) : null),
    set: (key, value) => { values.set(key, String(value)); },
    remove: (key) => { values.delete(key); },
  };
}

function createLocalStorage() {
  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, String(value)),
    remove: (key) => window.localStorage.removeItem(key),
  };
}

function isLocalStorageAvailable() {
  try {
    const probe = "__cheeko_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export const storage = isLocalStorageAvailable()
  ? createLocalStorage()
  : createMemoryStorage();
