import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowHuntAdapter as game, viewFor, MAP } from '../games/shadow-hunt/adapter.js';
import * as Engine from '../games/shadow-hunt/engine.js';
import { buildRoom, flush, lastState, wireTo } from './helpers.js';

const seatsOf = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: null }));
const MRX_START = 0;
const DET_STARTS = [10, 20, 30, 40, 44];

// ---- driving a room ----
const viewOf = (room, seat) => (seat === 0 ? room.host.snapshot().view : lastState(room.clients[seat - 1]).view);
async function act(room, seat, action) {
  if (seat === 0) room.host.act(action);
  else room.clients[seat - 1].act(action);
  await flush();
}
const mrxSeat = room => viewOf(room, 0).seatOf[0];
const seatOfPlayer = (room, k) => viewOf(room, 0).seatOf[k];

async function startedRoom(n = 4) {
  const room = await buildRoom(n, { game, start: true });
  // everyone picks a start: the fugitive on MRX_START, detectives on distinct stations
  for (let k = 0; k < n; k++) {
    const seat = seatOfPlayer(room, k);
    await act(room, seat, { cmd: 'startPick', pos: k === 0 ? MRX_START : DET_STARTS[k - 1] });
  }
  return room;
}
// first legal move for whoever's turn it is (read from that seat's own view)
async function playOne(room, { prefer } = {}) {
  const v0 = viewOf(room, 0);
  const seat = v0.seatOf[v0.turn - 1];
  const v = viewOf(room, seat);
  const moves = Engine.validMoves(v, MAP, v.me);
  // The fugitive steps somewhere no detective can reach this round; detectives wander from the far end
  // of their list. That keeps a test game alive long enough to pass several reveal rounds.
  let m;
  if (v.players[v.me].isMrX) {
    const danger = new Set(v.players.filter(p => !p.isMrX).flatMap(p => MAP.adj[p.pos].map(o => o.to)));
    m = (prefer && moves.find(prefer)) || moves.find(o => !danger.has(o.to)) || moves[0];
  } else m = (prefer && moves.find(prefer)) || moves[moves.length - 1];
  await act(room, seat, { cmd: 'move', to: m.to, type: m.type });
  return { seat, to: m.to, type: m.type };
}
const allStateMessages = (room, seat) => (seat === 0
  ? room.hostUpdates.filter(u => u.view).map(u => u.view)
  : room.clients[seat - 1].log.states.map(m => m.view));

/* ---------- who plays the fugitive ---------- */

test('the fugitive is drawn at random, not from a fixed order', () => {
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(game.start(seatsOf(4), { maxRounds: 24 }).seatOf[0]);
  assert.ok(seen.size >= 3, 'every seat should get a turn at being the fugitive; saw ' + [...seen]);
});

test('an injected rng makes the draw repeatable (tests only)', () => {
  const a = game.start(seatsOf(5), { maxRounds: 24 }, Engine.seededRand(7));
  const b = game.start(seatsOf(5), { maxRounds: 24 }, Engine.seededRand(7));
  assert.deepEqual(a.seatOf, b.seatOf);
  assert.equal(a.players[0].isMrX, true);
  assert.deepEqual([...a.seatOf].sort(), [0, 1, 2, 3, 4]);
});

/* ---------- views ---------- */

test('during setup you see only your own start', async () => {
  const room = await buildRoom(4, { game, start: true });
  const fSeat = mrxSeat(room);
  await act(room, fSeat, { cmd: 'startPick', pos: 5 });
  const other = [0, 1, 2, 3].find(s => s !== fSeat);
  await act(room, other, { cmd: 'startPick', pos: 12 });
  for (let s = 0; s < 4; s++) {
    const v = viewOf(room, s);
    v.players.forEach((p, k) => {
      if (k === v.me) { if (p.picked) assert.notEqual(p.pos, null, 'own start visible'); }
      else assert.equal(p.pos, null, `seat ${s} must not see player ${k}'s start`);
    });
  }
  assert.equal(viewOf(room, other).players.find(p => p.isMrX).picked, true, 'but everyone can see who has picked');
});

