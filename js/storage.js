// js/storage.js
// Thin localStorage wrapper. Storage can be full or blocked (private mode),
// so every call fails quietly and the app keeps working without it.

export const storage = {
  read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },

  // Store a value together with the time it was saved.
  writeTimed(key, value) {
    return this.write(key, { ts: Date.now(), value });
  },

  // Return the stored value only while it is younger than maxAgeMs; otherwise null.
  readFresh(key, maxAgeMs) {
    const entry = this.read(key);
    if (!entry || typeof entry.ts !== 'number' || Date.now() - entry.ts > maxAgeMs) return null;
    return entry.value;
  },
};
