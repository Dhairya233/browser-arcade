// Host-authoritative room, shared by both games.
//
// The host's browser holds the one true game state. Players send actions; the host checks each
// one, applies it, and sends every seat a view of the result that contains only what that seat
// is allowed to see. Nothing a client says is trusted:
//   - who is acting comes from the connection, never from the message;
//   - every action goes through game.validate() before game.apply();
//   - a returning player proves who they are with a secret token; a name alone is not enough,
//     it needs the host's approval.
//
// A game plugs in by supplying an adapter:
//   id, minPlayers, maxPlayers
//   colors?                         optional list of seat colours players can pick in the lobby
//   defaultSettings                 host-chosen options, e.g. {hideMode:'off'}
//   validateSetting(key, value)     -> boolean
//   start(seats, settings, rng)     -> state          (seats: [{name, color}])
//   view(state, seat)               -> JSON-safe object for that seat, with hidden data removed
//   validate(state, seat, action)   -> boolean
//   apply(state, seat, action)      -> {state, events}   (events: {type:'toast',msg} | {type:'sound',sound})
// The host is also a player: it plays through the same validate/apply path as everyone else.

import { PROTOCOL, LIMITS, DEFAULT_TIMERS, cleanName, parseMessage, withTimeout } from './protocol.js';
import { makeCode, makeToken, TOKEN_PATTERN } from './ids.js';