test('nobody but the fugitive ever receives his position or secret tickets (whole game, every message)', async () => {
  const room = await startedRoom(4);
  const fSeat = mrxSeat(room);
  for (let i = 0; i < 40 && !viewOf(room, 0).gameOver; i++) await playOne(room);
  assert.ok(viewOf(room, 0).round > 3, 'played past the first reveal round');
  let checked = 0;
  for (let s = 0; s < 4; s++) {
    if (s === fSeat) continue;
    for (const v of allStateMessages(room, s)) {
      const x = v.players.find(p => p.isMrX);
      if (!v.mrxVisible && !v.gameOver) assert.equal(x.pos, null, `seat ${s} saw the fugitive's position`);
      if (!v.gameOver) { assert.equal(x.tickets.black, null); assert.equal(x.tickets.double, null); }
      checked++;
    }
  }
  assert.ok(checked > 20);
  // the raw bytes agree with the parsed messages: the fugitive's pre-reveal squares never appear as his pos
  const det = [0, 1, 2, 3].find(s => s !== fSeat && s !== 0);
  const frames = room.clients[det - 1].log.endpoint.peer.sent.map(x => JSON.parse(x)).filter(m => m.t === 'state');
  assert.ok(frames.length > 20);
  for (const m of frames) {
    const x = m.view.players.find(p => p.isMrX);
    assert.ok(m.view.gameOver || m.view.mrxVisible || x.pos === null);
  }
});

test('the fugitive sees his own position and tickets', async () => {
  const room = await startedRoom(4);
  const v = viewOf(room, mrxSeat(room));
  const x = v.players.find(p => p.isMrX);
  assert.equal(x.pos, MRX_START);
  assert.equal(x.tickets.black, 5);
  assert.equal(x.tickets.double, 2);
});

test('on a reveal round everyone sees him; the next move hides him again', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(1));
  const f = s.seatOf[0], d1 = s.seatOf[1], d2 = s.seatOf[2];
  const run = (seat, a) => { assert.equal(game.validate(s, seat, a), true, JSON.stringify(a)); s = game.apply(s, seat, a).state; };
  run(f, { cmd: 'startPick', pos: 0 }); run(d1, { cmd: 'startPick', pos: 10 }); run(d2, { cmd: 'startPick', pos: 20 });
  s.round = 3; s.turn = 1;
  const m = Engine.validMoves(s, MAP, 0)[0];
  run(f, { cmd: 'move', to: m.to, type: m.type });
  assert.equal(viewFor(s, d1).players[0].pos, m.to, 'spotted');
  s.turn = 1; s.round = 4;
  const m2 = Engine.validMoves(s, MAP, 0)[0];
  run(f, { cmd: 'move', to: m2.to, type: m2.type });
  assert.equal(viewFor(s, d1).players[0].pos, null, 'hidden again');
});

test('when the game ends, everything is shown', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(1));
  const edge = MAP.adj[0][0];                       // a detective one hop from the fugitive
  s.players.forEach((p, k) => { p.pos = [0, edge.to, 20][k]; });
  s.startingPhase = false; delete s.startPickIdx; s.turn = 2;
  const other = s.seatOf[2];
  assert.equal(viewFor(s, other).players[0].pos, null, 'hidden while the game runs');
  const r = game.apply(s, s.seatOf[1], { cmd: 'move', to: 0, type: edge.type }).state;
  assert.equal(r.gameOver, true);
  assert.equal(r.winner, 'detectives');
  const v = viewFor(r, other);
  assert.equal(v.players[0].pos, 0);
  assert.equal(v.players[0].tickets.black, 5);
});

test('his double-move plan stays private until he has moved once', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(2));
  const f = s.seatOf[0], d = s.seatOf[1];
  s.players.forEach((p, k) => { p.pos = [0, 10, 20][k]; });
  s.startingPhase = false; delete s.startPickIdx;
  s = game.apply(s, f, { cmd: 'startDouble' }).state;
  assert.equal(viewFor(s, f).doubleMovePending, true);
  assert.equal(viewFor(s, d).doubleMovePending, false);
  const m = Engine.validMoves(s, MAP, 0)[0];
  s = game.apply(s, f, { cmd: 'move', to: m.to, type: m.type }).state;
  assert.equal(viewFor(s, d).doubleFirstDone, true);
});

/* ---------- setup rules ---------- */

test('setup: picks must be real stations, one per player, and detectives cannot share a start', () => {
  const s = game.start(seatsOf(4), { maxRounds: 24 }, Engine.seededRand(3));
  const [f, d1, d2] = s.seatOf;
  for (const bad of [-1, 45, 9999, 1.5, '5', null, undefined, NaN, Infinity, {}, [5]]) {
    assert.equal(game.validate(s, d1, { cmd: 'startPick', pos: bad }), false, 'pos ' + String(bad));
  }
  assert.equal(game.validate(s, d1, { cmd: 'startPick', pos: 10 }), true);
  const s2 = game.apply(s, d1, { cmd: 'startPick', pos: 10 }).state;
  assert.equal(game.validate(s2, d1, { cmd: 'startPick', pos: 11 }), false, 'a second pick is not allowed');
  assert.equal(game.validate(s2, d2, { cmd: 'startPick', pos: 10 }), false, 'two detectives cannot share a start');
  assert.equal(game.validate(s2, f, { cmd: 'startPick', pos: 10 }), true, 'the fugitive can pick any station');
});

