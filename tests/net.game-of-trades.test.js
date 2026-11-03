// The real Game of Trades rules running through the real shared host, over the in-memory network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, joinClient, flush, wireTo, lastState } from './helpers.js';
import { gameOfTradesAdapter } from '../games/game-of-trades/adapter.js';
import * as Rules from '../games/game-of-trades/engine.js';

// Same game, but every seat starts holding things nobody else may see.
const withSecrets = {
  ...gameOfTradesAdapter,
  start(seats, settings, rng) {
    const s = gameOfTradesAdapter.start(seats, settings, rng);
    s.players.forEach((p, i) => {
      p.password = `PASSWORD-${i}`;
      p.devCards = [{ id: `SECRETCARD-${i}`, type: 'knight' }];
      p.newDevCards = [{ id: `SECRETNEW-${i}`, type: 'monopoly' }];
    });
    return s;
  },
};

const act = (a, ds = {}, p = {}) => ({ a, ds, p });
const viewOf = c => lastState(c).view;

// Whoever's turn it is places a legal settlement and road, using only the view they are given.
async function placeOne(room, players) {
  const cur = players.find(p => p.seat === (p.view().currentPlayerIdx));
  const v = cur.view();
  const vid = v.board.vertices.find(x => Rules.query.settlementSpot(v, x.id)).id;
  cur.act(act('clickVertexSettlement', { vertexId: vid })); await flush();
  const v2 = cur.view();
  const eid = v2.board.edges.find(e => Rules.query.edgeBuildable(v2, e.id)).id;
  cur.act(act('clickEdge', { edgeId: eid })); await flush();
}
function everyone(room) {
  const host = { seat: 0, act: a => room.host.act(a), view: () => room.host.snapshot().view };
  const cl = room.clients.map(c => ({ seat: c.seat, act: a => c.act(a), view: () => viewOf(c) }));
  return [host, ...cl];
}
function assertNoLeaks(room, label) {
  room.clients.forEach((c, k) => {
    const seat = k + 1, wire = wireTo(c);
    for (let other = 0; other < 4; other++) {
      if (other === seat) continue;
      assert.ok(!wire.includes(`SECRETCARD-${other}`) && !wire.includes(`SECRETNEW-${other}`), `${label}: seat ${seat} saw seat ${other}'s cards`);
    }
    for (let any = 0; any < 4; any++) assert.ok(!wire.includes(`PASSWORD-${any}`), `${label}: a pass-and-play password reached seat ${seat}`);
    assert.ok(!/"token"/.test(wire));
  });
}

test('over a real game: no seat ever receives another seat\'s cards, and nobody receives a password', async () => {
  const room = await buildRoom(4, { game: withSecrets });
  room.host.setSetting('hideMode', 'off');
  assert.equal(room.host.startGame(), true); await flush();
  const players = everyone(room);
  assertNoLeaks(room, 'at start');
  for (let step = 0; step < 8; step++) { await placeOne(room, players); assertNoLeaks(room, `after placement ${step + 1}`); }
  assert.equal(viewOf(room.clients[0]).phase, 'turn', 'setup finished');
  // each seat does see its own hidden cards
  room.clients.forEach((c, k) => assert.ok(wireTo(c).includes(`SECRETCARD-${k + 1}`), `seat ${k + 1} sees its own card`));
  // other players' hands are zeroed but their sizes are public
  const v = viewOf(room.clients[0]);
  assert.deepEqual(v.players[2].resources, { wood: 0, brick: 0, ore: 0, wheat: 0, sheep: 0 });
  assert.equal(typeof v.players[2].handCount, 'number');
  assert.ok(v.devDeck.every(x => x === 0), 'the order of the development deck is hidden');
});

test('hidden tiles stay hidden on the wire until the host\'s rules reveal them', async () => {
  const room = await buildRoom(4, { game: withSecrets });
  room.host.setSetting('hideMode', 'all'); room.host.startGame(); await flush();
  const hostView = room.host.snapshot().view;
  room.clients.forEach(c => {
    const v = viewOf(c);
    assert.ok(v.tilesHidden);
    assert.ok(v.board.tiles.every(t => t.resource === null && t.number === null && !t.hasRobber), 'no tile data at all');
  });
  assert.ok(hostView.tilesHidden && hostView.board.tiles.every(t => t.resource === null), 'the host\'s own screen gets the same hidden view');
  const players = everyone(room);
  for (let step = 0; step < 8; step++) await placeOne(room, players);
  room.clients.forEach(c => assert.ok(viewOf(c).board.tiles.some(t => t.resource), 'revealed once setup is over'));
});

