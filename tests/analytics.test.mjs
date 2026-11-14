// Run with: node tests/analytics.test.mjs   (Node 18+, no dependencies)
import assert from 'node:assert/strict';
import {
  computeEO, netSwing, squadSwings, safetyScore, validFormation,
  liveEntryPoints, reRankLeague, movementArrow,
} from '../js/analytics.js';

const pick = (element, position, extra = {}) => ({ element, position, is_captain: false, is_vice_captain: false, ...extra });
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

// ---- 1. EO ----------------------------------------------------------------
test('EO counts ownership and captaincy', () => {
  // 4 entries. Player 1 owned by 2, captained by 1 (regular captain: +1). EO = (2 + 1) / 4 = 75
  const entries = [
    { picks: [pick(1, 1, { is_captain: true })] },
    { picks: [pick(1, 2)] },
    { picks: [pick(2, 1)] },
    { picks: [pick(3, 1)] },
  ];
  const eo = computeEO(entries);
  assert.equal(eo.get(1), 75);
  assert.equal(eo.get(2), 25);
  assert.equal(eo.get(3), 25);
});

test('EO gives Triple Captain 3x weight', () => {
  // Entry A owns player 9, triples as captain: 1 + 2 = 3. Entry B owns 9: 1. Sample 2: EO = 200
  const eo = computeEO([
    { chip: '3xc', picks: [pick(9, 1, { is_captain: true })] },
    { chip: null, picks: [pick(9, 1)] },
  ]);
  assert.equal(eo.get(9), 200);
});

test('EO on an empty sample is empty', () => {
  assert.equal(computeEO([]).size, 0);
});

// ---- 2. Net swing and safety ----------------------------------------------
test('net swing matches the formula: pts × multiplier − pts × EO/100', () => {
  // 10 pts, captain (2×), EO 40 → 20 − 4 = 16 → helps
  assert.deepEqual(netSwing({ points: 10, multiplier: 2, eo: 40 }), { gain: 16, verdict: 'helps' });
  // 10 pts, not in XI (0×), EO 80 → 0 − 8 = −8 → hurts
  assert.deepEqual(netSwing({ points: 10, multiplier: 0, eo: 80 }), { gain: -8, verdict: 'hurts' });
  // 1 pt, starter, EO 0 → gain 1 → helps; 0 pts → neutral
  assert.equal(netSwing({ points: 0, multiplier: 1, eo: 50 }).verdict, 'neutral');
});

test('squad swings total the individual gains', () => {
  const eo = new Map([[1, 50], [2, 10]]);
  const { players, netGain } = squadSwings(
    [{ element: 1, points: 6, multiplier: 1 }, { element: 2, points: 8, multiplier: 2 }], eo);
  assert.equal(players[0].gain, 3);      // 6 − 3
  assert.equal(players[1].gain, 15.2);   // 8 × 2 − 8 × 10%  = 16 − 0.8
  assert.equal(netGain, 18.2);
});

test('safety score is the share of points an average manager also earns', () => {
  const eo = new Map([[1, 100], [2, 0]]);
  // 6 pts from a 100% owned player and 4 pts from a 0% owned player → 6/10 = 60
  assert.equal(safetyScore([{ element: 1, points: 6 }, { element: 2, points: 4 }], eo), 60);
  assert.equal(safetyScore([{ element: 2, points: 0 }], eo), null);
});

// ---- Formation ------------------------------------------------------------
const types = new Map([[1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [7, 3], [8, 3], [9, 4], [10, 4], [11, 4], [12, 1], [13, 2], [14, 3], [15, 4]]);

test('formation check enforces FPL rules', () => {
  assert.equal(validFormation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], types), true);   // 1-4-4-2
  assert.equal(validFormation([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12], types), false); // 3 DEF, 4 MID... 12 is GK → two GKs
  assert.equal(validFormation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], types), false);       // 10 players
});

// ---- 3. Automatic substitutions and captaincy -----------------------------
const finished = (...ids) => new Set(ids);
const stats = (rows) => new Map(rows.map(([id, minutes, total_points]) => [id, { minutes, total_points }]));

test('an outfield starter with 0 minutes after finishing is replaced by a bench player who played', () => {
  // XI: GK1, DEF 2,3,4 (def 3), MID 5,6,7,8, FWD 9,10. Starter 2 (DEF) did not play, match finished.
  // Bench 13 (DEF) played: 1-4-4-2 → 1-3... swapping DEF for DEF keeps formation.
  const picks = [
    pick(1, 1), pick(2, 2), pick(3, 3), pick(4, 4), pick(5, 5), pick(6, 6),
    pick(7, 7), pick(8, 8), pick(9, 9, { is_captain: true }), pick(10, 10), pick(11, 11),
    pick(12, 12), pick(13, 13, {}), pick(14, 14), pick(15, 15),
  ];
  const s = stats([[1, 90, 2], [2, 0, 0], [3, 90, 3], [4, 90, 2], [5, 90, 1], [6, 90, 1], [7, 90, 1], [8, 90, 1], [9, 90, 8], [10, 90, 1], [11, 90, 1], [12, 0, 0], [13, 90, 6], [14, 0, 0], [15, 0, 0]]);
  const r = liveEntryPoints({ picks, stats: s, finished: finished(2), types, chip: null });
  assert.deepEqual(r.subs, [{ out: 2, in: 13 }]);
  assert.equal(r.points, 2 + 3 + 2 + 1 + 1 + 1 + 1 + 16 + 1 + 1 + 6 - 0); // captain 9 doubled to 16, sub 13 counts
});