export function createHost(opts) {
  const { transport, game, name, rng, onUpdate = () => {}, onRequest = () => {}, timers = DEFAULT_TIMERS } = opts;

  const seats = [];                 // {token, name, color, conn, connected}
  const meta = new Map();           // conn -> {seat, lastSeen, since, times[]}
  const pending = new Map();        // id -> {id, seat, name, token, conn, timer}
  let nextRequestId = 1;
  let phase = 'lobby';              // 'lobby' | 'playing'
  let state = null;
  let settings = Object.assign({}, game.defaultSettings || {});
  let code = null;
  let listener = null;
  let closed = false;
  let sweepTimer = null;

  /* ---------- small helpers ---------- */
  const idx = seat => seats.indexOf(seat);
  const publicSeats = () => seats.map(s => ({ name: s.name, color: s.color, on: !!s.connected }));
  const freeColor = () => (game.colors || []).find(c => !seats.some(s => s.color === c)) || null;
  const uniqueName = (wanted, except) => {
    let n = wanted, k = 2;
    while (seats.some(s => s !== except && s.name.toLowerCase() === n.toLowerCase())) n = `${wanted.slice(0, 13)} ${k++}`;
    return n;
  };
  const send = (conn, msg) => { try { if (conn && conn.open) conn.send(JSON.stringify(msg)); } catch (e) { /* connection died; the close handler cleans up */ } };
  const reject = (conn, reason) => {
    send(conn, { t: 'reject', reason });
    timers.setTimeout(() => { try { conn.close(); } catch (e) { /* ignore */ } }, 400);
  };
  const online = () => ({ code, connected: seats.map(s => !!s.connected) });

  /* ---------- sending views ---------- */
  function messageFor(i, events) {
    if (phase === 'lobby') {
      return { t: 'lobby', you: i, code, settings, seats: publicSeats(), min: game.minPlayers, max: game.maxPlayers, colors: game.colors || null };
    }
    const msg = { t: 'state', you: i, view: game.view(state, i), online: online() };
    const mine = (events || []).filter(e => e.type === 'sound' || (e.type === 'toast' && e.to === i));
    if (mine.length) msg.events = mine.map(e => (e.type === 'toast' ? { type: 'toast', msg: e.msg } : { type: 'sound', sound: e.sound }));
    return msg;
  }

  function broadcast(events) {
    seats.forEach((s, i) => {
      if (i === 0 || !s.conn) return;                 // seat 0 is the host itself
      try { send(s.conn, messageFor(i, events)); } catch (e) { /* a view that cannot be built is not sent */ }
    });
    notifyHost(events);
  }

  function notifyHost(events) {
    let snap;
    try { snap = snapshot(events); } catch (e) { return; }
    onUpdate(snap);
  }

  function snapshot(events) {
    const base = { phase, code, you: 0, seats: publicSeats(), settings, min: game.minPlayers, max: game.maxPlayers, colors: game.colors || null,
      requests: [...pending.values()].map(r => ({ id: r.id, name: r.name, seatName: r.seat.name })) };
    if (phase === 'playing') {
      const mine = (events || []).filter(e => e.type === 'sound' || (e.type === 'toast' && e.to === 0));
      return Object.assign(base, { view: game.view(state, 0), online: online(), events: mine.map(e => (e.type === 'toast' ? { type: 'toast', msg: e.msg } : { type: 'sound', sound: e.sound })) });
    }
    return base;
  }

  /* ---------- connections ---------- */
  function onConnection(conn) {
    if (closed) { try { conn.close(); } catch (e) { /* ignore */ } return; }
    meta.set(conn, { seat: null, lastSeen: timers.now(), since: timers.now(), times: [] });
    conn.onMessage = raw => handleRaw(conn, raw);
    conn.onClose = () => handleClose(conn);
  }

  function handleRaw(conn, raw) {
    const m0 = meta.get(conn);
    if (!m0 || closed) return;
    const now = timers.now();
    m0.times = m0.times.filter(t => now - t < LIMITS.rateWindowMs);
    if (m0.times.length >= LIMITS.rateMax) return;       // flood: ignore the excess
    m0.times.push(now);
    m0.lastSeen = now;
    const m = parseMessage(raw);
    if (!m) return;
    if (m.t === 'hello') { if (!m0.seat) handleHello(conn, m); return; }
    if (m.t === 'bye') { handleClose(conn); try { conn.close(); } catch (e) { /* ignore */ } return; }
    const waiting = !m0.seat && [...pending.values()].some(r => r.conn === conn);
    if (m.t === 'ping' && (m0.seat || waiting)) { send(conn, { t: 'pong' }); return; }   // keeps a waiting player's link alive
    if (!m0.seat) return;                                 // nobody who has not been seated can do anything else
    if (m.t === 'act') {
      const r = runAction(m0.seat, m.action);
      if (!r.ok) send(conn, { t: 'nack', reason: r.reason });
      return;
    }
    if (m.t === 'pref') { setColor(m0.seat, m.color); return; }
  }

  function handleClose(conn) {
    const m = meta.get(conn);
    meta.delete(conn);
    for (const r of [...pending.values()]) if (r.conn === conn) dropRequest(r.id);
    if (!m || !m.seat || m.seat.conn !== conn) return;
    const seat = m.seat;
    if (phase === 'lobby' && idx(seat) !== 0) seats.splice(idx(seat), 1);
    else { seat.conn = null; seat.connected = idx(seat) === 0; }
    broadcast();
  }

  /* ---------- joining, returning, taking over ---------- */
  function handleHello(conn, m) {
    if (m.v !== PROTOCOL) return reject(conn, 'Your copy of the game is out of date. Reload the page and try again.');
    if (typeof m.token !== 'string' || !TOKEN_PATTERN.test(m.token)) return reject(conn, 'That join request was not valid.');
    const nm = cleanName(m.name);
    const known = seats.find(s => s.token === m.token);
    if (known) return attach(conn, known, nm);                       // the token proves it is them
    if (phase === 'lobby') {
      if (seats.length >= game.maxPlayers) return reject(conn, 'This room is full.');
      const seat = { token: m.token, name: uniqueName(nm || `Player ${seats.length + 1}`), color: freeColor(), conn: null, connected: false };
      seats.push(seat);
      return attach(conn, seat);
    }
    // The game has started and this token is new. Only a name match on an empty seat can lead anywhere.
    const byName = seats.find(s => nm && s.name.toLowerCase() === nm.toLowerCase());
    if (!byName) return reject(conn, 'That game has already started. To rejoin, use the same name as before.');
    if (byName.connected) return reject(conn, 'That seat is still connected. If this is you, wait about 15 seconds and try again.');
    requestTakeover(conn, byName, m.token, nm);
  }

  function attach(conn, seat, nm) {
    if (seat.conn && seat.conn !== conn) {
      const old = meta.get(seat.conn); if (old) old.seat = null;
      try { seat.conn.close(); } catch (e) { /* ignore */ }
    }
    seat.conn = conn; seat.connected = true;
    meta.get(conn).seat = seat;
    if (phase === 'lobby' && nm) seat.name = uniqueName(nm, seat);
    send(conn, { t: 'welcome', seat: idx(seat), code });
    broadcast();
  }

  function requestTakeover(conn, seat, token, nm) {
    for (const r of [...pending.values()]) if (r.seat === seat) { send(r.conn, { t: 'reject', reason: 'Replaced by a newer request for the same seat.' }); dropRequest(r.id); }
    const id = nextRequestId++;
    const timer = timers.setTimeout(() => { const r = pending.get(id); if (r) { reject(r.conn, 'The host did not answer in time.'); dropRequest(id); notifyHost(); } }, LIMITS.requestExpiresMs);
    pending.set(id, { id, seat, name: nm, token, conn, timer });
    send(conn, { t: 'pending' });
    try { onRequest({ id, name: nm, seatName: seat.name }); } catch (e) { /* the UI callback must not break the room */ }
    notifyHost();
  }

  function dropRequest(id) {
    const r = pending.get(id); if (!r) return;
    timers.clearTimeout(r.timer); pending.delete(id);
  }

  /* ---------- actions ---------- */
  function runAction(seat, action) {
    if (phase !== 'playing') return { ok: false, reason: 'The game has not started yet.' };
    const i = idx(seat);
    if (i < 0) return { ok: false, reason: 'You are not in this game.' };
    let allowed = false;
    try { allowed = game.validate(state, i, action) === true; } catch (e) { allowed = false; }
    if (!allowed) return { ok: false, reason: 'That move is not allowed right now.' };
    let res;
    try { res = game.apply(state, i, action); } catch (e) { return { ok: false, reason: 'That move could not be applied.' }; }
    state = res.state;
    // a toast belongs to whoever caused it
    const events = (res.events || []).map(e => (e.type === 'toast' ? Object.assign({}, e, { to: i }) : e));
    broadcast(events);
    return { ok: true };
  }

  function setColor(seat, color) {
    if (phase !== 'lobby' || !game.colors || !game.colors.includes(color)) return;
    const other = seats.find(s => s !== seat && s.color === color);
    if (other) other.color = seat.color;
    seat.color = color;
    broadcast();
  }

  /* ---------- public API ---------- */
  async function start() {
    seats.push({ token: makeToken(), name: cleanName(name) || 'Player 1', color: freeColor(), conn: null, connected: true });
    let lastErr = null;
    for (let attempt = 0; attempt < LIMITS.hostAttempts; attempt++) {
      const candidate = makeCode(rng);
      try {
        listener = await withTimeout(transport.listen(candidate), LIMITS.connectTimeoutMs, timers);
        code = candidate;
        listener.onConnection = onConnection;
        sweepTimer = timers.setInterval(sweep, 5000);
        notifyHost();
        return code;
      } catch (err) {
        lastErr = err;
        if (err && (err.type === 'unavailable-id' || err.type === 'timeout')) continue;   // new code, try again
        break;
      }
    }
    throw lastErr || { type: 'unknown' };
  }

  // Drop connections that have gone quiet, or never said hello.
  function sweep() {
    const now = timers.now();
    for (const [conn, m] of [...meta.entries()]) {
      const quiet = now - m.lastSeen;
      const waitingForApproval = [...pending.values()].some(r => r.conn === conn);
      // seated players and people waiting for the host's answer keep the link alive by pinging;
      // anyone else has only a few seconds to say hello
      const dead = (m.seat || waitingForApproval) ? quiet > LIMITS.hostDeadAfterMs : now - m.since > LIMITS.helloWithinMs;
      if (dead) { handleClose(conn); try { conn.close(); } catch (e) { /* ignore */ } }
    }
  }

  return {
    start,
    get code() { return code; },
    get phase() { return phase; },
    snapshot: () => snapshot(),

    setSetting(key, value) {
      if (phase !== 'lobby' || !game.validateSetting || game.validateSetting(key, value) !== true) return false;
      settings = Object.assign({}, settings, { [key]: value });
      broadcast(); return true;
    },
    setColor: color => setColor(seats[0], color),

    startGame() {
      if (phase !== 'lobby' || seats.length < game.minPlayers) return false;
      state = game.start(seats.map(s => ({ name: s.name, color: s.color })), Object.assign({}, settings), rng);
      phase = 'playing';
      broadcast(); return true;
    },

    // the host plays through the same checks as everyone else
    act(action) { const r = runAction(seats[0], action); if (!r.ok) notifyHost(); return r; },

    approve(id) {
      const r = pending.get(id); if (!r) return false;
      dropRequest(id);
      if (r.seat.connected || !meta.has(r.conn)) { reject(r.conn, 'That seat is already in use.'); notifyHost(); return false; }
      r.seat.token = r.token;                          // from now on the old token is worthless
      attach(r.conn, r.seat); return true;
    },
    deny(id) {
      const r = pending.get(id); if (!r) return false;
      reject(r.conn, 'The host declined your request.'); dropRequest(id); notifyHost(); return true;
    },

    // Remove a seat's connection and make its token worthless, so the player has to ask the host again.
    kick(seatIndex) {
      const s = seats[seatIndex]; if (!s || seatIndex === 0) return false;
      s.token = makeToken();
      const c = s.conn;
      if (c) { send(c, { t: 'reject', reason: 'The host removed you from the room.' }); handleClose(c); try { c.close(); } catch (e) { /* ignore */ } }
      return true;
    },

    close() {
      if (closed) return; closed = true;
      timers.clearInterval(sweepTimer);
      for (const r of [...pending.values()]) { send(r.conn, { t: 'closed' }); dropRequest(r.id); }
      seats.forEach(s => send(s.conn, { t: 'closed' }));
      timers.setTimeout(() => { try { listener && listener.close(); } catch (e) { /* ignore */ } }, 150);
    },
  };
}
