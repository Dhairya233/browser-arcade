// Longest Road and Largest Army: branching, loops, cuts, ties and hand-overs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../games/game-of-trades/engine.js';

const COLORS = ['#c0392b', '#2c5f8a', '#ede7d9', '#d98a2b', '#3f6b3f', '#8e44ad', '#e8d24a', '#2f2f2f'];
const players = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: COLORS[i], password: '' }));
function seeded(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function turnPhase(n = 3) {
  const S = R.createGame(n, players(n), {}, seeded(1));
  S.phase = 'turn'; S.currentPlayerIdx = 0; S.uiMode = 'idle'; S.turn.rolled = true;
  return S;
}

/* ---- helpers to lay roads on the board without playing the setup ---- */
const edgesAt = (S, v) => S.board.edges.filter(e => e.v1 === v || e.v2 === v);
const other = (e, v) => (e.v1 === v ? e.v2 : e.v1);
// A simple path of `len` edges that uses none of `avoidEdges` and none of `avoidVerts`.
function findPath(S, len, avoidEdges = new Set(), avoidVerts = new Set()) {
  for (const start of S.board.vertices) {
    if (avoidVerts.has(start.id)) continue;
    const walk = (v, used, vs) => {
      if (used.length === len) return { edges: used, verts: vs };
      for (const e of edgesAt(S, v)) {
        const nx = other(e, v);
        if (avoidEdges.has(e.id) || used.includes(e) || vs.includes(nx) || avoidVerts.has(nx)) continue;
        const r = walk(nx, [...used, e], [...vs, nx]); if (r) return r;
      }
      return null;
    };
    const r = walk(start.id, [], [start.id]); if (r) return r;
  }
  throw new Error('no path of length ' + len);
}
const lay = (S, who, path) => path.edges.forEach(e => { e.road = who; });
// Lay a chain for `who` that shares no edge or vertex with anything already laid.
function layApart(S, who, len, taken) {
  const p = findPath(S, len, new Set(), taken.verts);
  lay(S, who, p); p.verts.forEach(v => taken.verts.add(v));
  return p;
}
const newTaken = () => ({ verts: new Set() });
// Make player `who` build one harmless extra road, which makes the engine re-count everyone's roads.
// The road only extends their network (it never closes a loop), so it cannot change what the test set up.
function triggerRecount(S, who = 0) {
  S.currentPlayerIdx = who; S.turn.freeRoads = 1; S.uiMode = 'build-road';
  const net = new Set();
  S.board.edges.forEach(e => { if (e.road === who) { net.add(e.v1); net.add(e.v2); } });
  const free = S.board.edges.find(e => e.road == null && R.query.edgeBuildable(S, e.id) && (net.has(e.v1) !== net.has(e.v2)));
  assert.ok(free, 'a buildable extending edge exists for player ' + who);
  return R.applyAction(S, 'clickEdge', { edgeId: free.id }, {}).state;
}

test('longest road follows the single longest path, not the total number of roads (a Y shape)', () => {
  const S = turnPhase();
  const hub = S.board.vertices.find(v => edgesAt(S, v.id).length >= 3).id;
  const used = new Set();
  const arms = edgesAt(S, hub).slice(0, 3);
  for (const first of arms) {
    first.road = 0; used.add(first.id);
    const mid = other(first, hub);
    const next = edgesAt(S, mid).find(e => e !== first && e.road == null && other(e, mid) !== hub);
    next.road = 0;
  }
  assert.equal(S.board.edges.filter(e => e.road === 0).length, 6);
  assert.equal(R.query.longestRoad(S, 0), 4, 'two arms of two, not all six');
});

test('a closed loop counts every road in it', () => {
  const S = turnPhase();
  // find a 6-cycle
  let cycle = null;
  for (const start of S.board.vertices) {
    const walk = (v, used, vs) => {
      if (used.length === 6) { const last = used[5]; return other(last, v) === start.id ? null : null; }
      for (const e of edgesAt(S, v)) {
        if (used.includes(e)) continue;
        const nx = other(e, v);
        if (used.length === 5 && nx === start.id) return [...used, e];
        if (vs.includes(nx) || used.length === 5) continue;
        const r = walk(nx, [...used, e], [...vs, nx]); if (r) return r;
      }
      return null;
    };
    cycle = walk(start.id, [], [start.id]); if (cycle) break;
  }
  assert.ok(cycle && cycle.length === 6);
  cycle.forEach(e => { e.road = 0; });
  assert.equal(R.query.longestRoad(S, 0), 6);
});

test('your own settlement does not cut your road; an opponent\'s does', () => {
  const S = turnPhase();
  const p = findPath(S, 5); lay(S, 0, p);
  const mid = S.board.vertices.find(v => v.id === p.verts[2]);
  mid.building = { playerIdx: 0, type: 'settlement' };
  assert.equal(R.query.longestRoad(S, 0), 5);
  mid.building = { playerIdx: 1, type: 'settlement' };
  assert.equal(R.query.longestRoad(S, 0), 3);
});

test('a road of 4 earns nothing; the fifth road takes the title and is worth 2 points', () => {
  const S = turnPhase();
  const p = findPath(S, 5);
  p.edges.slice(0, 3).forEach(e => { e.road = 0; });
  let r = triggerRecount(S);                     // the recount's own road makes it 4 at most
  assert.ok(R.query.longestRoad(r, 0) <= 4);
  assert.equal(r.longestRoadHolder, null);
  const S2 = turnPhase(); lay(S2, 0, findPath(S2, 5));
  r = triggerRecount(S2);
  assert.equal(r.longestRoadHolder, 0);
  assert.equal(R.query.victoryPoints(r, 0), 2);
});

test('a longer road takes the title; an equal one does not', () => {
  const S = turnPhase(); const taken = newTaken();
  layApart(S, 0, 5, taken);
  layApart(S, 1, 5, taken);
  layApart(S, 2, 1, taken);
  S.longestRoadHolder = 0;
  assert.equal(triggerRecount(S, 2).longestRoadHolder, 0, 'a tie leaves the holder where they are');

  const T = turnPhase(); const t2 = newTaken();
  layApart(T, 0, 5, t2);
  layApart(T, 1, 6, t2);
  layApart(T, 2, 1, t2);
  T.longestRoadHolder = 0;
  assert.equal(triggerRecount(T, 2).longestRoadHolder, 1, 'a longer road takes it');
});

test('N12: when the holder\'s road is cut and two others tie, nobody holds the title', () => {
  const S = turnPhase(); const taken = newTaken();
  const mine = layApart(S, 0, 5, taken);
  layApart(S, 1, 6, taken);
  layApart(S, 2, 6, taken);
  S.longestRoadHolder = 0;
  // player 1 now has a settlement in the middle of player 0's road
  S.board.vertices.find(v => v.id === mine.verts[2]).building = { playerIdx: 1, type: 'settlement' };
  const r = triggerRecount(S);
  assert.equal(r.longestRoadHolder, null, 'no one wins a tie for a title nobody holds');
  assert.equal(R.query.victoryPoints(r, 1), 1, 'only the settlement is worth points');
  assert.equal(R.query.victoryPoints(r, 2), 0);
});

test('when the holder\'s road is cut and one other player is clearly longest, they take it', () => {
  const S = turnPhase(); const taken = newTaken();
  const mine = layApart(S, 0, 5, taken);
  layApart(S, 1, 7, taken);
  layApart(S, 2, 6, taken);
  S.longestRoadHolder = 0;
  S.board.vertices.find(v => v.id === mine.verts[2]).building = { playerIdx: 2, type: 'settlement' };
  assert.equal(triggerRecount(S).longestRoadHolder, 1);
});

test('when the holder is cut but still among the longest, they keep it', () => {
  const S = turnPhase(); const taken = newTaken();
  const mine = layApart(S, 0, 7, taken);        // cutting near an end leaves 5 or more
  layApart(S, 1, 5, taken);
  S.longestRoadHolder = 0;
  S.board.vertices.find(v => v.id === mine.verts[1]).building = { playerIdx: 2, type: 'settlement' };
  const r = triggerRecount(S);
  assert.ok(R.query.longestRoad(r, 0) >= 5);
  assert.equal(r.longestRoadHolder, 0);
});

/* ---- Largest Army ---- */

function armyGame(holderKnights, challengerKnights) {
  const S = turnPhase();
  S.players[0].knightsPlayed = holderKnights; S.largestArmyHolder = holderKnights >= 3 ? 0 : null;
  S.currentPlayerIdx = 1;
  S.players[1].knightsPlayed = challengerKnights;
  S.players[1].devCards = [{ id: 'k', type: 'knight' }];
  return S;
}

test('largest army: matching the holder\'s count does not take it, beating it does', () => {
  let r = R.applyAction(armyGame(3, 2), 'playDevCard', { cardId: 'k' }, {}).state;
  assert.equal(r.players[1].knightsPlayed, 3);
  assert.equal(r.largestArmyHolder, 0, 'tie: the holder keeps it');
  r = R.applyAction(armyGame(3, 3), 'playDevCard', { cardId: 'k' }, {}).state;
  assert.equal(r.largestArmyHolder, 1, 'four beats three');
  assert.equal(R.query.victoryPoints(r, 0), 0);
  assert.equal(R.query.victoryPoints(r, 1), 2);
});

test('largest army: two knights is not enough', () => {
  const r = R.applyAction(armyGame(0, 1), 'playDevCard', { cardId: 'k' }, {}).state;
  assert.equal(r.players[1].knightsPlayed, 2);
  assert.equal(r.largestArmyHolder, null);
});
