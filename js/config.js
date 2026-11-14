// js/config.js
// Central configuration. Change proxyUrl if the proxy lives on another host.
// A full URL works too, e.g. 'https://your-site.netlify.app/.netlify/functions/fpl-proxy?endpoint='.

export const CONFIG = {
  proxyUrl: '/.netlify/functions/fpl-proxy?endpoint=',
  refreshMs: 30_000,                       // live refresh while the page is open
  staticTtlMs: 6 * 60 * 60 * 1000,         // player and team metadata lives 6 hours
  keys: {
    teamId: 'kopala_id',
    leagues: 'kopala_leagues',             // favourite mini-league IDs
    staticCache: 'kopala_static_v1',       // trimmed bootstrap data, timestamped
  },
};
