// What a cheater can do from DevTools: send any JSON they like as any seat. These tests play whole
// games while feeding the rules hostile input between the legal moves, and after every accepted
// action they check the things no input may ever break: card counts, ticket counts, positions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameOfTradesAdapter as GOT } from '../games/game-of-trades/adapter.js';
import { shadowHuntAdapter as SH, MAP } from '../games/shadow-hunt/adapter.js';
import * as Engine from '../games/shadow-hunt/engine.js';
import { RESOURCE } from '../games/game-of-trades/engine.js';
import { cleanName } from '../shared/net/protocol.js';

function seeded(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const wire = v => JSON.parse(JSON.stringify(v));          // anything a real message could carry

const HOSTILE = [-1, 0, 1, 2, 0.5, -0.5, 1e21, 1e-9, '1', '1e3', '', ' ', 'constructor', '__proto__', 'toString', null, true, false, [], {}, [1], [1, 2], ['wood', 'wood'], { a: 1 },
  'wood', 'brick', { wood: -5 }, { wood: 1e9 }, { wood: 'x' }, { wood: 0.5 }, { wood: 3, brick: 3 }, JSON.parse('{"__proto__":{"wood":5}}'), { constructor: { prototype: { wood: 5 } } }, '<img src=x>', 'x'.repeat(5000)];
const junk = r => pick(r, HOSTILE);
const junkObj = r => { const o = {}; for (let i = 0; i < 1 + Math.floor(r() * 4); i++) o[pick(r, ['vertexId', 'edgeId', 'tileId', 'cardId', 'i', 'res', 'mode', 'accept', 'target', 'give', 'get', 'qty', 'discard', 'picks', 'cmd', 'to', 'type', 'pos', 'playerIdx', 'isBlack', 'seat'])] = junk(r); return o; };

/* ---------------- Game of Trades ---------------- */

const SEATS = n => Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: GOT.colors[i] }));
const isNat = n => Number.isInteger(n) && n >= 0;

function gotInvariants(S, where) {
  const deck = S.numPlayers > 4 ? 24 : 19;       // the bank starts with 19 of each card, 24 for 5 to 8 players
  for (const r of Object.keys(RESOURCE)) {
    assert.ok(isNat(S.bank[r]), `${where}: bank ${r} = ${S.bank[r]}`);
    let sum = S.bank[r];
    for (const p of S.players) { assert.ok(isNat(p.resources[r]), `${where}: ${p.name} ${r} = ${p.resources[r]}`); sum += p.resources[r]; }
    assert.equal(sum, deck, `${where}: ${r} cards are not conserved`);
  }
  for (const p of S.players) for (const k of ['settlement', 'city', 'road']) assert.ok(isNat(p.pieces[k]), `${where}: ${p.name} has ${p.pieces[k]} ${k}`);
  assert.ok(S.currentPlayerIdx >= 0 && S.currentPlayerIdx < S.numPlayers, `${where}: current player out of range`);
  assert.equal(({}).wood, undefined, `${where}: Object.prototype was polluted`);
  assert.equal(({}).polluted, undefined);
}

function gotLegalCandidates(S, seat, r) {
  const c = [];
  const names = ['rollDice', 'startBuildRoad', 'startBuildSettlement', 'startBuildCity', 'cancelBuild', 'buyDevCard', 'openTradeChooser', 'endTurn'];
  names.forEach(a => c.push({ a }));
  S.board.vertices.forEach(v => { c.push({ a: 'clickVertexSettlement', ds: { vertexId: v.id } }); c.push({ a: 'clickVertexCity', ds: { vertexId: v.id } }); });
  S.board.edges.forEach(e => c.push({ a: 'clickEdge', ds: { edgeId: e.id } }));
  S.board.tiles.forEach(t => c.push({ a: 'clickTile', ds: { tileId: t.id } }));
  ['idle', 'trade-bank', 'trade-build'].forEach(mode => c.push({ a: 'setUiMode', ds: { mode } }));
  const res = Object.keys(RESOURCE);
  const bag = () => Object.fromEntries(res.filter(() => r() < 0.4).map(x => [x, 1 + Math.floor(r() * 3)]));
  for (let i = 0; i < 6; i++) {
    c.push({ a: 'sendTrade', p: { target: Math.floor(r() * S.numPlayers), give: bag(), get: bag() } });
    c.push({ a: 'confirmBankTrade', p: { give: pick(r, res), get: pick(r, res), qty: 1 + Math.floor(r() * 4) } });
    c.push({ a: 'doConfirmDiscard', p: { discard: bag() } });
    c.push({ a: 'confirmYoPAction', p: { picks: [pick(r, res), pick(r, res)] } });
    c.push({ a: 'resolveMonopolyAction', ds: { res: pick(r, res) } });
  }
  S.players.forEach((p, i) => c.push({ a: 'chooseVictim', ds: { i } }));
  c.push({ a: 'respondTrade', ds: { accept: '1' } }, { a: 'respondTrade', ds: { accept: '0' } });
  [...S.players[seat].devCards, ...S.players[seat].newDevCards].forEach(card => c.push({ a: 'playDevCard', ds: { cardId: card.id, cardType: card.type } }));
  return c;
}

