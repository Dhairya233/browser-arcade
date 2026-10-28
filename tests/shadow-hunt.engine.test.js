import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../games/shadow-hunt/engine.js';

const map = E.buildMap(E.seededRand(42));

// A started 4-player game: player 0 is the fugitive.
function started(positions = [7, 3, 20, 33]) {
  let g = E.newGame(['X', 'A', 'B', 'C'], 24);
  positions.forEach((pos, i) => { g = E.applyAction(g, map, { cmd: 'startPick', playerIdx: i, pos }).state; });
  return g;
}

test('map: 45 stations, edge counts, one connected component', () => {
  const count = t => map.edges.filter(e => e.type === t).length;
  assert.equal(map.stations.length, 45);
  assert.deepEqual([count('taxi'), count('bus'), count('underground')], [79, 103, 33]);
  const seen = new Set([0]); const stack = [0];
  while (stack.length) for (const n of map.adj[stack.pop()]) if (!seen.has(n.to)) { seen.add(n.to); stack.push(n.to); }
  assert.equal(seen.size, 45);
});

test('map: the same seed always gives the same map', () => {
  assert.deepEqual(E.buildMap(E.seededRand(42)), map);
});

test('applyAction never changes the state it was given', () => {
  const g = started();
  const before = JSON.stringify(g);
  const m = E.validMoves(g, map, 0)[0];
  E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type });
  assert.equal(JSON.stringify(g), before);
});

test('setup ends once every player has picked a start', () => {
  const g = started();
  assert.equal(g.startingPhase, false);
  assert.equal('startPickIdx' in g, false);
});

test('a detective ticket is handed to the fugitive', () => {
  let g = started();
  const x = E.validMoves(g, map, 0)[0];
  g = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: x.to, type: x.type }).state;
  const d = E.validMoves(g, map, 1).find(o => o.to !== g.players[0].pos);
  const xTaxi = g.players[0].tickets[d.type], dTickets = g.players[1].tickets[d.type];
  g = E.applyAction(g, map, { cmd: 'move', playerIdx: 1, to: d.to, type: d.type }).state;
  assert.equal(g.players[1].tickets[d.type], dTickets - 1);
  assert.equal(g.players[0].tickets[d.type], xTaxi + 1);
});

test('turn order: fugitive first, then detectives, then the round counter moves on', () => {
  let g = started();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(g.turn);
    const m = E.validMoves(g, map, g.turn - 1).find(o => !g.players.some(p => p.pos === o.to));
    g = E.applyAction(g, map, { cmd: 'move', playerIdx: g.turn - 1, to: m.to, type: m.type }).state;
  }
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.equal(g.round, 2);
  assert.equal(g.turn, 1);
});

test('reveal rounds expose the fugitive for that round only', () => {
  const g = started();
  g.round = 3;
  const m = E.validMoves(g, map, 0)[0];
  let r = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type });
  assert.equal(r.state.phantomVisible, true);
  assert.equal(r.state.players[0].revealedPos, m.to);
  const g2 = started(); g2.round = 4;
  r = E.applyAction(g2, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type });
  assert.equal(r.state.phantomVisible, false);
  assert.equal(r.state.players[0].revealedPos, null);
});

test('a detective landing on the fugitive wins the game for the detectives', () => {
  let g = started();
  const target = E.validMoves(g, map, 1)[0];
  g.players[0].pos = target.to;
  g.turn = 2;
  const r = E.applyAction(g, map, { cmd: 'move', playerIdx: 1, to: target.to, type: target.type });
  assert.equal(r.state.gameOver, true);
  assert.equal(r.state.winner, 'detectives');
  assert.equal(r.turnAdvanced, true);
});

test('surviving every round makes the fugitive win', () => {
  const g = started(); g.maxRounds = 1;
  let s = g;
  while (!s.gameOver) {
    const idx = s.turn - 1;
    const m = E.validMoves(s, map, idx).find(o => !s.players.some((p, i) => i !== idx && p.pos === o.to));
    s = E.applyAction(s, map, { cmd: 'move', playerIdx: idx, to: m.to, type: m.type }).state;
  }
  assert.equal(s.winner, 'phantom');
});

test('double move: two fugitive moves in one turn, one double ticket spent', () => {
  let g = started();
  g = E.applyAction(g, map, { cmd: 'startDouble' }).state;
  const m1 = E.validMoves(g, map, 0)[0];
  let r = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m1.to, type: m1.type });
  assert.equal(r.turnAdvanced, false);
  assert.equal(r.state.turn, 1);
  assert.equal(r.state.players[0].tickets.double, 1);
  const m2 = E.validMoves(r.state, map, 0)[0];
  r = E.applyAction(r.state, map, { cmd: 'move', playerIdx: 0, to: m2.to, type: m2.type });
  assert.equal(r.turnAdvanced, true);
  assert.equal(r.state.turn, 2);
});

test('black ticket hides the transport type in the history but spends a black ticket', () => {
  const g = started();
  const m = E.validMoves(g, map, 0)[0];
  const r = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type, isBlack: true });
  assert.equal(r.state.players[0].tickets.black, 4);
  assert.equal(r.state.phantomHistory.at(-1).type, 'black');
});

test('a detective cannot move onto another detective, or with a ticket type they have run out of', () => {
  const g = started();
  const nb = map.adj[g.players[1].pos][0];
  g.players[2].pos = nb.to;
  assert.equal(E.validMoves(g, map, 1).some(o => o.to === nb.to), false);
  g.players[1].tickets.taxi = 0;
  assert.equal(E.validMoves(g, map, 1).some(o => o.type === 'taxi'), false);
});

test('an unknown action is reported as not handled and changes nothing', () => {
  const g = started();
  const r = E.applyAction(g, map, { cmd: 'nonsense' });
  assert.equal(r.handled, false);
  assert.equal(r.state, g);
});
