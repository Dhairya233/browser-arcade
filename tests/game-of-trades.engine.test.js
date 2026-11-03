import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../games/game-of-trades/engine.js';

const COLORS = ['#c0392b', '#2c5f8a', '#ede7d9', '#d98a2b', '#3f6b3f', '#8e44ad', '#e8d24a', '#2f2f2f'];
const RES = ['wood', 'brick', 'ore', 'wheat', 'sheep'];
const players = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: COLORS[i], password: '' }));
function seeded(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
// An rng that rolls exactly the dice you ask for (two values per roll).
const dice = (...d) => { const q = d.map(x => (x - 1) / 6 + 0.01); return () => q.shift(); };

// A 3-player game already past setup, with an empty board, ready for player 0 to roll.
function turnPhase(n = 3, seed = 1) {
  const S = R.createGame(n, players(n), {}, seeded(seed));
  S.phase = 'turn'; S.currentPlayerIdx = 0; S.uiMode = 'idle';
  return S;
}
const vertex = (S, id) => S.board.vertices.find(v => v.id === id);
const give = (S, idx, res) => Object.entries(res).forEach(([r, n]) => { S.players[idx].resources[r] += n; });
const total = p => Object.values(p.resources).reduce((a, b) => a + b, 0);

test('board: 19 tiles for up to 4 players, 37 for more; standard resource mix', () => {
  const S = R.createGame(4, players(4), {}, seeded(1));
  assert.equal(S.board.tiles.length, 19);
  assert.equal(S.board.vertices.length, 54);
  assert.equal(S.board.edges.length, 72);
  const count = r => S.board.tiles.filter(t => t.resource === r).length;
  assert.deepEqual([count('wood'), count('brick'), count('ore'), count('wheat'), count('sheep'), count(null)], [4, 3, 3, 4, 4, 1]);
  assert.equal(R.createGame(6, players(6), {}, seeded(1)).board.tiles.length, 37);
});

test('the same seed gives the same game, a different seed gives a different one', () => {
  const a = R.createGame(4, players(4), {}, seeded(5)), b = R.createGame(4, players(4), {}, seeded(5)), c = R.createGame(4, players(4), {}, seeded(6));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.board.tiles.map(t => t.resource), c.board.tiles.map(t => t.resource));
});

test('red-number tiles (6 and 8) are never next to each other', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const S = R.createGame(4, players(4), {}, seeded(seed));
    const hot = new Set(S.board.tiles.filter(t => t.number === 6 || t.number === 8).map(t => t.id));
    for (const e of S.board.edges) if (e.tiles.length === 2) assert.ok(!(hot.has(e.tiles[0]) && hot.has(e.tiles[1])), `seed ${seed}`);
  }
});

test('applyAction never changes the state it was given', () => {
  const S = turnPhase();
  const before = JSON.stringify(S);
  R.applyAction(S, 'rollDice', {}, {}, dice(3, 4));
  assert.equal(JSON.stringify(S), before);
});

test('setup follows the snake order and ends with player 0 to move', () => {
  let S = R.createGame(3, players(3), {}, seeded(2));
  const seen = [];
  while (S.phase === 'setup') {
    seen.push(S.currentPlayerIdx);
    const vid = S.board.vertices.find(v => R.query.settlementSpot(S, v.id)).id;
    S = R.applyAction(S, 'clickVertexSettlement', { vertexId: vid }, {}).state;
    const eid = S.board.edges.find(e => R.query.edgeBuildable(S, e.id)).id;
    S = R.applyAction(S, 'clickEdge', { edgeId: eid }, {}).state;
  }
  assert.deepEqual(seen, [0, 1, 2, 2, 1, 0]);
  assert.equal(S.phase, 'turn');
  assert.equal(S.currentPlayerIdx, 0);
  assert.ok(S.players.every(p => total(p) > 0), 'second settlement pays out starting resources');
});

test('a roll pays settlements 1 and cities 2, and the robber blocks the tile', () => {
  const S = turnPhase();
  const tile = S.board.tiles.find(t => t.resource && !t.hasRobber);
  tile.number = 8;
  vertex(S, tile.corners[0]).building = { playerIdx: 0, type: 'settlement' };
  vertex(S, tile.corners[3]).building = { playerIdx: 1, type: 'city' };
  const r = R.applyAction(S, 'rollDice', {}, {}, dice(3, 5)).state;
  assert.equal(r.players[0].resources[tile.resource], 1);
  assert.equal(r.players[1].resources[tile.resource], 2);
  tile.hasRobber = true;
  const blocked = R.applyAction(S, 'rollDice', {}, {}, dice(3, 5)).state;
  assert.equal(total(blocked.players[0]), 0);
});

test('a seven makes players with more than 7 cards discard half, then the robber moves', () => {
  const S = turnPhase();
  give(S, 1, { wood: 3, brick: 3, ore: 3 });          // 9 cards -> must discard 4
  give(S, 2, { wood: 7 });                            // exactly 7 -> keeps all
  let r = R.applyAction(S, 'rollDice', {}, {}, dice(3, 4)).state;
  assert.equal(r.uiMode, 'discard');
  assert.deepEqual(r.turn.discardQueue, [1]);
  r = R.applyAction(r, 'doConfirmDiscard', {}, { discard: { wood: 3, brick: 1 } }).state;   // 4 cards
  assert.equal(total(r.players[1]), 5);
  assert.equal(r.uiMode, 'move-robber');
});