test('real players cannot act out of turn, for another seat, or with made-up ids', async () => {
  const room = await buildRoom(4, { game: withSecrets });
  room.host.startGame(); await flush();
  const before = JSON.stringify(viewOf(room.clients[0]).board);
  const mallory = room.clients[1];                                     // seat 2; seat 0 is placing
  const vid = viewOf(mallory).board.vertices[0].id;
  mallory.act(act('clickVertexSettlement', { vertexId: vid })); await flush();                // out of turn
  mallory.log.endpoint.send(JSON.stringify({ t: 'act', action: { ...act('clickVertexSettlement', { vertexId: vid }), seat: 0, playerIdx: 0 } })); await flush();
  assert.equal(room.clients[0].log.states.at(-1).view.board.vertices.find(v => v.id === vid).building, null);
  for (const bad of [act('clickVertexSettlement', { vertexId: 'nope' }), act('clickEdge', { edgeId: 7 }), act('clickTile', { tileId: {} }), act('rollDice', 'str'), act('notAnAction'),
    { a: 'rollDice', ds: [], p: null }, null, 'rollDice', { ds: {} }, act('respondTrade', { accept: '1' }), act('doConfirmDiscard', {}, { discard: { wood: 99 } }), act('chooseVictim', { i: '9' })]) {
    mallory.log.endpoint.send(JSON.stringify({ t: 'act', action: bad })); await flush();
  }
  assert.equal(JSON.stringify(viewOf(room.clients[0]).board), before, 'the board did not change');
  assert.equal(room.host.act(act('clickVertexSettlement', { vertexId: vid })).ok, true, 'the host\'s legal move still works');
});

test('the engine refuses unknown board ids instead of throwing', () => {
  const S = Rules.createGame(3, [0, 1, 2].map(i => ({ name: 'P' + i, color: '#c0392b', password: '' })), {});
  S.phase = 'turn'; S.uiMode = 'move-robber'; S.turn.rolled = true;
  assert.equal(Rules.validateAction(S, 0, 'clickTile', { tileId: 'nope' }, {}), false);
  assert.equal(Rules.validateAction(S, 0, 'clickEdge', { edgeId: undefined }, {}), false);
  assert.equal(Rules.validateAction(S, 0, 'clickVertexCity', { vertexId: 12 }, {}), false);
  assert.equal(Rules.validateAction(S, 0, 'clickVertexSettlement', {}, {}), false);
});

test('rejoining a real game: a refresh restores the seat and only that seat\'s cards; a name alone needs approval', async () => {
  const room = await buildRoom(4, { game: withSecrets });
  room.host.startGame(); await flush();
  const p = room.clients[1];                                            // seat 2
  room.net.sever(p.log.endpoint); await flush();
  const back = await joinClient({ ...room, name: 'Player2', token: p.token });
  assert.equal(back.seat, 2);
  assert.ok(wireTo(back).includes('SECRETCARD-2'));
  assert.ok(!wireTo(back).includes('SECRETCARD-1') && !wireTo(back).includes('SECRETCARD-3'));

  room.net.sever(back.log.endpoint); await flush();
  const taker = await joinClient({ ...room, name: 'player2' });          // case does not matter, but approval does
  assert.ok(taker.log.statuses.includes('pending'));
  assert.ok(!wireTo(taker).includes('SECRETCARD'), 'nothing is revealed while the request is pending');
  room.host.approve(room.requests.at(-1).id); await flush();
  assert.equal(taker.seat, 2);
  assert.ok(wireTo(taker).includes('SECRETCARD-2'));
});

test('lobby options for Game of Trades: tile hiding is a host-only setting with three valid values', async () => {
  const room = await buildRoom(3, { game: gameOfTradesAdapter });
  assert.equal(room.host.setSetting('hideMode', 'first'), true);
  assert.equal(room.host.setSetting('hideMode', 'sometimes'), false);
  await flush();
  assert.equal(room.clients[0].log.lobbies.at(-1).settings.hideMode, 'first');
  room.clients[0].log.endpoint.send(JSON.stringify({ t: 'set', key: 'hideMode', value: 'all' })); await flush();
  assert.equal(room.host.snapshot().settings.hideMode, 'first');
});
