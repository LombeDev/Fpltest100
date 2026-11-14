// js/app.js
// Dashboard controller. Fetches data, updates the store, and renders each part of the
// page only when its slice changes. Rows are keyed by data-player-id, so refreshes
// update text and classes in place instead of rebuilding the page.

import { CONFIG } from './config.js';
import { store } from './store.js';
import { storage } from './storage.js';
import { loadStatic, fetchGameweek, fetchEntry, fetchHistory, fetchLeagues } from './api.js';
import { setText, setClass, syncKeyed } from './dom.js';

const $ = (id) => document.getElementById(id);
const ROW_TOP = { 1: 12, 2: 36, 3: 60, 4: 84 };     // pitch rows: GK at the top
const ui = { sort: { key: 'points', dir: -1 }, timer: null, busy: false };

// ---------- Derived data ----------

function statusFor(team, fixtures, minutes) {
  const mine = fixtures.filter((f) => f.team_h === team || f.team_a === team);
  if (mine.some((f) => f.started && !f.finished)) return 'In play';
  if (mine.some((f) => !f.started)) return 'To play';
  if (mine.length) return minutes > 0 ? 'Played' : 'Missed';
  return 'No match';
}

function statusClass(s) {
  return { 'In play': 'play', Played: 'done', Missed: 'missed' }[s] || '';
}

// One row per squad player, joining picks, metadata, live stats and fixtures.
function buildRows() {
  const staticData = store.get('staticData');
  const gwd = store.get('gameweekData');
  const live = store.get('liveStats');
  if (!staticData || !gwd || !live) return [];

  const players = new Map(staticData.elements.map((p) => [p.id, p]));
  const teams = new Map(staticData.teams.map((t) => [t.id, t.short_name]));

  return gwd.picks.picks.map((pick) => {
    const pl = players.get(pick.element) || {};
    const s = live.byId.get(pick.element) || {};
    const start = pick.position <= 11;
    const mult = start ? Math.max(pick.multiplier || 1, 1) : 0;
    return {
      id: pick.element,
      name: pl.web_name || 'Player',
      team: teams.get(pl.team) || '',
      type: pl.element_type || 0,
      start,
      isCaptain: !!pick.is_captain,
      isVice: !!pick.is_vice_captain,
      points: (s.total_points || 0) * mult,
      raw: s.total_points || 0,
      minutes: s.minutes || 0,
      goals: s.goals_scored || 0,
      assists: s.assists || 0,
      cs: s.clean_sheets || 0,
      eo: parseFloat(pl.selected_by_percent) || 0,
      status: statusFor(pl.team, gwd.fixtures, s.minutes || 0),
    };
  });
}

function sortRows(rows) {
  const { key, dir } = ui.sort;
  return rows.slice().sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return typeof x === 'string' ? x.localeCompare(y) * dir : (x - y) * dir;
  });
}

// ---------- Squad list (one keyed tbody per position) ----------

const squadRow = {
  create(item) {
    const tr = document.createElement('tr');
    tr.dataset.playerId = String(item.id);
    for (let i = 0; i < 8; i++) {
      const td = document.createElement('td');
      if (i >= 1 && i <= 6) td.className = 'r num';
      if (i === 1) td.className = 'r num pts';
      tr.append(td);
    }
    tr.cells[7].append(document.createElement('span'));
    return tr;
  },
  update(tr, item) {
    const c = tr.cells;
    const mark = item.isCaptain ? ' (C)' : item.isVice ? ' (V)' : '';
    setText(c[0], item.name + mark + (item.start ? '' : '  · bench'));
    setText(c[1], item.points);
    setText(c[2], item.minutes);
    setText(c[3], item.goals);
    setText(c[4], item.assists);
    setText(c[5], item.cs);
    setText(c[6], item.eo.toFixed(1) + '%');
    const tag = c[7].firstChild;
    setText(tag, item.status);
    const cls = 'tag ' + statusClass(item.status);
    if (tag.className !== cls) tag.className = cls;
    setClass(tr, 'is-bench', !item.start);
    setClass(tr, 'is-scoring', item.goals > 0 || item.assists > 0);
  },
};

function renderSquad() {
  const rows = buildRows();
  [1, 2, 3, 4].forEach((type) => {
    syncKeyed($('sq-' + type), sortRows(rows.filter((r) => r.type === type)), squadRow);
  });
  const total = rows.filter((r) => r.start).reduce((sum, r) => sum + r.points, 0);
  setText($('squadTotal'), 'XI total ' + total);
  updateSortHeaders();
}