function playGot(seed, n, steps) {
  const r = seeded(seed);
  let S = GOT.start(SEATS(n), { hideMode: pick(r, ['off', 'first', 'all']) }, seeded(seed + 1));
  let accepted = 0, refused = 0;
  for (let i = 0; i < steps; i++) {
    const seat = r() < 0.75 ? (S.uiMode === 'discard' && S.turn.discardQueue.length ? S.turn.discardQueue[0] : S.pendingTrade ? S.pendingTrade.toIdx : S.currentPlayerIdx) : Math.floor(r() * n);
    let action;
    const kind = r();
    if (kind < 0.7) { const legal = gotLegalCandidates(S, seat, r).filter(c => GOT.validate(S, seat, wire(c)) === true); action = legal.length ? pick(r, legal) : { a: 'endTurn' }; }
    else if (kind < 0.9) action = { a: pick(r, ['rollDice', 'clickEdge', 'sendTrade', 'confirmBankTrade', 'doConfirmDiscard', 'confirmYoPAction', 'chooseVictim', 'playDevCard', 'respondTrade', 'setUiMode', 'clickTile', 'clickVertexCity']), ds: junkObj(r), p: junkObj(r) };
    else action = junkObj(r);
    action = wire(action);
    const before = JSON.stringify(S);
    let ok = false;
    assert.doesNotThrow(() => { ok = GOT.validate(S, seat, action); }, `validate threw on ${JSON.stringify(action).slice(0, 200)}`);
    if (ok !== true) { refused++; assert.equal(JSON.stringify(S), before, 'a refused action changed the state'); continue; }
    let res;
    assert.doesNotThrow(() => { res = GOT.apply(S, seat, action); }, `apply threw on ${JSON.stringify(action).slice(0, 200)}`);
    S = res.state; accepted++;
    gotInvariants(S, `seed ${seed} step ${i} ${JSON.stringify(action).slice(0, 120)}`);
    for (let s = 0; s < n; s++) assert.doesNotThrow(() => JSON.stringify(GOT.view(S, s)));
  }
  return { accepted, refused, S };
}

test('Game of Trades: junk and hostile actions between real moves never break the cards, pieces or turn order', () => {
  let accepted = 0, built = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const out = playGot(seed, 3 + (seed % 4), 1200);
    accepted += out.accepted;
    built += out.S.board.edges.filter(e => e.road != null).length;
  }
  assert.ok(accepted > 1000, `the fuzzer should get deep into real games (only ${accepted} accepted actions)`);
  assert.ok(built > 15, `and actually build things (${built} roads)`);
});

