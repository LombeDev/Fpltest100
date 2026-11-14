// js/analytics.js
// Pure analytics for the FPL dashboard.
//
// Every function here takes plain data and returns plain data. Nothing touches
// the DOM, the network or storage, so each function can be tested in isolation
// and reused by any view.
//
// Shared conventions:
//   element      FPL player id (number)
//   types        Map(element -> element_type: 1 GK, 2 DEF, 3 MID, 4 FWD)
//   stats        Map(element -> { total_points, minutes })   live stats for the gameweek
//   finished     Set(element) of players whose match has finished
//   chip         active chip for the entry: '3xc', 'bboost', 'freehit', 'wildcard', or null
//   picks        FPL picks: [{ element, position, is_captain, is_vice_captain }]
//                position 1-11 is the starting XI, 12-15 the bench, in FPL's order.
//   percentages  are numbers from 0 to 100 unless stated.

// ---------------------------------------------------------------------------
// 1. Effective Ownership (EO)
// ---------------------------------------------------------------------------

/**
 * Effective ownership of every player in a sample of entries.
 *
 * EO = (entries that own the player + extra captaincy weight) / sample size × 100
 *   - Each owner adds 1.
 *   - An owner who captains adds 1 more (the captain counts as 2×).
 *   - An owner who captains with Triple Captain adds 2 more (3×).
 *
 * The sample can be a mini-league, or any set of entries you have picks for
 * (for example a top-10k sample). EO can exceed 100 when captaincy is heavy.
 *
 * @param {Array<{ picks: Array<{element:number,is_captain:boolean}>, chip?: string|null }>} entries
 * @returns {Map<number, number>} element -> EO percentage, rounded to 2 decimals
 */
export function computeEO(entries) {
  const sample = entries.length;
  const weight = new Map();
  if (sample === 0) return new Map();

  for (const entry of entries) {
    const tripleCaptain = entry.chip === '3xc';
    for (const pick of entry.picks) {
      let add = 1;                                   // owns the player
      if (pick.is_captain) add += tripleCaptain ? 2 : 1;   // extra captaincy weight
      weight.set(pick.element, (weight.get(pick.element) || 0) + add);
    }
  }

  const eo = new Map();
  for (const [element, total] of weight) {
    eo.set(element, Math.round((total / sample) * 10000) / 100);
  }
  return eo;
}

// ---------------------------------------------------------------------------
// 2. Net point swing and safety score
// ---------------------------------------------------------------------------

/**
 * Net gain or loss for one player, relative to an average manager.
 *
 *   gain = (points × userMultiplier) − (points × EO / 100)
 *
 * A positive gain means the player's haul helps your rank relative to the field.
 * A negative gain means it hurts, because more managers own the player than you.
 *
 * @param {{ points:number, multiplier:number, eo:number }} p
 *        multiplier is your multiplier for the player: 0 not in XI, 1 starter, 2 captain, 3 Triple Captain.
 * @param {number} [threshold=0.5] gains within ±threshold count as 'neutral'.
 * @returns {{ gain:number, verdict:'helps'|'hurts'|'neutral' }}
 */
export function netSwing({ points, multiplier, eo }, threshold = 0.5) {
  const gain = points * multiplier - points * (eo / 100);
  const rounded = Math.round(gain * 100) / 100;
  let verdict = 'neutral';
  if (rounded > threshold) verdict = 'helps';
  else if (rounded < -threshold) verdict = 'hurts';
  return { gain: rounded, verdict };
}

/**
 * Net swing for every player in a squad, plus the squad total.
 *
 * @param {Array<{ element:number, name?:string, points:number, multiplier:number }>} squad
 * @param {Map<number, number>} eoMap element -> EO percentage (from computeEO)
 * @returns {{ players: Array, netGain: number }}
 */
export function squadSwings(squad, eoMap, threshold = 0.5) {
  const players = squad.map((p) => {
    const eo = eoMap.get(p.element) || 0;
    return { element: p.element, name: p.name || '', points: p.points, multiplier: p.multiplier, eo, ...netSwing({ points: p.points, multiplier: p.multiplier, eo }, threshold) };
  });
  const netGain = Math.round(players.reduce((sum, p) => sum + p.gain, 0) * 100) / 100;
  return { players, netGain };
}

/**
 * Safety score: the share of your squad's points that an average manager also earns.
 *
 *   safety = Σ(points_i × EO_i / 100) / Σ(points_i) × 100
 *
 * Near 100 means your points come from popular players, so you are close to the field.
 * Near 0 means your points come from differentials, so you are far from the field.
 * Points are the raw, unmultiplied points of each player in your XI.
 *
 * @param {Array<{ element:number, points:number }>} xi starters only
 * @param {Map<number, number>} eoMap
 * @returns {number|null} 0 to 100, or null when no points have been scored yet
 */
