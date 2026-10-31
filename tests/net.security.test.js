// Netcode security tests: these act like a hostile player with DevTools open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoom, joinClient, rawConnection, flush, wireTo, lastState, toyGame } from './helpers.js';
import { makeToken } from '../shared/net/ids.js';
import { LIMITS, PROTOCOL } from '../shared/net/protocol.js';

const hello = (token, name) => ({ t: 'hello', v: PROTOCOL, token, name });
const scoreOf = (room, seat) => room.host.snapshot().view.players[seat].score;

test('hidden information: each seat receives only its own secret, and nobody receives a token', async () => {
  const room = await buildRoom(4, { start: true });
  room.host.act({ type: 'add', n: 1 }); await flush();
  room.clients[0].act({ type: 'add', n: 2 }); await flush();
  const hostToken = 'unknown-to-clients';   // the host's own token is generated inside the host; scan for the shape instead
  room.clients.forEach((c, k) => {
    const seat = k + 1, wire = wireTo(c);
    for (let other = 0; other < 4; other++) {
      if (other === seat) assert.ok(wire.includes(`SECRET-OF-SEAT-${other}`), `seat ${seat} should see its own secret`);
      else assert.ok(!wire.includes(`SECRET-OF-SEAT-${other}`), `seat ${seat} must not see the secret of seat ${other}`);
    }
    assert.ok(!/"token"/.test(wire), 'no message carries a token field');
    room.clients.forEach(o => assert.ok(!wire.includes(o.token), 'no player ever receives anyone else\'s token'));
    assert.ok(!/[0-9a-f]{32}/.test(wire), 'nothing in the traffic looks like a 128-bit token');
  });
  void hostToken;
});

test('acting out of turn is refused and changes nothing', async () => {
  const room = await buildRoom(3, { start: true });
  room.clients[0].act({ type: 'add', n: 3 }); await flush();       // seat 1 acts while it is seat 0's turn
  assert.equal(scoreOf(room, 1), 0);
  assert.deepEqual(room.clients[0].log.nacks, ['That move is not allowed right now.']);
});

test('a client cannot act for another seat: seat fields in the message are ignored', async () => {
  const room = await buildRoom(3, { start: true });
  const attacker = room.clients[0];                                 // seat 1; it is seat 0's turn
  for (const forged of [{ type: 'add', n: 3, seat: 0 }, { type: 'add', n: 3, playerIdx: 0 }, { type: 'add', n: 3, as: 0, from: 0 }]) {
    attacker.log.endpoint.send(JSON.stringify({ t: 'act', action: forged, seat: 0, playerIdx: 0 }));
  }
  await flush();
  assert.equal(scoreOf(room, 0), 0, 'seat 0 score untouched');
  assert.equal(scoreOf(room, 1), 0, 'and nothing was applied for the attacker either');
  assert.equal(room.clients[0].log.nacks.length, 3);
});

test('illegal moves and junk actions are all refused, and the host keeps working', async () => {
  const room = await buildRoom(3, { start: true });
  const junk = [{ type: 'add', n: 99 }, { type: 'add', n: -1 }, { type: 'add', n: '1' }, { type: 'add', n: 1.5 }, { type: 'add' }, { type: 'nope', n: 1 },
    null, 7, 'add', [], [{ type: 'add', n: 1 }], { type: 'add', n: 1, __proto__: { x: 1 } }, { type: { toString: 1 }, n: 1 }];
  const sender = room.clients[0];
  for (const a of junk) sender.log.endpoint.send(JSON.stringify({ t: 'act', action: a }));
  sender.log.endpoint.send(JSON.stringify({ t: 'act' }));
  await flush();
  assert.equal(scoreOf(room, 0), 0);
  assert.equal(room.host.act({ type: 'add', n: 2 }).ok, true, 'the host is still fine');
  await flush();
  assert.equal(scoreOf(room, 0), 2);
});

test('garbage on the wire is ignored: bad JSON, wrong shapes, oversized, unseated senders', async () => {
  const room = await buildRoom(3, { start: true });
  const raw = await rawConnection(room.net, room.code);
  for (const s of ['not json', '{"t":', '[]', '"x"', 'null', '42', '{"t":42}', '{}', JSON.stringify({ t: 'act', action: { type: 'add', n: 1 } }),
    JSON.stringify({ t: 'ping' }), JSON.stringify({ t: 'pref', color: 'red' }), 'x'.repeat(LIMITS.maxMessageChars + 1)]) raw.send(s);
  await flush();
  assert.deepEqual(raw.received(), [], 'a connection that never said hello gets nothing back, not even a pong');
  assert.equal(scoreOf(room, 0), 0);
  assert.equal(room.host.act({ type: 'add', n: 1 }).ok, true);
});

