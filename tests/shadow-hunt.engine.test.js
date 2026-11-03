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

/* ---------- more rules ---------- */

test('exactly rounds 3, 8, 13, 18 and 24 are reveal rounds', () => {
  const revealed = Array.from({ length: 30 }, (_, i) => i + 1).filter(E.isRevealRound);
  assert.deepEqual(revealed, [3, 8, 13, 18, 24]);
  assert.deepEqual(E.REVEAL_ROUNDS, [3, 8, 13, 18, 24]);
});

test('on every reveal round the fugitive is shown, and on every other round he is not', () => {
  for (let round = 1; round <= 24; round++) {
    const g = started(); g.round = round;
    const m = E.validMoves(g, map, 0)[0];
    const r = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type }).state;
    assert.equal(r.phantomVisible, E.REVEAL_ROUNDS.includes(round), 'round ' + round);
    assert.equal(r.players[0].revealedPos, E.REVEAL_ROUNDS.includes(round) ? m.to : null, 'round ' + round);
  }
});

test('a black ticket on a reveal round still shows where he ended up, but not how he got there', () => {
  const g = started(); g.round = 8;
  const m = E.validMoves(g, map, 0)[0];
  const s = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type, isBlack: true }).state;
  assert.equal(s.phantomVisible, true);
  assert.equal(s.players[0].revealedPos, m.to);
  assert.equal(s.phantomHistory.at(-1).type, 'black');
  assert.equal(s.players[0].tickets.black, 4);
});

test('a double move across a reveal round: only the leg made in that round is shown', () => {
  let g = started(); g.round = 3;
  g = E.applyAction(g, map, { cmd: 'startDouble' }).state;
  const m1 = E.validMoves(g, map, 0)[0];
  g = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m1.to, type: m1.type }).state;
  assert.equal(g.turn, 1, 'still his turn');
  assert.equal(g.players[0].revealedPos, m1.to);
  const m2 = E.validMoves(g, map, 0).find(o => o.to !== m1.to);
  g = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m2.to, type: m2.type }).state;
  assert.equal(g.players[0].revealedPos, m2.to, 'the second leg of the same round is a reveal too');
  assert.equal(g.players[0].tickets.double, 1);
});

test('the fugitive can never be boxed in: every station has more neighbours than there are detectives', () => {
  const minNeighbours = Math.min(...map.adj.map(a => new Set(a.map(o => o.to)).size));
  assert.ok(minNeighbours > 5, 'fewest neighbours is ' + minNeighbours + ' but there can be 5 detectives');
});

test('a detective with no legal move forfeits and play passes on', () => {
  const g = started();
  g.round = 2; g.turn = 1;
  g.players[1].tickets = { taxi: 0, bus: 0, underground: 0 };      // detective A is out of tickets
  const m = E.validMoves(g, map, 0).find(o => !g.players.some(p => p.pos === o.to));
  const r = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type }).state;
  assert.equal(r.turn, 3, 'A is skipped and B is up');
  assert.ok(r.log.some(l => l.includes('forfeits')));
  assert.equal(r.gameOver, false);
});

test('if every detective is stuck the fugitive wins', () => {
  const g = started();
  g.players.forEach((p, i) => { if (i > 0) p.tickets = { taxi: 0, bus: 0, underground: 0 }; });
  const m = E.validMoves(g, map, 0).find(o => !g.players.some(p => p.pos === o.to));
  const r = E.applyAction(g, map, { cmd: 'move', playerIdx: 0, to: m.to, type: m.type });
  assert.equal(r.state.gameOver, true);
  assert.equal(r.state.winner, 'phantom');
  assert.equal(r.turnAdvanced, true);
});

test('ticket accounting: a detective\'s ticket is spent and handed to the fugitive, nothing else changes', () => {
  const g = started(); g.turn = 2;
  const before = JSON.parse(JSON.stringify(g));
  const m = E.validMoves(g, map, 1)[0];
  const r = E.applyAction(g, map, { cmd: 'move', playerIdx: 1, to: m.to, type: m.type }).state;
  for (const t of ['taxi', 'bus', 'underground']) {
    assert.equal(r.players[1].tickets[t], before.players[1].tickets[t] - (t === m.type ? 1 : 0));
    assert.equal(r.players[0].tickets[t], before.players[0].tickets[t] + (t === m.type ? 1 : 0));
  }
  assert.equal(r.players[0].tickets.black, 5);
  assert.equal(r.players[0].tickets.double, 2);
  assert.equal(r.players[2].tickets.taxi, before.players[2].tickets.taxi);
});

test('a detective who starts on the fugitive\'s square wins at once (pass-and-play start)', () => {
  let g = E.newGame(['X', 'A', 'B'], 24);
  g = E.pickStartLocal(g, 9);
  g = E.pickStartLocal(g, 9);        // detective A picks the same station
  g = E.pickStartLocal(g, 15);
  assert.equal(g.startingPhase, false);
  const r = E.checkStartCollision(g, map);
  assert.equal(r.gameOver, true);
  assert.equal(r.winner, 'detectives');
  assert.equal(E.checkStartCollision(E.pickStartLocal(E.pickStartLocal(E.pickStartLocal(E.newGame(['X', 'A', 'B'], 24), 9), 10), 15), map).gameOver, false);
});

test('graph: every station can reach every other, and taxi links alone already connect the map', () => {
  const comps = types => {
    const seen = new Set(); let n = 0;
    for (const s of map.stations) {
      if (seen.has(s.id)) continue; n++;
      const stack = [s.id];
      while (stack.length) {
        const v = stack.pop(); if (seen.has(v)) continue; seen.add(v);
        map.adj[v].filter(o => types.includes(o.type)).forEach(o => stack.push(o.to));
      }
    }
    return n;
  };
  assert.equal(comps(['taxi', 'bus', 'underground']), 1);
  assert.equal(comps(['taxi']), 1, 'a player who only has taxi tickets can still reach everywhere');
});

test('edges are two-way: if A links to B by a type, B links to A by the same type', () => {
  for (const s of map.stations) {
    for (const o of map.adj[s.id]) assert.ok(map.adj[o.to].some(b => b.to === s.id && b.type === o.type));
  }
});

test('the game lasts exactly the chosen number of rounds, no more and no fewer', () => {
  for (const rounds of [1, 2, 5]) {
    let g = started(); g.maxRounds = rounds;
    let phantomMoves = 0, guard = 0;
    while (!g.gameOver && guard++ < 500) {
      const idx = g.turn - 1;
      // keep everyone away from the fugitive so only the round limit can end the game
      const m = E.validMoves(g, map, idx).find(o => !g.players.some((p, i) => i !== idx && p.pos === o.to));
      assert.ok(m, 'a safe move exists');
      if (idx === 0) phantomMoves++;
      g = E.applyAction(g, map, { cmd: 'move', playerIdx: idx, to: m.to, type: m.type }).state;
    }
    assert.equal(g.gameOver, true);
    assert.equal(g.winner, 'phantom');
    assert.equal(phantomMoves, rounds, `${rounds} rounds means ${rounds} fugitive moves`);
  }
});