test('a sub is not made while the starter’s match is still running', () => {
  const picks = [pick(1, 1), pick(2, 2), pick(3, 2), pick(4, 2), pick(5, 3), pick(6, 3), pick(7, 3), pick(8, 3), pick(9, 4), pick(10, 4), pick(11, 4), pick(12, 1), pick(13, 2)];
  const s = stats([[2, 0, 0], [13, 90, 4]]);
  const r = liveEntryPoints({ picks, stats: s, finished: finished(), types, chip: null });
  assert.deepEqual(r.subs, []);
});

test('a substitution that would break the formation is skipped', () => {
  // 3-5-2 starting XI. Only a midfielder is on the bench, so a defender can't be replaced.
  const picks = [pick(1, 1), pick(2, 2), pick(3, 2), pick(4, 2), pick(5, 3), pick(6, 3), pick(7, 3), pick(8, 3), pick(9, 3), pick(10, 4), pick(11, 4), pick(12, 1), pick(14, 3)];
  const s = stats([[3, 0, 0], [14, 90, 5]]);
  const r = liveEntryPoints({ picks, stats: s, finished: finished(3), types, chip: null });
  assert.deepEqual(r.subs, []);
});

test('the vice-captain takes the captaincy when the captain did not play and has finished', () => {
  const picks = [pick(1, 1), pick(2, 2), pick(3, 2), pick(4, 2), pick(5, 3), pick(6, 3), pick(7, 3), pick(8, 3), pick(9, 4, { is_captain: true }), pick(10, 4, { is_vice_captain: true }), pick(11, 4), pick(12, 1), pick(13, 2)];
  const s = stats([[9, 0, 0], [10, 90, 4], [1, 90, 0]]);
  const r = liveEntryPoints({ picks, stats: s, finished: finished(9), types, chip: null });
  assert.equal(r.captain, 10);
  assert.equal(r.points, 8);   // vice scores 4 × 2
});

test('Triple Captain makes the captain 3×', () => {
  const picks = [pick(1, 1), pick(2, 2), pick(3, 2), pick(4, 2), pick(5, 3), pick(6, 3), pick(7, 3), pick(8, 3), pick(9, 4, { is_captain: true }), pick(10, 4), pick(11, 4), pick(12, 1), pick(13, 2)];
  const s = stats([[9, 90, 5], [1, 90, 0]]);
  const r = liveEntryPoints({ picks, stats: s, finished: finished(), types, chip: '3xc' });
  assert.equal(r.breakdown.find((b) => b.element === 9).points, 15);
});

test('Bench Boost counts the bench and makes no substitutions', () => {
  const picks = [pick(1, 1), pick(2, 2), pick(3, 2), pick(4, 2), pick(5, 3), pick(6, 3), pick(7, 3), pick(8, 3), pick(9, 4), pick(10, 4), pick(11, 4), pick(12, 1), pick(13, 2, { }) ];
  const s = stats([[13, 90, 3], [12, 0, 0]]);
  const r = liveEntryPoints({ picks, stats: s, finished: finished(2), types, chip: 'bboost' });
  assert.deepEqual(r.subs, []);
  assert.equal(r.points, 3);
});

// ---- 4. Live re-ranking ---------------------------------------------------
test('re-ranker sorts by live total and reports movement arrows', () => {
  const results = [
    { entry: 1, entry_name: 'Alpha', player_name: 'A', rank: 1, total: 500, event_total: 50 },   // base 450
    { entry: 2, entry_name: 'Bravo', player_name: 'B', rank: 2, total: 490, event_total: 40 },   // base 450
    { entry: 3, entry_name: 'Charlie', player_name: 'C', rank: 3, total: 480, event_total: 30 }, // base 450
  ];
  // Live gameweek points: Charlie 90, Bravo 45, Alpha 40
  const rows = reRankLeague(results, new Map([[1, 40], [2, 45], [3, 90]]));
  assert.deepEqual(rows.map((r) => r.name), ['Charlie', 'Bravo', 'Alpha']);
  assert.equal(rows[0].arrow, '▲');       // was 3rd, now 1st → up 2
  assert.equal(rows[0].places, 2);
  assert.equal(rows[2].arrow, '▼');       // was 1st, now 3rd → down 2
  assert.equal(rows[1].arrow, '—');       // was 2nd, now 2nd → same
});

test('entries without live points keep their published event total', () => {
  const rows = reRankLeague(
    [{ entry: 7, entry_name: 'Solo', rank: 1, total: 100, event_total: 20 }],
    new Map());
  assert.equal(rows[0].liveTotal, 100);
  assert.equal(rows[0].gwPoints, 20);
});

test('movement arrow symbols', () => {
  assert.equal(movementArrow(3), '▲');
  assert.equal(movementArrow(-1), '▼');
  assert.equal(movementArrow(0), '—');
});

console.log(`\n${passed} tests passed`);