test('the discard boundary: 7 cards are safe, 8 cards must discard 4', () => {
  const S = turnPhase();
  give(S, 1, { wood: 4, brick: 4 });                  // 8
  give(S, 2, { ore: 4, sheep: 3 });                   // 7
  const r = R.applyAction(S, 'rollDice', {}, {}, dice(3, 4)).state;
  assert.deepEqual(r.turn.discardQueue, [1]);
});

test('a discard of the wrong size is ignored', () => {
  const S = turnPhase();
  give(S, 1, { wood: 3, brick: 3, ore: 3 });
  let r = R.applyAction(S, 'rollDice', {}, {}, dice(3, 4)).state;
  r = R.applyAction(r, 'doConfirmDiscard', {}, { discard: { wood: 1 } }).state;
  assert.equal(total(r.players[1]), 9);
  assert.equal(r.uiMode, 'discard');
});

test('bank trade rates: 4:1 normally, 3:1 with a general port, 2:1 with that resource port', () => {
  const S = turnPhase();
  assert.equal(R.query.bestRate(S, 0, 'wood'), 4);
  const v = S.board.vertices[0]; v.building = { playerIdx: 0, type: 'settlement' }; v.port = 'any';
  assert.equal(R.query.bestRate(S, 0, 'wood'), 3);
  v.port = 'wood';
  assert.equal(R.query.bestRate(S, 0, 'wood'), 2);
  assert.equal(R.query.bestRate(S, 0, 'ore'), 4);
});

test('bank trade moves the right cards at the right rate', () => {
  const S = turnPhase(); S.turn.rolled = true; S.uiMode = 'trade-bank';
  give(S, 0, { wood: 4 });
  const r = R.applyAction(S, 'confirmBankTrade', {}, { give: 'wood', get: 'ore', qty: 1 }).state;
  assert.equal(r.players[0].resources.wood, 0);
  assert.equal(r.players[0].resources.ore, 1);
});

test('longest road: a straight chain counts, and an opponent settlement in the middle cuts it', () => {
  const S = turnPhase();
  const byV = id => S.board.edges.filter(e => e.v1 === id || e.v2 === id);
  let path = null;
  for (const start of S.board.vertices) {          // find any simple 5-edge path
    const dfs = (v, used, vs) => {
      if (used.length === 5) return { used, vs };
      for (const e of byV(v)) {
        if (used.includes(e)) continue;
        const nx = e.v1 === v ? e.v2 : e.v1;
        if (vs.includes(nx)) continue;
        const r = dfs(nx, [...used, e], [...vs, nx]); if (r) return r;
      }
      return null;
    };
    path = dfs(start.id, [], [start.id]); if (path) break;
  }
  path.used.forEach(e => { e.road = 0; });
  assert.equal(R.query.longestRoad(S, 0), 5);
  vertex(S, path.vs[2]).building = { playerIdx: 1, type: 'settlement' };
  assert.equal(R.query.longestRoad(S, 0), 3);
});

test('largest army goes to the first player to play 3 knights, and is worth 2 points', () => {
  const S = turnPhase(); S.turn.rolled = true;
  S.players[0].knightsPlayed = 2;
  S.players[0].devCards = [{ id: 'k', type: 'knight' }];
  const r = R.applyAction(S, 'playDevCard', { cardId: 'k' }, {}).state;
  assert.equal(r.largestArmyHolder, 0);
  assert.equal(R.query.victoryPoints(r, 0), 2);
  assert.equal(r.uiMode, 'move-robber');
});

test('reaching 10 points, hidden victory cards included, ends the game', () => {
  const S = turnPhase(); S.turn.rolled = true;
  S.players[0].devCards = Array.from({ length: 9 }, (_, i) => ({ id: 'v' + i, type: 'vp' }));
  S.devDeck = [{ id: 'last', type: 'vp' }];
  give(S, 0, { wheat: 1, sheep: 1, ore: 1 });
  const r = R.applyAction(S, 'buyDevCard', {}, {}).state;
  assert.equal(r.phase, 'gameover');
  assert.equal(r.winner, 0);
});

test('validate: only the player whose turn it is can act, and not before rolling', () => {
  const S = turnPhase();
  assert.equal(R.validateAction(S, 0, 'rollDice', {}, {}), true);
  assert.equal(R.validateAction(S, 1, 'rollDice', {}, {}), false);
  assert.equal(R.validateAction(S, 0, 'startBuildRoad', {}, {}), false);
  assert.equal(R.validateAction(S, 0, 'endTurn', {}, {}), false);
  assert.equal(R.validateAction(S, 0, 'notAnAction', {}, {}), false);
});

test('not enough resources: the build is refused and the player is told', () => {
  const S = turnPhase(); S.turn.rolled = true; S.uiMode = 'build-settlement';
  const v = S.board.vertices[0];
  S.board.edges.find(e => e.v1 === v.id || e.v2 === v.id).road = 0;
  const r = R.applyAction(S, 'clickVertexSettlement', { vertexId: v.id }, {});
  assert.equal(r.state.board.vertices[0].building, null);
  assert.deepEqual(r.events.filter(e => e.type === 'toast').map(e => e.msg), ['Not enough resources.']);
});

test('an unknown board id throws, and the caller\'s state is untouched', () => {
  const S = turnPhase(); S.turn.rolled = true; S.uiMode = 'move-robber';
  const before = JSON.stringify(S);
  assert.throws(() => R.applyAction(S, 'clickTile', { tileId: 'nope' }, {}));
  assert.equal(JSON.stringify(S), before);
});