test('setup: a forged playerIdx in the message is ignored', () => {
  const s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(3));
  const [f, d1] = s.seatOf;
  const r = game.apply(s, d1, { cmd: 'startPick', pos: 10, playerIdx: 0 }).state;
  assert.equal(r.players[0].pos, null, 'the fugitive was not moved');
  assert.equal(r.players[1].pos, 10);
  assert.notEqual(f, d1);
});

test('setup: a detective who starts on the fugitive wins at once', async () => {
  const room = await buildRoom(3, { game, start: true });
  const f = mrxSeat(room);
  const dets = [0, 1, 2].filter(s => s !== f);
  await act(room, f, { cmd: 'startPick', pos: 7 });
  await act(room, dets[0], { cmd: 'startPick', pos: 7 });
  await act(room, dets[1], { cmd: 'startPick', pos: 8 });
  const v = viewOf(room, 0);
  assert.equal(v.gameOver, true);
  assert.equal(v.winner, 'detectives');
});

test('after setup nobody can teleport with a late startPick', async () => {
  const room = await startedRoom(4);
  const v = viewOf(room, 0);
  for (let s = 0; s < 4; s++) await act(room, s, { cmd: 'startPick', pos: 3 });
  const after = viewOf(room, 0);
  assert.deepEqual(after.players.map(p => p.pos), v.players.map(p => p.pos));
});

/* ---------- illegal and forged actions ---------- */

test('moves: only the player whose turn it is, to an adjacent station, with a matching ticket', async () => {
  const room = await startedRoom(4);
  const v0 = viewOf(room, 0);
  const turnSeat = v0.seatOf[v0.turn - 1];
  const other = [0, 1, 2, 3].find(s => s !== turnSeat);
  const fView = viewOf(room, turnSeat);
  const legal = Engine.validMoves(fView, MAP, fView.me);
  const nonAdj = MAP.stations.find(st => st.id !== MRX_START && !MAP.adj[MRX_START].some(o => o.to === st.id)).id;
  const ok = legal[0];

  const before = JSON.stringify(viewOf(room, 0));
  await act(room, other, { cmd: 'move', to: ok.to, type: ok.type });                   // not your turn
  await act(room, turnSeat, { cmd: 'move', to: nonAdj, type: 'taxi' });                // not adjacent
  await act(room, turnSeat, { cmd: 'move', to: ok.to, type: 'rocket' });               // not a transport type
  await act(room, turnSeat, { cmd: 'move', to: 9999, type: ok.type });                 // not a station
  await act(room, turnSeat, { cmd: 'move', to: '5', type: ok.type });
  await act(room, turnSeat, { cmd: 'move', to: ok.to, type: ok.type, isBlack: 'yes' });
  await act(room, turnSeat, { cmd: 'move' });
  await act(room, turnSeat, { cmd: 'explode' });
  await act(room, turnSeat, null);
  await act(room, turnSeat, 'move');
  assert.equal(JSON.stringify(viewOf(room, 0)), before, 'none of that changed anything');

  await act(room, turnSeat, { cmd: 'move', to: ok.to, type: ok.type });
  assert.notEqual(JSON.stringify(viewOf(room, 0)), before, 'but the legal move did');
});

test('moves: a detective cannot use a ticket type they have run out of, or a black ticket', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(4));
  const [f, d1] = s.seatOf;
  s.players.forEach((p, k) => { p.pos = [0, 10, 20][k]; });
  s.startingPhase = false; delete s.startPickIdx; s.turn = 2;
  const mv = MAP.adj[10][0];
  s.players[1].tickets[mv.type] = 0;
  assert.equal(game.validate(s, d1, { cmd: 'move', to: mv.to, type: mv.type }), false, 'no ticket left');
  s.players[1].tickets[mv.type] = 3;
  assert.equal(game.validate(s, d1, { cmd: 'move', to: mv.to, type: mv.type }), true);
  assert.equal(game.validate(s, d1, { cmd: 'move', to: mv.to, type: mv.type, isBlack: true }), false, 'detectives have no black tickets');
  assert.ok(f >= 0);
});

test('moves: ticket counts can never go negative', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(5));
  const d1 = s.seatOf[1];
  s.players.forEach((p, k) => { p.pos = [0, 10, 20][k]; });
  s.startingPhase = false; delete s.startPickIdx; s.turn = 2;
  s.players[1].tickets = { taxi: 1, bus: 1, underground: 1 };
  for (let i = 0; i < 12; i++) {
    s.turn = 2;
    const opts = Engine.validMoves(s, MAP, 1);
    if (!opts.length) break;
    const a = { cmd: 'move', to: opts[0].to, type: opts[0].type };
    assert.equal(game.validate(s, d1, a), true);
    s = game.apply(s, d1, a).state;
    if (s.gameOver) break;
    assert.ok(Object.values(s.players[1].tickets).every(n => n >= 0));
  }
});