test('an unseated connection never receives game state', async () => {
  const room = await buildRoom(3, { start: true });
  const raw = await rawConnection(room.net, room.code);
  room.host.act({ type: 'add', n: 1 }); await flush();
  assert.equal(raw.receivedRaw().length, 0);
});

test('a join with a bad token or the wrong protocol version is rejected', async () => {
  const room = await buildRoom(3);
  for (const m of [{ t: 'hello', v: PROTOCOL, token: 'short', name: 'x' }, { t: 'hello', v: PROTOCOL, token: 'ZZZZ'.repeat(8), name: 'x' }, { t: 'hello', v: PROTOCOL, name: 'x' },
    { t: 'hello', v: PROTOCOL + 1, token: makeToken(), name: 'x' }, { t: 'hello', token: makeToken(), name: 'x' }]) {
    const raw = await rawConnection(room.net, room.code);
    raw.send(m); await flush();
    assert.equal(raw.received()[0].t, 'reject', JSON.stringify(m));
  }
});

test('lobby: duplicate names are made unique, the room can fill up, and names are cleaned', async () => {
  const room = await buildRoom(1);
  const a = await joinClient({ ...room, name: 'Sam' });
  const b = await joinClient({ ...room, name: 'sam' });
  const c = await joinClient({ ...room, name: '<img src=x onerror=alert(1)>' });
  const names = room.host.snapshot().seats.map(s => s.name);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, 'all names unique: ' + names);
  assert.ok(!names.some(n => /[<>&"'`]/.test(n)), 'no HTML characters survive: ' + names);
  const d = await joinClient({ ...room, name: 'Late' });
  assert.ok(d.log.statuses.some(s => s.startsWith('rejected:This room is full')), d.log.statuses.join());
  void a; void b; void c;
});

test('one connection cannot take a second seat by saying hello twice', async () => {
  const room = await buildRoom(1);
  const raw = await rawConnection(room.net, room.code);
  raw.send(hello(makeToken(), 'First')); raw.send(hello(makeToken(), 'Second')); raw.send(hello(makeToken(), 'Third'));
  await flush();
  assert.equal(room.host.snapshot().seats.length, 2);
  assert.equal(raw.received().filter(m => m.t === 'welcome').length, 1);
});

test('reconnecting with the right token restores the same seat and its private view', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  room.net.sever(p.log.endpoint); await flush();
  assert.equal(room.host.snapshot().online.connected[1], false);
  const back = await joinClient({ ...room, name: 'Player1', token: p.token });
  assert.equal(back.seat, 1);
  assert.ok(lastState(back).view.players[1].secret === 'SECRET-OF-SEAT-1');
  assert.equal(room.host.snapshot().online.connected[1], true);
});

test('someone else\'s token cannot be guessed into a seat; a connected seat cannot be hijacked by name', async () => {
  const room = await buildRoom(3, { start: true });
  const thief = await joinClient({ ...room, name: 'Player1', token: makeToken() });          // right name, wrong token, seat still connected
  assert.ok(thief.log.statuses.some(s => s.startsWith('rejected:That seat is still connected')), thief.log.statuses.join());
  assert.equal(thief.log.states.length, 0, 'the thief received no game state');
  assert.ok(!wireTo(thief).includes('SECRET-OF-SEAT'));
});

test('a stranger with an unknown name cannot join a game in progress', async () => {
  const room = await buildRoom(3, { start: true });
  const s = await joinClient({ ...room, name: 'Nobody' });
  assert.ok(s.log.statuses.some(x => x.startsWith('rejected:That game has already started')));
  assert.equal(room.host.snapshot().seats.length, 3);
});

test('name-only takeover: nothing is sent until the host approves, and then the old token is dead', async () => {
  const room = await buildRoom(3, { start: true });
  const victim = room.clients[0];
  room.net.sever(victim.log.endpoint); await flush();
  const taker = await joinClient({ ...room, name: 'Player1' });
  assert.ok(taker.log.statuses.includes('pending'), taker.log.statuses.join());
  assert.equal(room.requests.length, 1);
  assert.equal(taker.log.states.length, 0, 'no state while pending');
  assert.ok(!wireTo(taker).includes('SECRET'), 'no secrets while pending');
  assert.equal(room.host.snapshot().requests.length, 1);

  assert.equal(room.host.approve(room.requests[0].id), true); await flush();
  assert.equal(taker.seat, 1);
  assert.equal(lastState(taker).view.players[1].secret, 'SECRET-OF-SEAT-1');

  // the original player's token no longer works: they are just another stranger now
  room.net.sever(taker.log.endpoint); await flush();
  const old = await joinClient({ ...room, name: 'Player1', token: victim.token });
  assert.ok(old.log.statuses.includes('pending'), 'the old token earns no automatic seat: ' + old.log.statuses.join());
});

test('name-only takeover: a refusal sends nothing, and an unanswered request expires', async () => {
  const room = await buildRoom(3, { start: true });
  room.net.sever(room.clients[0].log.endpoint); await flush();
  const t1 = await joinClient({ ...room, name: 'Player1' });
  room.host.deny(room.requests[0].id); await flush();
  assert.ok(t1.log.statuses.some(s => s.startsWith('rejected:The host declined')));
  assert.equal(t1.log.states.length, 0);

  const t2 = await joinClient({ ...room, name: 'Player1' });
  await room.clock.advance(LIMITS.requestExpiresMs + 1000);
  assert.ok(t2.log.statuses.some(s => s.startsWith('rejected:The host did not answer')), t2.log.statuses.join());
  assert.equal(room.host.snapshot().requests.length, 0);
  assert.equal(room.host.approve(999), false);
});

test('approving a request after the seat came back is refused', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  room.net.sever(p.log.endpoint); await flush();
  const taker = await joinClient({ ...room, name: 'Player1' });
  await joinClient({ ...room, name: 'Player1', token: p.token });          // the real player comes back first
  assert.equal(room.host.approve(room.requests[0].id), false);
  await flush();
  assert.ok(taker.log.statuses.some(s => s.startsWith('rejected:That seat is already in use')), taker.log.statuses.join());
});

