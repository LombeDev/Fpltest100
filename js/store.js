// js/store.js
// A small reactive store. A subscriber runs only when the slice it watches
// changes, so updating live points does not re-render the league table.

const state = {
  teamId: null,
  staticData: null,              // trimmed bootstrap: players, teams, events
  gameweekData: null,            // { gw, picks, fixtures }
  liveStats: null,               // { gw, byId: Map(elementId -> stats) }
  miniLeagueStandings: {},       // { [leagueId]: { name, results } }
  entry: null,                   // rank, points and gameweek summary
  simulatedEvents: [],           // what-if changes (not wired to UI yet)
};

const subscribers = new Map();   // path -> Set of callbacks

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Two paths overlap when one is the same as, or a parent or child of, the other.
function overlaps(a, b) {
  return a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
}

function notify(changedPath) {
  for (const [path, fns] of subscribers) {
    if (!overlaps(path, changedPath)) continue;
    const value = getPath(state, path);
    for (const fn of fns) fn(value, changedPath);
  }
}

export const store = {
  get(path) {
    return getPath(state, path);
  },

  // Returns true only when the value actually changed.
  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((o, k) => o[k], state);
    if (Object.is(parent[last], value)) return false;
    parent[last] = value;
    notify(path);
    return true;
  },

  // Returns an unsubscribe function.
  subscribe(path, fn) {
    if (!subscribers.has(path)) subscribers.set(path, new Set());
    subscribers.get(path).add(fn);
    return () => subscribers.get(path).delete(fn);
  },
};