test('double move: only the fugitive, only with tickets left, not twice, not out of turn', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(6));
  const [f, d1] = s.seatOf;
  s.players.forEach((p, k) => { p.pos = [0, 10, 20][k]; });
  s.startingPhase = false; delete s.startPickIdx;
  assert.equal(game.validate(s, d1, { cmd: 'startDouble' }), false, 'a detective cannot');
  s.turn = 2;
  assert.equal(game.validate(s, f, { cmd: 'startDouble' }), false, 'not his turn');
  s.turn = 1;
  s.players[0].tickets.double = 0;
  assert.equal(game.validate(s, f, { cmd: 'startDouble' }), false, 'no double tickets left');
  s.players[0].tickets.double = 2;
  assert.equal(game.validate(s, f, { cmd: 'startDouble' }), true);
  s = game.apply(s, f, { cmd: 'startDouble' }).state;
  assert.equal(game.validate(s, f, { cmd: 'startDouble' }), false, 'already pending');
  const m = Engine.validMoves(s, MAP, 0)[0];
  s = game.apply(s, f, { cmd: 'move', to: m.to, type: m.type }).state;
  assert.equal(s.turn, 1, 'still his turn for the second leg');
  assert.equal(s.players[0].tickets.double, 1);
  const m2 = Engine.validMoves(s, MAP, 0)[0];
  s = game.apply(s, f, { cmd: 'move', to: m2.to, type: m2.type }).state;
  assert.equal(s.turn, 2, 'then play moves on');
  assert.equal(game.validate(s, f, { cmd: 'startDouble' }), false);
});

test('black ticket: only the fugitive, only if he has one, and it hides the transport', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(8));
  const f = s.seatOf[0];
  s.players.forEach((p, k) => { p.pos = [0, 10, 20][k]; });
  s.startingPhase = false; delete s.startPickIdx;
  const mv = MAP.adj[0][0];
  s.players[0].tickets.black = 0;
  assert.equal(game.validate(s, f, { cmd: 'move', to: mv.to, isBlack: true }), false);
  s.players[0].tickets.black = 1;
  assert.equal(game.validate(s, f, { cmd: 'move', to: mv.to, isBlack: true }), true, 'type may be left out for a black ticket');
  s = game.apply(s, f, { cmd: 'move', to: mv.to, isBlack: true }).state;
  assert.equal(s.players[0].tickets.black, 0);
  assert.equal(s.mrXHistory.at(-1).type, 'black');
});

test('a detective cannot move onto another detective', () => {
  const s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(9));
  const d1 = s.seatOf[1];
  const to = MAP.adj[10][0].to;
  s.players.forEach((p, k) => { p.pos = [0, 10, to][k]; });
  s.startingPhase = false; delete s.startPickIdx; s.turn = 2;
  const edge = MAP.adj[10].find(o => o.to === to);
  assert.equal(game.validate(s, d1, { cmd: 'move', to, type: edge.type }), false);
});

test('nothing is accepted once the game is over', () => {
  let s = game.start(seatsOf(3), { maxRounds: 24 }, Engine.seededRand(10));
  s.startingPhase = false; delete s.startPickIdx;
  s.players.forEach((p, k) => { p.pos = [0, 10, 20][k]; });
  s.gameOver = true; s.winner = 'mrx';
  for (const q of s.seatOf) assert.equal(game.validate(s, q, { cmd: 'startDouble' }), false);
});

test('lobby setting: only the offered round counts are accepted', () => {
  for (const ok of [12, 18, 24, 30]) assert.equal(game.validateSetting('maxRounds', ok), true);
  for (const bad of [0, 99, '24', null, -1, 24.5]) assert.equal(game.validateSetting('maxRounds', bad), false);
  assert.equal(game.validateSetting('other', 24), false);
});

/* ---------- a whole online game ---------- */

test('a full online game plays to a result with the chosen number of rounds', async () => {
  const room = await buildRoom(3, { game, start: false });
  assert.equal(room.host.setSetting('maxRounds', 12), true);
  room.host.startGame(); await flush();
  for (let k = 0; k < 3; k++) await act(room, seatOfPlayer(room, k), { cmd: 'startPick', pos: k === 0 ? 0 : [10, 20][k - 1] });
  for (let i = 0; i < 200 && !viewOf(room, 0).gameOver; i++) await playOne(room);
  const v = viewOf(room, 0);
  assert.equal(v.gameOver, true);
  assert.equal(v.maxRounds, 12);
  assert.ok(['mrx', 'detectives'].includes(v.winner));
  for (let s = 0; s < 3; s++) assert.equal(viewOf(room, s).gameOver, true);
});
