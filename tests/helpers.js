// Shared test helpers for the netcode tests: a fake clock, a toy game, and a room builder.
import { createMemoryNetwork } from '../shared/net/transport-memory.js';
import { createHost } from '../shared/net/host.js';
import { createClient } from '../shared/net/client.js';
import { makeToken } from '../shared/net/ids.js';

export const flush = () => new Promise(r => setImmediate(r));

// A clock the tests drive by hand. advance() runs every timer that falls due, in order,
// and lets the network settle after each one.
export function fakeClock() {
  let t = 0, nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at: t + ms, fn, every: null }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { at: t + ms, fn, every: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let pickId = null, pick = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!pick || tm.at < pick.at)) { pick = tm; pickId = id; }
        if (!pick) break;
        t = pick.at;
        if (pick.every) pick.at += pick.every; else timers.delete(pickId);
        pick.fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

// A tiny turn-based game with one secret per seat, so hidden-information leaks are easy to spot.
export const toyGame = {
  id: 'toy', minPlayers: 3, maxPlayers: 4,
  colors: ['red', 'blue', 'green', 'gold'],
  defaultSettings: { rounds: 3 },
  validateSetting: (k, v) => k === 'rounds' && Number.isInteger(v) && v > 0 && v < 10,
  start: (seats) => ({ turn: 0, players: seats.map((s, i) => ({ name: s.name, secret: `SECRET-OF-SEAT-${i}`, score: 0 })) }),
  view: (state, seat) => ({ turn: state.turn, players: state.players.map((p, i) => ({ name: p.name, score: p.score, secret: i === seat ? p.secret : undefined })) }),
  validate: (state, seat, a) => !!a && typeof a === 'object' && a.type === 'add' && state.turn === seat && Number.isInteger(a.n) && a.n >= 1 && a.n <= 3,
  apply(state, seat, a) {
    const s = structuredClone(state);
    s.players[seat].score += a.n; s.turn = (s.turn + 1) % s.players.length;
    return { state: s, events: [{ type: 'toast', msg: 'added' }, { type: 'sound', sound: 'ding' }] };
  },
};

// Build a room: one host plus `n - 1` joined clients, all on the in-memory network.
export async function buildRoom(n = 3, { game = toyGame, start = false } = {}) {
  const net = createMemoryNetwork();
  const clock = fakeClock();
  const hostUpdates = [];
  const requests = [];
  const host = createHost({ transport: net.transport(), game, name: 'Host', timers: clock, onUpdate: s => hostUpdates.push(s), onRequest: r => requests.push(r) });
  const code = await host.start();
  const clients = [];
  for (let i = 1; i < n; i++) clients.push(await joinClient({ net, clock, code, name: 'Player' + i }));
  await flush();
  if (start) { host.startGame(); await flush(); }
  return { net, clock, host, code, clients, hostUpdates, requests };
}

export async function joinClient({ net, clock, code, name, token }) {
  const log = { statuses: [], states: [], lobbies: [], nacks: [], endpoint: null, connectTimes: [] };
  const base = net.transport();
  const transport = { listen: base.listen, connect: async c => { log.connectTimes.push(clock.now()); const e = await base.connect(c); log.endpoint = e; return e; } };
  token = token || makeToken();
  const client = createClient({ transport, code, name, token, timers: clock,
    onStatus: (s, d) => log.statuses.push(d ? `${s}:${d}` : s), onLobby: m => log.lobbies.push(m), onState: m => log.states.push(m), onNack: r => log.nacks.push(r) });
  await client.connect();
  await flush();
  return Object.assign(client, { log, token, name });
}

// A hand-driven connection for hostile tests: send anything, read everything the host sent back.
export async function rawConnection(net, code) {
  const end = await net.transport().connect(code);
  await flush();
  return {
    send: s => end.send(typeof s === 'string' ? s : JSON.stringify(s)),
    received: () => end.peer.sent.map(s => { try { return JSON.parse(s); } catch (e) { return s; } }),
    receivedRaw: () => end.peer.sent.slice(),
    end,
  };
}

// Everything the host has sent to one player, as one string.
export const wireTo = client => client.log.endpoint.peer.sent.join('\n');
export const lastState = client => client.log.states[client.log.states.length - 1];