test('a kicked player\'s token stops working', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  assert.equal(room.host.kick(1), true); await flush();
  assert.ok(p.log.statuses.some(s => s.startsWith('rejected:The host removed you')));
  const again = await joinClient({ ...room, name: 'Player1', token: p.token });
  assert.ok(again.log.statuses.includes('pending'), 'must now ask the host again');
  assert.equal(room.host.kick(0), false, 'the host cannot be kicked');
});

test('a flood of messages is throttled and the host survives', async () => {
  const room = await buildRoom(3, { start: true });
  const p = room.clients[0];
  for (let i = 0; i < 500; i++) p.log.endpoint.send(JSON.stringify({ t: 'ping' }));
  await flush();
  const pongs = p.log.endpoint.peer.sent.filter(s => s === '{"t":"pong"}').length;
  assert.ok(pongs <= LIMITS.rateMax, `answered ${pongs} of 500`);
  assert.equal(room.host.act({ type: 'add', n: 1 }).ok, true);
});

test('a game adapter that throws cannot crash the host or leak a half-built view', async () => {
  const hostile = { ...toyGame,
    validate: (s, seat, a) => { if (a && a.boom === 'validate') throw new Error('x'); return toyGame.validate(s, seat, a); },
    apply: (s, seat, a) => { if (a.boom === 'apply') throw new Error('y'); return toyGame.apply(s, seat, a); } };
  const room = await buildRoom(3, { game: hostile, start: true });
  assert.equal(room.host.act({ boom: 'validate' }).ok, false);
  assert.equal(room.host.act({ type: 'add', n: 1, boom: 'apply' }).ok, false, 'apply threw: refused, not crashed');
  assert.equal(room.host.snapshot().view.players[0].score, 0);
  assert.equal(room.host.act({ type: 'add', n: 1 }).ok, true, 'and the room still works afterwards');
  const throwing = { ...toyGame, apply: () => { throw new Error('y'); } };
  const r2 = await buildRoom(3, { game: throwing, start: true });
  assert.equal(r2.host.act({ type: 'add', n: 1 }).ok, false);
  assert.equal(r2.host.snapshot().view.players[0].score, 0, 'state unchanged after a failed apply');
});

