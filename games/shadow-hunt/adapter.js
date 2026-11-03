// Plugs the Shadow Hunt rules into the shared room host (shared/net/host.js).
//
// Players send {cmd, ...} actions. The host decides who is acting from the connection; this file
// decides whether the action is legal for that seat, and what each seat is allowed to see.
// The fugitive's position and secret tickets never leave the host's state except through view().

import * as Engine from './engine.js';
import { secureRandom } from '../../shared/net/ids.js';

// The map is the same every time, built once from a fixed seed.
export const MAP = Engine.buildMap(Engine.seededRand(42));

export const ROUND_CHOICES = [12, 18, 24, 30];
const MOVE_TYPES = ['taxi', 'bus', 'underground'];

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStation = n => Number.isInteger(n) && n >= 0 && n < MAP.stations.length;

// What seat `seat` may see. Player order in the state is the game order (the fugitive first);
// state.seatOf[k] is the room seat that plays game player k.
export function viewFor(state, seat) {
  const me = state.seatOf.indexOf(seat);
  const v = JSON.parse(JSON.stringify(state));
  v.me = me;
  const setup = v.startingPhase;
  v.players.forEach((p, k) => {
    p.picked = p.pos !== null;
    if (k === me || v.gameOver) return;
    if (p.isPhantom) {
      if (!v.phantomVisible) p.pos = null;                       // only shown on a reveal round
      p.tickets.black = null; p.tickets.double = null;       // his secret tickets
    } else if (setup) {
      p.pos = null;                                          // nobody sees a start before the game begins
    }
  });
  if (me !== 0 && !v.doubleFirstDone) v.doubleMovePending = false;   // his plan is secret until he has moved once
  if (setup) v.startPickIdx = me; else delete v.startPickIdx;
  return v;
}

function validate(state, seat, a) {
  if (!isPlain(a) || state.gameOver) return false;
  const p = state.seatOf.indexOf(seat);
  if (p < 0) return false;
  const me = state.players[p];
  if (a.cmd === 'startPick') {
    if (!state.startingPhase || me.pos !== null || !isStation(a.pos)) return false;
    // detectives may not start on the same station as another detective
    return me.isPhantom || !state.players.some((q, k) => k !== p && !q.isPhantom && q.pos === a.pos);
  }
  if (state.startingPhase || state.turn !== p + 1) return false;
  if (a.cmd === 'startDouble') {
    return me.isPhantom && me.tickets.double > 0 && !state.doubleMovePending && !state.doubleFirstDone;
  }
  if (a.cmd === 'move') {
    if (!isStation(a.to) || (a.isBlack !== undefined && typeof a.isBlack !== 'boolean')) return false;
    const moves = Engine.validMoves(state, MAP, p).filter(o => o.to === a.to);
    if (a.isBlack) return me.isPhantom && me.tickets.black > 0 && moves.length > 0;
    return MOVE_TYPES.includes(a.type) && moves.some(o => o.type === a.type);
  }
  return false;
}

function apply(state, seat, a) {
  const p = state.seatOf.indexOf(seat);
  let action;
  if (a.cmd === 'startPick') action = { cmd: 'startPick', playerIdx: p, pos: a.pos };
  else if (a.cmd === 'startDouble') action = { cmd: 'startDouble' };
  else {
    const first = Engine.validMoves(state, MAP, p).find(o => o.to === a.to);
    action = { cmd: 'move', playerIdx: p, to: a.to, type: a.isBlack ? first.type : a.type, isBlack: !!a.isBlack };
  }
  let s = Engine.applyAction(state, MAP, action).state;
  // the last start pick may put a detective on the fugitive's square
  if (a.cmd === 'startPick' && !s.startingPhase) s = Engine.checkStartCollision(s, MAP);
  return { state: s, events: [] };
}

export const shadowHuntAdapter = {
  id: 'shadow-hunt',
  minPlayers: 3,
  maxPlayers: 6,
  defaultSettings: { maxRounds: 24 },
  validateSetting: (key, value) => key === 'maxRounds' && ROUND_CHOICES.includes(value),
  // Who plays the fugitive is drawn with the secure generator, so it cannot be predicted.
  start(seats, settings, rng) {
    const order = Engine.shuffle(seats.map((_, i) => i), rng || secureRandom);
    const state = Engine.newGame(order.map(i => seats[i].name), settings.maxRounds);
    state.seatOf = order;
    return state;
  },
  view: viewFor,
  validate,
  apply,
};
