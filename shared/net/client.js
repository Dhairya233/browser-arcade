// Player side of a room.
//
// Statuses reported through onStatus(status, detail):
//   connecting     first connection attempt(s)
//   pending        the host has to approve a name-only takeover of a seat
//   connected      seated and receiving updates
//   reconnecting   the link dropped; retrying with growing delays
//   host-left      gave up reconnecting (the host closed their tab or lost connection)
//   closed         the host closed the room on purpose
//   rejected       the host refused us (detail is the reason)
//   failed         could not reach the room at all (detail is a plain-English reason)
//   left           we left on purpose

import { PROTOCOL, LIMITS, DEFAULT_TIMERS, parseMessage, withTimeout, describeNetError } from './protocol.js';

export function createClient(opts) {
  const { transport, code, name, token, timers = DEFAULT_TIMERS,
    onStatus = () => {}, onLobby = () => {}, onState = () => {}, onNack = () => {} } = opts;

  let conn = null;
  let status = 'idle';
  let seated = false;           // has the host ever welcomed us?
  let lastHeard = 0;
  let beat = null;
  let retryTimer = null;
  let attempt = 0;
  let stopped = false;
  let you = null;

  function setStatus(s, detail) {
    if (status === s && detail === undefined) return;
    status = s; onStatus(s, detail);
  }
  const terminal = s => ['host-left', 'closed', 'rejected', 'failed', 'left'].includes(s);

  function startHeartbeat() {
    stopHeartbeat();
    beat = timers.setInterval(() => {
      if (!conn) return;
      if (timers.now() - lastHeard > LIMITS.clientDeadAfterMs) { lost(); return; }
      try { conn.send(JSON.stringify({ t: 'ping' })); } catch (e) { lost(); }
    }, LIMITS.heartbeatEveryMs);
  }
  function stopHeartbeat() { if (beat != null) { timers.clearInterval(beat); beat = null; } }

  function attach(c) {
    conn = c; lastHeard = timers.now();
    c.onMessage = raw => { if (conn === c) handle(raw); };
    c.onClose = () => { if (conn === c) lost(); };
    try { c.send(JSON.stringify({ t: 'hello', v: PROTOCOL, token, name })); } catch (e) { lost(); return; }
    startHeartbeat();
  }

  function handle(raw) {
    lastHeard = timers.now();
    const m = parseMessage(raw);
    if (!m) return;
    switch (m.t) {
      case 'welcome': seated = true; attempt = 0; you = m.seat; setStatus('connected'); break;
      case 'pending': setStatus('pending'); break;
      case 'lobby': seated = true; attempt = 0; you = m.you; setStatus('connected'); onLobby(m); break;
      case 'state': seated = true; attempt = 0; you = m.you; setStatus('connected'); onState(m); break;
      case 'nack': onNack(m.reason); break;
      case 'reject': finish('rejected', m.reason); break;
      case 'closed': finish('closed'); break;
      case 'pong': break;
      default: break;
    }
  }

  function finish(s, detail) {
    stopHeartbeat(); clearRetry();
    const c = conn; conn = null;
    try { c && c.close(); } catch (e) { /* ignore */ }
    setStatus(s, detail);
  }

  function clearRetry() { if (retryTimer != null) { timers.clearTimeout(retryTimer); retryTimer = null; } }

  // the link dropped, or went silent
  function lost() {
    if (stopped || terminal(status)) return;
    stopHeartbeat();
    const c = conn; conn = null;
    try { c && c.close(); } catch (e) { /* ignore */ }
    if (!seated) { setStatus('failed', 'Could not connect to the room. Try again.'); return; }
    setStatus('reconnecting');
    scheduleRetry();
  }

  function scheduleRetry() {
    clearRetry();
    if (attempt >= LIMITS.reconnectAttempts) { setStatus('host-left'); return; }
    const delays = LIMITS.reconnectDelaysMs;
    const wait = delays[Math.min(attempt, delays.length - 1)];
    attempt++;
    retryTimer = timers.setTimeout(tryReconnect, wait);
  }

  async function tryReconnect() {
    retryTimer = null;
    if (stopped || status !== 'reconnecting') return;
    try {
      const c = await withTimeout(transport.connect(code), LIMITS.connectTimeoutMs, timers);
      if (stopped || status !== 'reconnecting') { try { c.close(); } catch (e) { /* ignore */ } return; }
      attach(c);
    } catch (err) {
      if (!stopped && status === 'reconnecting') scheduleRetry();
    }
  }

  async function connect() {
    stopped = false; setStatus('connecting');
    let lastErr = null;
    for (let n = 0; n < LIMITS.initialAttempts; n++) {
      try {
        const c = await withTimeout(transport.connect(code), LIMITS.connectTimeoutMs, timers);
        if (stopped) { try { c.close(); } catch (e) { /* ignore */ } return; }
        attach(c); return;
      } catch (err) {
        lastErr = err;
        if (stopped) return;
        if (err && err.type === 'not-found') break;          // no point retrying a room that does not exist
      }
    }
    setStatus('failed', describeNetError(lastErr));
  }

  return {
    connect,
    get status() { return status; },
    get seat() { return you; },
    act(action) {
      if (status !== 'connected' || !conn) return false;
      try { conn.send(JSON.stringify({ t: 'act', action })); return true; } catch (e) { return false; }
    },
    pref(color) { if (conn) try { conn.send(JSON.stringify({ t: 'pref', color })); } catch (e) { /* ignore */ } },
    // e.g. the tab became visible again: do not wait out the backoff
    nudge() { if (status === 'reconnecting') { clearRetry(); tryReconnect(); } },
    leave() {
      stopped = true;
      try { conn && conn.send(JSON.stringify({ t: 'bye' })); } catch (e) { /* ignore */ }
      finish('left');
    },
  };
}
