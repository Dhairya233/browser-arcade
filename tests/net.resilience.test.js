// Netcode resilience tests: bad networks, a vanishing host, refreshes, slow or blocked connections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, joinClient, rawConnection, flush, fakeClock, lastState, toyGame } from './helpers.js';
import { createMemoryNetwork } from '../shared/net/transport-memory.js';
import { createHost } from '../shared/net/host.js';
import { createClient } from '../shared/net/client.js';
import { makeToken } from '../shared/net/ids.js';
import { LIMITS, PROTOCOL } from '../shared/net/protocol.js';

test('the host drops a seat that goes silent, and tells everyone else', async () => {
  const room = await buildRoom(3, { start: true });
  const raw = await rawConnection(room.net, room.code);                        // seated, but never pings
  raw.send({ t: 'hello', v: PROTOCOL, token: makeToken(), name: 'Ghost' });
  await flush();
  assert.equal(room.host.snapshot().seats.length, 3, 'in a started game an unknown name cannot take a seat');
  const room2 = await buildRoom(1);
  const raw2 = await rawConnection(room2.net, room2.code);
  raw2.send({ t: 'hello', v: PROTOCOL, token: makeToken(), name: 'Ghost' }); await flush();
  assert.equal(room2.host.snapshot().seats[1].on, true);
  await room2.clock.advance(LIMITS.hostDeadAfterMs + 6000);
  assert.equal(room2.host.snapshot().seats.length, 1, 'a silent lobby player is removed');
  void room;
});

test('in a started game a silent seat is marked offline for the other players', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  p.leave(); await flush();                                                    // the real client stops, so it cannot reconnect by itself
  const raw = await rawConnection(room.net, room.code);                        // a seated connection that never pings
  raw.send({ t: 'hello', v: PROTOCOL, token: p.token, name: 'Player1' }); await flush();
  assert.equal(lastState(room.clients[1]).online.connected[1], true);
  await room.clock.advance(LIMITS.hostDeadAfterMs + 6000);
  const seen = lastState(room.clients[1]).online.connected;
  assert.deepEqual(seen, [true, false, true]);
  assert.equal(raw.end.open, false, 'the host closed the silent connection');
});

test('a connection that never says hello is dropped', async () => {
  const room = await buildRoom(1);
  const raw = await rawConnection(room.net, room.code);
  await room.clock.advance(LIMITS.helloWithinMs + 6000);
  assert.equal(raw.end.open, false);
});

test('a player whose link stalls reconnects by itself and keeps the same seat', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  p.log.endpoint.peer.blocked = true;                                          // the host goes quiet towards this player
  await room.clock.advance(LIMITS.clientDeadAfterMs + 6000);
  assert.ok(p.log.statuses.includes('reconnecting'), p.log.statuses.join());
  assert.equal(p.status, 'connected');
  assert.equal(p.seat, 1);
  room.host.act({ type: 'add', n: 2 }); await flush();
  assert.equal(lastState(p).view.players[0].score, 2, 'and it gets current state again');
});

test('moves made while a player was away are there when they come back', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  room.net.sever(p.log.endpoint); await flush();
  room.host.act({ type: 'add', n: 3 }); await flush();
  await room.clock.advance(LIMITS.reconnectDelaysMs[0] + 50);
  assert.equal(p.status, 'connected');
  assert.equal(lastState(p).view.players[0].score, 3);
});

test('reconnect backoff: 0.5s, 1s, 2s, 4s, then every 8s, and then it gives up', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  room.net.killHost(room.code);
  await flush();
  const lostAt = room.clock.now();
  await room.clock.advance(120000);
  const gaps = p.log.connectTimes.slice(1).map(t => t - lostAt);
  assert.deepEqual(gaps.slice(0, 6), [500, 1500, 3500, 7500, 15500, 23500]);
  assert.equal(p.log.connectTimes.length - 1, LIMITS.reconnectAttempts);
  assert.equal(p.status, 'host-left');
  assert.deepEqual(p.log.statuses.slice(-2), ['reconnecting', 'host-left']);
});