test('Game of Trades: a player with no resources cannot build, buy or trade their way to cards', () => {
  const S = GOT.start(SEATS(3), { hideMode: 'off' }, seeded(5));
  S.phase = 'turn'; S.currentPlayerIdx = 0; S.uiMode = 'idle'; S.turn.rolled = true;
  for (const p of S.players) for (const r of Object.keys(RESOURCE)) { S.bank[r] += p.resources[r]; p.resources[r] = 0; }
  let T = S;
  const attempt = (seat, a, ds, p) => { const act = wire({ a, ds, p }); if (GOT.validate(T, seat, act) === true) T = GOT.apply(T, seat, act).state; };
  attempt(0, 'startBuildRoad');
  for (const e of T.board.edges) attempt(0, 'clickEdge', { edgeId: e.id });
  attempt(0, 'cancelBuild'); attempt(0, 'buyDevCard'); attempt(0, 'openTradeChooser'); attempt(0, 'setUiMode', { mode: 'trade-bank' });
  attempt(0, 'confirmBankTrade', undefined, { give: 'wood', get: 'ore', qty: 4 });
  attempt(0, 'setUiMode', { mode: 'trade-build' });
  attempt(0, 'sendTrade', undefined, { target: 1, give: { wood: 3 }, get: { ore: 3 } });
  assert.equal(T.board.edges.filter(e => e.road != null).length, 0);
  assert.equal(T.pendingTrade, null);
  assert.equal(Object.values(T.players[0].resources).reduce((a, b) => a + b, 0), 0);
  gotInvariants(T, 'broke player');
});

/* ---------------- Shadow Hunt ---------------- */

function shInvariants(S, where) {
  for (const p of S.players) {
    for (const [k, v] of Object.entries(p.tickets)) assert.ok(isNat(v), `${where}: ${p.name} ${k} tickets = ${v}`);
    if (p.pos !== null) assert.ok(Number.isInteger(p.pos) && p.pos >= 0 && p.pos < MAP.stations.length, `${where}: position ${p.pos}`);
  }
  assert.ok(S.round <= S.maxRounds + 1, `${where}: round ${S.round}`);
  assert.equal(({}).polluted, undefined);
}

function playSh(seed, n, steps) {
  const r = seeded(seed);
  let S = SH.start(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), { maxRounds: 24 }, seeded(seed));
  let accepted = 0;
  for (let i = 0; i < steps && !S.gameOver; i++) {
    const turnSeat = S.startingPhase ? S.seatOf[S.players.findIndex(p => p.pos === null)] : S.seatOf[S.turn - 1];
    const seat = r() < 0.8 ? turnSeat : Math.floor(r() * n);
    const p = S.seatOf.indexOf(seat);
    let action;
    const k = r();
    if (S.startingPhase && k < 0.6) action = { cmd: 'startPick', pos: Math.floor(r() * 45) };
    else if (k < 0.6) { const mv = Engine.validMoves(S, MAP, p); action = mv.length ? { cmd: 'move', to: pick(r, mv).to, type: pick(r, mv).type, isBlack: r() < 0.2 } : { cmd: 'startDouble' }; }
    else if (k < 0.7) action = { cmd: 'startDouble' };
    else action = { cmd: pick(r, ['move', 'startPick', 'startDouble', 'x', 7, null]), ...junkObj(r) };
    action = wire(action);
    const before = JSON.stringify(S);
    let ok = false;
    assert.doesNotThrow(() => { ok = SH.validate(S, seat, action); }, `validate threw on ${JSON.stringify(action).slice(0, 200)}`);
    if (ok !== true) { assert.equal(JSON.stringify(S), before); continue; }
    let res;
    assert.doesNotThrow(() => { res = SH.apply(S, seat, action); }, `apply threw on ${JSON.stringify(action).slice(0, 200)}`);
    S = res.state; accepted++;
    shInvariants(S, `seed ${seed} step ${i}`);
    // detectives must never receive the fugitive's position unless it is a reveal round or the game is over
    for (let s = 0; s < n; s++) {
      const v = SH.view(S, s);
      const mine = v.me;
      if (!S.gameOver && !v.phantomVisible && mine !== 0 && !v.startingPhase) assert.ok(v.players[0].pos == null, `seed ${seed} step ${i}: seat ${s} was sent the fugitive's position`);
    }
  }
  return accepted;
}

test('Shadow Hunt: junk and hostile actions between real moves never break tickets, positions or secrecy', () => {
  let accepted = 0;
  for (let seed = 1; seed <= 20; seed++) accepted += playSh(seed, 3 + (seed % 4), 1500);
  assert.ok(accepted > 800, `the fuzzer should get deep into real games (only ${accepted} accepted actions)`);
});

/* ---------------- names ---------------- */

test('names: invisible, text-direction and control characters are removed, so nobody can look like someone else', () => {
  assert.equal(cleanName('Al‮ice'), 'Alice');
  assert.equal(cleanName('​‍'), '');
  assert.equal(cleanName('Bo\u0000b\n'), 'Bob');
  assert.equal(cleanName('﻿Eve'), 'Eve');
  assert.equal(cleanName('<b>Zed</b>'), 'bZed/b');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.equal(cleanName('Anna  Lee'), 'Anna Lee');
});

