// Shared constants and small helpers for the room protocol.
//
// Every message is a JSON string. Players never put a seat number in a message they
// send: the host works out who is talking from the connection the message arrived on.
//
//   client -> host   hello {v, token, name}   act {action}   pref {color}   ping   bye
//   host   -> client welcome {seat, code}     pending        lobby {...}    state {...}
//                    reject {reason}          nack {reason}  closed         pong

export const PROTOCOL = 1;

export const LIMITS = {
  maxMessageChars: 200000,   // anything bigger is ignored
  rateWindowMs: 5000,        // flood guard: at most this many messages per window per connection
  rateMax: 80,
  heartbeatEveryMs: 4000,    // clients ping this often
  clientDeadAfterMs: 12000,  // a client that has heard nothing from the host for this long reconnects
  hostDeadAfterMs: 15000,    // the host drops a seat that has been silent this long
  helloWithinMs: 10000,      // a connection that never says hello is dropped
  connectTimeoutMs: 12000,
  requestExpiresMs: 60000,   // how long a name-only takeover waits for the host to answer
  initialAttempts: 3,
  hostAttempts: 4,
  reconnectDelaysMs: [500, 1000, 2000, 4000, 8000],
  reconnectAttempts: 12,
};

// Strip characters that could be read as HTML, trim, and cap the length.
export function cleanName(n) {
  return String(n == null ? '' : n).replace(/[<>&"'`]/g, '').trim().slice(0, 16);
}

export function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.maxMessageChars) return null;
  let m;
  try { m = JSON.parse(raw); } catch (e) { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return null;
  return m;
}

export const DEFAULT_TIMERS = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
  now: () => Date.now(),
};

// Reject with {type:'timeout'} if `promise` has not settled after `ms`. If it settles
// later and produces something with a close() method, close it so nothing leaks.
export function withTimeout(promise, ms, timers = DEFAULT_TIMERS) {
  return new Promise((resolve, reject) => {
    let done = false;
    const id = timers.setTimeout(() => { done = true; reject({ type: 'timeout' }); }, ms);
    promise.then(
      v => { if (done) { try { v && v.close && v.close(); } catch (e) { /* ignore */ } return; } done = true; timers.clearTimeout(id); resolve(v); },
      e => { if (done) return; done = true; timers.clearTimeout(id); reject(e); }
    );
  });
}

// Plain-English text for a transport failure.
export function describeNetError(err) {
  const type = err && err.type;
  if (type === 'not-found') return 'Room not found. Check the code and try again.';
  if (type === 'timeout') return 'The connection timed out. Some networks and VPNs block peer-to-peer connections. Try again, or try a different network.';
  if (type === 'no-peerjs') return 'Online play could not load. Check your internet connection and reload the page.';
  return 'Could not reach the matchmaking server (' + (type || 'unknown error') + '). Check your internet connection. Some firewalls and VPNs block it.';
}