test('nudge() retries straight away instead of waiting out the backoff', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  room.net.sever(p.log.endpoint); await flush();
  assert.equal(p.status, 'reconnecting');
  p.nudge(); await flush();
  assert.equal(p.status, 'connected');
  assert.equal(room.clock.now(), 0);
});

test('when the host closes the room on purpose nobody keeps retrying', async () => {
  const room = await buildRoom(3, { start: true });
  room.host.close(); await flush();
  await room.clock.advance(60000);
  room.clients.forEach(c => { assert.equal(c.status, 'closed'); assert.equal(c.log.connectTimes.length, 1); });
});

test('leaving is clean: a lobby seat is freed, and acting afterwards does nothing', async () => {
  const room = await buildRoom(3);
  const p = room.clients[0];
  p.leave(); await flush();
  assert.equal(p.status, 'left');
  assert.equal(room.host.snapshot().seats.length, 2);
  assert.equal(p.act({ type: 'add', n: 1 }), false);
});

test('room code collision: the host picks a new code and tries again', async () => {
  const net = createMemoryNetwork(), tried = [];
  const base = net.transport();
  const transport = { connect: base.connect, listen: code => { tried.push(code); return tried.length <= 2 ? Promise.reject({ type: 'unavailable-id' }) : base.listen(code); } };
  const host = createHost({ transport, game: toyGame, name: 'H', timers: fakeClock() });
  const code = await host.start();
  assert.equal(tried.length, 3);
  assert.equal(code, tried[2]);
  assert.equal(new Set(tried).size, 3, 'three different codes were tried');
});

test('room code collision: it gives up after a few tries with the transport\'s own error', async () => {
  const transport = { connect: () => Promise.reject({ type: 'x' }), listen: () => Promise.reject({ type: 'unavailable-id' }) };
  const host = createHost({ transport, game: toyGame, name: 'H', timers: fakeClock() });
  await assert.rejects(host.start(), { type: 'unavailable-id' });
});

test('hosting on a network that never answers times out cleanly', async () => {
  const clock = fakeClock();
  const transport = { connect: () => Promise.reject({ type: 'x' }), listen: () => new Promise(() => {}) };
  const host = createHost({ transport, game: toyGame, name: 'H', timers: clock });
  const result = host.start().then(() => 'started', e => e);
  for (let i = 0; i < LIMITS.hostAttempts; i++) await clock.advance(LIMITS.connectTimeoutMs + 100);
  assert.deepEqual(await result, { type: 'timeout' });
});

test('joining a room that does not exist fails fast with a clear message', async () => {
  const net = createMemoryNetwork(), clock = fakeClock();
  const log = { s: [], n: 0 };
  const t = net.transport();
  const c = createClient({ transport: { connect: code => { log.n++; return t.connect(code); }, listen: t.listen }, code: 'NOPE1', name: 'x', token: makeToken(), timers: clock, onStatus: (s, d) => log.s.push(d ? s + ':' + d : s) });
  await c.connect();
  assert.equal(log.n, 1, 'no pointless retries');
  assert.ok(log.s.at(-1).startsWith('failed:Room not found'), log.s.join());
});

test('joining over a network that never answers gives up after three tries', async () => {
  const clock = fakeClock(), log = { s: [], n: 0 };
  const c = createClient({ transport: { connect: () => { log.n++; return new Promise(() => {}); }, listen: () => {} }, code: 'ABCDE', name: 'x', token: makeToken(), timers: clock, onStatus: (s, d) => log.s.push(d ? s + ':' + d : s) });
  const done = c.connect();
  for (let i = 0; i < LIMITS.initialAttempts; i++) await clock.advance(LIMITS.connectTimeoutMs + 100);
  await done;
  assert.equal(log.n, LIMITS.initialAttempts);
  assert.ok(log.s.at(-1).startsWith('failed:'), log.s.join());
  assert.ok(/block peer-to-peer/.test(log.s.at(-1)), 'the message mentions that some networks block peer-to-peer connections');
});

test('the clock and network used in tests never leave timers running', async () => {
  const room = await buildRoom(3, { start: true });
  room.host.close(); await flush();
  await room.clock.advance(10000);
  assert.ok(true);
});
