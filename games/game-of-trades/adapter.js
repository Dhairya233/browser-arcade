// Plugs the Game of Trades rules into the shared room host (shared/net/host.js).
//
// Players send actions shaped {a, ds, p}: the action name, the data-attributes of what they
// tapped, and an optional payload. The host decides who is acting from the connection; the
// engine decides whether the action is legal; this file decides what each seat may see.

import * as Rules from './engine.js';

export const COLOR_CHOICES = ['#c0392b', '#2c5f8a', '#ede7d9', '#d98a2b', '#3f6b3f', '#8e44ad', '#e8d24a', '#2f2f2f'];
export const HIDE_MODES = ['off', 'first', 'all'];

export const GAME_ACTIONS = new Set(['rollDice', 'startBuildRoad', 'startBuildSettlement', 'startBuildCity', 'cancelBuild', 'clickVertexSettlement', 'clickVertexCity', 'clickEdge', 'clickTile', 'buyDevCard', 'playDevCard', 'openTradeChooser', 'setUiMode', 'sendTrade', 'respondTrade', 'cancelTrade', 'confirmBankTrade', 'doConfirmDiscard', 'chooseVictim', 'resolveMonopolyAction', 'confirmYoPAction', 'endTurn']);

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// What seat `i` is allowed to see: everything public, plus its own hand and cards.
export function viewFor(state, i) {
  const v = JSON.parse(JSON.stringify(state));
  const over = v.phase === 'gameover';
  v.players.forEach((p, j) => {
    p.password = '';
    if (j === i || over) return;
    p.handCount = Object.values(p.resources).reduce((a, b) => a + b, 0);
    p.resources = { wood: 0, brick: 0, ore: 0, wheat: 0, sheep: 0 };
    p.devCards = []; p.newDevCards = [];
  });
  v.devDeck = v.devDeck.map(() => 0);           // how many cards are left is public, which ones they are is not
  if (v.tilesHidden) v.board.tiles.forEach(t => { t.resource = null; t.number = null; t.hasRobber = false; });
  return v;
}

function wellFormed(action) {
  return isPlain(action) && typeof action.a === 'string' && GAME_ACTIONS.has(action.a)
    && (action.ds === undefined || isPlain(action.ds)) && (action.p === undefined || isPlain(action.p));
}

export const gameOfTradesAdapter = {
  id: 'game-of-trades',
  minPlayers: 3,
  maxPlayers: Rules.MAX_PLAYERS,
  colors: COLOR_CHOICES,
  defaultSettings: { hideMode: 'off' },
  validateSetting: (key, value) => key === 'hideMode' && HIDE_MODES.includes(value),
  start: (seats, settings, rng) => Rules.createGame(seats.length, seats.map(s => ({ name: s.name, color: s.color, password: '' })), { hideMode: settings.hideMode }, rng),
  view: viewFor,
  validate: (state, seat, action) => wellFormed(action) && Rules.validateAction(state, seat, action.a, action.ds || {}, action.p || {}),
  apply: (state, seat, action) => Rules.applyAction(state, action.a, action.ds || {}, action.p || {}),
};