function updateSortHeaders() {
  document.querySelectorAll('th button[data-sort]').forEach((b) => {
    const active = b.dataset.sort === ui.sort.key;
    b.parentElement.setAttribute('aria-sort', active ? (ui.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

function sortBy(key) {
  const textFirst = key === 'name' || key === 'status';
  ui.sort = { key, dir: ui.sort.key === key ? -ui.sort.dir : (textFirst ? 1 : -1) };
  renderSquad();
}

// ---------- Pitch (3D view) ----------

function slotSpec(extraClass) {
  return {
    create(item) {
      const el = document.createElement('div');
      el.className = extraClass;
      el.dataset.playerId = String(item.id);
      const card = document.createElement('div');
      card.className = 'shirt-card';
      const band = document.createElement('span');
      band.className = 'armband';
      const name = document.createElement('div');
      name.className = 'pname';
      const pts = document.createElement('div');
      pts.className = 'pslot-pts';
      const eo = document.createElement('span');
      eo.className = 'eo-badge';
      card.append(band, name, pts, eo);
      el.append(card);
      return el;
    },
    update(el, item) {
      if (item.x !== undefined) {
        const left = item.x + '%';
        const top = item.y + '%';
        if (el.style.left !== left) el.style.left = left;
        if (el.style.top !== top) el.style.top = top;
      }
      setClass(el, 'is-cap', item.isCaptain);
      const band = el.querySelector('.armband');
      band.hidden = !(item.isCaptain || item.isVice);
      setText(band, item.isCaptain ? 'C' : 'V');
      setClass(band, 'vice', item.isVice && !item.isCaptain);
      setText(el.querySelector('.pname'), item.name);
      setText(el.querySelector('.pslot-pts'), item.points);
      setText(el.querySelector('.eo-badge'), 'EO ' + item.eo.toFixed(1) + '%');
    },
  };
}

const starterSpec = slotSpec('pslot');
const benchSpec = slotSpec('bench-item');

function renderPitch() {
  const rows = buildRows();
  const starters = [];
  [1, 2, 3, 4].forEach((type) => {
    const line = rows.filter((r) => r.start && r.type === type);
    line.forEach((r, i) => starters.push({ ...r, x: ((i + 1) / (line.length + 1)) * 100, y: ROW_TOP[type] }));
  });
  syncKeyed($('pitchPlayers'), starters, starterSpec);

  const bench = rows.filter((r) => !r.start).sort((a, b) => a.type - b.type);
  syncKeyed($('pitchBench'), bench, benchSpec);
}

// ---------- Rank card ----------

function renderRank() {
  const e = store.get('entry');
  if (!e) return;
  const rows = buildRows();
  const captain = rows.find((r) => r.isCaptain);

  setText($('rankGw'), 'Gameweek ' + e.gw);
  setText($('rankVal'), e.rank ? e.rank.toLocaleString('en-GB') : '--');

  const change = $('rankChange');
  if (e.rankChange === null || e.rankChange === 0) {
    setText(change, 'No change this gameweek');
  } else if (e.rankChange > 0) {
    setText(change, 'Up ' + e.rankChange.toLocaleString('en-GB') + ' places this gameweek');
  } else {
    setText(change, 'Down ' + Math.abs(e.rankChange).toLocaleString('en-GB') + ' places this gameweek');
  }
  setClass(change, 'pos-up', e.rankChange > 0);
  setClass(change, 'pos-down', e.rankChange < 0);

  setText($('gwPts'), e.gwPts);
  setText($('overallPts'), e.overallPts.toLocaleString('en-GB'));
  setText($('hitPts'), e.hit ? '-' + e.hit : '0');
  setText($('capPts'), captain ? captain.points : 0);
}

// ---------- Prices (net transfers, not predictions) ----------

const priceRow = {
  create() {
    const tr = document.createElement('tr');
    tr.append(document.createElement('td'), document.createElement('td'));
    return tr;
  },
  update(tr, item) {
    setText(tr.cells[0], item.name);
    setText(tr.cells[1], (item.net > 0 ? '+' : '') + item.net.toLocaleString('en-GB'));
    tr.cells[1].className = item.net >= 0 ? 'pos-up' : 'pos-down';
  },
};

function renderPrices() {
  const st = store.get('staticData');
  if (!st) return;
  const teams = new Map(st.teams.map((t) => [t.id, t.short_name]));
  const all = st.elements.map((p) => ({
    id: p.id,
    name: p.web_name + ' · ' + (teams.get(p.team) || ''),
    net: p.transfers_in_event - p.transfers_out_event,
  }));
  syncKeyed($('risingBody'), all.slice().sort((a, b) => b.net - a.net).slice(0, 8), priceRow);
  syncKeyed($('fallingBody'), all.slice().sort((a, b) => a.net - b.net).slice(0, 8), priceRow);
}

// ---------- Mini-leagues ----------

const leagueRow = {
  create() {
    const tr = document.createElement('tr');
    for (let i = 0; i < 3; i++) tr.append(document.createElement('td'));
    return tr;
  },
  update(tr, item) {
    setText(tr.cells[0], '#' + item.rank);
    setText(tr.cells[1], item.name);
    setText(tr.cells[2], item.total.toLocaleString('en-GB'));
    setClass(tr, 'is-me', item.me);
  },
};

function renderLeagues() {
  const board = store.get('miniLeagueStandings') || {};
  const ids = Object.keys(board);
  const first = board[ids[0]];
  const me = String(store.get('teamId'));

  setText($('leagueName'), first ? first.name : '');
  setText($('leagueNote'), first
    ? `Top 10 of ${ids.length} favourite league${ids.length > 1 ? 's' : ''}. Your team is highlighted.`
    : 'Add a mini-league ID to follow it here.');

  const rows = first ? first.results.slice(0, 10).map((r) => ({
    id: r.entry,
    rank: r.rank,
    name: r.entry_name,
    total: r.total,
    me: String(r.entry) === me,
  })) : [];
  syncKeyed($('leagueBody'), rows, leagueRow);
  renderLeagueChips();
}

// ---------- Refresh loop ----------

async function refresh() {
  const teamId = storage.read(CONFIG.keys.teamId);
  if (!teamId || ui.busy) return;
  ui.busy = true;
  try {
    const favourites = storage.read(CONFIG.keys.leagues) || [];

    // Static data, entry and history are independent, so they run together.
    const [{ data: staticData }, entry, history] = await Promise.all([
      loadStatic(),
      fetchEntry(teamId),
      fetchHistory(teamId),
    ]);
    store.set('staticData', staticData);

    const current = history.current || [];
    if (!current.length) {
      setStatus('Your season has not started yet.');
      return;
    }
    const latest = current[current.length - 1];
    const prev = current.length > 1 ? current[current.length - 2] : null;
    const gw = latest.event;

    store.set('entry', {
      gw,
      name: entry.name || 'Your team',
      rank: latest.overall_rank,
      rankChange: prev ? prev.overall_rank - latest.overall_rank : null,
      gwPts: latest.points,
      overallPts: latest.total_points,
      hit: latest.event_transfers_cost || 0,
    });

    // Picks, live stats, fixtures and mini-leagues are also independent.
    const [gwData, leagues] = await Promise.all([
      fetchGameweek(teamId, gw),
      favourites.length ? fetchLeagues(favourites) : Promise.resolve(null),
    ]);
    store.set('gameweekData', {
      gw,
      picks: gwData.picks,
      chip: gwData.picks.active_chip || null,
      fixtures: gwData.fixtures.filter((f) => f.event === gw),
    });
    store.set('liveStats', { gw, byId: new Map(gwData.live.elements.map((e) => [e.id, e.stats])) });
    if (leagues) store.set('miniLeagueStandings', leagues);

    setStatus('Updated ' + clock());
  } catch (err) {
    setStatus(err.message || 'Could not refresh. Retrying shortly.');
  } finally {
    ui.busy = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(ui.timer);
  if (storage.read(CONFIG.keys.teamId)) ui.timer = setTimeout(refresh, CONFIG.refreshMs);
}

// ---------- What-if: captain (choice lives in store.simulatedEvents) ----------

function renderWhatIf() {
  const select = $('whatifCaptain');
  if (!select) return;
  const rows = buildRows().filter((r) => r.start);
  const current = rows.find((r) => r.isCaptain);

  // Rebuild the options only when the squad changes, not on every live refresh.
  const key = rows.map((r) => r.id + ':' + r.name).join(',');
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    select.replaceChildren();
    rows.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((r) => {
      const opt = document.createElement('option');
      opt.value = String(r.id);
      opt.textContent = r.name;
      select.append(opt);
    });
  }

  const sim = (store.get('simulatedEvents') || []).find((e) => e.type === 'captain');
  const chosenId = sim ? sim.playerId : current ? current.id : null;
  if (chosenId != null && select.value !== String(chosenId)) select.value = String(chosenId);

  const chosen = rows.find((r) => r.id === Number(select.value));
  if (!chosen) return setText($('whatifResult'), '');

  const capMult = (store.get('gameweekData') || {}).chip === '3xc' ? 3 : 2;
  const base = rows.reduce((sum, r) => sum + r.raw, 0);
  const projected = base + chosen.raw * (capMult - 1);
  const currentTotal = base + (current ? current.raw : 0) * (capMult - 1);
  const diff = projected - currentTotal;
  setText($('whatifResult'), chosen.isCaptain
    ? projected + ' pts with ' + chosen.name + ' (current captain)'
    : projected + ' pts with ' + chosen.name + ' (' + (diff > 0 ? '+' : '') + diff + ' vs now)');
}

// ---------- Mini-league chips (remove buttons) ----------

const chipSpec = {
  create(item) {
    const li = document.createElement('li');
    li.dataset.playerId = String(item.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-remove';
    btn.textContent = '×';
    btn.dataset.removeLeague = String(item.id);
    li.append(document.createElement('span'), btn);
    return li;
  },
  update(li, item) {
    setText(li.firstChild, item.name);
    li.lastChild.setAttribute('aria-label', 'Remove ' + item.name);
  },
};

function renderLeagueChips() {
  const ids = storage.read(CONFIG.keys.leagues) || [];
  const board = store.get('miniLeagueStandings') || {};
  syncKeyed($('leagueChips'), ids.map((id) => ({
    id,
    name: (board[id] && board[id].name) || 'League ' + id,
  })), chipSpec);
}

function removeLeague(id) {
  const ids = (storage.read(CONFIG.keys.leagues) || []).filter((x) => x !== String(id));
  storage.write(CONFIG.keys.leagues, ids);
  const board = { ...(store.get('miniLeagueStandings') || {}) };
  delete board[id];
  store.set('miniLeagueStandings', board);
  setStatus('Removed league ' + id + '.');
}

// ---------- Filters and view ----------

function setFilter(f) {
  document.body.setAttribute('data-filter', f);
  document.querySelectorAll('[data-filter-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.filterBtn === f));
  });
}

function setView(v) {
  document.querySelectorAll('[data-view-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.viewBtn === v));
  });
  $('listView').hidden = v !== 'list';
  $('pitchView').hidden = v !== 'pitch';
}

// ---------- Status ----------

function setStatus(message) {
  setText($('status'), message);
}

function clock() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Wiring and start ----------

function wire() {
  $('teamForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('teamId').value.trim();
    if (!/^\d{1,9}$/.test(v)) return setStatus('Team ID should be a number, like 1234567.');
    storage.write(CONFIG.keys.teamId, v);
    store.set('teamId', v);
    refresh();
  });

  $('leagueForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('leagueId').value.trim();
    if (!/^\d{1,12}$/.test(v)) return setStatus('League ID should be a number from the league page address.');
    const ids = storage.read(CONFIG.keys.leagues) || [];
    if (!ids.includes(v)) storage.write(CONFIG.keys.leagues, [...ids, v]);
    $('leagueId').value = '';
    refresh();
  });

  document.querySelectorAll('[data-filter-btn]').forEach((b) => {
    b.addEventListener('click', () => setFilter(b.dataset.filterBtn));
  });
  document.querySelectorAll('[data-view-btn]').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.viewBtn));
  });
  $('whatifCaptain').addEventListener('change', (e) => {
    store.set('simulatedEvents', [{ type: 'captain', playerId: Number(e.target.value) }]);
  });
  $('leagueChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-league]');
    if (btn) removeLeague(btn.dataset.removeLeague);
  });

  document.querySelectorAll('th button[data-sort]').forEach((b) => {
    b.addEventListener('click', () => sortBy(b.dataset.sort));
  });
}

function start() {
  wire();
  store.set('teamId', storage.read(CONFIG.keys.teamId));
  setFilter('my');
  setView('list');

  // Each renderer subscribes only to the slices it reads.
  store.subscribe('staticData', () => { renderPrices(); renderSquad(); renderPitch(); });
  store.subscribe('gameweekData', () => { renderSquad(); renderPitch(); renderRank(); renderWhatIf(); });
  store.subscribe('liveStats', () => { renderSquad(); renderPitch(); renderRank(); renderWhatIf(); });
  store.subscribe('simulatedEvents', renderWhatIf);
  store.subscribe('entry', renderRank);
  store.subscribe('miniLeagueStandings', renderLeagues);

  renderLeagues();
  refresh();
}

start();