export function safetyScore(xi, eoMap) {
  const total = xi.reduce((sum, p) => sum + p.points, 0);
  if (total <= 0) return null;
  const shared = xi.reduce((sum, p) => sum + p.points * Math.min((eoMap.get(p.element) || 0) / 100, 1), 0);
  return Math.round((shared / total) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// 3. Automatic substitutions, captaincy fallback and live entry points
// ---------------------------------------------------------------------------

/**
 * True when a starting XI (as element ids) has a legal FPL formation:
 * 11 players, one goalkeeper, 3 to 5 defenders, 2 to 5 midfielders, 1 to 3 forwards.
 *
 * @param {number[]} ids
 * @param {Map<number, number>} types
 */
export function validFormation(ids, types) {
  if (ids.length !== 11) return false;
  const count = (t) => ids.filter((id) => types.get(id) === t).length;
  const gk = count(1);
  const def = count(2);
  const mid = count(3);
  const fwd = count(4);
  return gk === 1 && def >= 3 && def <= 5 && mid >= 2 && mid <= 5 && fwd >= 1 && fwd <= 3;
}

/**
 * Live points for one entry, with FPL's automatic substitutions and captaincy fallback.
 *
 * Automatic substitutions (FPL rules, applied in squad order):
 *   - A starter is replaced only if their match has finished and they recorded 0 minutes.
 *   - Goalkeepers are replaced only by the bench goalkeeper.
 *   - Outfield players are replaced by the first bench outfield player, in order, who
 *     played and keeps a legal formation.
 *   - Bench Boost: every squad player counts, so no substitutions are made.
 *
 * Captaincy fallback:
 *   - If the captain's match has finished and they did not play, the vice-captain
 *     takes the captain's multiplier, provided the vice-captain played.
 *
 * Multipliers: captain 2×, or 3× with Triple Captain. Everyone else in the XI 1×.
 * Bench players score 0 unless Bench Boost is active.
 *
 * @returns {{ points:number, captain:number|null, subs:Array<{out:number,in:number}>,
 *             breakdown:Array<{element:number,points:number,multiplier:number}> }}
 */
export function liveEntryPoints({ picks, stats, finished, types, chip = null }) {
  const played = (id) => ((stats.get(id) || {}).minutes || 0) > 0;
  const pts = (id) => (stats.get(id) || {}).total_points || 0;

  const ordered = [...picks].sort((a, b) => a.position - b.position);
  const xi = ordered.filter((p) => p.position <= 11).map((p) => p.element);
  const bench = ordered.filter((p) => p.position > 11).map((p) => p.element);
  const captain = (ordered.find((p) => p.is_captain) || {}).element ?? null;
  const vice = (ordered.find((p) => p.is_vice_captain) || {}).element ?? null;

  let lineup = [...xi];
  const subs = [];

  if (chip === 'bboost') {
    lineup = [...xi, ...bench];
  } else {
    const used = new Set();
    for (const out of xi) {
      if (!finished.has(out) || played(out)) continue;   // only sub players who finished with 0 minutes
      const isGoalkeeper = types.get(out) === 1;
      const cand = bench.find((b) =>
        !used.has(b) &&
        played(b) &&
        (types.get(b) === 1) === isGoalkeeper &&
        validFormation(lineup.map((id) => (id === out ? b : id)), types)
      );
      if (cand !== undefined) {
        lineup = lineup.map((id) => (id === out ? cand : id));
        used.add(cand);
        subs.push({ out, in: cand });
      }
    }
  }

  // Captaincy fallback: the vice-captain takes over only if the captain has finished and did not play.
  let effectiveCaptain = captain;
  const captainFailed = captain !== null && finished.has(captain) && !played(captain);
  if (captainFailed) {
    effectiveCaptain = vice !== null && lineup.includes(vice) && played(vice) ? vice : null;
  }

  const triple = chip === '3xc';
  const breakdown = lineup.map((id) => {
    const multiplier = id === effectiveCaptain ? (triple ? 3 : 2) : 1;
    return { element: id, points: pts(id) * multiplier, multiplier };
  });
  const points = breakdown.reduce((sum, b) => sum + b.points, 0);

  return { points, captain: effectiveCaptain, subs, breakdown };
}

// ---------------------------------------------------------------------------
// 4. Live mini-league re-ranking
// ---------------------------------------------------------------------------

/**
 * Movement arrow for a rank change. Positive places means the manager went up.
 * @param {number} places
 * @returns {'▲'|'▼'|'—'}
 */
export function movementArrow(places) {
  if (places > 0) return '▲';
  if (places < 0) return '▼';
  return '—';
}

/**
 * Re-rank a mini-league using live points for the current gameweek.
 *
 * Each row's base total is `total − event_total` (points before this gameweek).
 * The live total is that base plus the entry's live gameweek points. Entries with
 * no live points supplied keep their published event_total.
 *
 * Ties are broken by the static rank, so the order is stable.
 *
 * @param {Array<{ entry:number, entry_name:string, player_name?:string,
 *                 rank?:number, total:number, event_total?:number }>} results
 *        the `standings.results` array from leagues-classic/{id}/standings
 * @param {Map<number, number>} liveByEntry entry -> live gameweek points (from liveEntryPoints)
 * @returns {Array<{ entry:number, name:string, manager:string, staticRank:number,
 *                   liveRank:number, liveTotal:number, gwPoints:number,
 *                   places:number, arrow:'▲'|'▼'|'—', direction:'up'|'down'|'same' }>}
 */
export function reRankLeague(results, liveByEntry) {
  const rows = results.map((r, i) => {
    const base = r.total - (r.event_total || 0);
    const gwPoints = liveByEntry.has(r.entry) ? liveByEntry.get(r.entry) : (r.event_total || 0);
    return {
      entry: r.entry,
      name: r.entry_name,
      manager: r.player_name || '',
      staticRank: r.rank ?? i + 1,
      liveTotal: base + gwPoints,
      gwPoints,
    };
  });

  rows.sort((a, b) => (b.liveTotal - a.liveTotal) || (a.staticRank - b.staticRank));

  rows.forEach((row, i) => {
    const liveRank = i + 1;
    const places = row.staticRank - liveRank;   // positive: moved up
    row.liveRank = liveRank;
    row.places = places;
    row.arrow = movementArrow(places);
    row.direction = places > 0 ? 'up' : places < 0 ? 'down' : 'same';
  });

  return rows;
}