test('events: a toast goes only to the player who caused it, a sound goes to everyone', async () => {
  const room = await buildRoom(3, { start: true });
  room.host.act({ type: 'add', n: 1 }); await flush();
  room.clients[0].act({ type: 'add', n: 1 }); await flush();
  const ev = c => lastState(c).events || [];
  assert.deepEqual(ev(room.clients[0]).map(e => e.type).sort(), ['sound', 'toast']);
  assert.deepEqual(ev(room.clients[1]).map(e => e.type), ['sound']);
  const hostLast = room.hostUpdates[room.hostUpdates.length - 1];
  assert.deepEqual(hostLast.events.map(e => e.type), ['sound']);
});

test('lobby colours: swap on a clash, ignore unknown colours, locked once the game starts', async () => {
  const room = await buildRoom(3);
  const [a, b] = room.clients;
  const colorsBefore = room.host.snapshot().seats.map(s => s.color);
  a.pref(colorsBefore[2]); await flush();                          // take seat 2's colour: they swap
  const after = room.host.snapshot().seats.map(s => s.color);
  assert.equal(after[1], colorsBefore[2]); assert.equal(after[2], colorsBefore[1]);
  b.pref('ultraviolet'); await flush();
  assert.deepEqual(room.host.snapshot().seats.map(s => s.color), after);
  room.host.startGame(); await flush();
  a.pref('gold'); await flush();
  assert.deepEqual(room.host.snapshot().seats.map(s => s.color), after);
});

test('settings are validated and only the host can change them', async () => {
  const room = await buildRoom(3);
  assert.equal(room.host.setSetting('rounds', 5), true);
  assert.equal(room.host.setSetting('rounds', 500), false);
  assert.equal(room.host.setSetting('__proto__', 1), false);
  room.clients[0].log.endpoint.send(JSON.stringify({ t: 'set', key: 'rounds', value: 9, settings: { rounds: 9 } })); await flush();
  assert.equal(room.host.snapshot().settings.rounds, 5);
  assert.equal(room.host.startGame(), true);
  assert.equal(room.host.setSetting('rounds', 2), false, 'locked after start');
});

test('the game cannot start with too few players, and cannot be started twice', async () => {
  const room = await buildRoom(2);
  assert.equal(room.host.startGame(), false);
  await joinClient({ ...room, name: 'Third' });
  assert.equal(room.host.startGame(), true);
  assert.equal(room.host.startGame(), false);
});

test('actions before the game starts are refused', async () => {
  const room = await buildRoom(3);
  assert.equal(room.host.act({ type: 'add', n: 1 }).ok, false);
  room.clients[0].act({ type: 'add', n: 1 }); await flush();
  assert.deepEqual(room.clients[0].log.nacks, ['The game has not started yet.']);
});

test('hostile payloads from a seated player: deep nesting, prototype pollution and unseen-character names do nothing', async () => {
  const room = await buildRoom(3, { start: true });
  const me = room.clients[0];
  const send = s => me.log.endpoint.send(typeof s === 'string' ? s : JSON.stringify(s));
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  send(`{"t":"act","action":${deep}}`);                                   // JSON that nests far too deeply
  send('{"t":"act","action":{"__proto__":{"polluted":true},"type":"add","n":1}}');
  send('{"t":"hello","v":1,"token":"' + makeToken() + '","name":{"__proto__":{"polluted":true}}}');
  send('{"t":"pref","color":{"__proto__":{"polluted":true}}}');
  await flush();
  assert.equal(({}).polluted, undefined, 'Object.prototype must stay clean');
  assert.equal(room.host.act({ type: 'add', n: 1 }).ok, true, 'the host still works');
});

test('lobby names: blank-looking and text-direction tricks cannot make two players look alike', async () => {
  const room = await buildRoom(1);
  const a = await joinClient({ net: room.net, clock: room.clock, code: room.code, name: '​‍ ' });
  const b = await joinClient({ net: room.net, clock: room.clock, code: room.code, name: 'Al‮ice' });
  const c = await joinClient({ net: room.net, clock: room.clock, code: room.code, name: 'Alice' });
  await flush();
  const names = room.hostUpdates[room.hostUpdates.length - 1].seats.map(s => s.name);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, 'every seat has a distinct name: ' + names.join(' | '));
  assert.ok(names.every(n => n.trim() && !/[​-‏‪-‮]/.test(n)), 'and a visible one: ' + names.join(' | '));
  void a; void b; void c;
});
