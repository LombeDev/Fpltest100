// js/api.js
// All FPL requests go through the configured proxy, which avoids browser CORS limits.
// Independent requests run together with Promise.all.

import { CONFIG } from './config.js';
import { storage } from './storage.js';

async function request(endpoint) {
  const res = await fetch(CONFIG.proxyUrl + encodeURIComponent(endpoint));
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.error) || `FPL returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Keep only what the dashboard uses, so the cached copy stays well under localStorage limits.
export function trimBootstrap(b) {
  return {
    events: b.events.map((e) => ({
      id: e.id,
      name: e.name,
      deadline_time: e.deadline_time,
      is_current: e.is_current,
      is_next: e.is_next,
      finished: e.finished,
    })),
    teams: b.teams.map((t) => ({ id: t.id, name: t.name, short_name: t.short_name })),
    elements: b.elements.map((p) => ({
      id: p.id,
      web_name: p.web_name,
      team: p.team,
      element_type: p.element_type,
      now_cost: p.now_cost,
      selected_by_percent: p.selected_by_percent,
      transfers_in_event: p.transfers_in_event,
      transfers_out_event: p.transfers_out_event,
    })),
  };
}

// Player and team metadata changes rarely: serve it from cache while it is fresh.
export async function loadStatic() {
  const cached = storage.readFresh(CONFIG.keys.staticCache, CONFIG.staticTtlMs);
  if (cached) return { data: cached, fromCache: true };
  const data = trimBootstrap(await request('bootstrap-static/'));
  storage.writeTimed(CONFIG.keys.staticCache, data);
  return { data, fromCache: false };
}

// Everything that changes per gameweek, fetched concurrently.
export async function fetchGameweek(teamId, gw) {
  const [picks, live, fixtures] = await Promise.all([
    request(`entry/${teamId}/event/${gw}/picks/`),
    request(`event/${gw}/live/`),
    request('fixtures/').catch(() => []),   // fixtures are optional; the page still works without them
  ]);
  return { picks, live, fixtures: fixtures || [] };
}

export const fetchEntry = (teamId) => request(`entry/${teamId}/`);
export const fetchHistory = (teamId) => request(`entry/${teamId}/history/`);
export const fetchRaw = (endpoint) => request(endpoint);
export const fetchStandings = (leagueId) => request(`leagues-classic/${leagueId}/standings/`);

// Load several leagues at once. One failing league does not stop the others.
export async function fetchLeagues(ids) {
  const settled = await Promise.allSettled(ids.map((id) => fetchStandings(id)));
  const out = {};
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    out[ids[i]] = {
      name: (r.value.league && r.value.league.name) || `League ${ids[i]}`,
      results: (r.value.standings && r.value.standings.results) || [],
    };
  });
  return out;
}