/* ---------------- a trade nobody answers ---------------- */

test('a trade offer can be withdrawn by whoever made it, and by nobody else', () => {
  let S = GOT.start(SEATS(3), { hideMode: 'off' }, seeded(9));
  S.phase = 'turn'; S.currentPlayerIdx = 0; S.uiMode = 'trade-build'; S.turn.rolled = true;
  S.players[0].resources.wood = 2; S.bank.wood -= 2;
  const run = (seat, action) => { const a = wire(action); if (GOT.validate(S, seat, a) !== true) return false; S = GOT.apply(S, seat, a).state; return true; };
  assert.equal(run(0, { a: 'sendTrade', p: { target: 1, give: { wood: 1 }, get: { ore: 1 } } }), true);
  assert.equal(S.pendingTrade.status, 'pending');
  assert.equal(run(0, { a: 'endTurn' }), false, 'everything else waits while an offer is open');
  assert.equal(run(2, { a: 'cancelTrade' }), false, 'a bystander cannot withdraw it');
  assert.equal(run(1, { a: 'cancelTrade' }), false, 'and neither can the player it was offered to');
  assert.equal(run(0, { a: 'cancelTrade' }), true);
  assert.equal(S.pendingTrade, null);
  assert.equal(S.players[0].resources.wood, 2, 'nothing was exchanged');
  assert.equal(run(0, { a: 'cancelTrade' }), false, 'there is nothing left to withdraw');
  assert.equal(run(0, { a: 'endTurn' }), true, 'play can go on');
});

/* ---------------- development cards: the fuzzer rarely reaches them, so they get their own check ---------------- */

test('development cards: Year of Plenty, Monopoly and a Knight keep every card accounted for', () => {
  const fresh = () => {
    const S = GOT.start(SEATS(3), { hideMode: 'off' }, seeded(11));
    S.phase = 'turn'; S.currentPlayerIdx = 0; S.uiMode = 'idle'; S.turn.rolled = true;
    return S;
  };
  const go = (S, seat, action) => { const a = wire(action); assert.equal(GOT.validate(S, seat, a), true, JSON.stringify(a)); return GOT.apply(S, seat, a).state; };
  const hand = (S, i, r, n) => { S.players[i].resources[r] += n; S.bank[r] -= n; };

  let S = fresh();
  S.players[0].devCards.push({ id: 'yop', type: 'yearofplenty' });
  S = go(S, 0, { a: 'playDevCard', ds: { cardId: 'yop' } });
  const before = S.bank.ore;
  S = go(S, 0, { a: 'confirmYoPAction', p: { picks: ['ore', 'ore'] } });
  assert.equal(S.players[0].resources.ore, 2); assert.equal(S.bank.ore, before - 2);
  gotInvariants(S, 'year of plenty');

  S = fresh(); hand(S, 1, 'wheat', 3); hand(S, 2, 'wheat', 4);
  S.players[0].devCards.push({ id: 'mon', type: 'monopoly' });
  S = go(S, 0, { a: 'playDevCard', ds: { cardId: 'mon' } });
  S = go(S, 0, { a: 'resolveMonopolyAction', ds: { res: 'wheat' } });
  assert.deepEqual([S.players[0].resources.wheat, S.players[1].resources.wheat, S.players[2].resources.wheat], [7, 0, 0]);
  gotInvariants(S, 'monopoly');

  S = fresh(); hand(S, 1, 'brick', 1);
  const tile = S.board.tiles.find(t => !t.hasRobber && t.resource);
  const corner = S.board.vertices.find(v => v.id === tile.corners[0]);
  corner.building = { type: 'settlement', playerIdx: 1 };
  S.players[0].devCards.push({ id: 'kn', type: 'knight' });
  S = go(S, 0, { a: 'playDevCard', ds: { cardId: 'kn' } });
  S = go(S, 0, { a: 'clickTile', ds: { tileId: tile.id } });
  assert.equal(S.players[0].resources.brick + S.players[1].resources.brick, 1, 'one card moved, none appeared or vanished');
  gotInvariants(S, 'knight');
});
